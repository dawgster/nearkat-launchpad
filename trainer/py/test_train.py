import base64
import io
import json
import subprocess
import sys
import time
from pathlib import Path

import onnx
from PIL import Image

HERE = Path(__file__).parent
COLORS = {"hotdog": (220, 20, 20), "not_hotdog": (20, 20, 220)}


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


def make_heldout(tmp_path):
    root = tmp_path / "heldout"
    for label, color in COLORS.items():
        (root / label).mkdir(parents=True)
        for i in range(5):
            (root / label / f"{i}.jpg").write_bytes(jpeg(color, i * 3))
    return root


def run(tmp_path, *extra, stdin=None):
    out = tmp_path / "m.onnx"
    proc = subprocess.run(
        [sys.executable, str(HERE / "train.py"), "--classes", "hotdog,not_hotdog",
         "--heldout", str(make_heldout(tmp_path)), "--out", str(out), *extra],
        input=stdin if stdin is not None else stdin_lines(),
        capture_output=True, text=True, cwd=HERE,
    )
    return proc, out


def test_learns_a_separable_toy_set(tmp_path):
    proc, out = run(tmp_path, "--epochs", "8", "--seconds", "40")
    assert proc.returncode == 0, proc.stderr
    events = [json.loads(l) for l in proc.stdout.splitlines()]
    assert events[0] == {"stage": "loaded", "count": 40}
    done = events[-1]
    assert done["stage"] == "done" and done["heldout"] == 10
    assert done["accuracy"] >= 0.9
    assert out.exists()


def test_onnx_matches_the_input_contract(tmp_path):
    proc, out = run(tmp_path, "--epochs", "1")
    assert proc.returncode == 0, proc.stderr
    graph = onnx.load(str(out)).graph
    assert [i.name for i in graph.input] == ["image"]
    dims = [d.dim_value for d in graph.input[0].type.tensor_type.shape.dim]
    assert dims[1:] == [3, 64, 64]
    assert [o.name for o in graph.output] == ["logits"]
    assert graph.output[0].type.tensor_type.shape.dim[-1].dim_value == 2


def test_onnx_is_one_self_contained_file(tmp_path):
    # The app reads back only --out, and onnxruntime-web can't open external data.
    proc, out = run(tmp_path, "--epochs", "1")
    assert proc.returncode == 0, proc.stderr
    assert sorted(p.name for p in out.parent.iterdir() if p.name.startswith("m.onnx")) == ["m.onnx"]
    model = onnx.load(str(out), load_external_data=False)
    assert all(t.data_location != onnx.TensorProto.EXTERNAL for t in model.graph.initializer)


def test_refuses_an_unknown_label(tmp_path):
    bad = json.dumps({"label": "pizza", "jpeg": base64.b64encode(jpeg((0, 0, 0))).decode()})
    proc, _ = run(tmp_path, "--epochs", "1", stdin=stdin_lines([bad]))
    assert proc.returncode != 0
    assert "pizza" in proc.stderr


def test_respects_the_time_cap(tmp_path):
    start = time.time()
    proc, out = run(tmp_path, "--seconds", "2", "--epochs", "1000")
    assert proc.returncode == 0, proc.stderr
    assert time.time() - start < 10
    assert out.exists()
