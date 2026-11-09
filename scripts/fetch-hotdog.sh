#!/usr/bin/env bash
# Fetches the hotdog / not-hotdog images from https://github.com/truepositive/hotdog_nothotdog
# (AGPL-3.0). Images are never committed; data/ and the held-out dirs are gitignored.
set -euo pipefail

REPO=https://github.com/truepositive/hotdog_nothotdog
COMMIT=c719396d87a52102a78a683ac4394086a4a7190a

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/data/hotdog-src"
TRAIN="$ROOT/data/hotdog/train"
HELD_TRAINER="$ROOT/trainer/heldout"
HELD_WEB="$ROOT/web/public/heldout"
CLASSES=(hotdog not_hotdog)

# Shallow clone pinned to an exact commit (reuse an existing checkout).
if [ ! -d "$SRC/.git" ]; then
  mkdir -p "$SRC"
  git -C "$SRC" init -q
  git -C "$SRC" remote add origin "$REPO"
fi
if [ "$(git -C "$SRC" rev-parse -q --verify HEAD 2>/dev/null || true)" != "$COMMIT" ]; then
  git -C "$SRC" fetch -q --depth 1 origin "$COMMIT"
fi
git -C "$SRC" checkout -q --force "$COMMIT"

# Rebuild outputs from scratch so re-runs never duplicate.
rm -rf "$TRAIN" "$HELD_TRAINER" "$HELD_WEB"
for c in "${CLASSES[@]}"; do
  mkdir -p "$TRAIN/$c" "$HELD_TRAINER/$c" "$HELD_WEB/$c"
  cp "$SRC"/train/"$c"/*.jpg "$TRAIN/$c/"
  cp "$SRC"/val/"$c"/*.jpg "$HELD_TRAINER/$c/"
  cp "$SRC"/val/"$c"/*.jpg "$HELD_WEB/$c/"
done

# Manifest for the browser.
python3 - "$HELD_WEB" "${CLASSES[@]}" <<'PY'
import json, os, sys
root, classes = sys.argv[1], sys.argv[2:]
files = [{"path": f"{c}/{f}", "label": c}
         for c in classes for f in sorted(os.listdir(os.path.join(root, c)))]
with open(os.path.join(root, "manifest.json"), "w") as out:
    json.dump({"classes": classes, "files": files}, out)
PY

echo "hotdog @ ${COMMIT:0:7}: train $(find "$TRAIN" -name '*.jpg' | wc -l), held-out $(find "$HELD_WEB" -name '*.jpg' | wc -l)"
