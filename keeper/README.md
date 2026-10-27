# Nearkat keeper

The service that holds each kat's mind. It checks NFT ownership on every
request, decrypts the kat's context, runs inference on NEAR AI Cloud and saves
updated memory. Design: `../docs/superpowers/specs/2026-10-13-nearkat-ai-nft-design.md`.

It serves many collections: its home one (`CONTRACT_ID`), any listed in
`CONTRACT_IDS`, and every launch on `LAUNCHPAD_ID` whose contract names this
keeper's account. Each collection's public prompt and starter context are
read from its contract (`get_collection`), so the same keeper serves a
meerkat, a tutor or a game master. Each has its own meter and journal, and
its own context keys from NEAR's MPC network.

Two modes:

- **local** (default): the root secret comes from `KEEPER_ROOT_SECRET`. The
  operator can read contexts, because the keeper decrypts them in memory.
- **phala**: set `KEEPER_MODE=phala` inside a Phala Cloud (dstack) app. The
  root secret comes from dstack's key service, which hands it only to
  instances of that app; `KEEPER_ROOT_SECRET` must be unset. `/attestation`
  then serves a TDX quote whose report data commits to the keeper's NEAR key.
  `DSTACK_ENDPOINT` can point at the dstack simulator for development.

Each collection is charged at its own prices: its `terms` prices, or the
keeper's raised to cover the creator's share. The keeper refuses a collection
whose prices leave it less than its own after that share.

A TEE collection can carry a sealed prompt, encrypted in the creator's browser
to the keeper's X25519 sealing key. The key is derived from the root secret,
so every instance of the app has it, and the quote binds it together with the
NEAR key. The keeper adds the opened instructions to conversations only,
marked confidential, never to the update that rewrites a token's character.

Token art is served at `GET /art/<contract>/<id>.svg`, drawn by the shared
`../art` module from the token's on-chain growth.

**Context keys.** Every collection's keys come from NEAR's MPC network
(confidential key derivation); the root secret only gives the keeper its NEAR
key, session key and sealing key. Before serving a collection, the keeper
makes a throwaway BLS12-381 key and calls the collection's
`request_context_key`; the network derives a key for that collection's
account and key epoch, and returns it encrypted to the throwaway key. The
keeper checks the result is the network's BLS signature on the collection's
app id, and derives every token's key from it (`src/ckd.ts`, checked against
values frozen in NEAR's MPC repository). So the keys don't depend on any
keeper's own secret: a replacement keeper the collection names gets the same
keys, and for a TEE collection only an attested keeper key can ask.

**Key epochs.** Changing keeper, revoking an attested key or
`rotate_context_key` moves the collection to a new key epoch. The keeper
saves under the current epoch, fetches older epochs' keys to read what was
saved before, and if the epoch moves during a save, saves again under the new
key. A replaced keeper can't get any key, so it can't read what is saved
after it left.

**Storage.** By default (`STORAGE=fastfs`) each encrypted context is stored
on NEAR as a FastFS file: a `__fastdata_fastfs` call from the keeper account
to the collection, which costs the keeper a small transaction fee. The
on-chain `context_ref` names the uploader, the blob's SHA-256 and the
transaction. The keeper reads it back from its disk cache, then a FastFS
gateway (`https://<uploader>.fastfs.io` on mainnet), then any archival RPC
node (`NEAR_ARCHIVAL_RPC_URL`), checking the hash each time. `STORAGE=file`
keeps contexts only on disk.

If a collection names a Phala app (`tee`), the keeper refuses to serve it
unless it runs as exactly that app. In that case it first proves its key to
the contract: it fetches Intel's collateral for its quote from Phala's PCCS
and calls `register_keeper_key`, which verifies the quote on-chain. The
contract then only accepts keeper calls signed with that key.

## Test

```bash
npm install
npm test           # unit tests, plus a sandbox test against the real contract
npm run typecheck
npm run lint
```

The sandbox tests need the contract wasm (and, for the MPC test, the mock
MPC wasm) and are skipped without them. Build them first with
`cargo near build non-reproducible-wasm` in `../contract` and
`cargo near build non-reproducible-wasm --no-abi` in `../mock-mpc`. Its
first run downloads a NEAR sandbox binary.

## Run against testnet

1. Deploy the contract and note its account id.
2. Copy `.env.example` to `.env` and fill it in.
3. Start the keeper once with `npm run dev`. It prints the public key its
   account must hold.
4. Add that key to the keeper account as a full-access key, and make sure the
   contract's `keeper_id` is that account.
5. Restart. New kats are woken within a few seconds of minting.

## Operating notes

- Run one keeper process per keeper account. Sign-in nonces, sessions and
  unsettled charges are held by the process, and two would overcommit
  balances. The contract's version and debit sequence checks stop them
  corrupting state, but users would see refused saves.
- Unsettled charges are journaled to `METER_JOURNAL` and settled on SIGTERM.
  Keep that file across restarts.
- Chat is limited per account (20 messages at once, then one every 3 s) and
  sign-in per client (30, then one every 2 s). Behind a reverse proxy, set
  `TRUST_PROXY=true` so clients are told apart by `X-Forwarded-For`.
- A reply that quotes a collection's secret instructions (any six words in a
  row) is replaced before the owner or the conversation sees it, and logged.
  Paraphrase still gets through.
- `npm run live-check` checks the live pieces: the MPC contract's CKD
  domain and key, a collection's key source, a real key request, and a
  FastFS round trip. Set `NEAR_NETWORK`, and for the collection steps
  `COLLECTION_ID`, `KEEPER_ACCOUNT_ID` and `KEEPER_ROOT_SECRET`. The sandbox
  tests rehearse it.
- Inference charges accrue on each contract for the keeper. The keeper
  withdraws them to its account once they reach `WITHDRAW_MIN_YOCTO`
  (1 NEAR by default), after settling charges.
- `GET /collections` shows which collections are served and why any others
  are not (another keeper named, TEE mismatch, attestation refused).
- On start the keeper logs `SETUP PROBLEM` if the contract does not name its
  account as keeper or the account lacks its key. It keeps serving, so the
  public key stays available at `/attestation`.

## API

| Route | Auth | Purpose |
|---|---|---|
| `GET /attestation` | none | Keeper mode and public key; in phala mode also `app_id`, `compose_hash`, `quote` and `event_log` |
| `POST /auth/challenge` | none | Nonce, message and recipient to sign (NEP-413) |
| `GET /info` | none | Prices per message and per save (yoctoNEAR) and the model id |
| `POST /auth/session` | none | Body `{ nonce, signed_message, callback_url? }`; returns a 15-minute token |
| `GET /collections` | none | Collections served with their prices, and those seen but not served with the reason |
| `GET /art/:contract/:id.svg` | none, any origin | A token's picture, as it has grown |
| `GET /kats/:id/context` | owner | The whole context: token id, version, salt, character (`personality`), memory summary |
| `POST /kats/:id/chat` | owner | Body `{ message }`; returns reply, verification data, balance |
| `GET /kats/:id/export` | owner | The context with its on-chain record (hash, ref, version, key epoch), as a file to keep |
| `GET /c/:contract/kats/:id/...` | owner | The same routes, for a collection other than the home one |

Errors are JSON `{ error, message }`: 400 `invalid_input`, 401
`unauthorized`, 404 `not_served` (a collection this keeper doesn't serve), 413 `too_large`, 402 `insufficient_balance` (with `balance` and `required`),
403 `not_owner`, 404 `not_found`, 409 `waking_up`, 429 `rate_limited` (with
`retry_after_ms`), 500 `corrupted`, 503 `inference_unavailable`. A chat reply
that was held back carries `withheld: true`.
