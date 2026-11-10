import base64
import io
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import pytest
import torch
from PIL import Image

import train

HERE = Path(__file__).parent
COLORS = {"hotdog": (220, 20, 20), "not_hotdog": (20, 20, 220)}


@pytest.fixture(scope="session", autouse=True)
def weights():
    """The backbone's weights, downloaded once into torch's cache; skips if that can't be done."""
    if not train.weights_path().is_file():
        try:
            train.WEIGHTS.get_state_dict(progress=False, check_hash=True)
        except Exception as e:  # offline
            pytest.skip(
                f"backbone weights unavailable ({type(e).__name__}); "
                "run `uv run python fetch_weights.py` once with network access"
            )
    return train.weights_path()


def jpeg(color, shade=0):
    img = Image.new("RGB", (80, 80), tuple(min(255, max(0, c + shade)) for c in color))
    buf = io.BytesIO()
    img.save(buf, "JPEG")
    return buf.getvalue()


def stdin_lines(extra=()):
    lines = []
    for label, color in COLORS.items():
        for i in range(20):
            lines.append(json.dumps({"label": label, "jpeg": base64.b64encode(jpeg(color, i)).decode()}))
    lines.extend(extra)
    return "\n".join(lines) + "\n"


def make_heldout(tmp_path, suffix=".jpg"):
    root = tmp_path / "heldout"
    for label, color in COLORS.items():
        (root / label).mkdir(parents=True)
        for i in range(5):
            (root / label / f"{i}{suffix}").write_bytes(jpeg(color, i * 3))
    return root


def run(tmp_path, *extra, stdin=None, heldout=None, env=None):
    out = tmp_path / "m.onnx"
    proc = subprocess.run(
        [sys.executable, str(HERE / "train.py"), "--classes", "hotdog,not_hotdog",
         "--heldout", str(heldout or make_heldout(tmp_path)), "--out", str(out), *extra],
        input=stdin if stdin is not None else stdin_lines(),
        capture_output=True, text=True, cwd=HERE, env={**os.environ, **(env or {})},
    )
    return proc, out


@pytest.fixture(scope="module")
def trained(tmp_path_factory):
    """One full run, shared: (process, model path, held-out dir)."""
    tmp_path = tmp_path_factory.mktemp("run")
    proc, out = run(tmp_path, "--epochs", "30")
    assert proc.returncode == 0, proc.stderr
    return proc, out, tmp_path / "heldout"


def test_learns_a_separable_toy_set(trained):
    proc, out, _ = trained
    events = [json.loads(l) for l in proc.stdout.splitlines()]
    assert events[0] == {"stage": "loaded", "count": 40}
    # The SVM is fitted once: one epoch, whatever --epochs asked for.
    assert [(e["epoch"], e["epochs"]) for e in events if e["stage"] == "epoch"] == [(1, 1)]
    done = events[-1]
    assert done["stage"] == "done" and done["heldout"] == 10
    assert done["accuracy"] >= 0.9
    assert out.exists()


def test_onnx_matches_the_input_contract(trained):
    _, out, _ = trained
    proto = onnx.load(str(out))
    graph = proto.graph
    assert [i.name for i in graph.input] == ["image"]
    dims = graph.input[0].type.tensor_type.shape.dim
    # The batch dimension is symbolic; then RGB, 224×224.
    assert dims[0].dim_param
    assert [d.dim_value for d in dims[1:]] == [3, train.INPUT_SIZE, train.INPUT_SIZE] == [3, 224, 224]
    assert [o.name for o in graph.output] == ["logits"]
    assert graph.output[0].type.tensor_type.shape.dim[-1].dim_value == 2
    # An opset onnxruntime-web runs.
    assert 17 <= max(o.version for o in proto.opset_import if o.domain in ("", "ai.onnx")) <= 23


def test_onnx_is_one_self_contained_file(trained):
    # The app reads back only --out, and onnxruntime-web can't open external data.
    _, out, _ = trained
    assert sorted(p.name for p in out.parent.iterdir() if p.name.startswith("m.onnx")) == ["m.onnx"]
    model = onnx.load(str(out), load_external_data=False)
    assert all(t.data_location != onnx.TensorProto.EXTERNAL for t in model.graph.initializer)


def test_onnx_predicts_like_the_torch_model_and_the_svm(tmp_path):
    # A head fitted on real features, normalisation inside the graph, any batch size.
    rng = np.random.default_rng(0)
    model = train.Classifier(train.load_backbone(), 2).eval()
    images = [train.TRANSFORM(Image.open(io.BytesIO(jpeg(c, s))).convert("RGB"))
              for c in COLORS.values() for s in (0, 30)]
    images += [torch.from_numpy(rng.random((3, 224, 224), dtype=np.float32)) for _ in range(2)]
    features = train.extract(model, images, float("inf"))
    labels = np.array([0, 0, 1, 1, 0, 1])
    weight, bias, _ = train.fit_head(features, labels, 2)
    with torch.no_grad():
        model.head.weight.copy_(torch.from_numpy(weight))
        model.head.bias.copy_(torch.from_numpy(bias))
    out = tmp_path / "m.onnx"
    train.export_onnx(model, out)

    batch = torch.stack(images)
    with torch.no_grad():
        expected = model(batch).numpy()
    (got,) = ort.InferenceSession(str(out)).run(None, {"image": batch.numpy()})
    assert got.shape == (6, 2)
    np.testing.assert_allclose(got, expected, rtol=1e-3, atol=1e-3)
    svm = train.LinearSVC(C=train.SVM_C, random_state=0).fit(features, labels)
    assert got.argmax(1).tolist() == svm.predict(features).tolist()


def test_the_head_picks_what_the_svm_picks_for_more_classes():
    rng = np.random.default_rng(1)
    centers = rng.normal(size=(3, 8)) * 4
    labels = np.repeat([0, 2, 3], 10)  # class 1 has no sample
    features = (centers[np.searchsorted([0, 2, 3], labels)] + rng.normal(size=(30, 8))).astype(np.float32)
    weight, bias, loss = train.fit_head(features, labels, 4)
    svm = train.LinearSVC(C=train.SVM_C, random_state=0).fit(features, labels)
    assert (features @ weight.T + bias).argmax(1).tolist() == svm.predict(features).tolist()
    assert bias[1] == train.ABSENT_LOGIT and not weight[1].any()
    assert loss >= 0


def test_one_class_seen_always_predicts_it():
    features = np.ones((3, 4), dtype=np.float32)
    weight, bias, loss = train.fit_head(features, np.array([1, 1, 1]), 2)
    assert (features @ weight.T + bias).argmax(1).tolist() == [1, 1, 1]
    assert loss == 0.0


def test_refuses_to_run_without_the_weights(tmp_path):
    proc, out = run(tmp_path, env={"TORCH_HOME": str(tmp_path / "empty")})
    assert proc.returncode == 2
    assert "backbone weights not found" in proc.stderr
    assert proc.stdout == "" and not out.exists()


def test_refuses_an_unknown_label(tmp_path):
    bad = json.dumps({"label": "pizza", "jpeg": base64.b64encode(jpeg((0, 0, 0))).decode()})
    proc, _ = run(tmp_path, stdin=stdin_lines([bad]))
    assert proc.returncode != 0
    assert "pizza" in proc.stderr


def test_respects_the_time_cap(tmp_path):
    proc, out = run(tmp_path, "--seconds", "0")
    assert proc.returncode == 2
    assert "ran out of time" in proc.stderr
    assert not out.exists()


def test_reads_jpeg_held_out_files_in_any_case(tmp_path):
    proc, _ = run(tmp_path, heldout=make_heldout(tmp_path, ".JPEG"))
    assert proc.returncode == 0, proc.stderr
    assert json.loads(proc.stdout.splitlines()[-1])["heldout"] == 10


def test_refuses_a_missing_held_out_class(tmp_path):
    root = make_heldout(tmp_path)
    for f in (root / "not_hotdog").iterdir():
        f.unlink()
    proc, out = run(tmp_path, heldout=root)
    assert proc.returncode == 2
    assert "no held-out images for class 'not_hotdog'" in proc.stderr
    assert proc.stdout == "" and not out.exists()


def test_refuses_a_single_sample(tmp_path):
    one = json.dumps({"label": "hotdog", "jpeg": base64.b64encode(jpeg((1, 2, 3))).decode()})
    proc, out = run(tmp_path, stdin=one + "\n")
    assert proc.returncode == 2
    assert "at least 2 samples" in proc.stderr
    assert not out.exists()


def test_refuses_an_oversized_image_before_decoding_it(tmp_path):
    buf = io.BytesIO()
    Image.new("RGB", (4100, 4100)).save(buf, "JPEG")
    big = json.dumps({"label": "hotdog", "jpeg": base64.b64encode(buf.getvalue()).decode()})
    proc, _ = run(tmp_path, stdin=stdin_lines([big]))
    assert proc.returncode == 2
    assert "line 41: image too large (label 'hotdog')" in proc.stderr
