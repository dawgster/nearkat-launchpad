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

`collection.key_source` (`{ mpc_contract_id, domain_id }`, required, fixed)
names NEAR's MPC network as the source of the collection's context keys.
`request_context_key({ app_public_key, key_epoch? })` (keeper only, and for
a TEE collection only with an attested key) forwards a confidential key
derivation request to `request_app_private_key` on that contract, for the
path `nearkat/contexts/v1/<epoch>`. The network derives the key for this
account and returns it encrypted to the keeper's throwaway BLS12-381 key, so
only the keeper that asked can read it.

Keys have epochs (`get_collection().key_epoch`, from 1). `set_keeper` with a
new account, `revoke_keeper_key` and `rotate_context_key` (admin, 1 yocto)
move to the next. `set_context` takes the `key_epoch` the context was
encrypted under, accepts only the current one, and records it on the token
(`get_kat().key_epoch`). The keeper may request any epoch up to the current
one, to read older contexts.

**Lending.** `lend({ token_id, borrower_id?, duration_s?, messages?,
sees_memory, learns, fee? })` (owner; attach about 0.01 NEAR for the record's
storage, the rest comes back) offers the token on loan, to one account or to
anyone, for a time, a number of messages, or both. A free loan to a named
account starts at once; otherwise the borrower takes it with `borrow({ token_id })`,
attaching the fee, which goes straight to the owner. `end_loan({ token_id })`
(1 yocto): the borrower can give it back any time; the owner can withdraw an
offer or end a free loan, not a paid one before its time; anyone can clear one
that is over. `get_loan({ token_id })` shows it with its status (`offered`,
`active`, `over`). A rented token (an active loan with a fee) can't change
hands until the loan ends; any other loan ends when it does. The token never
leaves its owner. The keeper enforces the rest: the borrower may chat, with or
without the token's memory (`sees_memory`), changing it only if `learns`;
never read its mind, use its wallet or import into it. Loans live under their
own storage keys, so older collections need no migration. Events:
`loan_offered`, `loan_started`, `loan_ended`. A dataset sample's rental
(`lend_many`/`borrow_many`) is for one training use: once `record_training`
spends it, it reads as `over` everywhere, so the sample can change hands, be
listed again, and anyone can clear the record (the lender gets the storage
back).

**Model tokens.** A training run's model is a token of the dataset it was
trained on, `model-<run_id>` (samples' ids are numbers, and `minted` counts
only them). The app that recorded the run asks for the token's key with
`request_model_key({ run_id, app_public_key })`: the MPC network's key for the
path `nearkat/samples/v1/model-<run_id>`, given to no other app, before the
token exists (to seal the model) and after (to open it for its owner). It
then calls `mint_model({ run_id, sealed_hash, sealed_ref })`, once a run,
attaching the token's storage (about 0.02 NEAR; the rest is refunded): the
token goes to the run's renter, with the sealed blob's SHA-256 and FastFS ref.
`get_model({ token_id })` and `get_models({ from, limit })` show a model with
its run (app, renter, `model_sha256`, accuracy) and current owner;
`get_sample` is None for one. A model changes hands like any token, but can't
be lent as a sample. The chain decides which app gets the key; that the app
opens the model only for the token's owner rests on the app's attested code.
Event: `model_minted`.

**History import.** `collection.history_import` (default false) lets owners
teach their token from their ChatGPT or Claude history; the keeper refuses
imports otherwise. It's fixed at deployment and kept under its own storage
key, so collections from before it read as off without a migration.
`get_collection` reports it.

**Wallets.** With `collection.wallet_code_hash` (the published
`token-wallet/` code), every token can have its own NEAR account,
`<token_id>.<collection>`. `open_wallet({ token_id })` (anyone, attach at
least 0.02 NEAR; what's left after the record's storage goes in) creates it
with that code; the account has no keys, and only this contract can call its
`transfer`. `get_wallet({ token_id })` gives `account_id`, `open` and the
rules; `set_wallet_policy({ token_id, daily_allowance, max_payment })`
(token owner, 1 yocto) sets what the token's mind may send;
`wallet_send({ token_id, receiver_id, amount, memo? })` sends and resolves
to whether the transfer went through. The owner may send anything (1 yocto);
the keeper, for the mind, only within the rules, which a new owner doesn't
inherit. Nothing is ever signed in advance, so the token can be sold at any
moment and the wallet goes with it. `enable_wallets({ code_hash })` (admin,
once) turns wallets on for a collection from before them. Each payment logs
a `wallet_payment` event.

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
