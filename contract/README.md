# Nearkat NFT contract

NEAR contract holding each kat's ownership, context hash and inference balance.
It is also the code every launchpad collection runs (see `../launchpad`).

`new` takes a `collection` with `name`, `symbol` and `base_uri`, and optionally
`prompt` (shared by every token, with `{name}` and `{token_id}` filled in),
`starter` (the context each token starts from), `max_supply`, and `tee`
(`{ "Phala": { "app_id": "…" } }`: contexts may only be opened inside that
Phala app). Empty `prompt` and `starter` give the original Nearkat. All are
public through `get_collection` and fixed at deployment.

Mint revenue accrues for the treasury (`withdraw_treasury`, admin). Inference
charges accrue for the keeper, which pays for inference
(`withdraw_inference`, keeper).
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
