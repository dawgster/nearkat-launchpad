# Nearkat launchpad

A launchpad for NFTs whose data only attested TEEs can open. A collection's
contract names the confidential app (a Phala Cloud / Intel TDX app) allowed to
open its tokens' data; keys come from NEAR's MPC network (confidential key
derivation), released only to that attested code. Two kinds of collection:

- **Character collections.** Each token is a kat (or any creator-defined
  character): an AI mind whose memory is encrypted, grows from conversation,
  and is readable only inside the keeper's TEE. Tokens can have their own NEAR
  wallets and can be lent.
- **Dataset collections.** Each token is one encrypted training sample (an
  image and its label). Holders can rent samples to a training app for a fee
  and a time limit; the app trains inside a TEE and records the run on-chain.
  Neither the renter nor the holder sees the others' data.

## The dataset flow

1. A creator drops a folder of labelled images in the web app. The browser
   hands them to the keeper (a TEE), which seals each sample under its own key
   from NEAR's MPC network, stores the ciphertext on FastFS and mints a token
   per sample.
2. Holders list their samples for rent to a named training app, with a fee and
   a duration.
3. A renter rents N samples for that app. The training app proves its code to
   the collection (`register_app_key`, with a TDX quote), asks the collection
   for the samples' keys, decrypts them in memory, fits a linear SVM on frozen
   MobileNetV3-Large features on a CPU (`trainer/py`), scores it on a held-out set, and records the run on-chain,
   which spends the rentals.
4. The renter downloads the ONNX model and can try it on a photo in the browser.

## Layout

| Path | What |
| --- | --- |
| `contract/` | The collection contract (characters and datasets) |
| `launchpad/` | The factory that launches collections |
| `keeper/` | The keeper service: ingest, chat, key requests |
| `trainer/` | The training app (TypeScript service; `trainer/py` is the Python trainer) |
| `web/` | The single-page web app |
| `art/` | Shared token art |
| `mock-mpc/` | Stand-in for NEAR's MPC contract, for sandbox tests |
| `deploy/` | Dockerfiles, Caddyfile, `phala/` compose files |
| `scripts/` | `fetch-hotdog.sh`, `demo-hotdog.ts` |
| `docs/demo/` | Stage script, walkthrough, Phala runbook (`phala.md`) |

## Run locally

Needs Node 24, Rust with `cargo near`, `uv` and Python 3.12 for the trainer,
and Docker only for the images.

```bash
# 1. The demo dataset (pinned commit, never committed), and the trainer's
#    backbone weights (into torch's cache, TORCH_HOME; the trainer never downloads)
scripts/fetch-hotdog.sh            # data/hotdog/train, trainer/heldout, web/public/heldout
(cd trainer/py && uv run python fetch_weights.py)

# 2. Sandbox and browser end-to-end tests (local NEAR sandbox, mock MPC)
(cd contract  && cargo near build non-reproducible-wasm)
(cd launchpad && cargo near build non-reproducible-wasm)
(cd mock-mpc  && cargo near build non-reproducible-wasm --no-abi)
(cd keeper  && npm install && npm test)
(cd trainer && npm install && npm test)
(cd web     && npm install && npm run e2e)

# 3. The services by hand (copy each .env.example to .env and fill it in)
(cd keeper  && npm run dev)        # :8787
(cd trainer && npm run dev)        # :8790; set HELDOUT_DIR=./heldout
(cd web     && npm run dev)        # :3000
```

See `keeper/README.md`, `trainer/README.md`, `web/README.md` and
`docs/demo/walkthrough.md` for configuration. Container images:
`deploy/keeper.Dockerfile`, `deploy/trainer.Dockerfile`, `deploy/web.Dockerfile`;
deploying to Phala (not done yet) is in `docs/demo/phala.md`.

## Honesty notes

- **Local mode is not private.** Run without Phala (`KEEPER_MODE=local`,
  `TRAINER_MODE=local`), the root secret comes from the environment and the
  operator can read everything the service decrypts. Only the Phala mode, with
  an attested quote, gives the guarantee.
- **A rental's single use relies on the attested code.** The chain controls who
  gets a key and when; it cannot control what an app does after it has one. A
  sample is used once because the attested training code discards the keys
  after a run, which is why renters and collections trust a specific attested
  app identity.
- **Samples are public and permanent.** They are stored on FastFS: encrypted,
  but public and undeletable on-chain forever. Privacy therefore rests on the
  keys; if a key leaks, or the cryptography is ever broken, the data cannot be
  withdrawn.
- **Trained models can leak.** A model can reveal some information about its
  training data (memorisation, membership inference). The renter receives the
  model, not the samples, but that is not the same as no leakage.
- **The dataset is AGPL-3.0.** The hotdog / not-hotdog images are
  `truepositive/hotdog_nothotdog` (AGPL-3.0), fetched at a pinned commit by
  `scripts/fetch-hotdog.sh` and never committed to this repository. The
  trainer image (`deploy/trainer.Dockerfile`) and the web image
  (`deploy/web.Dockerfile`) do contain the held-out images, so pushing either
  image distributes them under the AGPL.
- **The keeper's data volume is outside the TEE's memory encryption.** In the
  Phala deployment the `keeper-data` volume holds only ciphertext and public
  records, never keys, but the host can read, copy or delete it.
- **What was tested against what.** Most tests run against stand-ins: a local
  NEAR sandbox and a mock MPC contract that does the real key maths. The key
  derivation is also checked live against testnet's MPC (`npm run live-check`
  in `keeper/`). Nothing has been deployed to Phala yet: the dataset keeper
  and the training app have only run locally and in tests, and
  `docs/demo/phala.md` is the plan for deploying them, not a record of it.

## Hackathon

Built for the NEAR hackathon, tracks **Privacy & Private AI** and
**NFTs That Do Something**.
