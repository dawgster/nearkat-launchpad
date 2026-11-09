# Training app

An HTTP service that trains an image classifier on rented dataset samples. For
each run it checks the renter's rentals on-chain, gets the samples' keys from
NEAR's MPC network through the collection, decrypts the samples from FastFS in
memory, streams them to `py/train.py`, records the run on-chain (which spends
the rentals) and keeps the ONNX model for the renter. Keys and images are never
logged, returned or written to disk.

## Running

The app imports modules from `../keeper/src`, so the keeper's dependencies must
be installed too:

    (cd ../keeper && npm install)
    npm install
    cp .env.example .env   # fill it in
    npm run dev

Python is run with `uv` (or the interpreter in `TRAINER_PYTHON`); see `py/`.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `TRAINER_MODE` | `local` | `local`: the root secret comes from the environment. `phala`: from dstack's KMS, inside a Phala app. |
| `NEAR_NETWORK` | `testnet` | `testnet`, `mainnet` or `sandbox`. |
| `NEAR_RPC_URL` | network default | Required for `sandbox`. |
| `TRAINER_ACCOUNT_ID` | required | The NEAR account that signs `record_training` and `register_app_key`. |
| `TRAINER_ROOT_SECRET` | required in local mode | 64 hex characters. Refused in phala mode. |
| `TRAINER_APP_ID` | `local-trainer` | Local mode only; in phala mode it is `dstack.info().app_id`. |
| `TRAINER_LABEL` | `Hotdog CNN` | The name the collection lists this app under. |
| `HELDOUT_DIR` | `./data/heldout` | Held-out images, `<dir>/<class>/*.jpg`. |
| `ARCHIVAL_RPC_URL` | fastnear archival | Reads back FastFS files from old transactions. |
| `FASTFS_GATEWAY` | none (mainnet: fastfs.io) | Gateway URL with `{uploader}`. |
| `PORT` | `8790` | |
| `WEB_ORIGINS` | `http://localhost:3000` | Comma-separated CORS origins. |
| `AUTH_RECIPIENT` | `nearkat.xyz` | The NEP-413 recipient renters sign in to. |
| `TRUST_PROXY` | `false` | Rate limits key on `X-Forwarded-For` behind a proxy. |
| `DSTACK_ENDPOINT` | guest agent socket | A URL reaches the dstack simulator. |
| `TRAINER_PYTHON` | uv | Interpreter for `py/train.py`. |

## The trainer's key

The NEAR key derives from the root secret. It must be a **full-access** key on
`TRAINER_ACCOUNT_ID`, because `record_training` takes a deposit and
`register_app_key` must be signed by the key it registers. On start the app
prints the key; add it with:

    near account add-key TRAINER_ACCOUNT_ID grant-full-access use-manually ed25519:<key> \
      network-config testnet sign-with-keychain send

## Registration

Before a run, the app reads `get_app_key` for its key on the collection:

- registered to this app id: nothing to do;
- registered to another app: the run fails ("This trainer's key is registered to another app");
- absent, **phala mode**: it calls `register_app_key` with a TDX quote, its
  label, 0.05 NEAR and 300 Tgas;
- absent, **local mode**: the run fails; the collection's admin must call
  `trust_app_key` with the key the app printed.

## Routes

- `GET /info`: `{ app_id, label, classes_supported: "any", heldout }`
- `GET /attestation`: `{ mode, app_id, public_key, seal_public_key, quote?, event_log?, compose_hash? }`
- `POST /auth/challenge`, `POST /auth/session`: NEP-413 sign-in, as the keeper.
- `POST /train { contract, token_ids }` (session): 202 and the run, or 400 with the reason.
- `GET /runs/:id`: the run's state (stage, epoch, accuracy, ...). Public; it holds no samples or keys.
- `GET /runs/:id/model` (session): the ONNX model; 403 unless the session is the renter, 404 until the run is done.

At most 20 runs are kept (the oldest finished one is dropped first), and a model
is dropped 24 hours after its run finished.
