#!/bin/sh
# Adds path remaps so the wasm carries no home dir or checkout name.
rustc="$1"; shift
exec "$rustc" "$@" --remap-path-prefix="$HOME/.cargo=/cargo" --remap-path-prefix="$HOME/.rustup=/rustup" --remap-path-prefix="$PROBE_ROOT=/build" --remap-path-prefix="$HOME=/build"
