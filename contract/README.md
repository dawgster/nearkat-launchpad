# Nearkat NFT contract

NEAR contract holding each kat's ownership, context hash and inference balance.
Design: `../docs/superpowers/specs/2026-10-13-nearkat-ai-nft-design.md`.

## Test

```bash
cargo test            # unit tests, then sandbox tests against the compiled wasm
cargo clippy --all-targets
cargo fmt --check
```

The first sandbox run downloads a NEAR sandbox binary and builds the wasm, so
it takes a few minutes.

## Build

```bash
cargo near build non-reproducible-wasm
```

Needs cargo-near 0.22.0 or newer; older releases refuse current Rust
toolchains. The wasm is written to `target/near/nearkat_nft.wasm`. Running the
sandbox tests builds the same file.
