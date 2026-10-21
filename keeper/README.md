# Nearkat keeper

The service that holds each kat's mind. It checks NFT ownership on every
request, decrypts the kat's context, runs inference on NEAR AI Cloud and saves
updated memory. Design: `../docs/superpowers/specs/2026-10-13-nearkat-ai-nft-design.md`.

It serves one collection. The collection's public prompt and starter context
are read from the contract (`get_collection`), so the same keeper serves a
meerkat, a tutor or a game master.

Two modes:

- **local** (default): the root secret comes from `KEEPER_ROOT_SECRET` and
  the operator can read contexts.
- **phala**: set `KEEPER_MODE=phala` inside a Phala Cloud (dstack) app. The
  root secret comes from dstack's key service, which hands it only to
  instances of that app; `KEEPER_ROOT_SECRET` must be unset. `/attestation`
  then serves a TDX quote whose report data commits to the keeper's NEAR key.
  `DSTACK_ENDPOINT` can point at the dstack simulator for development.

If the collection names a Phala app (`tee`), the keeper refuses to serve it
unless it runs as exactly that app. Contexts are still stored on disk; NOVA
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
- Inference charges accrue on the contract for the keeper. Withdraw them to
  the keeper account with the contract's `withdraw_inference`; the keeper
  does not do this by itself yet.
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
| `GET /kats/:id/context` | owner | The whole context: token id, version, salt, character (`personality`), memory summary |
| `POST /kats/:id/chat` | owner | Body `{ message }`; returns reply, verification data, balance |

Errors are JSON `{ error, message }`: 400 `invalid_input`, 401
`unauthorized`, 413 `too_large`, 402 `insufficient_balance` (with `balance` and `required`),
403 `not_owner`, 404 `not_found`, 409 `waking_up`, 500 `corrupted`, 503
`inference_unavailable`.
