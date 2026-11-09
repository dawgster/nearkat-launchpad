# Dataset collections: NFTs of private training data

Date: 2026-11-09
Status: awaiting review
Branch: `claude/demo-polish-launchpad`
Deadline: NEAR Hackathon submission, 14 Nov 2026 23:59 UTC

## Why

The launchpad's idea is that an NFT can stand for data that the owner controls
and nobody else can read. The kats are one face of that, a character whose mind
is sealed. This is a second face: **each token is one encrypted training example**.
The image can only be opened inside an attested TEE, and only while someone has
rented the token. The holder is paid rent for each use. The renter gets a trained
model, but never the images.

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
- The project stays stealth until it is finished, then goes public for the
  submission (public repo, X post). Nothing is published before the user says so.

## Goals

1. On `/launch`, a creator drops a folder of labelled images and gets a live
   dataset collection, one token per image, after **one signed message and one
   wallet confirmation**.
2. Images leave the creator's browser only sealed to the attested keeper. After
   that they exist only encrypted under the collection's CKD keys on FastFS.
3. Holders list their samples for rent, all of them in one transaction.
4. A renter rents a batch of samples in one transaction, and every holder is
   paid at that moment.
5. The renter presses **Train**. Within about a minute the TEE has trained a
   small CNN on exactly the rented samples and reported accuracy on a public
   held-out set. It also records on-chain the model's hash and the list of
   tokens it trained on, and the renter downloads the model.
6. On the same page the renter drops a photo onto the downloaded model, which
   runs in the browser and answers "hotdog" or "not hotdog".
7. Each token shows that it was rented, what it earned, and which model runs it
   went into.

## Non-goals

- Real or sensitive datasets, other data types (text, tabular), or tasks other
  than image classification.
- Training code supplied by the renter. One fixed trainer, attested as part of
  the app.
- GPUs, large models, hyper-parameter search.
- Protection against what a model can leak about its training data (membership
  inference, inversion). The README states this plainly as a known limit.
- A loan NEP or marketplace integration.
- Mainnet. The demo runs on testnet.

## Anti-goals (a failure even if it works)

- A plaintext image reaching anything but the creator's browser and the attested
  app, including the operator, the web server and logs.
- A launch that needs a confirmation per image, or many confirmations at all.
- Training slow enough to stall the stage. It should take under 60 s, with
  visible progress.
- A regression in character collections. Kats, chat, lending and wallets keep
  working unchanged.
- A model that trained on a token without an active paid rental, or a rental that
  could be used twice.

## How it fits what exists

The parts already on the branch carry most of this:

| Need | Already there |
|---|---|
| Launch a collection in one batch | `launchpad/` factory, global collection code |
| Per-token keys only the attested app gets | CKD from NEAR's MPC network (`keeper/src/ckd.ts`, `contract/src/ckd.rs`) |
| Send secrets from the browser to the TEE only | Sealing to the keeper's attested X25519 key with purpose labels (`web/src/lib/sealing.ts`, `keeper/src/sealing.ts`) |
| Encrypted blobs on NEAR | FastFS (`keeper/src/fastfs.ts`), `context_ref`/hash on the token |
| Rent with a fee to the owner | `contract/src/lending.rs` (`lend`, `borrow`, single-use via `messages: 1`) |
| Proving which code runs | On-chain TDX attestation, attested signing key |
| Token art that changes with state | `art/`, sigil for launched collections, served by the keeper |

A sample is stored the same way a kat's context is. Its **context** is the
sealed image plus its label, encrypted under the collection's context key for
the current epoch and stored on FastFS, with its hash and ref on the token.

## Design

### Collection kind

`CollectionArgs` gains `kind: Character | Dataset { classes: Vec<String> }`,
which is fixed at launch and defaults to `Character`. Old collections read as
`Character` without migration, with the kind kept under its own storage key as
with `history_import`.

For a `Dataset` collection:
- `prompt`, `starter`, chat, history import, wallets' mind payments do not apply;
  the keeper refuses chat routes.
- `classes` is public (`["hotdog", "not_hotdog"]`). Which token has which label
  is **private**: the label travels inside the sealed sample.
- `get_collection` also reports `class_counts` as declared by the creator at
  launch (a public claim that nothing checks; the page says so).

### Launch in one go

The creator chooses the **Dataset** template on `/launch` and drops a folder whose
sub-folders are the class names (`hotdog/`, `not_hotdog/`), which is the layout
the dataset already has. They can also drop loose files and pick a class for each
group.

In the browser:
1. Decode each image, scale it so its longest side is at most 256 px, and
   re-encode it as JPEG. This keeps each one to a few KB and strips EXIF data.
   Show a grid of thumbnails with counts per class. Thumbnails stay local.
2. Fetch the keeper's attestation and check the quote binds its sealing key to
   the chosen app, exactly as sealed prompts do. In local mode, warn that the
   operator could read the images and ask for confirmation.
3. Seal each sample, `{ label, jpeg }`, to the sealing key with a new purpose
   label `dataset-sample/v1`, so that it cannot be passed off as a prompt or a
   history.

Then:
4. **One NEP-413 signed message** opens a keeper session for the creator.
5. **One wallet confirmation**: the launchpad `launch` call, whose collection
   args include `kind`, `class_counts` and `initial_supply: N`. `new` mints
   tokens 1..N to the creator. The deposit covers their storage. `max_supply`
   is N, so nobody else can mint.
6. The browser uploads the N sealed samples to the keeper
   (`POST /c/:contract/samples`, chunked, with progress). For each one, the
   keeper checks that the caller is the collection's admin and the token has no
   context yet. It then opens the sample inside the TEE, re-encrypts it under
   the token's CKD key, stores it on FastFS, and writes hash and ref with a new
   keeper-only `set_context_batch`. Uploads and on-chain writes are batched (many
   FastFS files and contexts per transaction).
7. The page shows "N samples sealed" when every token has a context. An
   interrupted upload can be resumed by dropping the same folder again. The
   tokens that already have a context are skipped.

Token metadata is neutral (`Sample #17`, sigil art). Images and labels never
appear in public metadata.

### Renting

Holders use the existing `lend` with `messages: 1` (one training use), a fee,
and an optional duration. `sees_memory`/`learns` have no meaning for samples and
are fixed to false.

New on the contract:
- `lend_many(token_ids, terms)`: one offer per token, the same terms for all,
  storage paid once.
- `borrow_many(token_ids)`: takes each offer and pays each lender its fee from a
  single deposit, refunding any surplus. It fails as a whole if any token is not
  on offer to the caller.

On the collection page, a **Rent** panel shows how many samples are on offer and
their total price, and offers "rent N" (choosing listed tokens, spread across
holders). Rented tokens are still bound by the existing rule: a paid loan can't
change hands until it ends.

### Training

- `POST /c/:contract/train { token_ids }`, with a session as the renter. The
  keeper checks on-chain that every token has an active loan to the renter whose
  single use is unspent. It loads and decrypts the samples inside the TEE.
- A **trainer** sidecar runs in the same Phala app (same compose, so the same
  attestation covers it): Python, PyTorch on CPU. It reuses the small 64×64 RGB
  CNN and training loop from
  `~/Repositories/near_nn/hotdog_cnn_contract/scripts/export_model.py`
  (conv-pool-conv-pool-conv, global average pooling, linear). The keeper sends it
  the images over a local socket only. It never writes plaintext to disk. The
  seed is fixed and the run is time-capped.
- It evaluates on a **public held-out set**: dataset images that are not minted,
  shipped with the web app, so anyone can check the accuracy claim by running the
  downloaded model on them. It exports **ONNX**.
- The keeper calls a new `record_training(run_id, token_ids, model_sha256,
  accuracy_bps)`, signed with its attested key. The contract checks each loan is
  active, belongs to the same renter and is unspent, marks the use spent, adds
  the run to each token's record and emits an event. That makes the use count
  on-chain and stops a rental from being trained on twice.
- Progress streams to the page (loading, epoch k/n, evaluating, recording).
- The renter downloads the ONNX file with their session. The page checks its
  SHA-256 against the on-chain record before using it.

### Using the model

The collection page loads the downloaded model with `onnxruntime-web`, shows its
accuracy on the held-out set, and has a drop zone: drop a photo, get "hotdog" /
"not hotdog" with a confidence.

### What a holder sees

On a sample's page: owner, loan status, total earned in fees, and the runs it
went into (run id, model hash, accuracy, renter). Its sigil grows a stage with
each run, the same way kat art grows with context versions. Nobody, the holder
included, can view the image. *(Assumption: the holder is not shown their own
image. The point of the demo is that nobody sees it.)*

### Verification

The existing verify page covers the keeper's attestation. A run page shows the
`record_training` transaction, the attested key that signed it, the code hash of
the app (keeper plus trainer), and the model hash.

## Demo script (testnet)

1. Before the demo, the creator account launches the hotdog collection by drag
   and drop. A script spreads the tokens across 3 holder accounts and lists them
   all for rent (for example 0.01 NEAR, one use, 1 day).
2. On stage: show a collection where no image is visible anywhere. Rent 150
   samples in one confirmation, and show three holders paid.
3. Press Train. Progress runs for under a minute. Accuracy appears, the run is
   recorded on-chain, and the model downloads.
4. Drop a hotdog photo and the page says "hotdog". Open a sample's page to show
   it earned rent and trained model #1.
5. *(Stretch)* Load the model into the on-chain hotdog contract from `near_nn`:
   trained in private, running in public on NEAR.

The launch itself can also be shown live with a small folder, if time allows.

## Constraints

- Testnet. Stealth naming on-chain and in public artifacts until the user lifts
  it (see the earlier deployment notes). The submission README and X post come at
  the end, with the user's go-ahead.
- **Develop locally first, demo on a real Phala CVM** (user's decision). Build
  and test everything in local mode, then deploy the dataset keeper plus trainer
  to Phala and launch the demo collection against that app. Because the TEE
  requirement is fixed at launch, the demo collection is launched only once the
  CVM is up; local-mode collections are throwaway.
- CKD against the live testnet MPC network already works; it was checked for the
  kats (user, 2026-11-09).
- Latest stable libraries throughout (PyTorch, onnxruntime-web, near-kit).
- Contract changes keep old collections working. New fields use their own
  storage keys or `migrate`, as the branch already does.

## Calls made while writing this (not the user's)

- **Separate keeper.** Dataset collections get their own keeper account and
  Phala app (`LaunchArgs.keeper_id`), with the trainer sidecar. The kats'
  keeper is not redeployed for this.
- **Which images are minted.** The dataset's own split is used: `train/`
  images are minted, and `val/`/`test/` is the public held-out set. The
  held-out images are fetched at build time from the dataset's source and not
  committed to the repo, which keeps third-party photos out of the public repo.
  If minting every training image in one transaction exceeds gas, `new` mints
  in chained self-calls inside the same transaction. The goal is still one
  confirmation.
- **Encrypted cache.** The keeper may cache the encrypted blobs it reads from
  FastFS (they are ciphertext), so training doesn't depend on gateway speed.
- **The single use is enforced on-chain** by `record_training`, not only
  counted by the keeper, as for chat loans.

## Left to the builder

- How samples, contexts and FastFS files are batched per transaction, and gas
  sizing.
- How rentals are chosen in "rent N" (cheapest first, spread across holders, and
  so on).
- Training hyper-parameters, as long as a run on about 150 images finishes under
  60 s on the CVM's CPU and beats chance clearly on the held-out set.
- How the keeper and the trainer talk to each other, and how the model file is
  kept for download.
- Sigil changes for runs.
- Exact UI layout, following the existing design.

## Open items

- The Phala CVM has not been deployed before (no CVM in `deploy/` yet). Plan time
  for it, including the trainer's image size and the whole compose being attested.
  Run `npm run live-check` against it. CKD on testnet is already proven.
- Five days. Priority order if time runs short: launch by drop, rent, train and
  download, browser inference; then holder history and the run page; the
  on-chain export last.
