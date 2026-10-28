# Token wallet

The code every token's own wallet account runs: `<token_id>.<collection>`.
A collection creates the account when someone calls its `open_wallet`, using
this code published once as a global contract and referenced by hash.

The account has no access keys and no state. Its one method,
`transfer({ receiver_id, amount })`, may only be called by the collection
that created it (the account it lives under), which checks the token owner's
rules first: see `../contract/src/wallet.rs`. Anyone can send NEAR to it.

```bash
cargo test
cargo near build non-reproducible-wasm --no-abi
```

Publish `target/near/nearkat_token_wallet.wasm` by hash and pass the hash to
collections as `collection.wallet_code_hash` (the launchpad does it for its
launches), or call `enable_wallets` on an existing collection.
