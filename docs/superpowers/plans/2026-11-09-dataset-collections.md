# Dataset Collections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A creator launches a collection of encrypted training images by drag and drop. Holders rent samples to attested training apps. A renter trains a hotdog/not-hotdog CNN inside a Phala TEE on exactly the rented samples and downloads the model.

**Architecture:** A dataset collection is the existing collection contract with a `Dataset` kind. Each token's sample is encrypted under its own key from NEAR's MPC network (CKD path `nearkat/samples/v1/<token_id>`). The contract releases that key only to the ingest keeper, before the sample exists, and to a registered training app while the token is rented to it. The keeper gains an ingest route. A new `trainer/` package (a TypeScript service with a Python/PyTorch subprocess) is the training app. The web app gains a dataset launch template, a rent panel, a train panel and in-browser inference.

**Tech Stack:** Rust (near-sdk 5.29, near-sandbox), TypeScript on Node ≥ 24 (hono, near-kit, @noble/curves, vitest, biome), Python 3.12 with uv (torch CPU, torchvision, onnx, pytest), React 19 with Vite (onnxruntime-web, Playwright), Phala Cloud (dstack).

**Spec:** `docs/superpowers/specs/2026-11-09-dataset-collections-design.md`

**Worktree:** `../nearkatnft-launchpad`, branch `claude/demo-polish-launchpad`. Deadline 14 Nov 2026 23:59 UTC.

## Global Constraints

- Testnet only. Stealth: nothing deployed or published may say "nearkat". Collection names, account names and token titles are neutral (`Sample #17`). The repo goes public only when the user says so.
- Plaintext images exist only in the creator's browser and inside attested apps. Never write them to disk, logs or error messages in the keeper or the trainer.
- Character collections behave exactly as before. Every existing test in `contract/`, `launchpad/`, `keeper/` and `web/` still passes.
- New contract state lives under its own raw storage keys (no change to the `Contract` struct's borsh layout), so existing collections need no migration.
- Latest stable libraries. Add only `onnxruntime-web` (web) and, in `trainer/py`, `torch`, `torchvision`, `onnx`, `pytest`.
- Dataset images: `truepositive/hotdog_nothotdog` (AGPL-3.0). It has `train/{hotdog,not_hotdog}` with 100 + 100 images and `val/{hotdog,not_hotdog}` with 25 + 25. Fetch it at build or run time, and never commit images.
- Model input contract (trainer, ONNX and browser must agree): RGB, squashed to 64×64 (no crop), float32 in [0,1], NCHW `[1,3,64,64]`, input name `image`, output name `logits` with shape `[1, classes.length]` in the collection's `classes` order.
- Sealing purpose label for samples: `nearkat-dataset-sample:v1`. This follows the existing `nearkat-…:v1` labels. The spec's `dataset-sample/v1` is the same thing.
- The keeper and trainer quotes use the existing report data (`sha256("nearkat-keeper:v2:" + NEAR key + ":" + sealing key)`).
- Per-call limits: at most `MAX_KEYS_PER_CALL = 10` CKD requests per contract call (15 Tgas each). At most `MAX_SAMPLES_PER_CALL = 50` tokens per `set_samples`, `lend_many`, `borrow_many` and `record_training`.

## Review Focus

1. **Dropping the dataset folder as it is laid out on disk** (`hotdog_nothotdog/train/hotdog/*.jpg`, extra nesting, a `.DS_Store`, a PNG, a 4 MB photo). The class should come from the nearest parent folder named like a class, case-insensitive. Non-images are skipped and counted. Large images are scaled down. Test: Task 13, `classifies files by their nearest class folder`.
2. **Dropping the same folder again after an interrupted upload.** Token ↔ image order must be identical every time (sorted by class index, then path). Tokens already sealed are skipped, never re-assigned. Tests: Task 13, `orders samples the same way regardless of drop order`; Task 8, `skips tokens that already have a sample`.
3. **Pressing Train twice, or a second renter using the same rentals.** The second run is refused before any key is requested, and the error says the rental was already used. Tests: Task 5, `record_training_refuses_a_spent_rental`; Task 10, `refuses tokens whose rental is spent or not the caller's`.
4. **A rental that ends, or a token that changes hands, between renting and recording.** `borrow_many` fails as a whole. A run whose loans expired mid-training is reported as "rental ended", and the renter is not shown a model that has no record on-chain. Tests: Task 4, `borrow_many_fails_whole_if_one_is_not_on_offer`; Task 10, `reports a rental that ended before recording`.
5. **Another account fetching the model, or the wallet switching accounts.** `GET /runs/:id/model` answers 403 to anyone but the renter's session. Test: Task 11, `serves the model only to the renter`.

---

## Task 0: Per-token CKD throughput on testnet (spike)

**Files:**
- Create: `keeper/scripts/ckd-throughput.ts`

This is a throwaway measurement, with no tests. It decides whether keys are requested at rent time (see the spec's open items).

- [ ] **Step 1:** Write a script that, from `pals-c0b7a5.testnet` (credentials in `~/.near-credentials/testnet/`), sends one transaction with 10 `request_app_private_key` function-call actions to `v1.signer-prod.testnet` (domain 2, 15 Tgas each, 1 yocto, distinct paths `spike/<i>`), each with its own `newAppKey()`. It decrypts each answer with `openResponse` and `appId("pals-c0b7a5.testnet", path)` from `keeper/src/ckd.ts`.
- [ ] **Step 2:** Run it 3 times: `node keeper/scripts/ckd-throughput.ts`. Record the time to final result, the gas burnt and whether all 10 decrypt. Then run 5 such transactions in parallel and record the same.
- [ ] **Step 3:** Write the numbers into the spec's "Open items" section. If one batch of 10 takes more than 20 s, or 5 in parallel fail, set `KEYS_AT_RENT_TIME = true` in Task 10. Otherwise set it to false.
- [ ] **Step 4:** Commit: `git commit -m "Spike: per-token CKD throughput on testnet"`.

---

## Task 1: Contract: dataset kind, class counts, minting every sample to the creator

**Files:**
- Create: `contract/src/dataset.rs`
- Modify: `contract/src/kat.rs` (`Collection`, `CollectionView`), `contract/src/lib.rs` (`new`, `get_collection`), `launchpad/src/lib.rs` (`CollectionArgs`, `with_key_source`)
- Test: `contract/src/tests.rs`, `launchpad/src/tests.rs`

**Interfaces:**
- Produces:
  - `pub enum CollectionKind { Character, Dataset { classes: Vec<String> } }` (json, borsh, `#[serde(default)]` → `Character`).
  - `Collection` gains `#[serde(default)] kind: CollectionKind`, `#[serde(default)] class_counts: Vec<U64>` and `#[serde(default)] initial_supply: Option<U64>`.
  - `CollectionView` gains `kind: CollectionKind` and `class_counts: Vec<U64>`.
  - `pub(crate) fn dataset_classes(&self) -> Option<Vec<String>>`, which reads raw storage key `b"dataset"`.
  - `pub fn mint_samples(&mut self, count: U64)`, a private continuation (`#[private]`).
  - `pub(crate) const SAMPLE_MINT_BATCH: u64 = 50;`

Rules: a `Dataset` needs 2 to 16 classes, each 1–32 chars of `[a-z0-9_]`, with no duplicates. `class_counts.len() == classes.len()`. `initial_supply` must be `Some(n)` with 1 ≤ n ≤ 1000 and equal to the sum of `class_counts`. `max_supply` is forced to `n`. `mint_price` is irrelevant: `mint()` panics with "This collection's samples were all minted at launch" for datasets. `new` stores `{classes, class_counts}` under `b"dataset"`. It mints the first `min(n, 50)` tokens to `admin_id` with title `Sample #<id>` and no media, and if more remain it schedules `mint_samples(remaining)` on itself (each call mints up to 50 and schedules the rest). Storage is paid from the collection account's balance; no deposit check. Character collections are unaffected.

- [ ] **Step 1: Write the failing tests** in `contract/src/tests.rs`:

```rust
#[test] fn a_dataset_mints_every_sample_to_the_creator() {
    // classes ["hotdog","not_hotdog"], counts [3,2], initial_supply 5
    // assert get_collection().minted == 5, max_supply == Some(5),
    // nft_token("5").owner_id == "admin.near", title == "Sample #5",
    // kind == Dataset { classes: [...] }, class_counts == [3,2]
}
#[test] fn a_dataset_over_fifty_schedules_the_rest() {
    // initial_supply 120 → minted == 50 after new; one promise created to mint_samples(70)
}
#[test] #[should_panic(expected = "initial_supply must equal the sum of class_counts")]
fn dataset_counts_must_add_up() {}
#[test] #[should_panic(expected = "class names are 1 to 32 lowercase letters, digits or _")]
fn dataset_class_names_are_checked() {}
#[test] #[should_panic(expected = "This collection's samples were all minted at launch")]
fn nobody_mints_from_a_dataset() {}
#[test] fn a_character_collection_reads_as_character() { /* kind == Character, class_counts empty */ }
```

In `launchpad/src/tests.rs`: `launch_passes_dataset_fields_through`. The init JSON contains `kind`, `class_counts` and `initial_supply` unchanged.

- [ ] **Step 2:** Run `cargo test --manifest-path contract/Cargo.toml dataset` and `cargo test --manifest-path launchpad/Cargo.toml dataset`. Expected: they fail to compile (`CollectionKind` is undefined).
- [ ] **Step 3:** Implement as above in `dataset.rs`, wired into `new`, `mint` and `get_collection`. In the launchpad, add the three fields to its `CollectionArgs` with `#[serde(default)]` and pass them through. Raise `GAS_FOR_INIT` if `new` minting 50 tokens needs it, and test the gas in the sandbox in Task 6.
- [ ] **Step 4:** Run `cargo test --manifest-path contract/Cargo.toml && cargo test --manifest-path launchpad/Cargo.toml`. Expected: all pass, including the existing tests.
- [ ] **Step 5:** Commit: `git commit -m "Contract: dataset collections mint every sample to their creator"`.

---

## Task 2: Contract: per-token sample keys for ingest, and `set_samples`

**Files:**
- Modify: `contract/src/ckd.rs`, `contract/src/dataset.rs`
- Test: `contract/src/tests.rs`

**Interfaces:**
- Consumes: `dataset_classes()` (Task 1), `assert_keeper()`, `Kat.context_*`.
- Produces:
  - `pub const SAMPLE_KEY_PATH: &str = "nearkat/samples/v1";` and `pub fn sample_key_path(token_id: &str) -> String` → `"nearkat/samples/v1/<token_id>"`.
  - `pub(crate) fn ckd_request(&self, path: String, app_public_key: &str) -> Promise`, factored out of `request_context_key` with identical args.
  - `pub fn request_ingest_keys(&mut self, token_ids: Vec<TokenId>, app_public_key: String) -> Promise`. Keeper only (`assert_keeper`, so attested for TEE collections). Dataset only. 1 ≤ len ≤ 10. Every token must exist with `context_version == 0`. It joins the CKD promises and then calls `on_sample_keys`.
  - `#[private] pub fn on_sample_keys(&self, token_ids: Vec<TokenId>) -> Vec<Option<near_sdk::serde_json::Value>>`. One entry per token, in order: the MPC response JSON (`{big_y, big_c}`), or `None` if that request failed.
  - `pub fn set_samples(&mut self, items: Vec<(TokenId, Base64VecU8, String)>)`: (token, sha256 of the encrypted blob, FastFS ref). Keeper only, dataset only, 1–50 items. Each token must have `context_version == 0`. It sets hash and ref, `context_version = 1`, and `kat_epochs[token] = 0` (unused for samples).
  - `pub fn get_sample(&self, token_id: TokenId) -> Option<SampleView>` with `SampleView { owner_id, sample_hash: Option<Base64VecU8>, sample_ref: Option<String> }`.

- [ ] **Step 1: Write the failing tests:**

```rust
#[test] fn sample_key_paths_name_the_token() { assert_eq!(sample_key_path("17"), "nearkat/samples/v1/17"); }
#[test] fn the_keeper_requests_ingest_keys_for_unsealed_samples() { /* 3 tokens → 3 promises + callback */ }
#[test] #[should_panic(expected = "Sample 1 is already sealed")] fn no_ingest_key_once_a_sample_is_sealed() {}
#[test] #[should_panic(expected = "Only the keeper can call this method")] fn only_the_keeper_requests_ingest_keys() {}
#[test] #[should_panic(expected = "At most 10 keys per call")] fn ingest_keys_are_limited_per_call() {}
#[test] fn set_samples_seals_each_sample_once() { /* get_sample has hash+ref */ }
#[test] #[should_panic(expected = "Sample 1 is already sealed")] fn set_samples_refuses_a_second_seal() {}
#[test] #[should_panic(expected = "This is not a dataset collection")] fn character_collections_have_no_samples() {}
```

- [ ] **Step 2:** Run `cargo test --manifest-path contract/Cargo.toml sample`. Expected: FAIL.
- [ ] **Step 3:** Implement. Use `Promise::and` over the per-token CKD promises, then `.then(Self::ext(current).with_static_gas(Gas::from_tgas(10)).on_sample_keys(token_ids))`. The callback reads `env::promise_result_checked(i, 1024)` for each token.
- [ ] **Step 4:** Run `cargo test --manifest-path contract/Cargo.toml`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "Contract: a key per sample, for the keeper only until it is sealed"`.

---

## Task 3: Contract: training app registry

**Files:**
- Create: `contract/src/apps.rs`
- Modify: `contract/src/attestation.rs` (expose `measured_app_id` result from a registration)
- Test: `contract/src/attestation_tests.rs`, `contract/src/tests.rs`

**Interfaces:**
- Produces:
  - `pub struct AppKey { pub app_id: String, pub label: String, pub seal_public_key: String, pub attested_at: u64, pub trusted_by_admin: bool }`, stored under raw key `b"appkey:" + borsh(public_key)`.
  - `#[payable] pub fn register_app_key(&mut self, public_key: PublicKey, seal_public_key: String, label: String, quote: String, collateral: String, event_log: String) -> AppKey`. Anyone may call it. It runs `verify_quote` and the same report-data check as `check_registration`, with the app id taken from the event log (`measured_app_id`), not compared to the collection's `tee`. The label is 1–48 printable chars. The deposit must cover the storage and the rest is refunded. It records the app id in the list under `b"apps"` (a `Vec<String>`, unique, at most 32 entries).
  - `#[payable] pub fn trust_app_key(&mut self, public_key: PublicKey, app_id: String, label: String) -> AppKey`. Admin only, 1 yocto plus storage, `app_id` 1–64 chars `[a-z0-9-]`, and **only for collections with no `tee`** (dev and local mode). It panics with "A TEE collection only accepts attested training apps" otherwise. It sets `trusted_by_admin = true`.
  - `pub fn get_app_key(&self, public_key: PublicKey) -> Option<AppKey>`
  - `pub fn training_apps(&self) -> Vec<(String, String)>`, which returns `(app_id, label)` for the latest label per app.
  - `pub(crate) fn signer_app(&self) -> Option<String>`, the app id of `env::signer_account_pk()`, if registered.

- [ ] **Step 1: Write the failing tests:**
  - In `attestation_tests.rs`, reusing the recorded quote fixture: `an_app_key_registers_under_the_app_its_quote_measures`. It asserts `get_app_key(..).app_id` equals the fixture's app id. `an_app_key_with_the_wrong_report_data_is_refused`.
  - In `tests.rs`: `the_admin_trusts_app_keys_only_without_a_tee`, then `#[should_panic(expected = "A TEE collection only accepts attested training apps")] trust_app_key_refused_for_tee_collections`, and `training_apps_lists_each_app_once`.
- [ ] **Step 2:** Run `cargo test --manifest-path contract/Cargo.toml app_key`. Expected: FAIL.
- [ ] **Step 3:** Implement in `apps.rs`.
- [ ] **Step 4:** Run `cargo test --manifest-path contract/Cargo.toml`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "Contract: training apps register attested keys"`.

---

## Task 4: Contract: dataset loans name training apps (`lend_many`, `borrow_many`)

**Files:**
- Modify: `contract/src/lending.rs`
- Test: `contract/src/tests.rs`

**Interfaces:**
- Consumes: `Loan`, `read`/`write`/`remove_loan`, `dataset_classes()`, `training_apps()`.
- Produces:
  - `pub struct LoanTraining { pub apps: Vec<String>, pub app_id: Option<String>, pub spent: bool }`, stored under raw key `b"loantrain:" + token_id`. It is removed in `remove_loan` together with the loan, so it never outlives the loan.
  - `#[payable] pub fn lend_many(&mut self, token_ids: Vec<TokenId>, duration_s: Option<U64>, fee: NearToken, apps: Vec<String>) -> u32`. Dataset only. The caller must own every token. 1–50 tokens. `apps` must be 1–8 ids, each in `training_apps()`. Each loan is `messages: Some(1)`, `sees_memory: false`, `learns: false`, `borrower_id: None`. The rules are otherwise those of `lend` (no active loan, duration bounds). Storage for all records is paid from one deposit and the rest is refunded. It returns the count. It emits one `loan_offered` event per token.
  - `lend` panics with "Lend samples with lend_many, naming training apps" on dataset collections.
  - `#[payable] pub fn borrow_many(&mut self, token_ids: Vec<TokenId>, app_id: String) -> u32`. 1–50 tokens. Each must be `Offered`, not owned by the caller, and have `app_id ∈ apps`. If any fails, the whole call panics. It pays each lender its fee (summing per lender, one transfer each) from one deposit and refunds the surplus. It sets `LoanTraining.app_id`. It emits `loan_started` per token.
  - `get_loan_training(&self, token_id) -> Option<LoanTraining>`.
  - `borrow` panics with "Rent samples with borrow_many, naming a training app" on dataset collections.

- [ ] **Step 1: Write the failing tests:**

```rust
#[test] fn lend_many_offers_each_sample_for_one_use() { /* messages Some(1), apps recorded */ }
#[test] #[should_panic(expected = "is not a registered training app")] fn lend_many_names_only_registered_apps() {}
#[test] fn borrow_many_pays_each_lender_once() { /* 3 tokens, 2 lenders → 2 transfers, surplus refunded */ }
#[test] #[should_panic(expected = "Sample 3 isn't offered for app")] fn borrow_many_fails_whole_if_one_is_not_on_offer() {}
#[test] fn the_training_record_goes_with_its_loan() { /* after transfer-voided loan cleared, get_loan_training is None */ }
#[test] #[should_panic(expected = "Lend samples with lend_many")] fn plain_lend_is_refused_for_samples() {}
```

- [ ] **Step 2:** Run `cargo test --manifest-path contract/Cargo.toml lend_many borrow_many`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `cargo test --manifest-path contract/Cargo.toml`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "Contract: samples are lent to named training apps, many at once"`.

---

## Task 5: Contract: training apps get keys for rented samples, and record runs

**Files:**
- Modify: `contract/src/dataset.rs`
- Test: `contract/src/tests.rs`

**Interfaces:**
- Consumes: `signer_app()` (Task 3), `LoanTraining` (Task 4), `ckd_request`, `on_sample_keys` (Task 2).
- Produces:
  - `pub fn request_sample_keys(&mut self, token_ids: Vec<TokenId>, app_public_key: String) -> Promise`. The signer's key must be a registered app key with app `A`, otherwise it panics "Only a registered training app can request sample keys". 1–10 tokens. Each must have an active loan with `app_id == Some(A)` and `!spent`, and a sealed sample. The same CKD path is used as for ingest.
  - `#[payable] pub fn record_training(&mut self, run_id: String, renter_id: AccountId, token_ids: Vec<TokenId>, model_sha256: String, accuracy_bps: u16) -> RunView`. The signer must be a registered app `A`. `run_id` is 1–64 chars `[a-z0-9-]`. `model_sha256` is 64 hex chars. `accuracy_bps ≤ 10000`. 1–50 tokens. Each loan must be active, `borrower_id == renter_id`, `app_id == A` and `!spent`, otherwise it panics with `Sample <id>: <reason>` ("rental ended", "rented by someone else", "rented for another app", "already used"). It marks each spent. It creates the run under `b"run:" + run_id`, or appends tokens if the run exists with the same app, renter and model (and panics on a mismatch). It appends `run_id` to `b"runs:" + token_id`. The deposit covers the storage and the surplus is refunded. It emits a `training_recorded` event.
  - `pub struct RunView { run_id, app_id, renter_id, model_sha256, accuracy_bps, token_count: u32, recorded_at: U64 }`, plus `get_run(run_id) -> Option<RunView>`, `get_run_tokens(run_id, from: u32, limit: u32) -> Vec<TokenId>`, and `get_sample_runs(token_id) -> Vec<String>`.
  - `get_sample` (Task 2) gains `runs: u32`.

- [ ] **Step 1: Write the failing tests:**

```rust
#[test] fn a_rented_app_requests_keys_for_its_samples() {}
#[test] #[should_panic(expected = "Only a registered training app")] fn others_get_no_sample_keys() {}
#[test] #[should_panic(expected = "Sample 2: rented for another app")] fn sample_keys_follow_the_loans_app() {}
#[test] fn record_training_spends_each_rental_and_lists_the_run() { /* get_sample_runs("1") == ["run-1"], spent */ }
#[test] #[should_panic(expected = "Sample 1: already used")] fn record_training_refuses_a_spent_rental() {}
#[test] #[should_panic(expected = "Sample 1: rental ended")] fn record_training_refuses_an_ended_rental() {}
#[test] #[should_panic(expected = "Sample 1: already used")] fn no_sample_keys_after_the_rental_is_used() {}
#[test] fn a_run_recorded_in_parts_adds_up() { /* two calls, same run_id → token_count == sum */ }
```

- [ ] **Step 2:** Run `cargo test --manifest-path contract/Cargo.toml training sample_keys`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `cargo test --manifest-path contract/Cargo.toml`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "Contract: rented samples open only for their training app; runs recorded on-chain"`.

---

## Task 6: Sandbox: the dataset flow end to end against the mock MPC

**Files:**
- Modify: `contract/tests/sandbox.rs`

**Interfaces:**
- Consumes: everything from Tasks 1–5, `mock_mpc_wasm()` and `setup_with_key_source()`.

- [ ] **Step 1: Write the test** `a_sample_opens_only_for_the_app_it_was_rented_to`. Steps: deploy a dataset collection (no `tee`) with 120 samples. Assert `minted == 120` after the chained mints, which proves the gas for `new` plus 2 continuations. As keeper, `request_ingest_keys(["1","2"])` returns 2 responses that decrypt (verify with the mock's derivation, as the existing CKD sandbox test does). Then `set_samples`. As admin, `trust_app_key(trainer key, "app-a")`. Alice receives tokens 1–2 and calls `lend_many(apps ["app-a"], fee 0.1)`. Bob calls `borrow_many(["1","2"], "app-a")`, and Alice's balance rises by 0.2 NEAR. The trainer account, signing with the trusted key, gets 2 responses from `request_sample_keys`. They decrypt to the same keys as the ingest responses. Then `record_training`. A second `request_sample_keys` fails with "already used".
- [ ] **Step 2:** Run `cargo test --manifest-path contract/Cargo.toml --test sandbox a_sample_opens -- --nocapture`. Expected: PASS. Fix the contract if gas or promises misbehave.
- [ ] **Step 3:** Commit: `git commit -m "Sandbox: a sample opens only for the app it was rented to"`.

---

## Task 7: Keeper: sample keys, multi-file FastFS uploads, dataset chain calls

**Files:**
- Create: `keeper/src/samples.ts`
- Modify: `keeper/src/ckd.ts`, `keeper/src/chain.ts`, `keeper/src/fastfs.ts`, `keeper/test/fakes.ts`
- Test: `keeper/test/samples.test.ts`, `keeper/test/fastfs.test.ts`

**Interfaces:**
- Produces (`ckd.ts`):
  - `export const SAMPLE_KEY_PATH = "nearkat/samples/v1"` and `sampleKeyPath(tokenId: string): string`.
  - `export function sampleKey(derivedKey: Uint8Array, tokenId: string): Buffer`, which is HKDF-SHA256(derived, salt `"near-mpc-ckd-hkdf-v1"`, info `sampleKeyPath(tokenId)`, 32).
  - `export async function fetchSampleKeys(collectionId: string, source: KeySource, request: (tokenIds: string[], appPublicKey: string) => Promise<Array<{ big_y: string; big_c: string } | null>>, mpcPublicKey: string, tokenIds: string[]): Promise<Map<string, Buffer>>`. It chunks by 10 and runs the chunks in parallel. One throwaway key per chunk. Each response is checked with `openResponse(…, appId(collectionId, sampleKeyPath(id)))`. A `null` or invalid response throws `Error("No key for sample <id>")`.
- Produces (`samples.ts`):
  - `export const SAMPLE_INFO = "nearkat-dataset-sample:v1"`
  - `export interface SampleDoc { v: 1; token_id: string; label: string; jpeg: string /* base64 */ }`
  - `export function sealSample(key: Uint8Array, doc: SampleDoc): Buffer` and `export function openSample(key: Uint8Array, blob: Uint8Array, tokenId: string): SampleDoc`. Both use `crypto.seal`/`open` over canonical JSON. `openSample` throws if `token_id` differs.
- Produces (`chain.ts`, on a new `DatasetChain` interface added to `Chain`):
  - `requestIngestKeys(tokenIds: string[], appPublicKey: string): Promise<Array<{big_y:string;big_c:string}|null>>`
  - `setSamples(items: Array<[tokenId: string, sha256Base64: string, ref: string]>): Promise<void>`
  - `getSample(tokenId: string): Promise<{ owner_id: string; sample_hash: string | null; sample_ref: string | null; runs: number } | null>`
  - `getDatasetInfo(): Promise<{ classes: string[] } | null>`, read from `get_collection().kind`.
  - `getAdminId(): Promise<string>`
  - `uploadFastfsMany(argsList: Uint8Array[]): Promise<string>`, one transaction with up to 20 `__fastdata_fastfs` actions (10 Tgas each).
- Produces (`fastfs.ts`): `FastfsStore.putMany(blobs: Uint8Array[]): Promise<string[]>`, which returns refs in order, all naming the same tx hash. `transactionArgs` now returns `Uint8Array[]` (every action's args), and `get` decodes each until the path matches. Old single-action refs still read.

- [ ] **Step 1: Write the failing tests:**
  - `samples.test.ts`: `seals and opens a sample for its token`. `refuses a sample sealed for another token` throws "not sample 2". `sample keys come from the MPC answer for that token's path`, using the mock vector in `keeper/test/fixtures` (add a vector for path `nearkat/samples/v1/1` produced by the mock-mpc unit test `write_vector_for_the_keeper`, extended the same way). `fetchSampleKeys asks in chunks of ten`: 23 ids → 3 requests.
  - `fastfs.test.ts`: `putMany stores several files in one transaction and reads each back`.
- [ ] **Step 2:** Run `cd keeper && npx vitest run samples fastfs`. Expected: FAIL.
- [ ] **Step 3:** Implement. Extend the fakes (`FakeChain`) with the new methods.
- [ ] **Step 4:** Run `cd keeper && npm test && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "Keeper: a key per sample from the MPC network; several FastFS files per transaction"`.

---

## Task 8: Keeper: ingest route; dataset collections refuse chat

**Files:**
- Create: `keeper/src/ingest.ts`
- Modify: `keeper/src/app.ts`, `keeper/src/collections.ts`, `keeper/src/main.ts`
- Test: `keeper/test/ingest.test.ts`, `keeper/test/app.test.ts`

**Interfaces:**
- Consumes: Task 7 and `Keys.sealing()`.
- Produces:
  - `export class Ingest { constructor(o: { contractId: string; chain: Chain; store: FastfsStore | ContextStore; sealing: SealingKey; keySource: KeySource; mpcPublicKey: () => Promise<string> }); seal(caller: string, samples: Array<{ token_id: string; sealed: string }>): Promise<{ sealed: string[]; skipped: string[] }> }`.
    - The caller must equal `getAdminId()`, otherwise it throws `ForbiddenError`.
    - At most 25 samples per call.
    - Each sealed sample opens with `sealing.open(s, SAMPLE_INFO)` to JSON `{label, jpeg}`. The label must be in `classes`. The JPEG is base64, at most 96 KB decoded, and starts with `FF D8`. Otherwise it throws a `BadRequest` naming the token. The image bytes never appear in the message.
    - Tokens whose `getSample` already has a `sample_ref` are skipped.
    - The rest: `fetchSampleKeys` via `requestIngestKeys`, then `sealSample`, `putMany` (chunks of 20) and `setSamples` (chunks of 50).
  - Route `POST /c/:contract/samples` (session required). Body `{ samples: [...] }`. 200 `{ sealed, skipped }`. 403 if not the admin. 400 on a bad sample. 409 "not a dataset collection".
  - Chat, context, export and import routes answer 409 `"Samples can't be talked to"` for dataset collections.
  - `GET /collections` entries gain `kind`.

- [ ] **Step 1: Write the failing tests** (`ingest.test.ts`, with fakes):
  - `seals each sample under its own key and records it`. After the call, `fake.samples["1"].ref` is set. Opening the stored blob with the key from the fake MPC for token 1 gives the original label and JPEG.
  - `skips tokens that already have a sample`
  - `only the collection's creator can ingest` (ForbiddenError)
  - `refuses a label that isn't one of the classes`. The message names the token and contains no base64.
  - `refuses something sealed for another purpose` (sealed with `INFO` for prompts)
  - In `app.test.ts`: `dataset collections refuse chat` (409).
- [ ] **Step 2:** Run `cd keeper && npx vitest run ingest app`. Expected: FAIL.
- [ ] **Step 3:** Implement and wire it in `main.ts` for every served collection whose kind is `Dataset`.
- [ ] **Step 4:** Run `cd keeper && npm test && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "Keeper: creators seal their samples through the TEE"`.

---

## Task 9: Python trainer

**Files:**
- Create: `trainer/py/pyproject.toml` (uv, Python 3.12, deps `torch` CPU index, `torchvision`, `onnx`, `pillow`; dev `pytest`), `trainer/py/train.py`, `trainer/py/test_train.py`

**Interfaces:**
- Produces a CLI: `python train.py --classes hotdog,not_hotdog --heldout DIR --out MODEL.onnx [--epochs 30] [--seconds 45] [--seed 7]`.
  - stdin: JSON lines `{"label": "<class>", "jpeg": "<base64>"}`, then EOF. Images are decoded in memory only.
  - stdout: JSON lines `{"stage":"loaded","count":n}`, `{"stage":"epoch","epoch":k,"epochs":n,"loss":x}`, then a final `{"stage":"done","accuracy":0.87,"heldout":50,"seconds":t}`. Errors go to stderr, and the exit code is non-zero.
  - Model: `TinyHotdogCnn` copied from `~/Repositories/near_nn/hotdog_cnn_contract/scripts/export_model.py` (conv/bn ×3, max pool, adaptive avg pool, fc1, fc2), with output size `len(classes)`.
  - Training: train transform Resize 72 → RandomResizedCrop 64 → flip → ColorJitter → ToTensor. Eval transform: Resize((64,64)) → ToTensor. AdamW, cosine schedule. It stops at `--epochs` or `--seconds`, whichever comes first. `torch.manual_seed(seed)` and `torch.set_num_threads(os.cpu_count())`.
  - Held-out: `DIR/<class>/*.jpg`. Accuracy is the fraction correct.
  - Export: `torch.onnx.export` in eval mode, with input `image` `[1,3,64,64]` and output `logits`. Opset is the latest the installed torch supports. Dynamic batch is allowed.

- [ ] **Step 1: Write the failing tests** (`test_train.py`, using small synthetic images: red squares labelled `hotdog`, blue squares labelled `not_hotdog`, 20 each, with a held-out set of 10):
  - `test_learns_a_separable_toy_set`: exits 0, final `accuracy >= 0.9`, `out` exists.
  - `test_onnx_matches_the_input_contract`: `onnx.load(out)`, input `image` with shape `[?,3,64,64]` (or `[1,3,64,64]`), output `logits` with last dim 2.
  - `test_refuses_an_unknown_label`: a non-zero exit and stderr naming the label.
  - `test_respects_the_time_cap`: `--seconds 2 --epochs 1000` finishes in under 10 s.
- [ ] **Step 2:** Run `cd trainer/py && uv run pytest -q`. Expected: FAIL (no `train.py`).
- [ ] **Step 3:** Implement `train.py`.
- [ ] **Step 4:** Run `cd trainer/py && uv run pytest -q`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "Trainer: a small CNN trained from samples on stdin, exported to ONNX"`.

---

## Task 10: Training app: the run pipeline

**Files:**
- Create: `trainer/package.json` (mirroring the keeper's scripts and deps, importing shared modules from `../keeper/src/*.ts`), `trainer/tsconfig.json`, `trainer/biome.json`, `trainer/vitest.config.ts`, `trainer/src/run.ts`, `trainer/src/chain.ts`, `trainer/src/python.ts`
- Test: `trainer/test/run.test.ts`, `trainer/test/fakes.ts`

**Interfaces:**
- Consumes: `fetchSampleKeys`, `openSample`, `FastfsStore` (Task 7), contract views and calls (Tasks 4–5).
- Produces:
  - `trainer/src/chain.ts`: `interface TrainerChain { getCollection(contract): Promise<{ classes: string[] | null; key_source: KeySource }>; getLoan(contract, id): Promise<LoanView | null>; getLoanTraining(contract, id): Promise<{ apps: string[]; app_id: string | null; spent: boolean } | null>; getSample(contract, id); requestSampleKeys(contract, ids, appPublicKey); recordTraining(contract, run: { run_id; renter_id; token_ids; model_sha256; accuracy_bps }): Promise<void>; isAppKeyRegistered(contract, publicKey): Promise<boolean>; registerAppKey(contract, proof: KeyProof & { label: string }): Promise<void>; mpcPublicKey(source): Promise<string>; fastfsStore(contract): FastfsStore }`, plus a `NearTrainerChain` implementation with near-kit, as `keeper/src/chain.ts` does.
  - `trainer/src/python.ts`: `export function runPython(args: { classes: string[]; heldoutDir: string; samples: AsyncIterable<{label:string; jpeg: Buffer}>; onProgress(p: Progress): void; signal?: AbortSignal }): Promise<{ accuracy: number; heldout: number; model: Buffer }>`. It spawns `uv run --project trainer/py python train.py` (or `TRAINER_PYTHON`), streams stdin, parses stdout lines, and writes the model to a tmpfs path (`/dev/shm` when present, else `os.tmpdir()`). It reads the file back and deletes it.
  - `trainer/src/run.ts`:
    - `export type Stage = "checking" | "keys" | "loading" | "training" | "recording" | "done" | "failed"`
    - `export interface RunState { id: string; contract: string; renter: string; tokenIds: string[]; stage: Stage; epoch?: number; epochs?: number; accuracy?: number; modelSha256?: string; error?: string }`
    - `export class Runs { constructor(o: { appId: string; appPublicKey: () => string; chain: TrainerChain; python: typeof runPython; heldoutDir: string; ensureRegistered(contract: string): Promise<void> }); start(contract: string, renter: string, tokenIds: string[]): RunState /* throws on a failed check */; get(id: string): RunState | undefined; model(id: string, caller: string): Buffer /* throws ForbiddenError unless caller === renter */ }`.
    - Pipeline:
      1. Check, synchronously before returning: 1–200 unique ids. Each `getLoan` must be `Active` with `borrower_id === renter`, and each `getLoanTraining` must have `app_id === appId` and `!spent`. Otherwise it throws `BadRequest("Sample <id>: <reason>")`. A token in another run that is not yet finished is refused with "already in a run".
      2. `ensureRegistered(contract)`.
      3. `fetchSampleKeys` via `requestSampleKeys`.
      4. Fetch each blob, `openSample`, check the label is in the classes, and stream to Python.
      5. Python.
      6. `model_sha256 = sha256(model)`. `recordTraining` in chunks of 50. On a contract panic containing "rental ended", set stage `failed` with `error: "A rental ended before the run was recorded"` and drop the model.
      7. `done`. Keys and plaintext live only in local variables of the pipeline.
    - `run_id`: `run-` plus 12 hex chars of random.
    - `KEYS_AT_RENT_TIME` from Task 0: if it is true, step 3 reads keys prefetched by `prefetch(contract, renter, ids)`, called by the web right after `borrow_many`. Otherwise `prefetch` is not built.

- [ ] **Step 1: Write the failing tests** (`run.test.ts`, with fake chain and fake python):
  - `trains on exactly the rented samples and records the run`: the fake python receives 3 samples with the right labels, and `recordTraining` is called once with the same 3 ids and `sha256(model)`.
  - `refuses tokens whose rental is spent or not the caller's`: spent → throws "Sample 2: already used"; another borrower → "Sample 2: rented by someone else".
  - `refuses a token already in a running run`
  - `reports a rental that ended before recording`: the fake `recordTraining` throws "Sample 1: rental ended", so stage is `failed`, the error is as above, and `model()` throws.
  - `serves the model only to the renter` (this one is at the `Runs.model` level; the HTTP test is in Task 11).
  - `never puts image bytes in an error`: a fake python failing with stderr containing base64 gives `error` without it ("Training failed").
- [ ] **Step 2:** Run `cd trainer && npm install && npx vitest run`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `cd trainer && npm test && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "Training app: train on rented samples, record the run"`.

---

## Task 11: Training app: HTTP, sessions, attestation, registration

**Files:**
- Create: `trainer/src/app.ts`, `trainer/src/config.ts`, `trainer/src/main.ts`, `trainer/.env.example`, `trainer/README.md`
- Test: `trainer/test/app.test.ts`, `trainer/test/config.test.ts`

**Interfaces:**
- Consumes: `Auth` (`keeper/src/auth.ts`), `keysFromRootSecret`, `localRootSecret` (`keeper/src/keys.ts`), `phalaRootSecret`, `keyProof`, `DstackAgent`, `phalaCollateral` (`keeper/src/tee.ts`), and `Runs` (Task 10).
- Produces:
  - Config from env: `TRAINER_MODE=local|phala`, `NEAR_NETWORK`, `NEAR_RPC_URL`, `TRAINER_ACCOUNT_ID`, `TRAINER_ROOT_SECRET` (local only, and refused in phala mode, as the keeper does), `TRAINER_APP_ID` (local mode: a label like `local-trainer`; phala: read from `dstack.info().app_id`), `TRAINER_LABEL` (default "Hotdog CNN"), `HELDOUT_DIR`, `ARCHIVAL_RPC_URL`, `FASTFS_GATEWAY`, `PORT` (default 8790), `WEB_ORIGINS`, `AUTH_RECIPIENT`.
  - Routes:
    - `GET /attestation`: `{ mode, app_id, public_key, seal_public_key, quote?, event_log?, compose_hash? }`
    - `GET /info`: `{ app_id, label, classes_supported: "any", heldout: n }`
    - `POST /auth/challenge` and `POST /auth/session`, as in the keeper
    - `POST /train { contract, token_ids }` (session): 202 `RunState`, or 400 with the check error
    - `GET /runs/:id`: `RunState`. Public: it shows no image data and no keys.
    - `GET /runs/:id/model` (session): `application/octet-stream`, or 403 unless the session account is the renter, or 404 until `done`.
  - `ensureRegistered(contract)`: if `isAppKeyRegistered` is false, then in phala mode it calls `registerAppKey` with `keyProof(...)` and `TRAINER_LABEL`. In local mode it throws `Error("This trainer isn't trusted by <contract>: its admin can trust key <pk> with trust_app_key")`.
- [ ] **Step 1: Write the failing tests:**
  - `app.test.ts`: `starts a run for the renter's session`, `serves the model only to the renter` (403 for another session, 200 bytes for the renter), `run status never includes samples or keys` (JSON keys ⊆ the `RunState` fields), and `train without a session is refused` (401).
  - `config.test.ts`: `refuses a root secret in phala mode`.
- [ ] **Step 2:** Run `cd trainer && npx vitest run app config`. Expected: FAIL.
- [ ] **Step 3:** Implement. `main.ts` builds everything and listens.
- [ ] **Step 4:** Run `cd trainer && npm test && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "Training app: sessions, attestation and model download"`.

---

## Task 12: Dataset fetch and held-out set

**Files:**
- Create: `scripts/fetch-hotdog.sh`, plus `.gitignore` entries for `data/`, `web/public/heldout/` and `trainer/heldout/`

**Interfaces:**
- Produces:
  - `data/hotdog/train/{hotdog,not_hotdog}/*.jpg` (the images to drop at launch).
  - `trainer/heldout/{hotdog,not_hotdog}/*.jpg`.
  - `web/public/heldout/{hotdog,not_hotdog}/*.jpg` plus `web/public/heldout/manifest.json` with `{ "classes": ["hotdog","not_hotdog"], "files": [{"path":"hotdog/x.jpg","label":"hotdog"}, ...] }`.

- [ ] **Step 1:** Write the script. It runs a shallow `git clone` of `https://github.com/truepositive/hotdog_nothotdog` at a pinned commit (record the hash) into `data/hotdog-src`, copies `train/` to `data/hotdog/train`, copies `val/` to both held-out folders, and writes the manifest. It is idempotent.
- [ ] **Step 2:** Run `bash scripts/fetch-hotdog.sh && ls data/hotdog/train/hotdog | wc -l && jq '.files | length' web/public/heldout/manifest.json`. Expected: `100` and `50`.
- [ ] **Step 3:** Run `git status --short`. Expected: no images listed.
- [ ] **Step 4:** Commit: `git commit -m "Scripts: fetch the hotdog dataset and its held-out set"`.

---

## Task 13: Web: dataset launch by drag and drop

**Files:**
- Create: `web/src/lib/samples.ts`, `web/src/components/DatasetDrop.tsx`
- Modify: `web/src/lib/sealing.ts` (export `sealTo(publicKeyHex, plaintext, info)` if it is not already exported, plus `SAMPLE_INFO`), `web/src/lib/launchpad.ts` (`LaunchRequest` gains `dataset: { classes: string[]; classCounts: number[] } | null`, and the init args map it to `kind`, `class_counts`, `initial_supply`), `web/src/lib/keeper.ts` (`sealSamples(session, contract, samples): Promise<{ sealed: string[]; skipped: string[] }>`), `web/src/pages/Launch.tsx` (a "Dataset" template that swaps prompt and starter for the drop zone)
- Test: `web/test/samples.test.ts`, `web/test/DatasetDrop.test.tsx`, `web/e2e/` (extend the launch story)

**Interfaces:**
- Produces (`samples.ts`):
  - `export interface DroppedSample { path: string; label: string; file: File }`
  - `export function classify(files: Array<{ path: string; file: File }>, classes: string[]): { samples: DroppedSample[]; skipped: Array<{ path: string; reason: "not an image" | "no class folder" }> }`. The class is the nearest ancestor folder whose name, lowercased with `-` and spaces turned into `_`, equals a class. Images are by MIME type or by extension `jpg|jpeg|png|webp`. The result is sorted by `(classes.indexOf(label), path)`.
  - `export function classesFromFolders(paths: string[]): string[]`, the class folder names found (for the default class list). Hotdog gives `["hotdog","not_hotdog"]`.
  - `export async function prepare(sample: DroppedSample): Promise<{ label: string; jpeg: Uint8Array; thumb: string }>`, using `createImageBitmap` → OffscreenCanvas with the longest side at most 256 → `convertToBlob({ type: "image/jpeg", quality: 0.85 })`. Drawing to canvas drops EXIF.
  - `export function sealSample(sealKeyHex: string, label: string, jpeg: Uint8Array): Promise<string>`, which seals `JSON.stringify({ label, jpeg: base64 })` with `SAMPLE_INFO`.
  - Token ids: sample `i` in the sorted order is token `String(i + 1)`.
- UI: a drop zone that accepts folders (`webkitGetAsEntry` traversal) and files. It shows a thumbnail grid and counts per class, plus skipped files with reasons. It checks the keeper's attestation (reusing the sealed-prompt check) before sealing, and shows the local-mode warning with a confirm. The **Launch** button runs: sign in (NEP-413), `launch` (one wallet confirmation), then `sealSamples` in chunks of 25 with a progress bar, then "N samples sealed". If the collection exists already (resume), it skips the launch and only seals. The keeper skips sealed tokens.
- [ ] **Step 1: Write the failing tests:**
  - `samples.test.ts`: `classifies files by their nearest class folder` (`hotdog_nothotdog/train/hotdog/a.jpg` → hotdog; `Not-Hotdog/b.png` → not_hotdog; `.DS_Store` → not an image; `misc/c.jpg` → no class folder). `orders samples the same way regardless of drop order` (shuffle the input, same output). `finds the classes from the folders`.
  - `DatasetDrop.test.tsx`: `shows counts per class and what was skipped`.
  - e2e (Playwright, local keeper and sandbox as in the existing story): `launches a dataset from a dropped folder`, using 6 tiny fixture JPEGs in `web/e2e/fixtures/dataset/{hotdog,not_hotdog}`. It ends at "6 samples sealed".
- [ ] **Step 2:** Run `cd web && npx vitest run samples DatasetDrop`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `cd web && npm test && npm run typecheck && npm run lint && npx playwright test launch`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "Web: launch a dataset by dropping its folder"`.

---

## Task 14: Web: renting samples and the sample page

**Files:**
- Create: `web/src/components/RentPanel.tsx`, `web/src/components/ListSamplesPanel.tsx`, `web/src/components/SamplePanel.tsx`
- Modify: `web/src/lib/contract.ts` (`KatContract` gains `lendMany`, `borrowMany`, `getLoanTraining`, `getSample`, `getSampleRuns`, `getRun`, `trainingApps`, `getAppKey`), `web/src/pages/Collection.tsx`, `web/src/pages/Kat.tsx` (render `SamplePanel` for dataset collections instead of chat)
- Test: `web/test/RentPanel.test.tsx`, `web/test/contract.test.ts`

**Interfaces:**
- Consumes: the contract methods from Tasks 3–5.
- Produces:
  - `lendMany(tokenIds: string[], terms: { durationS: number | null; fee: bigint; apps: string[] }): Promise<number>`. It chunks by 50, one transaction each, and the deposit is `LOAN_STORAGE_DEPOSIT × count`.
  - `borrowMany(tokenIds: string[], appId: string, totalFee: bigint): Promise<number>`, chunked by 50.
  - `pickRentable(offers: Array<{ tokenId: string; fee: bigint; lender: string; apps: string[] }>, appId: string, count: number): string[]`. It picks the cheapest first and then spreads round-robin across lenders, so that several holders get paid.
  - Collection page, dataset kind: classes and the class counts claim (labelled "declared by the creator"), sealed count, training apps (label, app id, "attested" or "trusted by admin"). **List your samples** for holders: count owned, fee, duration, app checkboxes, then `lendMany`. **Rent** for others: per app, how many are on offer and their total price, an input N, then `pickRentable` and `borrowMany`. It shows "paid <k> holders".
  - Sample page: owner, loan status, apps offered to, earned (sum of fees from `loan_started` events is not available on-chain, so show `fee × rentals` from runs plus the current loan), and the list of runs (run id, app, accuracy, model hash, renter). Its sigil grows a stage per run (pass `min(3, runs)` as the stage to the existing `TokenSigil`). The image is not shown, and a line says "Nobody can see this image, its owner included."
- [ ] **Step 1: Write the failing tests:**
  - `contract.test.ts`: `pickRentable spreads across lenders, cheapest first`. With 3 lenders × 3 offers at mixed fees and count 4, the result includes every lender and only the cheapest of each.
  - `RentPanel.test.tsx`: `rents N samples for an app in one go` (calls `borrowMany` with the summed fee) and `offers only apps the samples are listed for`.
- [ ] **Step 2:** Run `cd web && npx vitest run RentPanel contract`. Expected: FAIL.
- [ ] **Step 3:** Implement. The offer list comes from `nft_tokens` plus `get_loan` and `get_loan_training`, paginated (200 tokens is 3 view batches).
- [ ] **Step 4:** Run `cd web && npm test && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "Web: list samples for training apps and rent them in one go"`.

---

## Task 15: Web: train, download, and try the model

**Files:**
- Create: `web/src/lib/trainer.ts`, `web/src/lib/model.ts`, `web/src/components/TrainPanel.tsx`, `web/src/components/TryModel.tsx`
- Modify: `web/src/lib/config.ts` (`VITE_TRAINER_URLS`: a JSON map of app id to base URL), `web/src/pages/Collection.tsx`, `web/package.json` (+`onnxruntime-web`)
- Test: `web/test/model.test.ts`, `web/test/TrainPanel.test.tsx`

**Interfaces:**
- Consumes: the trainer routes (Task 11), `KeeperSession`-style sign-in (reuse `web/src/lib/session.ts` against the trainer's base URL), `getRun` (Task 14), and the held-out manifest (Task 12).
- Produces:
  - `trainer.ts`: `createTrainer(baseUrl)` returning `{ attestation(), info(), train(session, contract, tokenIds): Promise<RunState>, run(id): Promise<RunState>, model(session, id): Promise<Uint8Array> }`.
  - `model.ts`: `export async function toInput(image: ImageBitmap): Float32Array` (64×64 squash, RGB, /255, NCHW). `export async function loadModel(bytes: Uint8Array, expectedSha256: string): Promise<Classifier>`, which throws "This model isn't the one recorded on-chain" on a mismatch. `interface Classifier { classify(image: ImageBitmap, classes: string[]): Promise<{ label: string; confidence: number }> }` (softmax over `logits`). `export async function heldoutAccuracy(c: Classifier, classes: string[]): Promise<number>`, from `/heldout/manifest.json`.
  - TrainPanel, for the renter's unspent rentals per app: a "Train on N rented samples" button, then a session with that app's trainer (one signed message), then `train`, polling `run` every second. It shows the stages (checking → keys → loading → training epoch k/n → recording → done) with the accuracy. After `done` it shows `getRun` confirming the on-chain record (the transaction link and the app's attested key), then **Download model** (saves `<collection>-<run>.onnx`) and passes the bytes to TryModel.
  - TryModel: shows "held-out accuracy in your browser: X%", which is recomputed locally, and a drop zone: a photo gives "hotdog / not hotdog", the confidence and the image preview (the user's own photo only).
- [ ] **Step 1: Write the failing tests:**
  - `model.test.ts`: `toInput squashes to 64×64 RGB in [0,1], channels first` (a 2×1 red/blue bitmap gives the expected values at known indices). `loadModel refuses bytes whose hash isn't on-chain`.
  - `TrainPanel.test.tsx`: `walks through the stages to a downloadable model` (fake trainer) and `shows why a run failed` (error text from `RunState.error`).
- [ ] **Step 2:** Run `cd web && npx vitest run model TrainPanel`. Expected: FAIL.
- [ ] **Step 3:** Implement. Use onnxruntime-web's wasm backend, with the wasm files served by Vite (follow the package's Vite guidance).
- [ ] **Step 4:** Run `cd web && npm test && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 5: e2e.** Extend the Playwright story `trains and tries a model`: a local keeper, a local trainer (`TRAINER_MODE=local`, trusted with `trust_app_key` in the sandbox setup) and the 6 fixture samples. Rent 4, train (`--epochs 3`), download, then drop a fixture image and get a label. Run `cd web && npx playwright test trains`. Expected: PASS.
- [ ] **Step 6:** Commit: `git commit -m "Web: train on rented samples, download the model and try it"`.

---

## Task 16: Demo script

**Files:**
- Create: `scripts/demo-hotdog.ts` (run with Node, using near-kit from `keeper/node_modules`), `docs/demo/hotdog.md`

**Interfaces:**
- Consumes: `lend_many` and `nft_transfer`.
- Produces a CLI: `node scripts/demo-hotdog.ts --collection <id> --creator <acct> --holders h1,h2,h3 --fee 0.01 --duration 86400 --app <app_id>`. It transfers tokens round-robin from the creator to the holders, skipping any already held. Each holder then calls `lend_many` for all its tokens, in chunks of 50. It prints a summary per holder. Credentials come from `~/.near-credentials/testnet/`. It is idempotent: tokens already offered are skipped.
- `docs/demo/hotdog.md` is the stage script from the spec, with the exact URLs, accounts, and the fallback if a step fails (for example, show the recorded run if live training fails).

- [ ] **Step 1:** Write the script and run it against a local sandbox collection from Task 15's setup. Expected: the summary shows every token offered.
- [ ] **Step 2:** Commit: `git commit -m "Demo: spread hotdog samples across holders and list them"`.

---

## Task 17: Phala deployment, testnet launch, README

**Files:**
- Create: `deploy/trainer.Dockerfile` (Node 24 + uv + Python 3.12 + CPU torch; copies `trainer/`, the `keeper/src` modules it imports and `trainer/heldout`), `deploy/phala/keeper-dataset.compose.yml`, `deploy/phala/trainer.compose.yml`, `docs/demo/phala.md`
- Modify: `README.md` (root; create it if absent): a section on dataset collections, how to run locally, honesty notes (local mode, single use relying on the attested code, model leakage, AGPL dataset fetched not committed), and the hackathon tracks.

This task is operational, so its checks are live runs, not unit tests.

- [ ] **Step 1:** Build both images locally: `docker build -f deploy/trainer.Dockerfile -t trainer .` and the keeper image. Expected: they build, and `docker run trainer node trainer/src/main.ts` with `TRAINER_MODE=local` answers `GET /info`.
- [ ] **Step 2:** Ask the user for the Phala account and credits, then deploy both apps (two CVMs or one, the user's call at that moment). Record the app ids in `docs/demo/phala.md`. Fund the trainer and keeper accounts on testnet with neutral names (`pals-*`).
- [ ] **Step 3:** Run `cd keeper && npm run live-check` against the deployed keeper, and check the trainer's `GET /attestation` with the web verify logic. Expected: both quotes verify, and the app ids match.
- [ ] **Step 4:** Deploy the updated collection code and launchpad on testnet (stealth build: path remap, `--no-abi --no-embed-abi`). Set `key_source` to `v1.signer-prod.testnet` with domain 2.
- [ ] **Step 5:** Launch the hotdog collection from the web app by dropping `data/hotdog/train` (200 samples, TEE = the keeper's app). Expected: "200 samples sealed".
- [ ] **Step 6:** Run `scripts/demo-hotdog.ts` for 3 holders. In the web app, as the user's wallet `weakrice6857.testnet`: rent 150 for the trainer app, train, download, then drop a hotdog photo. Expected: training under 60 s, held-out accuracy clearly above 50%, and the run on-chain.
- [ ] **Step 7:** Commit: `git commit -m "Deploy: dataset keeper and training app on Phala; README"`. Do **not** make the repo public or post anything. That waits for the user.
