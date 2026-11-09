//! Dataset collections: each token is one training sample, and every sample
//! is minted to the creator when the collection launches.

use near_contract_standards::non_fungible_token::events::NftMint;
use near_contract_standards::non_fungible_token::metadata::TokenMetadata;
use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::json_types::U64;
use near_sdk::{env, near, require, Gas, GasWeight, NearToken, Promise};

use crate::kat::{CollectionKind, Kat};
use crate::{Contract, ContractExt};

/// Raw storage key of a dataset's classes and counts. Under its own key, so
/// collections from before datasets read as characters with no migration.
pub(crate) const DATASET_KEY: &[u8] = b"dataset";

/// How many samples one call mints, to stay within gas.
pub(crate) const SAMPLE_MINT_BATCH: u64 = 50;

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

#[near]
impl Contract {
    /// Mints up to a batch of the samples still to come, then schedules the
    /// rest. Only the collection itself calls this.
    #[private]
    pub fn mint_samples(&mut self, count: U64) {
        self.mint_sample_batch(count.0);
    }
}

impl Contract {
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
