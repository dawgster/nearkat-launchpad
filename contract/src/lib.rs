mod admin;
pub mod attestation;
pub(crate) mod ckd;
mod dataset;
mod kat;
mod keeper;
pub mod lending;
mod nft;
mod payout;
pub(crate) mod upgrade;
pub mod wallet;

use near_contract_standards::non_fungible_token::events::NftMint;
use near_contract_standards::non_fungible_token::metadata::TokenMetadata;
use near_contract_standards::non_fungible_token::{NonFungibleToken, Token, TokenId};
use near_sdk::json_types::{Base58CryptoHash, U64};
use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, CryptoHash, NearToken, PanicOnDefault,
    PublicKey,
};

pub use kat::{
    Collection, CollectionKind, CollectionView, ConfigView, Kat, KatView, KeySource, SealedPrompt,
    TeeRequirement, Terms, DEFAULT_PROMPT, DEFAULT_STARTER,
};
use kat::{MAX_PROMPT_LEN, MAX_SEALED_PROMPT_LEN, MAX_STARTER_LEN};
pub use payout::Payout;

/// Bytes charged at mint on top of the measured usage. Covers later growth no
/// caller pays for: the context hash and ref, first-approval bookkeeping, and
/// a longer owner id after a transfer.
pub const KAT_STORAGE_RESERVE_BYTES: u64 = 600;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    OwnerById,
    TokenMetadata,
    Enumeration,
    Approval,
    Kats,
    AttestedKeys,
    KatEpochs,
    Wallets,
}

/// Set when owners may import their chat history; see `Collection::history_import`.
const HISTORY_IMPORT_KEY: &[u8] = b"history_import";

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct Contract {
    tokens: NonFungibleToken,
    kats: LookupMap<TokenId, Kat>,
    admin_id: AccountId,
    keeper_id: AccountId,
    treasury_id: AccountId,
    mint_price: NearToken,
    /// Where token images live. Empty until the artwork exists.
    base_uri: String,
    /// Collection name, also used in each token's title.
    name: String,
    symbol: String,
    /// Instructions shared by every token. Public, fixed at deployment.
    prompt: String,
    /// The context every token starts from. Public, fixed at deployment.
    starter: String,
    max_supply: Option<u64>,
    /// Where contexts may be opened. Fixed at deployment.
    tee: Option<TeeRequirement>,
    next_token_id: u64,
    /// Mint revenue, owed to the treasury.
    treasury_accrued: NearToken,
    /// Inference charges, owed to the keeper that pays for inference.
    inference_accrued: NearToken,
    /// Sequence number of the last applied `debit_batch`.
    debit_seq: u64,
    /// Keeper keys proven to run inside the required TEE app.
    attested_keys: LookupMap<PublicKey, attestation::AttestedKey>,
    /// Extension of token images under `base_uri`.
    media_extension: String,
    terms: Terms,
    /// Instructions only the TEE app can read. Fixed at deployment.
    sealed_prompt: Option<SealedPrompt>,
    /// Set once a key attested inside the app is the one the prompt is sealed to.
    sealed_key_attested: bool,
    /// The launchpad this came from, which approves upgrades. None for a
    /// collection its operator deployed directly.
    factory_id: Option<AccountId>,
    /// The published code this runs, when known.
    code_hash: Option<CryptoHash>,
    /// Where context keys come from. Fixed at deployment.
    key_source: KeySource,
    /// Contexts are saved under this epoch's key. Starts at 1.
    key_epoch: u32,
    /// The key epoch each token's context is saved under. Kept apart from
    /// `Kat` so token records from before epochs still read; a token missing
    /// here was saved under epoch 0, the key from before epochs.
    kat_epochs: LookupMap<TokenId, u32>,
    /// The published code token wallets run. None: no wallets.
    wallet_code_hash: Option<CryptoHash>,
    /// Each token's wallet record, from when its wallet is opened.
    wallets: LookupMap<TokenId, wallet::Wallet>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(
        admin_id: AccountId,
        keeper_id: AccountId,
        treasury_id: AccountId,
        mint_price: NearToken,
        collection: Collection,
        code_hash: Option<Base58CryptoHash>,
    ) -> Self {
        let Collection {
            name,
            symbol,
            base_uri,
            prompt,
            starter,
            max_supply,
            tee,
            media_extension,
            terms,
            sealed_prompt,
            key_source,
            wallet_code_hash,
            history_import,
            kind,
            class_counts,
            initial_supply,
        } = collection;
        require!(
            !name.trim().is_empty() && !symbol.trim().is_empty(),
            "name and symbol must not be empty"
        );
        let or_default = |text: String, default: &str| {
            if text.trim().is_empty() {
                default.to_string()
            } else {
                text
            }
        };
        let prompt = or_default(prompt, DEFAULT_PROMPT);
        let starter = or_default(starter, DEFAULT_STARTER);
        require!(
            prompt.chars().count() <= MAX_PROMPT_LEN,
            format!("prompt must be at most {MAX_PROMPT_LEN} characters")
        );
        require!(
            starter.chars().count() <= MAX_STARTER_LEN,
            format!("starter must be at most {MAX_STARTER_LEN} characters")
        );
        if let Some(tee) = &tee {
            tee.validate();
        }
        require!(
            max_supply.is_none_or(|max| max.0 > 0),
            "max_supply must be at least 1"
        );
        terms.validate();
        let dataset_size = dataset::validate(&kind, &class_counts, initial_supply);
        // A dataset holds exactly its samples, whatever else was asked for.
        let max_supply = dataset_size.map(U64).or(max_supply);
        let media_extension = if media_extension.is_empty() {
            "png".to_string()
        } else {
            media_extension
        };
        require!(
            media_extension.len() <= 8
                && media_extension.bytes().all(|b| b.is_ascii_alphanumeric()),
            "media_extension must be 1 to 8 letters or digits"
        );
        if let Some(sealed) = &sealed_prompt {
            require!(
                tee.is_some(),
                "A sealed prompt needs a TEE requirement, or nothing could read it safely"
            );
            require!(
                !sealed.ciphertext.is_empty() && sealed.ciphertext.len() <= MAX_SEALED_PROMPT_LEN,
                "sealed_prompt.ciphertext must be 1 to 24000 bytes"
            );
            require!(
                sealed.sealed_to.len() == 64
                    && sealed.sealed_to.bytes().all(|b| b.is_ascii_hexdigit()),
                "sealed_prompt.sealed_to must be a 32-byte hex key"
            );
        }
        // A launchpad initialises the collections it creates; an operator
        // deploying directly initialises from the contract's own account.
        let factory_id = (env::predecessor_account_id() != env::current_account_id())
            .then(env::predecessor_account_id);
        // Under its own key, so collections from before it read as "off"
        // without a state migration. Fixed at deployment.
        if history_import {
            env::storage_write(HISTORY_IMPORT_KEY, &[1]);
        }
        if let CollectionKind::Dataset { classes } = &kind {
            let info = dataset::DatasetInfo {
                classes: classes.clone(),
                class_counts: class_counts.iter().map(|c| c.0).collect(),
            };
            env::storage_write(
                dataset::DATASET_KEY,
                &near_sdk::borsh::to_vec(&info)
                    .unwrap_or_else(|_| env::panic_str("Dataset can't be encoded")),
            );
        }
        let mut contract = Self {
            tokens: NonFungibleToken::new(
                StorageKey::OwnerById,
                admin_id.clone(),
                Some(StorageKey::TokenMetadata),
                Some(StorageKey::Enumeration),
                Some(StorageKey::Approval),
            ),
            kats: LookupMap::new(StorageKey::Kats),
            admin_id,
            keeper_id,
            treasury_id,
            mint_price,
            base_uri,
            name,
            symbol,
            prompt,
            starter,
            max_supply: max_supply.map(|max| max.0),
            tee,
            next_token_id: 1,
            treasury_accrued: NearToken::from_yoctonear(0),
            inference_accrued: NearToken::from_yoctonear(0),
            debit_seq: 0,
            attested_keys: LookupMap::new(StorageKey::AttestedKeys),
            media_extension,
            terms,
            sealed_prompt,
            sealed_key_attested: false,
            factory_id,
            code_hash: code_hash.map(Into::into),
            key_source,
            key_epoch: 1,
            kat_epochs: LookupMap::new(StorageKey::KatEpochs),
            wallet_code_hash: wallet_code_hash.map(Into::into),
            wallets: LookupMap::new(StorageKey::Wallets),
        };
        if let Some(n) = dataset_size {
            contract.mint_sample_batch(n);
        }
        contract
    }

    /// Mints the next kat to the caller. The deposit must cover the mint price
    /// plus storage (measured usage and a fixed reserve); anything above that
    /// becomes the kat's inference balance.
    #[payable]
    pub fn mint(&mut self) -> Token {
        let deposit = env::attached_deposit();
        require!(
            self.dataset_classes().is_none(),
            "This collection's samples were all minted at launch"
        );
        require!(
            self.max_supply.is_none_or(|max| self.next_token_id <= max),
            "Sold out"
        );
        let storage_before = env::storage_usage();
        let token_id = self.next_token_id.to_string();
        self.next_token_id += 1;

        let metadata = TokenMetadata {
            title: Some(format!("{} #{token_id}", self.name)),
            media: (!self.base_uri.is_empty())
                .then(|| format!("{token_id}.{}", self.media_extension)),
            ..Default::default()
        };
        let token = self.tokens.internal_mint_with_refund(
            token_id.clone(),
            env::predecessor_account_id(),
            Some(metadata),
            None,
        );
        self.kats
            .insert(token_id, Kat::new(NearToken::from_yoctonear(0)));
        self.kats.flush();

        let storage_bytes = env::storage_usage() - storage_before + KAT_STORAGE_RESERVE_BYTES;
        let storage_cost = env::storage_byte_cost().saturating_mul(storage_bytes.into());
        let required = self.mint_price.saturating_add(storage_cost);
        require!(
            deposit >= required,
            format!("Deposit too low: need at least {required}")
        );
        let balance = deposit.saturating_sub(required);
        self.kats
            .get_mut(&token.token_id)
            .unwrap_or_else(|| env::panic_str("Kat not found"))
            .balance = balance;
        self.treasury_accrued = self.treasury_accrued.saturating_add(self.mint_price);
        NftMint {
            owner_id: &token.owner_id,
            token_ids: &[token.token_id.as_str()],
            memo: None,
        }
        .emit();
        token
    }

    /// Adds the attached deposit to a kat's inference balance.
    #[payable]
    pub fn fund(&mut self, token_id: TokenId) {
        let deposit = env::attached_deposit();
        require!(!deposit.is_zero(), "Attach NEAR to fund a kat");
        let kat = self.kat_mut(&token_id);
        kat.balance = kat
            .balance
            .checked_add(deposit)
            .unwrap_or_else(|| env::panic_str("Balance overflow"));
    }

    pub fn get_kat(&self, token_id: TokenId) -> Option<KatView> {
        let kat = self.kats.get(&token_id)?;
        let owner_id = self.tokens.owner_by_id.get(&token_id)?;
        let epoch = self.kat_epochs.get(&token_id).copied().unwrap_or(0);
        Some(KatView::new(owner_id, kat, epoch))
    }

    /// How the collection presents itself: its public prompt, the context
    /// every token starts from, and where contexts may be opened.
    pub fn get_collection(&self) -> CollectionView {
        CollectionView {
            name: self.name.clone(),
            symbol: self.symbol.clone(),
            base_uri: self.base_uri.clone(),
            prompt: self.prompt.clone(),
            starter: self.starter.clone(),
            max_supply: self.max_supply.map(U64),
            tee: self.tee.clone(),
            media_extension: self.media_extension.clone(),
            terms: self.terms.clone(),
            sealed_prompt: self.sealed_prompt.clone(),
            sealed_key_attested: self.sealed_key_attested,
            key_source: self.key_source.clone(),
            key_epoch: self.key_epoch,
            wallet_code_hash: self.wallet_code_hash.map(Into::into),
            history_import: env::storage_has_key(HISTORY_IMPORT_KEY),
            kind: self
                .dataset_classes()
                .map_or(CollectionKind::Character, |classes| {
                    CollectionKind::Dataset { classes }
                }),
            class_counts: self.dataset_info().map_or_else(Vec::new, |info| {
                info.class_counts.into_iter().map(U64).collect()
            }),
            minted: U64(self.next_token_id - 1),
            factory_id: self.factory_id.clone(),
            code_hash: self.code_hash.map(Into::into),
        }
    }

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            admin_id: self.admin_id.clone(),
            keeper_id: self.keeper_id.clone(),
            treasury_id: self.treasury_id.clone(),
            mint_price: self.mint_price,
            treasury_accrued: self.treasury_accrued,
            inference_accrued: self.inference_accrued,
            debit_seq: self.debit_seq.into(),
        }
    }
}

impl Contract {
    pub(crate) fn kat_mut(&mut self, token_id: &TokenId) -> &mut Kat {
        self.kats
            .get_mut(token_id)
            .unwrap_or_else(|| env::panic_str("Kat not found"))
    }
}

#[cfg(test)]
mod attestation_tests;
#[cfg(test)]
mod tests;
