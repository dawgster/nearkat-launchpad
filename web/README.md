# Nearkat web app

Where owners mint a kat, talk to it, shape its personality, give it away and
check what the keeper tells them. Design:
`../docs/superpowers/specs/2026-10-13-nearkat-ai-nft-design.md`.

It is a static single-page app. It reads the contract directly, sends
transactions through the visitor's wallet, and talks to the keeper for
anything that touches a kat's mind.

## Run

```bash
npm install
cp .env.example .env.local   # then set VITE_CONTRACT_ID and VITE_KEEPER_URL
npm run dev                  # http://localhost:3000
```

The keeper must list this app's origin in its `WEB_ORIGIN`.

## Test

```bash
npm test            # unit and component tests
npm run typecheck
npm run lint
npm run e2e         # the whole story in a real browser
```

`npm run e2e` starts a local NEAR sandbox, deploys the contract, starts the
keeper from `../keeper` with a stand-in for the AI model, and serves this app
twice, once per test wallet. It needs the contract wasm, so build that first
with `cargo near build non-reproducible-wasm` in `../contract`, and a browser:
`npx playwright install chromium`.

## Pages

| Path | What it is |
|---|---|
| `/` | The surface: what a nearkat is, minting, and the kats in your wallet |
| `/kat/:id` | The burrow: talk to a kat, edit its personality, add NEAR, give it away |
| `/kat/:id/verify` | What the browser can check about the kat and its keeper |

## Notes

- Kat portraits are a placeholder badge until the artwork exists; see
  `src/components/KatBadge.tsx`.
- The keeper reads finalized blocks, so it trails the chain by a few seconds.
  After a mint or a transfer the kat page waits for it instead of showing an
  error.
- Browser wallets come through NEAR Connect and work on testnet and mainnet.
  A sandbox has no browser wallets, which is what the dev wallet is for.
