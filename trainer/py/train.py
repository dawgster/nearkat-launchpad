"""Train a tiny CNN from labelled JPEGs on stdin and export it to ONNX.

Privacy: images are decoded in memory only and never written to disk or printed.
"""
import time

START = time.monotonic()

import argparse  # noqa: E402
import base64  # noqa: E402
import binascii  # noqa: E402
import contextlib  # noqa: E402
import io  # noqa: E402
import json  # noqa: E402
import math  # noqa: E402
import os  # noqa: E402
import random  # noqa: E402
import sys  # noqa: E402
from pathlib import Path  # noqa: E402

import torch  # noqa: E402
from PIL import Image  # noqa: E402
from torch import nn  # noqa: E402
from torchvision import transforms  # noqa: E402

# Architecture constants copied from near_nn hotdog_cnn_contract/scripts/export_model.py
INPUT_WIDTH = 64
INPUT_HEIGHT = 64
INPUT_CHANNELS = 3
CONV1_STRIDE = 2
CONV1_OUT_CHANNELS = 16
CONV2_OUT_CHANNELS = 32
CONV3_OUT_CHANNELS = 48
MLP_HIDDEN_SIZE = 9432

BATCH_SIZE = 16
LEARNING_RATE = 2e-3
WEIGHT_DECAY = 1e-4
CROP_SCALE_MIN = 0.65
JITTER = 0.15
# Training images are small; a header claiming more pixels than this is refused before decoding.
MAX_SAMPLE_PIXELS = 4096 * 4096
HELDOUT_SUFFIXES = {".jpg", ".jpeg"}


class Fail(Exception):
    pass


class TinyHotdogCnn(nn.Module):
    def __init__(self, num_classes: int) -> None:
        super().__init__()
        self.conv1 = nn.Conv2d(
            INPUT_CHANNELS, CONV1_OUT_CHANNELS, kernel_size=3, stride=CONV1_STRIDE, padding=1
        )
        self.bn1 = nn.BatchNorm2d(CONV1_OUT_CHANNELS)
        self.conv2 = nn.Conv2d(CONV1_OUT_CHANNELS, CONV2_OUT_CHANNELS, kernel_size=3, padding=1)
        self.bn2 = nn.BatchNorm2d(CONV2_OUT_CHANNELS)
        self.conv3 = nn.Conv2d(CONV2_OUT_CHANNELS, CONV3_OUT_CHANNELS, kernel_size=3, padding=1)
        self.bn3 = nn.BatchNorm2d(CONV3_OUT_CHANNELS)
        self.relu = nn.ReLU()
        self.pool = nn.MaxPool2d(kernel_size=2)
        self.avg_pool = nn.AdaptiveAvgPool2d((1, 1))
        self.fc1 = nn.Linear(CONV3_OUT_CHANNELS, MLP_HIDDEN_SIZE)
        self.fc2 = nn.Linear(MLP_HIDDEN_SIZE, num_classes)

    def forward(self, images: torch.Tensor) -> torch.Tensor:
        images = self.pool(self.relu(self.bn1(self.conv1(images))))
        images = self.pool(self.relu(self.bn2(self.conv2(images))))
        images = self.avg_pool(self.relu(self.bn3(self.conv3(images))))
        images = self.relu(self.fc1(images.flatten(1)))
        return self.fc2(images)


TRAIN_TRANSFORM = transforms.Compose(
    [
        transforms.Resize((72, 72)),
        transforms.RandomResizedCrop((INPUT_HEIGHT, INPUT_WIDTH), scale=(CROP_SCALE_MIN, 1.0)),
        transforms.RandomHorizontalFlip(),
        transforms.ColorJitter(
            brightness=JITTER, contrast=JITTER, saturation=JITTER, hue=min(JITTER / 5.0, 0.08)
        ),
        transforms.ToTensor(),
    ]
)
EVAL_TRANSFORM = transforms.Compose(
    [transforms.Resize((INPUT_HEIGHT, INPUT_WIDTH)), transforms.ToTensor()]
)


def emit(obj: dict) -> None:
    print(json.dumps(obj), flush=True)


def read_samples(stream, classes: list[str]) -> list[tuple[Image.Image, int]]:
    samples = []
    for n, line in enumerate(stream, 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
            label = row["label"]
            raw = base64.b64decode(row["jpeg"], validate=True)
        except (ValueError, KeyError, TypeError, binascii.Error):
            raise Fail(f"line {n}: malformed sample")
        if label not in classes:
            raise Fail(f"line {n}: unknown label {label!r}")
        try:
            img = Image.open(io.BytesIO(raw))
        except Exception:
            raise Fail(f"line {n}: undecodable image (label {label!r})")
        # Image.open reads only the header: check the size before decoding the pixels.
        width, height = img.size
        if width * height > MAX_SAMPLE_PIXELS:
            raise Fail(f"line {n}: image too large (label {label!r})")
        try:
            img = img.convert("RGB")
        except Exception:
            raise Fail(f"line {n}: undecodable image (label {label!r})")
        samples.append((img, classes.index(label)))
    return samples


def heldout_paths(root: Path, classes: list[str]) -> list[tuple[Path, int]]:
    """Every class's held-out JPEGs (.jpg or .jpeg, any case). Fails unless every class has some."""
    paths = []
    for idx, cls in enumerate(classes):
        folder = root / cls
        found = (
            sorted(p for p in folder.iterdir() if p.suffix.lower() in HELDOUT_SUFFIXES)
            if folder.is_dir()
            else []
        )
        if not found:
            raise Fail(f"no held-out images for class {cls!r}")
        paths.extend((p, idx) for p in found)
    return paths


def load_heldout(paths: list[tuple[Path, int]]) -> list[tuple[torch.Tensor, int]]:
    items = []
    for path, idx in paths:
        with Image.open(path) as img:
            items.append((EVAL_TRANSFORM(img.convert("RGB")), idx))
    return items


def evaluate(model: nn.Module, items) -> float:
    model.eval()
    correct = 0
    with torch.no_grad():
        for i in range(0, len(items), 64):
            chunk = items[i : i + 64]
            preds = model(torch.stack([x for x, _ in chunk])).argmax(dim=1)
            correct += sum(int(p) == y for p, (_, y) in zip(preds.tolist(), chunk))
    return correct / len(items)


def export_onnx(model: nn.Module, out: Path) -> None:
    model.eval()
    dummy = torch.zeros(1, INPUT_CHANNELS, INPUT_HEIGHT, INPUT_WIDTH)
    # The exporter chats on stdout; stdout is reserved for JSON events.
    with contextlib.redirect_stdout(sys.stderr):
        torch.onnx.export(
            model,
            (dummy,),
            str(out),
            input_names=["image"],
            output_names=["logits"],
            dynamic_shapes={"images": {0: torch.export.Dim("batch")}},
            # One file: the app reads back only `out`, and onnxruntime-web can't open external data.
            external_data=False,
        )


def train(samples, classes, epochs: int, seconds: float):
    model = TinyHotdogCnn(len(classes))
    optimizer = torch.optim.AdamW(model.parameters(), lr=LEARNING_RATE, weight_decay=WEIGHT_DECAY)
    loss_fn = nn.CrossEntropyLoss()
    # Leave room for evaluation and export inside the overall budget.
    deadline = START + seconds - min(6.0, 0.25 * seconds)
    # Batches of one are skipped, so they don't count.
    steps_per_epoch = max(1, len(samples) // BATCH_SIZE + (len(samples) % BATCH_SIZE >= 2))
    total_steps = epochs * steps_per_epoch
    train_start = time.monotonic()
    step = 0
    for epoch in range(1, epochs + 1):
        if time.monotonic() >= deadline and epoch > 1:
            break
        model.train()
        order = list(range(len(samples)))
        random.shuffle(order)
        total_loss, seen = 0.0, 0
        for i in range(0, len(order), BATCH_SIZE):
            batch = order[i : i + BATCH_SIZE]
            if len(batch) < 2:  # BatchNorm needs more than one sample
                continue
            now = time.monotonic()
            if now >= deadline and step > 0:
                break
            # Cosine schedule over whichever limit (steps or time) is nearer.
            progress = max(step / total_steps, (now - train_start) / max(deadline - train_start, 1e-6))
            for group in optimizer.param_groups:
                group["lr"] = LEARNING_RATE * 0.5 * (1 + math.cos(math.pi * min(progress, 1.0)))
            images = torch.stack([TRAIN_TRANSFORM(samples[j][0]) for j in batch])
            labels = torch.tensor([samples[j][1] for j in batch])
            optimizer.zero_grad()
            loss = loss_fn(model(images), labels)
            loss.backward()
            optimizer.step()
            total_loss += loss.item() * len(batch)
            seen += len(batch)
            step += 1
        if seen == 0:  # the time ran out before this epoch's first batch
            break
        emit({"stage": "epoch", "epoch": epoch, "epochs": epochs, "loss": total_loss / seen})
    if step == 0:
        raise Fail("nothing was trained")
    return model


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--classes", required=True)
    parser.add_argument("--heldout", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--seconds", type=float, default=45)
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()
    classes = [c for c in args.classes.split(",") if c]
    if len(classes) < 2 or len(set(classes)) != len(classes):
        raise Fail("--classes needs at least two distinct names")
    if args.epochs < 1:
        raise Fail("--epochs must be at least 1")

    torch.manual_seed(args.seed)
    random.seed(args.seed)
    torch.set_num_threads(os.cpu_count() or 1)

    # Checked first: a run without a held-out set can't report its accuracy.
    heldout_files = heldout_paths(args.heldout, classes)
    samples = read_samples(sys.stdin, classes)
    if len(samples) < 2:
        raise Fail("training needs at least two samples")
    emit({"stage": "loaded", "count": len(samples)})

    model = train(samples, classes, args.epochs, args.seconds)
    heldout = load_heldout(heldout_files)
    accuracy = evaluate(model, heldout)
    export_onnx(model, args.out)
    emit(
        {
            "stage": "done",
            "accuracy": accuracy,
            "heldout": len(heldout),
            "seconds": round(time.monotonic() - START, 2),
        }
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Fail as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(2)
    except Exception as e:  # never echo data; type and message of library errors only
        print(f"error: {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(1)
