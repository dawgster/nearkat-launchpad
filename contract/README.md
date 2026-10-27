# Nearkat NFT contract

NEAR contract holding each kat's ownership, context hash and inference balance.
It is also the code every launchpad collection runs (see `../launchpad`).

`new` takes a `collection` with `name`, `symbol` and `base_uri`, and optionally
`prompt` (shared by every token, with `{name}` and `{token_id}` filled in),
`starter` (the context each token starts from), `max_supply`, and `tee`
(`{ "Phala": { "app_id": "…" } }`: contexts may only be opened inside that
Phala app). Empty `prompt` and `starter` give the original Nearkat. All are
public through `get_collection` and fixed at deployment.

A collection with `tee` only accepts keeper calls signed by a key proven to
run inside that app. Anyone may submit the proof with
`register_keeper_key({ public_key, seal_public_key, quote, collateral, event_log })`:
the contract verifies the TDX quote against Intel's collateral (dcap-qvl, about
166 Tgas), that its report data commits to both keys, and that dstack's event
log replays to RTMR3 and names the app. `is_keeper_key_attested` reads the
result; the admin can `revoke_keeper_key`. Test fixtures and their sources
are in `tests/fixtures/`.

The `collection` also takes `terms` (`royalty_bps` up to 2500 for NEP-199
`nft_payout`/`nft_transfer_payout`, `creator_share_bps` up to 5000 of every
conversation charge, optional `chat_price` and `save_price`),
`media_extension` for token images under `base_uri`, and, with `tee`, a
`sealed_prompt` (`ciphertext`, `sealed_to`) of instructions only the TEE app
can read; `sealed_key_attested` says when the key it is sealed to has been
attested. `new` also takes an optional `code_hash` (the launchpad passes it).

`collection.key_source` (`{ mpc_contract_id, domain_id }`, optional, fixed)
names NEAR's MPC network as the source of the collection's context keys.
`request_context_key({ app_public_key })` (keeper only, and for a TEE
collection only with an attested key) forwards a confidential key derivation
request to `request_app_private_key` on that contract, for the path
`nearkat/contexts/v1`. The network derives the key for this account and
returns it encrypted to the keeper's throwaway BLS12-381 key, so only the
keeper that asked can read it. The keeper derives every token's key from it.

The contract also accepts `__fastdata_fastfs` calls and ignores them: the
keeper stores each encrypted context as a FastFS file addressed to the
collection, and records `fastfs:<uploader>:<sha256>:<tx hash>` as its
`context_ref`.

`upgrade({ code_hash })` (admin, 1 yocto) moves the collection to other
published code and runs `migrate` in the same batch. A collection created by
a launchpad may only move to versions that launchpad approves, and the
launchpad records the move.

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
