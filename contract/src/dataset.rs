//! Dataset collections: each token is one training sample, and every sample
//! is minted to the creator when the collection launches.

use near_contract_standards::non_fungible_token::events::NftMint;
use near_contract_standards::non_fungible_token::metadata::TokenMetadata;
use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::json_types::{Base64VecU8, U64};
use near_sdk::{env, near, require, AccountId, Gas, GasWeight, NearToken, Promise};

use crate::ckd::sample_key_path;
use crate::kat::{CollectionKind, Kat};
use crate::lending::log_event;
use crate::{Contract, ContractExt};

/// Raw storage key of a dataset's classes and counts. Under its own key, so
/// collections from before datasets read as characters with no migration.
pub(crate) const DATASET_KEY: &[u8] = b"dataset";

/// How many samples one call mints, to stay within gas.
pub(crate) const SAMPLE_MINT_BATCH: u64 = 50;

/// Minting stops when less gas than this is left, which keeps the call
/// itself (and `new`) from running out. A sample costs about 4 Tgas.
const GAS_TO_STOP_MINTING: Gas = Gas::from_tgas(30);
/// The rest is only scheduled when this much is left to run it. A chain of
/// continuations shares the gas of the transaction that started it (300
/// Tgas at most), so it reaches about 70 samples; `finish_minting` mints
/// more, in later transactions.
const GAS_TO_CONTINUE_MINTING: Gas = Gas::from_tgas(60);

/// Keys per `request_ingest_keys` call, to stay within gas.
const MAX_INGEST_KEYS: usize = 10;
/// Samples sealed per `set_samples` call.
const MAX_SEAL_BATCH: usize = 50;
/// Samples one `record_training` call may list.
const MAX_RUN_TOKENS: usize = 50;
const MAX_RUN_ID_LEN: usize = 64;
/// Most tokens `get_run_tokens` returns at once.
const MAX_RUN_TOKENS_PAGE: u32 = 100;
const RUN_PREFIX: &[u8] = b"run:";
const RUN_TOKENS_PREFIX: &[u8] = b"runtok:";
const SAMPLE_RUNS_PREFIX: &[u8] = b"runs:";
/// Gas for `on_sample_keys`, which only reads the results.
const GAS_FOR_SAMPLE_KEYS: Gas = Gas::from_tgas(10);
/// An MPC response ({big_y, big_c}) is far below this.
const MAX_KEY_RESPONSE_LEN: usize = 1024;

pub(crate) const MAX_CLASSES: usize = 16;
pub(crate) const MAX_CLASS_NAME_LEN: usize = 32;
pub(crate) const MAX_INITIAL_SUPPLY: u64 = 1000;

#[derive(BorshSerialize, BorshDeserialize)]
#[borsh(crate = "near_sdk::borsh")]
pub(crate) struct DatasetInfo {
    pub classes: Vec<String>,
    pub class_counts: Vec<u64>,
}

/// Checks a dataset's declaration and returns its sample count.
pub(crate) fn validate(
    kind: &CollectionKind,
    class_counts: &[U64],
    initial_supply: Option<U64>,
) -> Option<u64> {
    match kind {
        CollectionKind::Character => {
            require!(
                class_counts.is_empty() && initial_supply.is_none(),
                "class_counts and initial_supply are only for datasets"
            );
            None
        }
        CollectionKind::Dataset { classes } => {
            require!(
                (2..=MAX_CLASSES).contains(&classes.len()),
                "A dataset has 2 to 16 classes"
            );
            for (i, class) in classes.iter().enumerate() {
                require!(
                    (1..=MAX_CLASS_NAME_LEN).contains(&class.len())
                        && class
                            .bytes()
                            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_'),
                    "class names are 1 to 32 lowercase letters, digits or _"
                );
                require!(!classes[..i].contains(class), "class names must be unique");
            }
            require!(
                class_counts.len() == classes.len(),
                "class_counts needs one count per class"
            );
            let n = initial_supply
                .unwrap_or_else(|| env::panic_str("A dataset needs an initial_supply"))
                .0;
            require!(
                (1..=MAX_INITIAL_SUPPLY).contains(&n),
                "initial_supply must be 1 to 1000"
            );
            let sum = class_counts
                .iter()
                .try_fold(0u64, |acc, c| acc.checked_add(c.0));
            require!(
                sum == Some(n),
                "initial_supply must equal the sum of class_counts"
            );
            Some(n)
        }
    }
}

#[near(serializers = [json])]
#[derive(Debug, PartialEq)]
pub struct SampleView {
    pub owner_id: AccountId,
    pub sample_hash: Option<Base64VecU8>,
    pub sample_ref: Option<String>,
    /// How many training runs have used it.
    pub runs: u32,
}

/// A training run, as an app recorded it. Lives under `run:<run_id>`; its
/// tokens are under `runtok:<run_id>`.
#[derive(BorshSerialize, BorshDeserialize)]
#[borsh(crate = "near_sdk::borsh")]
struct RunRecord {
    app_id: String,
    renter_id: AccountId,
    model_sha256: String,
    accuracy_bps: u16,
    token_count: u32,
    /// Nanoseconds, when its first part was recorded.
    recorded_at: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct RunView {
    pub run_id: String,
    pub app_id: String,
    pub renter_id: AccountId,
    pub model_sha256: String,
    pub accuracy_bps: u16,
    pub token_count: u32,
    pub recorded_at: U64,
}

impl RunRecord {
    fn view(&self, run_id: &str) -> RunView {
        RunView {
            run_id: run_id.to_string(),
            app_id: self.app_id.clone(),
            renter_id: self.renter_id.clone(),
            model_sha256: self.model_sha256.clone(),
            accuracy_bps: self.accuracy_bps,
            token_count: self.token_count,
            recorded_at: U64(self.recorded_at),
        }
    }
}

fn gas_left() -> Gas {
    env::prepaid_gas().saturating_sub(env::used_gas())
}

fn slot(prefix: &[u8], id: &str) -> Vec<u8> {
    [prefix, id.as_bytes()].concat()
}

fn read_raw<T: BorshDeserialize>(key: &[u8]) -> Option<T> {
    env::storage_read(key).map(|raw| {
        T::try_from_slice(&raw).unwrap_or_else(|_| env::panic_str("Run record is corrupt"))
    })
}

fn write_raw<T: BorshSerialize>(key: &[u8], value: &T) {
    let bytes = near_sdk::borsh::to_vec(value).unwrap_or_else(|_| env::panic_str("Can't encode"));
    env::storage_write(key, &bytes);
}

fn read_run(run_id: &str) -> Option<RunRecord> {
    read_raw(&slot(RUN_PREFIX, run_id))
}

fn sample_runs(token_id: &str) -> Vec<String> {
    read_raw(&slot(SAMPLE_RUNS_PREFIX, token_id)).unwrap_or_default()
}

fn require_unique(token_ids: &[TokenId]) {
    for (i, token_id) in token_ids.iter().enumerate() {
        require!(
            !token_ids[..i].contains(token_id),
            format!("Sample {token_id} is listed twice")
        );
    }
}

#[near]
impl Contract {
    /// Has the MPC network derive a key for each listed sample, encrypted to
    /// `app_public_key`, so the keeper can seal the samples. Keeper only;
    /// dataset only; only samples not sealed yet. Resolves to
    /// `on_sample_keys`' answer. Attach plenty of gas: each request gets a
    /// share of what is left.
    pub fn request_ingest_keys(
        &mut self,
        token_ids: Vec<TokenId>,
        app_public_key: String,
    ) -> Promise {
        self.assert_keeper();
        self.require_dataset();
        require!(
            (1..=MAX_INGEST_KEYS).contains(&token_ids.len()),
            format!("At most {MAX_INGEST_KEYS} keys per call")
        );
        require_unique(&token_ids);
        for token_id in &token_ids {
            self.require_unsealed(token_id);
        }
        self.sample_key_requests(token_ids, &app_public_key)
    }

    /// Has the MPC network derive each listed sample's key, encrypted to
    /// `app_public_key`, for the training app that signed this transaction.
    /// Each sample must be sealed and rented, with its use unspent, for that
    /// app. The app checks that the renter's session asked for it;
    /// `record_training` holds it to the renter. Resolves to
    /// `on_sample_keys`' answer. Attach plenty of gas (300 Tgas): each
    /// request gets a share of what is left.
    pub fn request_sample_keys(
        &mut self,
        token_ids: Vec<TokenId>,
        app_public_key: String,
    ) -> Promise {
        let app_id = self.require_signer_app("request sample keys");
        self.require_dataset();
        require!(
            (1..=MAX_INGEST_KEYS).contains(&token_ids.len()),
            format!("At most {MAX_INGEST_KEYS} keys per call")
        );
        require_unique(&token_ids);
        for token_id in &token_ids {
            self.require_rental(token_id, &app_id, None);
            let sealed = self
                .kats
                .get(token_id)
                .is_some_and(|kat| kat.context_version != 0);
            require!(sealed, format!("Sample {token_id} is not sealed yet"));
        }
        self.sample_key_requests(token_ids, &app_public_key)
    }

    /// Records a training run by the app that signed this transaction, on
    /// samples `renter_id` rented for it, and spends each rental. A run may
    /// be recorded in parts: a later call with the same `run_id`, app, renter
    /// and model adds its samples. The deposit pays the records' storage
    /// (about 0.0013 NEAR a sample with a 64-character run_id, so up to 0.07
    /// NEAR for 50); the rest is refunded.
    #[payable]
    pub fn record_training(
        &mut self,
        run_id: String,
        renter_id: AccountId,
        token_ids: Vec<TokenId>,
        model_sha256: String,
        accuracy_bps: u16,
    ) -> RunView {
        let app_id = self.require_signer_app("record training");
        self.require_dataset();
        require!(
            (1..=MAX_RUN_ID_LEN).contains(&run_id.len())
                && run_id
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-'),
            "run_id is 1 to 64 lowercase letters, digits or -"
        );
        require!(
            model_sha256.len() == 64 && model_sha256.bytes().all(|b| b.is_ascii_hexdigit()),
            "model_sha256 is 64 hex characters"
        );
        let model_sha256 = model_sha256.to_lowercase();
        require!(accuracy_bps <= 10_000, "accuracy_bps is at most 10000");
        require!(
            (1..=MAX_RUN_TOKENS).contains(&token_ids.len()),
            format!("1 to {MAX_RUN_TOKENS} samples per call")
        );
        // Checked and spent one at a time, so a sample listed twice is
        // refused as already used.
        for token_id in &token_ids {
            self.require_rental(token_id, &app_id, Some(&renter_id));
            self.spend_rental(token_id);
        }
        let added = token_ids.len() as u32;
        let before = env::storage_usage();
        let run = match read_run(&run_id) {
            Some(mut run) => {
                require!(
                    run.app_id == app_id
                        && run.renter_id == renter_id
                        && run.model_sha256 == model_sha256,
                    format!("Run {run_id} was recorded for another app, renter or model")
                );
                run.token_count = run.token_count.saturating_add(added);
                run
            }
            None => RunRecord {
                app_id: app_id.clone(),
                renter_id: renter_id.clone(),
                model_sha256: model_sha256.clone(),
                accuracy_bps,
                token_count: added,
                recorded_at: env::block_timestamp(),
            },
        };
        write_raw(&slot(RUN_PREFIX, &run_id), &run);
        let tokens_key = slot(RUN_TOKENS_PREFIX, &run_id);
        let mut tokens: Vec<TokenId> = read_raw(&tokens_key).unwrap_or_default();
        tokens.extend(token_ids.iter().cloned());
        write_raw(&tokens_key, &tokens);
        for token_id in &token_ids {
            let mut runs = sample_runs(token_id);
            runs.push(run_id.clone());
            write_raw(&slot(SAMPLE_RUNS_PREFIX, token_id), &runs);
        }
        let bytes = env::storage_usage().saturating_sub(before);
        let cost = env::storage_byte_cost().saturating_mul(u128::from(bytes));
        let deposit = env::attached_deposit();
        require!(
            deposit >= cost,
            format!("Attach at least {cost} for the run's storage")
        );
        let refund = deposit.saturating_sub(cost);
        if !refund.is_zero() {
            Promise::new(env::predecessor_account_id())
                .transfer(refund)
                .detach();
        }
        log_event(
            "training_recorded",
            near_sdk::serde_json::json!({
                "run_id": run_id,
                "app_id": app_id,
                "renter_id": renter_id,
                "model_sha256": model_sha256,
                "accuracy_bps": accuracy_bps,
                "token_ids": token_ids,
            }),
        );
        run.view(&run_id)
    }

    pub fn get_run(&self, run_id: String) -> Option<RunView> {
        read_run(&run_id).map(|run| run.view(&run_id))
    }

    /// A page of the run's samples, in the order recorded; at most 100.
    pub fn get_run_tokens(&self, run_id: String, from: u32, limit: u32) -> Vec<TokenId> {
        let tokens: Vec<TokenId> = read_raw(&slot(RUN_TOKENS_PREFIX, &run_id)).unwrap_or_default();
        tokens
            .into_iter()
            .skip(from as usize)
            .take(limit.min(MAX_RUN_TOKENS_PAGE) as usize)
            .collect()
    }

    /// The runs that used a sample, oldest first.
    pub fn get_sample_runs(&self, token_id: TokenId) -> Vec<String> {
        sample_runs(&token_id)
    }

    /// One entry per token, in order: the MPC response, or None if that
    /// request failed.
    #[private]
    pub fn on_sample_keys(
        &self,
        token_ids: Vec<TokenId>,
    ) -> Vec<Option<near_sdk::serde_json::Value>> {
        (0..token_ids.len() as u64)
            .map(
                |i| match env::promise_result_checked(i, MAX_KEY_RESPONSE_LEN) {
                    Ok(bytes) => near_sdk::serde_json::from_slice(&bytes).ok(),
                    Err(_) => None,
                },
            )
            .collect()
    }

    /// Records each sample's encrypted blob: its sha256 and FastFS ref. A
    /// sample is sealed once. Keeper only; dataset only.
    pub fn set_samples(&mut self, items: Vec<(TokenId, Base64VecU8, String)>) {
        self.assert_keeper();
        self.require_dataset();
        require!(
            (1..=MAX_SEAL_BATCH).contains(&items.len()),
            format!("1 to {MAX_SEAL_BATCH} samples per call")
        );
        for (token_id, sample_hash, sample_ref) in items {
            let hash: [u8; 32] = sample_hash
                .0
                .try_into()
                .unwrap_or_else(|_| env::panic_str("sample hash must be 32 bytes"));
            require!(
                !sample_ref.is_empty() && sample_ref.len() <= 256,
                "sample ref must be 1 to 256 bytes"
            );
            self.require_unsealed(&token_id);
            let kat = self.kat_mut(&token_id);
            kat.context_hash = Some(hash);
            kat.context_ref = Some(sample_ref);
            kat.context_version = 1;
            self.kat_epochs.insert(token_id, 0);
        }
    }

    pub fn get_sample(&self, token_id: TokenId) -> Option<SampleView> {
        let kat = self.kats.get(&token_id)?;
        let owner_id = self.tokens.owner_by_id.get(&token_id)?;
        Some(SampleView {
            owner_id,
            sample_hash: kat.context_hash.map(|h| h.to_vec().into()),
            sample_ref: kat.context_ref.clone(),
            runs: sample_runs(&token_id).len() as u32,
        })
    }

    /// Mints the samples still missing, up to the dataset's size, so a launch
    /// whose continuation ran out of gas or balance can be completed. Admin
    /// only; one batch per call, the rest scheduled like at launch.
    #[payable]
    pub fn finish_minting(&mut self) {
        self.assert_admin();
        self.require_dataset();
        let remaining = self
            .max_supply
            .unwrap_or(0)
            .saturating_sub(self.next_token_id - 1);
        require!(remaining > 0, "All samples are minted");
        self.mint_sample_batch(remaining);
    }

    /// Mints up to a batch of the samples still to come, then schedules the
    /// rest. Only the collection itself calls this.
    #[private]
    pub fn mint_samples(&mut self, count: U64) {
        self.mint_sample_batch(count.0);
    }
}

impl Contract {
    /// One CKD request per sample, joined, then `on_sample_keys`.
    fn sample_key_requests(&self, token_ids: Vec<TokenId>, app_public_key: &str) -> Promise {
        let mut requests = token_ids
            .iter()
            .map(|token_id| self.ckd_request(sample_key_path(token_id), app_public_key));
        let first = requests
            .next()
            .unwrap_or_else(|| env::panic_str("No samples"));
        let all = requests.fold(first, |all, next| all.and(next));
        all.then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_FOR_SAMPLE_KEYS)
                .on_sample_keys(token_ids),
        )
    }

    /// The app of the key that signed this transaction; panics if none.
    fn require_signer_app(&self, action: &str) -> String {
        self.signer_app().unwrap_or_else(|| {
            env::panic_str(&format!("Only a registered training app can {action}"))
        })
    }

    fn require_rental(&self, token_id: &TokenId, app_id: &str, renter_id: Option<&AccountId>) {
        if let Some(problem) = self.rental_problem(token_id, app_id, renter_id) {
            env::panic_str(&format!("Sample {token_id}: {problem}"));
        }
    }

    pub(crate) fn require_dataset(&self) {
        require!(
            self.dataset_classes().is_some(),
            "This is not a dataset collection"
        );
    }

    fn require_unsealed(&self, token_id: &TokenId) {
        let kat = self
            .kats
            .get(token_id)
            .unwrap_or_else(|| env::panic_str("Kat not found"));
        require!(
            kat.context_version == 0,
            format!("Sample {token_id} is already sealed")
        );
    }

    /// The classes of a dataset collection, None for a character collection.
    pub(crate) fn dataset_classes(&self) -> Option<Vec<String>> {
        self.dataset_info().map(|info| info.classes)
    }

    pub(crate) fn dataset_info(&self) -> Option<DatasetInfo> {
        let raw = env::storage_read(DATASET_KEY)?;
        Some(
            DatasetInfo::try_from_slice(&raw)
                .unwrap_or_else(|_| env::panic_str("Dataset record is corrupt")),
        )
    }

    /// Mints up to `min(count, SAMPLE_MINT_BATCH)` samples to the admin (the
    /// creator), fewer if the gas runs low, and schedules `mint_samples` for
    /// what remains if there is gas to run it. Storage comes out of the
    /// collection account's balance.
    pub(crate) fn mint_sample_batch(&mut self, count: u64) {
        let max = self.max_supply.unwrap_or(0);
        let minted = self.next_token_id - 1;
        require!(
            minted + count <= max,
            "More samples than the collection holds"
        );
        let batch = count.min(SAMPLE_MINT_BATCH);
        let owner = self.admin_id.clone();
        let mut ids = Vec::with_capacity(batch as usize);
        for _ in 0..batch {
            if gas_left() < GAS_TO_STOP_MINTING {
                break;
            }
            let token_id = self.next_token_id.to_string();
            self.next_token_id += 1;
            let metadata = TokenMetadata {
                title: Some(format!("Sample #{token_id}")),
                ..Default::default()
            };
            // No refund: the collection account pays the storage, and the
            // batch emits one event for all its tokens.
            self.tokens.internal_mint_with_refund(
                token_id.clone(),
                owner.clone(),
                Some(metadata),
                None,
            );
            self.kats
                .insert(token_id.clone(), Kat::new(NearToken::from_yoctonear(0)));
            ids.push(token_id);
        }
        require!(!ids.is_empty(), "Not enough gas to mint samples");
        let id_refs: Vec<&str> = ids.iter().map(String::as_str).collect();
        NftMint {
            owner_id: &owner,
            token_ids: &id_refs,
            memo: None,
        }
        .emit();
        let remaining = count - ids.len() as u64;
        if remaining > 0 && gas_left() >= GAS_TO_CONTINUE_MINTING {
            Promise::new(env::current_account_id())
                .function_call_weight(
                    "mint_samples".to_string(),
                    near_sdk::serde_json::json!({ "count": U64(remaining) })
                        .to_string()
                        .into_bytes(),
                    NearToken::from_yoctonear(0),
                    Gas::from_gas(0),
                    GasWeight(1),
                )
                .detach();
        }
    }
}
