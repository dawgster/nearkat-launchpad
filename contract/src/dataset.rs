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
use crate::{Contract, ContractExt};

/// Raw storage key of a dataset's classes and counts. Under its own key, so
/// collections from before datasets read as characters with no migration.
pub(crate) const DATASET_KEY: &[u8] = b"dataset";

/// How many samples one call mints, to stay within gas.
pub(crate) const SAMPLE_MINT_BATCH: u64 = 50;

/// Keys per `request_ingest_keys` call, to stay within gas.
const MAX_INGEST_KEYS: usize = 10;
/// Samples sealed per `set_samples` call.
const MAX_SEAL_BATCH: usize = 50;
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
        for (i, token_id) in token_ids.iter().enumerate() {
            require!(
                !token_ids[..i].contains(token_id),
                format!("Sample {token_id} is listed twice")
            );
            self.require_unsealed(token_id);
        }
        let mut requests = token_ids
            .iter()
            .map(|token_id| self.ckd_request(sample_key_path(token_id), &app_public_key));
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
        })
    }

    /// Mints up to a batch of the samples still to come, then schedules the
    /// rest. Only the collection itself calls this.
    #[private]
    pub fn mint_samples(&mut self, count: U64) {
        self.mint_sample_batch(count.0);
    }
}

impl Contract {
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

    /// Mints `min(count, SAMPLE_MINT_BATCH)` samples to the admin (the
    /// creator) and schedules `mint_samples` for what remains. Storage comes
    /// out of the collection account's balance.
    pub(crate) fn mint_sample_batch(&mut self, count: u64) {
        let max = self.max_supply.unwrap_or(0);
        let minted = self.next_token_id - 1;
        require!(
            minted + count <= max,
            "More samples than the collection holds"
        );
        let now = count.min(SAMPLE_MINT_BATCH);
        let owner = self.admin_id.clone();
        let mut ids = Vec::with_capacity(now as usize);
        for _ in 0..now {
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
        let id_refs: Vec<&str> = ids.iter().map(String::as_str).collect();
        NftMint {
            owner_id: &owner,
            token_ids: &id_refs,
            memo: None,
        }
        .emit();
        let remaining = count - now;
        if remaining > 0 {
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
