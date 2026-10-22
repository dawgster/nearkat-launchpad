# Nearkat keeper

The service that holds each kat's mind. It checks NFT ownership on every
request, decrypts the kat's context, runs inference on NEAR AI Cloud and saves
updated memory. Design: `../docs/superpowers/specs/2026-10-13-nearkat-ai-nft-design.md`.

It serves many collections: its home one (`CONTRACT_ID`), any listed in
`CONTRACT_IDS`, and every launch on `LAUNCHPAD_ID` whose contract names this
keeper's account. Each collection's public prompt and starter context are
read from its contract (`get_collection`), so the same keeper serves a
meerkat, a tutor or a game master. Each has its own meter and journal, and
kat keys derived per contract.

Two modes:

- **local** (default): the root secret comes from `KEEPER_ROOT_SECRET` and
  the operator can read contexts.
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

With `S3_BUCKET` set, contexts are stored in an S3-compatible bucket before
their hash moves on-chain, and the local directory only caches them.

If a collection names a Phala app (`tee`), the keeper refuses to serve it
unless it runs as exactly that app. In that case it first proves its key to
the contract: it fetches Intel's collateral for its quote from Phala's PCCS
and calls `register_keeper_key`, which verifies the quote on-chain. The
contract then only accepts keeper calls signed with that key. Contexts are still stored on disk; NOVA
storage is a later step.

## Test

```bash
npm install
npm test           # unit tests, plus a sandbox test against the real contract
npm run typecheck
npm run lint
```

The sandbox test needs the contract wasm and is skipped without it. Build it
first with `cargo near build non-reproducible-wasm` in `../contract`. Its
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

- Run one keeper per contract. Sign-in nonces, sessions and unsettled charges
  are held by the process, and two keepers would overcommit balances.
- Unsettled charges are journaled to `METER_JOURNAL` and settled on SIGTERM.
  Keep that file across restarts.
- There is no rate limiting. Put the keeper behind a proxy that provides it
  before exposing it publicly.
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
| `GET /c/:contract/kats/:id/context`, `POST /c/:contract/kats/:id/chat` | owner | The same, for a collection other than the home one |

Errors are JSON `{ error, message }`: 400 `invalid_input`, 401
`unauthorized`, 404 `not_served` (a collection this keeper doesn't serve), 413 `too_large`, 402 `insufficient_balance` (with `balance` and `required`),
403 `not_owner`, 404 `not_found`, 409 `waking_up`, 500 `corrupted`, 503
`inference_unavailable`.
