# Mock MPC (tests only)

A stand-in for NEAR's MPC signer contract (`v1.signer` on mainnet), so the
sandbox tests and the browser story can exercise confidential key derivation
(CKD) without the real MPC network.

It answers `request_app_private_key`, `public_key` and a small part of
`state` (its one CKD domain, in the real contract's shape) with the same
derivation and encryption the real network uses: the app id is
`sha3_256("near-mpc v0.1.0 app_id derivation:" + caller + "," + path)`, the
derived key is `msk · H(pk ‖ app_id)` hashed to G1 with
`NEAR BLS12381G1_XMD:SHA-256_SSWU_RO_`, and the response is
`(Y, C) = (y·G1, derived + y·A)` for the caller's app key `A`.

Its app-id derivation and hash-to-curve are tested against values frozen in
NEAR's MPC repository (`../keeper/test/fixtures/near-mpc-upstream.json`).

**Never deploy it anywhere real.** It keeps the master secret in its own
state, where anyone can read it. The real network splits that secret between
many independent nodes.

Doing the BLS12-381 arithmetic in wasm is expensive: `new` needs close to
300 Tgas and a request about 120 Tgas. The real contract defers the work to
its nodes and answers a few seconds later.

```bash
cargo test
cargo near build non-reproducible-wasm --no-abi
```
