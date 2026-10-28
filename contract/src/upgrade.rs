//! Moving a live collection to a newer version of the collection code.
//!
//! A collection from the launchpad may only move to code the launchpad has
//! approved, so a creator can't swap in code that drops the promises buyers
//! relied on (the public prompt, the TEE requirement, the terms). A
//! collection its operator deployed directly can move to any published code.
//! Either way the new code runs `migrate` in the same transaction, and the
//! launchpad records which version the collection now runs.

use near_sdk::json_types::Base58CryptoHash;
use near_sdk::{env, near, require, Gas, NearToken, Promise, PromiseError};

use near_contract_standards::non_fungible_token::{NonFungibleToken, TokenId};
use near_sdk::borsh::BorshDeserialize;
use near_sdk::store::LookupMap;
use near_sdk::{AccountId, CryptoHash, PublicKey};

use crate::attestation::AttestedKey;
use crate::{Contract, ContractExt, Kat, KeySource, SealedPrompt, TeeRequirement, Terms};

const GAS_FOR_CHECK: Gas = Gas::from_tgas(5);
const GAS_FOR_APPROVED: Gas = Gas::from_tgas(60);
const GAS_FOR_MIGRATE: Gas = Gas::from_tgas(20);
const GAS_FOR_RECORD: Gas = Gas::from_tgas(10);

#[near]
impl Contract {
    /// Moves this collection to the published code `code_hash`. Admin only.
    #[payable]
    pub fn upgrade(&mut self, code_hash: Base58CryptoHash) -> Promise {
        self.assert_admin();
        match &self.factory_id {
            Some(factory) => Promise::new(factory.clone())
                .function_call(
                    "is_code_approved",
                    near_sdk::serde_json::json!({ "code_hash": code_hash })
                        .to_string()
                        .into_bytes(),
                    NearToken::from_yoctonear(0),
                    GAS_FOR_CHECK,
                )
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(GAS_FOR_APPROVED)
                        .on_upgrade_checked(code_hash),
                ),
            None => self.switch_code(code_hash),
        }
    }

    #[private]
    pub fn on_upgrade_checked(
        &mut self,
        code_hash: Base58CryptoHash,
        #[callback_result] approved: Result<bool, PromiseError>,
    ) -> Promise {
        require!(
            matches!(approved, Ok(true)),
            "The launchpad has not approved that version"
        );
        let switch = self.switch_code(code_hash);
        let factory = self
            .factory_id
            .clone()
            .unwrap_or_else(|| env::panic_str("No launchpad"));
        switch.then(
            Promise::new(factory).function_call(
                "record_upgrade",
                near_sdk::serde_json::json!({ "code_hash": code_hash })
                    .to_string()
                    .into_bytes(),
                NearToken::from_yoctonear(0),
                GAS_FOR_RECORD,
            ),
        )
    }

    /// Re-reads the state after new code is in place, converting an older
    /// layout when that is what is stored.
    #[private]
    #[init(ignore_state)]
    pub fn migrate(code_hash: Base58CryptoHash) -> Self {
        let raw =
            env::storage_read(b"STATE").unwrap_or_else(|| env::panic_str("No state to migrate"));
        // Newest layout first; each older one converts to the next.
        let mut state = if let Ok(current) = Self::try_from_slice(&raw) {
            current
        } else if let Ok(v2) = ContractV2::try_from_slice(&raw) {
            v2.into_current()
        } else if let Ok(v1) = ContractV1::try_from_slice(&raw) {
            v1.into_v2().into_current()
        } else {
            env::panic_str("Stored state is in a layout this version can't read")
        };
        state.code_hash = Some(code_hash.into());
        state
    }
}

/// The layout before key epochs, when `key_source` was optional (to c74795b).
#[near(serializers = [borsh])]
pub(crate) struct ContractV1 {
    pub tokens: NonFungibleToken,
    pub kats: LookupMap<TokenId, Kat>,
    pub admin_id: AccountId,
    pub keeper_id: AccountId,
    pub treasury_id: AccountId,
    pub mint_price: NearToken,
    pub base_uri: String,
    pub name: String,
    pub symbol: String,
    pub prompt: String,
    pub starter: String,
    pub max_supply: Option<u64>,
    pub tee: Option<TeeRequirement>,
    pub next_token_id: u64,
    pub treasury_accrued: NearToken,
    pub inference_accrued: NearToken,
    pub debit_seq: u64,
    pub attested_keys: LookupMap<PublicKey, AttestedKey>,
    pub media_extension: String,
    pub terms: Terms,
    pub sealed_prompt: Option<SealedPrompt>,
    pub sealed_key_attested: bool,
    pub factory_id: Option<AccountId>,
    pub code_hash: Option<CryptoHash>,
    pub key_source: Option<KeySource>,
}

impl ContractV1 {
    /// Contexts saved before epochs used the bare path, which is epoch 0; new
    /// saves start at epoch 1. A collection whose keys came from its keeper's
    /// own secret has no MPC key to move to, so it can't take this version.
    fn into_v2(self) -> ContractV2 {
        let key_source = self.key_source.unwrap_or_else(|| {
            env::panic_str(
                "This collection's keys come from its keeper's own secret; this version takes keys only from NEAR's MPC network",
            )
        });
        ContractV2 {
            tokens: self.tokens,
            kats: self.kats,
            admin_id: self.admin_id,
            keeper_id: self.keeper_id,
            treasury_id: self.treasury_id,
            mint_price: self.mint_price,
            base_uri: self.base_uri,
            name: self.name,
            symbol: self.symbol,
            prompt: self.prompt,
            starter: self.starter,
            max_supply: self.max_supply,
            tee: self.tee,
            next_token_id: self.next_token_id,
            treasury_accrued: self.treasury_accrued,
            inference_accrued: self.inference_accrued,
            debit_seq: self.debit_seq,
            attested_keys: self.attested_keys,
            media_extension: self.media_extension,
            terms: self.terms,
            sealed_prompt: self.sealed_prompt,
            sealed_key_attested: self.sealed_key_attested,
            factory_id: self.factory_id,
            code_hash: self.code_hash,
            key_source,
            key_epoch: 1,
            kat_epochs: LookupMap::new(crate::StorageKey::KatEpochs),
        }
    }
}

impl Contract {
    /// Points this account at the published code and migrates, in one batch:
    /// if `migrate` fails, the switch is undone with it.
    fn switch_code(&mut self, code_hash: Base58CryptoHash) -> Promise {
        Promise::new(env::current_account_id())
            .use_global_contract(code_hash)
            .function_call(
                "migrate",
                near_sdk::serde_json::json!({ "code_hash": code_hash })
                    .to_string()
                    .into_bytes(),
                NearToken::from_yoctonear(0),
                GAS_FOR_MIGRATE,
            )
    }
}

/// The layout with key epochs, before token wallets (to 824f1dc).
#[near(serializers = [borsh])]
pub(crate) struct ContractV2 {
    pub tokens: NonFungibleToken,
    pub kats: LookupMap<TokenId, Kat>,
    pub admin_id: AccountId,
    pub keeper_id: AccountId,
    pub treasury_id: AccountId,
    pub mint_price: NearToken,
    pub base_uri: String,
    pub name: String,
    pub symbol: String,
    pub prompt: String,
    pub starter: String,
    pub max_supply: Option<u64>,
    pub tee: Option<TeeRequirement>,
    pub next_token_id: u64,
    pub treasury_accrued: NearToken,
    pub inference_accrued: NearToken,
    pub debit_seq: u64,
    pub attested_keys: LookupMap<PublicKey, AttestedKey>,
    pub media_extension: String,
    pub terms: Terms,
    pub sealed_prompt: Option<SealedPrompt>,
    pub sealed_key_attested: bool,
    pub factory_id: Option<AccountId>,
    pub code_hash: Option<CryptoHash>,
    pub key_source: KeySource,
    pub key_epoch: u32,
    pub kat_epochs: LookupMap<TokenId, u32>,
}

impl ContractV2 {
    /// Wallets start off; the admin turns them on with `enable_wallets`.
    fn into_current(self) -> Contract {
        Contract {
            tokens: self.tokens,
            kats: self.kats,
            admin_id: self.admin_id,
            keeper_id: self.keeper_id,
            treasury_id: self.treasury_id,
            mint_price: self.mint_price,
            base_uri: self.base_uri,
            name: self.name,
            symbol: self.symbol,
            prompt: self.prompt,
            starter: self.starter,
            max_supply: self.max_supply,
            tee: self.tee,
            next_token_id: self.next_token_id,
            treasury_accrued: self.treasury_accrued,
            inference_accrued: self.inference_accrued,
            debit_seq: self.debit_seq,
            attested_keys: self.attested_keys,
            media_extension: self.media_extension,
            terms: self.terms,
            sealed_prompt: self.sealed_prompt,
            sealed_key_attested: self.sealed_key_attested,
            factory_id: self.factory_id,
            code_hash: self.code_hash,
            key_source: self.key_source,
            key_epoch: self.key_epoch,
            kat_epochs: self.kat_epochs,
            wallet_code_hash: None,
            wallets: LookupMap::new(crate::StorageKey::Wallets),
        }
    }
}
