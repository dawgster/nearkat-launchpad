"""Rebuild a run's ONNX model from its trained head (JSON on stdin) and the public backbone.

The head is what `train.py --head-out` wrote. The backbone is read from torch's hub cache,
as in `train.py`, and must be the one the head was trained on. With the same libraries the
file is byte for byte the one `train.py` exported, so it has the SHA-256 the run recorded.
"""
import argparse
import base64
import binascii
import json
import sys
from pathlib import Path

import numpy as np
import torch

from train import FEATURES, WEIGHTS_SHA256, Classifier, Fail, emit, export_onnx, load_backbone

# A dataset has at most this many classes (MAX_CLASSES in contract/src/dataset.rs).
MAX_CLASSES = 16


def read_head(stream) -> tuple[np.ndarray, np.ndarray]:
    try:
        head = json.load(stream)
        features = head["features"]
        backbone = head["backbone_sha256"]
        weight = np.frombuffer(base64.b64decode(head["weight"], validate=True), dtype="<f4")
        bias = np.frombuffer(base64.b64decode(head["bias"], validate=True), dtype="<f4")
    except (ValueError, KeyError, TypeError, binascii.Error):
        raise Fail("malformed head")
    if features != FEATURES or backbone != WEIGHTS_SHA256:
        raise Fail("the head was trained on another backbone")
    classes = len(bias)
    if not 2 <= classes <= MAX_CLASSES or len(weight) != classes * FEATURES:
        raise Fail("the head has the wrong shape")
    if not (np.isfinite(weight).all() and np.isfinite(bias).all()):
        raise Fail("the head has values that are not numbers")
    return weight.reshape(classes, FEATURES), bias


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    weight, bias = read_head(sys.stdin)
    model = Classifier(load_backbone(), len(bias)).eval()
    with torch.no_grad():
        model.head.weight.copy_(torch.from_numpy(weight.copy()))
        model.head.bias.copy_(torch.from_numpy(bias.copy()))
    export_onnx(model, args.out)
    emit({"stage": "done", "classes": len(bias)})
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Fail as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(2)
    except Exception as e:
        print(f"error: {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(1)
