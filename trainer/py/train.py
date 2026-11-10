"""Train a linear SVM on frozen MobileNetV3-Large features of labelled JPEGs on stdin; export to ONNX.

The backbone is torchvision's ImageNet MobileNetV3-Large with its classifier removed. Its
weights are read from torch's hub cache (TORCH_HOME) and never downloaded here:
`fetch_weights.py` puts them there.

Privacy: images are decoded in memory only and never written to disk or printed.
"""
import time

START = time.monotonic()

import argparse  # noqa: E402
import base64  # noqa: E402
import binascii  # noqa: E402
import contextlib  # noqa: E402
import hashlib  # noqa: E402
import io  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import random  # noqa: E402
import sys  # noqa: E402
from pathlib import Path  # noqa: E402

import numpy as np  # noqa: E402
import torch  # noqa: E402
from PIL import Image  # noqa: E402
from sklearn.svm import LinearSVC  # noqa: E402
from torch import nn  # noqa: E402
from torchvision import models, transforms  # noqa: E402

# The model's input: RGB in [0,1], channels first, squashed (not cropped) to this square.
INPUT_SIZE = 224
INPUT_CHANNELS = 3
# ImageNet normalisation, applied inside the exported graph.
MEAN = (0.485, 0.456, 0.406)
STD = (0.229, 0.224, 0.225)
FEATURES = 960
# torchvision's MobileNetV3-Large ImageNet weights, pinned by their full SHA-256.
WEIGHTS = models.MobileNet_V3_Large_Weights.IMAGENET1K_V2
WEIGHTS_SHA256 = "5c1a416349c4cf298f2a6a5e2600ed0ee55e604713578f5e74e6bc8bcaef7997"
# The SVM's regularisation, measured on the hotdog set (held-out and cross-validated).
SVM_C = 0.01
# What an output for a class with no training sample is pinned to, so it never wins.
ABSENT_LOGIT = -1e4
BATCH_SIZE = 32
# The fewest samples a run trains on; MIN_RUN_SAMPLES in trainer/src/run.ts matches.
MIN_SAMPLES = 2
# Training images are small; a header claiming more pixels than this is refused before decoding.
MAX_SAMPLE_PIXELS = 4096 * 4096
HELDOUT_SUFFIXES = {".jpg", ".jpeg"}


class Fail(Exception):
    pass


def weights_path() -> Path:
    """Where torch's hub cache (TORCH_HOME) keeps the backbone's weights."""
    return Path(torch.hub.get_dir()) / "checkpoints" / Path(WEIGHTS.url).name


def load_backbone() -> nn.Module:
    """MobileNetV3-Large with its classifier removed: 960 pooled features an image. Offline only."""
    path = weights_path()
    if not path.is_file():
        raise Fail(
            f"backbone weights not found at {path}; run `uv run python fetch_weights.py` "
            "(TORCH_HOME chooses where they go)"
        )
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != WEIGHTS_SHA256:
        raise Fail(f"backbone weights at {path} do not match their pinned hash")
    backbone = models.mobilenet_v3_large()
    backbone.load_state_dict(torch.load(io.BytesIO(raw), weights_only=True))
    backbone.classifier = nn.Identity()
    return backbone.eval()


class Classifier(nn.Module):
    """[N, 3, 224, 224] RGB in [0,1] in, one logit a class out."""

    def __init__(self, backbone: nn.Module, num_classes: int) -> None:
        super().__init__()
        self.register_buffer("mean", torch.tensor(MEAN).view(1, 3, 1, 1))
        self.register_buffer("std", torch.tensor(STD).view(1, 3, 1, 1))
        self.backbone = backbone
        self.head = nn.Linear(FEATURES, num_classes)

    def features(self, images: torch.Tensor) -> torch.Tensor:
        return self.backbone((images - self.mean) / self.std)

    def forward(self, images: torch.Tensor) -> torch.Tensor:
        return self.head(self.features(images))


# Pillow's bilinear resize, which the browser's preprocessing matches.
TRANSFORM = transforms.Compose([transforms.Resize((INPUT_SIZE, INPUT_SIZE)), transforms.ToTensor()])


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
            items.append((TRANSFORM(img.convert("RGB")), idx))
    return items


def check_time(deadline: float) -> None:
    if time.monotonic() >= deadline:
        raise Fail("ran out of time (--seconds)")


def extract(model: Classifier, images: list[torch.Tensor], deadline: float) -> np.ndarray:
    """The backbone's features for every image, a batch at a time."""
    out = []
    with torch.no_grad():
        for i in range(0, len(images), BATCH_SIZE):
            check_time(deadline)
            out.append(model.features(torch.stack(images[i : i + BATCH_SIZE])).numpy())
    return np.concatenate(out)


def fit_head(features: np.ndarray, labels: np.ndarray, num_classes: int):
    """
    A linear SVM's weights as one row a class, so the class with the biggest
    output is the SVM's prediction. Returns (weight, bias, mean squared hinge loss).
    """
    weight = np.zeros((num_classes, features.shape[1]), dtype=np.float32)
    bias = np.full(num_classes, ABSENT_LOGIT, dtype=np.float32)
    present = np.unique(labels)
    if len(present) == 1:
        # Nothing to tell apart: always the one class seen.
        bias[present[0]] = 0.0
        return weight, bias, 0.0
    svm = LinearSVC(C=SVM_C, random_state=0).fit(features, labels)
    coef = svm.coef_.astype(np.float32)
    intercept = svm.intercept_.astype(np.float32)
    if len(present) == 2:
        # One decision value d, positive for the second class: outputs [-d, d].
        coef = np.concatenate([-coef, coef])
        intercept = np.concatenate([-intercept, intercept])
    weight[svm.classes_] = coef
    bias[svm.classes_] = intercept
    # One-vs-rest squared hinge, what LinearSVC minimises, over the classes seen.
    targets = np.where(labels[:, None] == svm.classes_[None, :], 1.0, -1.0)
    margins = features @ coef.T + intercept
    loss = float(np.mean(np.maximum(0.0, 1.0 - targets * margins) ** 2))
    return weight, bias, loss


def evaluate(model: nn.Module, items, deadline: float) -> float:
    model.eval()
    correct = 0
    with torch.no_grad():
        for i in range(0, len(items), BATCH_SIZE):
            check_time(deadline)
            chunk = items[i : i + BATCH_SIZE]
            preds = model(torch.stack([x for x, _ in chunk])).argmax(dim=1)
            correct += sum(int(p) == y for p, (_, y) in zip(preds.tolist(), chunk))
    return correct / len(items)


def export_onnx(model: nn.Module, out: Path) -> None:
    model.eval()
    dummy = torch.zeros(1, INPUT_CHANNELS, INPUT_SIZE, INPUT_SIZE)
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


def train(samples, classes, deadline: float) -> Classifier:
    """Frozen backbone, linear SVM head. Reports one epoch: the SVM's fit."""
    model = Classifier(load_backbone(), len(classes)).eval()
    features = extract(model, [TRANSFORM(img) for img, _ in samples], deadline)
    labels = np.array([y for _, y in samples])
    check_time(deadline)
    weight, bias, loss = fit_head(features, labels, len(classes))
    with torch.no_grad():
        model.head.weight.copy_(torch.from_numpy(weight))
        model.head.bias.copy_(torch.from_numpy(bias))
    emit({"stage": "epoch", "epoch": 1, "epochs": 1, "loss": loss})
    return model


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--classes", required=True)
    parser.add_argument("--heldout", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    # Accepted for compatibility: the SVM is fitted once, so a run is always one epoch.
    parser.add_argument("--epochs", type=int, default=1)
    # The budget for training, scoring and export, counted once every sample is read
    # (they stream in as they are fetched, which takes as long as it takes); past it the run fails.
    parser.add_argument("--seconds", type=float, default=120)
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
    # And without the backbone it can't train: fail before reading any sample.
    if not weights_path().is_file():
        load_backbone()
    samples = read_samples(sys.stdin, classes)
    if len(samples) < MIN_SAMPLES:
        raise Fail(f"training needs at least {MIN_SAMPLES} samples")
    emit({"stage": "loaded", "count": len(samples)})

    deadline = time.monotonic() + args.seconds
    model = train(samples, classes, deadline)
    heldout = load_heldout(heldout_files)
    accuracy = evaluate(model, heldout, deadline)
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
