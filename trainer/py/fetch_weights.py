"""Puts the trainer's backbone weights in torch's hub cache (TORCH_HOME), for offline runs.

torchvision downloads them and checks the hash in their file name; the full
SHA-256 pinned in train.py is checked when they are loaded. Does nothing if
they are already there.
"""
import sys

import train

if __name__ == "__main__":
    try:
        if not train.weights_path().is_file():
            train.WEIGHTS.get_state_dict(progress=False, check_hash=True)
        train.load_backbone()
    except train.Fail as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(2)
    print(train.weights_path())
