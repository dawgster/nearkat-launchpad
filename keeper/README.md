# Nearkat keeper

The service that holds each kat's mind. It checks NFT ownership on every
request, decrypts the kat's context, runs inference on NEAR AI Cloud and saves
updated memory. Design: `../docs/superpowers/specs/2026-10-13-nearkat-ai-nft-design.md`.

This is the local mode: the root secret comes from an environment variable
and contexts are stored on disk. Running inside a TEE with NOVA storage is a
later step; until then the operator can read contexts.

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

## API

| Route | Auth | Purpose |
|---|---|---|
| `GET /attestation` | none | Keeper mode and public key |
| `POST /auth/challenge` | none | Nonce, message and recipient to sign (NEP-413) |
| `POST /auth/session` | none | Body `{ nonce, signed_message }`; returns a 15-minute token |
| `GET /kats/:id/context` | owner | Personality, memory summary, version |
| `PUT /kats/:id/personality` | owner | Body `{ prompt }`, up to 4,000 characters |
| `POST /kats/:id/chat` | owner | Body `{ message }`; returns reply, verification data, balance |

Errors are JSON `{ error, message }`: 400 `invalid_input`, 401
`unauthorized`, 402 `insufficient_balance` (with `balance` and `required`),
403 `not_owner`, 404 `not_found`, 409 `waking_up`, 500 `corrupted`, 503
`inference_unavailable`.
