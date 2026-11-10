# Dataset collections: NFTs of private training data

Date: 2026-11-09
Status: awaiting review
Branch: `claude/demo-polish-launchpad`
Deadline: NEAR Hackathon submission, 14 Nov 2026 23:59 UTC

## Why

The launchpad's idea is that an NFT can stand for data that the owner controls
and nobody else can read. The kats are one face of that, a character whose mind
is sealed. This is a second face: **each token is one encrypted training example**.
Its holder rents it out to training code of their choosing. Only that code, running
in an attested TEE, can open the image, and only while it is rented. The holder is
paid rent for each use. The renter gets a trained model, but never the images.

The demo has to land one moment for the judges: *"you own the data, a model
learned from it, you were paid, and nobody saw it."* It targets the hackathon's
**Privacy & Private AI** track (hints: Private AI, TEE) and **NFTs That Do
Something** ("ownership with behavior").

## What the user decided

- The dataset is a toy one: **hotdog / not hotdog** (the small
  `truepositive/hotdog_nothotdog` set on GitHub, a few hundred photos). It is
  not on this machine any more and has to be cloned again.
- This belongs to the launchpad, as a second kind of collection next to
  character collections. It is not a separate project.
- Holders earn **rent** through the existing **lending** feature.
- The user is the person on stage who rents the samples and presses train.
- The renter **downloads the trained model**.
- The creator makes the whole collection **in one go** on the launchpad, by
  **dragging and dropping the images**.
- Storage is **FastFS**, not NOVA.
- **Different parties run different training code.** A collection is not tied to
  one TEE app. Each sample's key goes directly to the attested training app it
  was rented to, and only for the tokens rented to it. There is no central data
  custodian in between.
- **Develop locally first, demo on a real Phala CVM.**
- CKD against the live testnet MPC network already works. It was checked for the
  kats.
- The project stays stealth until it is finished, then goes public for the
  submission (public repo, X post). Nothing is published before the user says so.

## Goals

1. On `/launch`, a creator drops a folder of labelled images and gets a live
   dataset collection, one token per image, after **one signed message and one
   wallet confirmation**.
2. Images leave the creator's browser only sealed to the attested ingest app.
   After that they exist only encrypted, each under **its own token's key** from
   NEAR's MPC network, on FastFS.
3. Holders list their samples for rent, all of them in one transaction. They name
   which training apps may use them.
4. A renter rents a batch of samples for a named training app in one
   transaction, and every holder is paid at that moment.
5. The renter presses **Train**. The training app proves its attestation
   on-chain, receives the keys of exactly the rented tokens, and trains an
   image classifier in about a minute. It reports accuracy on a public held-out set and
   records on-chain the model's hash and the list of tokens it trained on. The
   renter downloads the model.
6. On the same page the renter drops a photo onto the downloaded model, which
   runs in the browser and answers "hotdog" or "not hotdog".
7. Each token shows that it was rented, what it earned, which training app used
   it, and which model runs it went into.

## Non-goals

- Real or sensitive datasets, other data types (text, tabular), or tasks other
  than image classification.
- More than one training app in the demo. The mechanism must allow any number,
  but only one is built and deployed. A second one is a stretch goal.
- Uploading training code through the UI. A training app is a Phala app with its
  own published code. Anyone can deploy one and get it named in loans.
- GPUs, large models, hyper-parameter search.
- Protection against what a model can leak about its training data (membership
  inference, inversion). The README states this plainly as a known limit.
- A loan NEP or marketplace integration.
- Mainnet. The demo runs on testnet.

## Anti-goals (a failure even if it works)

- A plaintext image reaching anything but the creator's browser and attested
  apps the holder agreed to, including operators, web servers and logs.
- Any party, the launchpad's own keeper included, that can get keys for samples
  that aren't rented to it.
- A launch that needs a confirmation per image, or many confirmations at all.
- Training slow enough to stall the stage. It should take under 60 s, with
  visible progress.
- A regression in character collections. Kats, chat, lending and wallets keep
  working unchanged.
- A model recorded as trained on a token that wasn't actively rented to that app
  and that renter, or a rental counted twice.

## How it fits what exists

| Need | Already there |
|---|---|
| Launch a collection in one batch | `launchpad/` factory, global collection code |
| Keys from NEAR's MPC network for a collection | CKD (`contract/src/ckd.rs`, `keeper/src/ckd.ts`); proven on testnet |
| Proving which Phala app holds a key | On-chain TDX quote verification, RTMR3 replay, app id check (`contract/src/attestation.rs`) |
| Send secrets from the browser to a TEE only | Sealing to an attested X25519 key with purpose labels (`web/src/lib/sealing.ts`, `keeper/src/sealing.ts`) |
| Encrypted blobs on NEAR | FastFS (`keeper/src/fastfs.ts`), hash and ref on the token |
| Rent with a fee to the owner | `contract/src/lending.rs` (`lend`, `borrow`, `messages: 1` for single use) |
| Token art that changes with state | `art/`, sigils, served by the keeper |

What changes is **the scope of a key**. Character collections derive one root
per collection epoch and every token key from it, so whoever holds the root can
open every token. Dataset collections derive a **key per token** from the MPC
network (path `nearkat/samples/v1/<token_id>`, caller = the collection), so the
collection can hand out exactly the keys a renter paid for.

## Design

### Collection kind

`CollectionArgs` gains `kind: Character | Dataset { classes: Vec<String> }`,
which is fixed at launch and defaults to `Character`. Old collections read as
`Character` without migration, with the kind kept under its own storage key as
with `history_import`.

For a `Dataset` collection:
- `prompt`, `starter`, chat, history import and mind payments do not apply. The
  ingest app refuses chat routes.
- `classes` is public (`["hotdog", "not_hotdog"]`). Which token has which label
  is **private**: the label travels inside the encrypted sample.
- `get_collection` also reports `class_counts` as declared by the creator at
  launch (a public claim that nothing checks; the page says so).
- `tee` names the **ingest app** only (see below). It says nothing about who may
  train.

### Who can open a sample

| Who | When | How |
|---|---|---|
| The creator | Before launch | They hold the files. |
| The **ingest app** (the launchpad's attested keeper) | Once per token, while the token has no sample yet | It requests that token's key through the collection, encrypts the sample and stores it. The contract refuses it any key for a token that already has a sample. |
| A **training app** | While the token is actively rented to it | It requests the key with an attested key of the app that the loan names. The contract checks the loan and asks the MPC network to derive the key encrypted to a throwaway key made inside the TEE. |
| Anyone else, the holder included | Never | — |

On-chain additions for this:
- **Training app registry.** `register_app_key(public_key, quote, collateral,
  event_log)` is the same verification `register_keeper_key` does now (TDX quote,
  report data binding the key, RTMR3 replay, app id), but for any Phala app. It
  records `public_key → app_id`. Anyone may call it and pays for the storage.
  Registered keys are shared across the collection. *(Builder may put this on the
  launchpad instead, so that every collection shares it.)*
- **`request_sample_keys(token_ids, app_public_key)`**, called by an account
  whose signing key (`env::signer_account_pk()`) is a registered app key. Each
  token must have an active loan whose `app_id` is that key's app, with its
  single use unspent. For each token, the collection calls the MPC network's
  `request_app_private_key` with the token's path and returns the encrypted
  results.
- **Ingest:** `request_ingest_keys(token_ids, app_public_key)`, from the
  collection's ingest app's attested key, only for tokens with no sample.

A key, once released, is known to that app. The single-use promise therefore
rests on the attested training code discarding keys and plaintext after the run.
The README says so. What the chain enforces is who can get a key in the first
place.

### Launch in one go

The creator chooses the **Dataset** template on `/launch` and drops a folder whose
sub-folders are the class names (`hotdog/`, `not_hotdog/`), which is the layout
the dataset already has. They can also drop loose files and pick a class for each
group.

In the browser:
1. Decode each image, scale it so its longest side is at most 256 px, and
   re-encode it as JPEG. This keeps each one to a few KB and strips EXIF data.
   Show a grid of thumbnails with counts per class. Thumbnails stay local.
2. Fetch the ingest app's attestation and check the quote binds its sealing key
   to its app, exactly as sealed prompts do. In local mode, warn that the
   operator could read the images and ask for confirmation.
3. Seal each sample, `{ label, jpeg }`, with a new purpose label
   `dataset-sample/v1`, so that it cannot be passed off as a prompt or a history.

Then:
4. **One NEP-413 signed message** opens a session with the ingest app.
5. **One wallet confirmation**: the launchpad `launch` call, whose collection
   args include `kind`, `class_counts` and `initial_supply: N`. `new` mints
   tokens 1..N to the creator, and the deposit covers their storage. `max_supply`
   is N, so nobody else can mint.
6. The browser uploads the N sealed samples to the ingest app
   (`POST /c/:contract/samples`, chunked, with progress). The ingest app checks
   that the caller is the collection's admin and the tokens have no sample. It
   requests their keys in batches, opens each sample in the TEE, re-encrypts it
   under its token key, stores it on FastFS, and writes the hashes and refs with
   a new `set_samples` (ingest key only, once per token).
7. The page shows "N samples sealed" when every token has a sample. An
   interrupted upload can be resumed by dropping the same folder again. The
   tokens that already have a sample are skipped.

Token metadata is neutral (`Sample #17`, sigil art). Images and labels never
appear in public metadata.

### Renting

Loan terms gain `apps: Vec<app_id>`, the training apps the holder accepts (at
least one, for dataset collections). Holders use `lend` with `messages: 1` (one
training use), a fee, an optional duration and `apps`. `sees_memory`/`learns`
have no meaning for samples and are fixed to false.

New on the contract:
- `lend_many(token_ids, terms)`: one offer per token, the same terms for all,
  storage paid once.
- `borrow_many(token_ids, app_id)`: takes each offer for that app, and must be in
  each offer's `apps`. It pays each lender its fee from a single deposit,
  refunding any surplus, and records `app_id` on the loan. It fails as a whole if
  any token isn't on offer to the caller for that app.

The lend form offers the training apps that have registered keys, by name and
app id, with a link to their published code. The collection page's **Rent**
panel shows how many samples are on offer to which app and their total price,
and offers "rent N for app X". The existing rule stays: a paid loan can't change
hands until it ends.

### The training app

A separate Phala app, with its own published code: a small service plus the
trainer. It holds its own NEAR account whose signing key is generated in the TEE
and registered with `register_app_key`.

- The renter opens a session with it (NEP-413) and calls `POST /train
  { contract, token_ids }`. The app checks on-chain that every token is actively
  rented to that renter for this app.
- It calls `request_sample_keys`, decrypts the BLS-derived keys inside the TEE
  and checks them against the network's public key (as `keeper/src/ckd.ts`
  does). It then reads the samples from FastFS, checks their hashes and opens
  them in memory. Plaintext is never written to disk.
- The trainer is Python with PyTorch and scikit-learn on CPU. A frozen
  MobileNetV3-Large (torchvision's ImageNet weights, classifier removed) turns
  each picture into 960 features, and a linear SVM (`LinearSVC`, C = 0.01,
  one-vs-rest) is fitted on them. Trained from scratch, a small CNN reached only
  52–58% on the hotdog held-out set with 150 samples; this reaches about 90%.
  The weights are baked into the image and loaded offline, checked against a
  pinned SHA-256. The run is time-capped.
- **Model contract** (trainer, ONNX and browser agree): input `image`, float32
  `[batch, 3, 224, 224]`, RGB in [0,1], squashed to 224×224 (no crop) with
  Pillow's bilinear filter; the ImageNet mean/std normalisation is inside the
  graph. Output `logits`, `[batch, classes.length]` in the collection's
  `classes` order: the SVM's weights as a linear layer (for two classes the
  decision value d gives `[-d, d]`), so the argmax is the SVM's prediction. One
  self-contained file, about 12 MB.
- It evaluates on a **public held-out set**: dataset images that are not minted,
  fetched at build time from the dataset source (not committed to the repo), so
  anyone can check the accuracy claim by running the downloaded model on them.
  It exports **ONNX**.
- It calls a new `record_training(run_id, token_ids, model_sha256,
  accuracy_bps)` with its attested key. The contract checks each loan is active,
  belongs to the same renter and app and is unspent. It marks the use spent, adds
  the run to each token's record and emits an event.
- Progress streams to the page (proving attestation, fetching keys, loading,
  training, evaluating, recording). The SVM is fitted once, so training reports
  epoch 1 of 1.
- The renter downloads the ONNX file with their session. The page checks its
  SHA-256 against the on-chain record before using it. The app then drops the
  keys and samples.

### Using the model

The collection page loads the downloaded model with `onnxruntime-web`, shows its
accuracy on the held-out set, and has a drop zone: drop a photo, get "hotdog" /
"not hotdog" with a confidence.

### What a holder sees

On a sample's page: owner, loan status, which apps it is offered to, total
earned in fees, and the runs it went into (run id, training app, model hash,
accuracy, renter). Its sigil grows a stage with each run, the same way kat art
grows with context versions. Nobody, the holder included, can view the image.

### Verification

A run page shows the `record_training` transaction, the training app's id and
attested key, the code hash of the app, the key requests that preceded it, and
the model hash. The existing verify page covers the ingest app.

## Demo script (testnet)

1. Before the demo, on a real Phala CVM running the ingest app and the training
   app, the creator account launches the hotdog collection by drag and drop. A
   script spreads the tokens across 3 holder accounts and lists them all for the
   training app (for example 0.01 NEAR, one use, 1 day).
2. On stage: show a collection where no image is visible anywhere. Rent 150
   samples for the training app in one confirmation, and show three holders paid.
3. Press Train. Show the attestation and key requests on-chain, then the progress
   for under a minute. Accuracy appears, the run is recorded on-chain, and the
   model downloads.
4. Drop a hotdog photo and the page says "hotdog". Open a sample's page to show
   it earned rent and trained model #1 for that app.
5. *(Stretch)* A second training app, for example a different architecture,
   rents the same samples and gets a different model.

The launch itself can also be shown live with a small folder, if time allows.

## Constraints

- Testnet. Stealth naming on-chain and in public artifacts until the user lifts
  it. The submission README and X post come at the end, with the user's go-ahead.
- Build and test everything in local mode first. Then deploy the ingest app and
  the training app to Phala and launch the demo collection against them. The
  ingest app is fixed when the collection launches, so local-mode collections are
  throwaway.
- Latest stable libraries throughout (PyTorch, onnxruntime-web, near-kit).
- Contract changes keep old collections working. New fields use their own
  storage keys or `migrate`, as the branch already does.

## Calls made while writing this (not the user's)

- **Ingest app = the launchpad's keeper**, attested. It can get a token's key
  only while that token has no sample, so it can't read samples later. The kats'
  keeper code is extended, not replaced.
- **Per-token CKD paths** (`nearkat/samples/v1/<token_id>`) rather than one root
  per collection, so that keys can be scoped to rentals.
- **Which images are minted.** The dataset's own split is used: `train/`
  images are minted, and `val/`/`test/` is the public held-out set. If minting
  every training image in one transaction exceeds gas, `new` mints in chained
  self-calls inside the same transaction. The goal is still one confirmation.
- **Encrypted cache.** Apps may cache the encrypted blobs they read from FastFS
  (they are ciphertext), so training doesn't depend on gateway speed.
- **The single use is enforced on-chain** by `record_training`, not only counted
  by an app.

## Left to the builder

- Whether the training app registry lives on each collection or on the launchpad.
- How key requests, samples and FastFS files are batched per transaction, and gas
  sizing.
- How rentals are chosen in "rent N" (cheapest first, spread across holders, and
  so on).
- Training hyper-parameters, as long as a run on about 150 images finishes under
  60 s on the CVM's CPU and beats chance clearly on the held-out set.
- How the training app's service and trainer talk, and how the model file is kept
  for download.
- Sigil changes for runs. Exact UI layout, following the existing design.

## Open items

- **Per-token CKD throughput is the first thing to prove (day 1).** Ingesting
  about 200 tokens and training on 150 means hundreds of MPC requests. Measure
  latency, gas, deposit and how many fit in one transaction on testnet. If it's
  too slow for the stage, request keys at rent time (`borrow_many` triggers
  them), so they are ready before Train is pressed.
  - Measured on testnet (`keeper/scripts/ckd-throughput.ts`, domain 2, 15 Tgas,
    1 yocto): one request takes 6.9-8.3 s to final and burns about 8.7 Tgas
    (1 yocto deposit); all decrypt. A single transaction with 10 requests did
    not work: the MPC contract panicked "Request has timed out" after about
    125 s, and 2 in one transaction also timed out (HTTP 408), so one request
    per transaction is the largest working batch. Separate transactions
    from one account run in parallel without trouble: 5 in parallel took 7.8 s,
    10 in parallel 7.8 s, all decrypt. Verdict by the rule (10 in one
    transaction over 20 s): `KEYS_AT_RENT_TIME = true`; parallel single
    transactions (about 8 s for 10) would support false for small counts.
  - Fan-out from one contract call (`probes/ckd-fanout`, `keeper/scripts/ckd-fanout.ts`,
    one `request_app_private_key` promise per key, joined with `Promise::and`, 300 Tgas
    attached): N=2, 5, 10, two runs each, all took 7.9-9.7 s to final, the callback
    received all N responses every time and all N decrypt and pass `openResponse`.
    Gas burnt is about 9.2 Tgas per key (21 / 48 / 92 Tgas for 2 / 5 / 10), so the
    limit is the 300 Tgas cap (15 Tgas static per promise), not the MPC network.
    Conclusion: fan-out works reliably up to N=10 in one call (about 8 s); larger
    N was not tried, expect roughly 15 to 20 per call by gas.
- The Phala CVM has not been deployed before (no CVM in `deploy/` yet). Plan time
  for two apps, including the trainer's image size and the whole compose being
  attested. Run `npm run live-check` against them.
- Five days. Priority order if time runs short: launch by drop, rent, train and
  download, browser inference; then holder history and the run page; then the
  stretch goals.
