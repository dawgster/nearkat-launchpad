# Training app

An HTTP service that trains an image classifier on rented dataset samples. For
each run it checks the renter's rentals on-chain, gets the samples' keys from
NEAR's MPC network through the collection, decrypts the samples from FastFS in
memory, streams them to `py/train.py`, records the run on-chain (which spends
the rentals) and keeps the ONNX model for the renter. Keys and images are never
logged, returned or written to disk.

The model also becomes a token. After recording the run, the app asks the
collection for the key of the token `model-<run id>` (`request_model_key`, which
the collection grants only to the app that recorded the run), seals what the run
learned under it, stores that on FastFS and mints the token to the renter
(`mint_model`). Whoever owns the token can have the app open it again; see
"Model tokens" below.

## Running

The app imports modules from `../keeper/src`, so the keeper's dependencies must
be installed too:

    (cd ../keeper && npm install)
    npm install
    cp .env.example .env   # fill it in
    npm run dev

Python is run with `uv` (or the interpreter in `TRAINER_PYTHON`); see `py/`.
It needs the backbone's weights in torch's cache, and never downloads them
itself. Fetch them once:

    (cd py && uv run python fetch_weights.py)

The image (`deploy/trainer.Dockerfile`) bakes them in at build time.

## The model

`py/train.py` passes every sample through a frozen MobileNetV3-Large
(torchvision's ImageNet weights, classifier removed: 960 features a picture)
and fits a linear SVM on the features (`LinearSVC`, C = 0.01, one-vs-rest).
On the hotdog set, 150 samples give about 90% on the 50 held-out images. The
SVM is fitted once, so a run reports epoch 1 of 1; feature extraction for 150
samples takes a few seconds on one CPU core.

It exports one self-contained ONNX file of about 12 MB: input `image`, float32
`[batch, 3, 224, 224]`, RGB in [0,1] squashed (not cropped) to 224×224, with
the ImageNet normalisation inside the graph; output `logits`, one per class in
the collection's order, whose argmax is the SVM's prediction.

`train.py --seconds` (default 120) caps training, scoring and export, counted
from when the last sample has been read. The weights' SHA-256 is pinned in
`train.py` and checked on every load.

## Model tokens

What a run learns is only the linear layer on top of the backbone: 960 weights
and a bias for each class, a few kilobytes. `train.py --head-out` writes it on
its own, and that is what the token seals:
`{ v, kind: "model-head", token_id, run_id, classes, head }`, encrypted with
AES-256-GCM under the token's key (the MPC network's key for the path
`nearkat/samples/v1/model-<run id>`, the same scheme as a sample's). The
backbone is public and named in the head by its SHA-256.

`py/assemble.py` puts a head and the backbone back together into the ONNX file.
The exporter's notes about source files and lines are stripped from the file,
so with the same libraries it is byte for byte the file `train.py` exported and
has the SHA-256 the run recorded on-chain. `GET /models/:contract/:token_id`
does this for the token's owner: it checks the owner on-chain, gets the key,
reads the sealed head from FastFS, checks it against the hash on the token,
rebuilds the file and checks it against the run's `model_sha256`. It always
opens from the token, not from the run's copy in memory, and keeps the last
four rebuilt models. A rebuilt file that doesn't match is refused (409): that
happens when the app's libraries differ from those that trained the model.

If sealing or minting fails, the run still finishes: it is recorded, the model
can be downloaded from the run, and the run's status carries `mintProblem`
instead of `modelToken`.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `TRAINER_MODE` | `local` | `local`: the root secret comes from the environment. `phala`: from dstack's KMS, inside a Phala app. |
| `NEAR_NETWORK` | `testnet` | `testnet`, `mainnet` or `sandbox`. |
| `NEAR_RPC_URL` | network default | Required for `sandbox`. |
| `TRAINER_ACCOUNT_ID` | required | The NEAR account that signs `record_training` and `register_app_key`. |
| `TRAINER_ROOT_SECRET` | required in local mode | 64 hex characters. Refused in phala mode. |
| `TRAINER_LAUNCHPAD_ID` | required in phala mode | The launchpad whose collections this app trains on. A collection must name it as its `factory_id`, and the launchpad must list it as live; others get 400 "This trainer only trains on collections from …". Unset in local mode: any collection. |
| `TRAINER_APP_ID` | `local-trainer` | Local mode only; in phala mode it is `dstack.info().app_id`, and setting it is refused. |
| `TRAINER_LABEL` | `Hotdog CNN` | The name the collection lists this app under. |
| `HELDOUT_DIR` | `./data/heldout` | Held-out images, `<dir>/<class>/*.jpg` (or `.jpeg`); every class a dataset has needs some. |
| `ARCHIVAL_RPC_URL` | fastnear archival | Reads back FastFS files from old transactions. |
| `FASTFS_GATEWAY` | none (mainnet: fastfs.io) | Gateway URL with `{uploader}`. |
| `SAMPLE_KEYS_PER_CALL` | `10` | Sample keys asked for in one `request_sample_keys` call, 1 to 10. 1 for the sandbox's mock MPC, which costs ~120 Tgas per key. |
| `TRAINER_EPOCHS` | train.py's | Accepted, 1 to 1000, and passed on; the SVM is fitted once, so a run is always epoch 1 of 1. |
| `PORT` | `8790` | |
| `WEB_ORIGINS` | `http://localhost:3000` | Comma-separated CORS origins. |
| `AUTH_RECIPIENT` | `trainer.local`; required in phala mode | The NEP-413 recipient renters sign in to. The app's own, never the keeper's, so a keeper sign-in opens no session here; the web app's `VITE_TRAINER_URLS` names it per app. |
| `TRUST_PROXY` | `false` | Rate limits key on `X-Forwarded-For` behind a proxy. |
| `DSTACK_ENDPOINT` | guest agent socket | A URL reaches the dstack simulator. |
| `TRAINER_PYTHON` | uv | Interpreter for `py/train.py`. |
| `TORCH_HOME` | `~/.cache/torch` | Where `py/train.py` finds the backbone's weights (`hub/checkpoints/`). |

## The trainer's key

The NEAR key derives from the root secret. It must be a **full-access** key on
`TRAINER_ACCOUNT_ID`, because `record_training` and `mint_model` take deposits
(0.1 NEAR attached to each call, most of it refunded; a model token's storage
costs about 0.02 NEAR) and `register_app_key` must be signed by the key it
registers. The account also pays for the FastFS upload of each sealed model. On start the app
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
- `GET /runs/:id`: the run's state (stage, epoch, accuracy, `recordTx`, `modelToken`, `mintTx`, ...). Public; it holds no samples or keys.
- `GET /runs/:id/model` (session): the ONNX model; 403 unless the session is the renter, 404 until the run is done.
- `GET /models/:contract/:token_id` (session): the ONNX model a model token stands for; 403 unless the session owns the token now, 404 if it is not a model, 400 if another app trained it, 409 if what was rebuilt doesn't match the record. Takes a few seconds: one MPC request and a rebuild.

At most 20 runs are kept (the oldest finished one is dropped first), and a model
is dropped 24 hours after its run finished.
