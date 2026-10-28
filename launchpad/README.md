# Nearkat launchpad

Lets anyone launch their own collection of prompt-based NFTs. Each collection
is a sub-account (`<slug>.<launchpad>`) running the collection contract from
`../contract`, published once as a global contract and referenced by its code
hash. Design: `../docs/superpowers/specs/2026-10-21-launchpad-design.md`.

## Test

```bash
cargo test            # unit tests, then sandbox tests that build both contracts
cargo clippy --all-targets
cargo fmt --check
```

## Build

```bash
cargo near build non-reproducible-wasm
```

The wasm is written to `target/near/nearkat_launchpad.wasm`.

## Deploy

1. Build the collection contract in `../contract`.
2. Publish it by hash from any account, for example with near-kit:
   `near.transaction(account).publishContract(wasm, { identifiedBy: "hash" }).send()`.
   Note the code hash: base58 of the wasm's SHA-256.
3. Deploy this contract and call
   `new({ admin_id, keeper_id, launch_fee, collection_funding })`.
4. As the admin, call `set_collection_code_hash({ code_hash })` and
   `set_key_source({ key_source })` (NEAR's MPC contract, `v1.signer` on
   mainnet or `v1.signer-prod.testnet`, and its CKD domain; `npm run
   live-check` in `../keeper` finds it), each with 1 yoctoNEAR attached.
   Launching is closed until both are set.

## Methods

| Method | Who | What |
|---|---|---|
| `launch({ args })` | anyone, payable | Launches `<slug>.<launchpad>` with the caller as admin and treasury. Deposit at least `launch_fee + collection_funding`. Returns true when live; refunds and returns false if the launch fails. |
| `get_collections({ from_index?, limit? })` | view | Launched collections, including any still in flight (`live: false`). |
| `get_collection({ account_id })` | view | One entry, or null. |
| `collection_account({ slug })` | view | The account a slug launches to, or an error saying why it can't. |
| `get_config()` | view | Admin, keeper, code hash, fee, funding, fees kept. |
| `is_code_approved({ code_hash })`, `get_approved_code_hashes()` | view | Versions collections may upgrade to. The launch version is always one. |
| `record_upgrade({ code_hash })` | a collection | Records that a collection moved to an approved version. |
| `set_collection_code_hash`, `approve_code_hash`, `revoke_code_hash`, `set_keeper`, `set_prices`, `reserve`, `withdraw_fees` | admin, 1 yocto | Operating the launchpad. Only approve versions that keep every promise a collection made to its buyers. |
| `set_key_source({ key_source })` | admin, 1 yocto | NEAR's MPC network (`{ mpc_contract_id, domain_id, wallet_domain_id? }`, e.g. `v1.signer`, its CKD domain and its Ed25519 domain for token wallets) that every new launch gets its context keys from. The launchpad sets it in each launch; creators can't. Launching is closed while it is unset. |

`launch` takes:

```json
{
  "args": {
    "slug": "spanish-tutor",
    "mint_price": "1000000000000000000000000",
    "collection": {
      "name": "Profe",
      "symbol": "PROFE",
      "prompt": "You are {name} #{token_id}, a patient Spanish tutor…",
      "starter": "You have not met your student yet.",
      "max_supply": "500",
      "tee": { "Phala": { "app_id": "0a1b2c…" } }
    },
    "keeper_id": null
  }
}
```

`key_source` comes from the launchpad, not the creator. `max_supply`, `tee`, `keeper_id`, `base_uri`, `media_extension`, `terms` and
`sealed_prompt` are optional; see `../contract/README.md` for what they mean. A collection that requires a
Phala app needs a keeper running as that app; name it in `keeper_id` if the
launchpad's keeper isn't one.
