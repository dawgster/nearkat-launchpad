//! The launchpad: anyone can launch their own collection of prompt-based
//! NFTs. Each collection is a sub-account running the collection contract
//! from `../contract`, published once as a global contract and referenced by
//! its code hash, so every collection runs exactly the same audited code and
//! none pays to store its own copy.

use near_sdk::json_types::{Base58CryptoHash, U64};
use near_sdk::store::{IterableMap, IterableSet, LookupSet};
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, BorshStorageKey, CryptoHash, Gas, NearToken,
    PanicOnDefault, Promise, PromiseError,
};

#[cfg(test)]
mod tests;

const GAS_FOR_INIT: Gas = Gas::from_tgas(100);
/// A dataset mints its samples while it initialises, about 4 Tgas each, so
/// it gets more: enough for `new` to mint its first batch of 50 (the sandbox
/// sees exactly 50 at launch, with too little gas left to chain more);
/// `finish_minting` mints the rest.
const GAS_FOR_DATASET_INIT: Gas = Gas::from_tgas(230);
/// What a dataset launch must attach: the init, the callback, and the launch
/// call itself.
const GAS_TO_LAUNCH_DATASET: Gas = Gas::from_tgas(280);
const GAS_FOR_LAUNCH_CALLBACK: Gas = Gas::from_tgas(15);
const GAS_FOR_WITHDRAW_CALLBACK: Gas = Gas::from_tgas(5);
const MAX_SLUG_LEN: usize = 32;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Collections,
    Reserved,
    Approved,
}

/// Where a collection's contexts may be opened. Mirrors the collection
/// contract's type; the collection itself validates it.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub enum TeeRequirement {
    Phala { app_id: String },
}

/// What a creator chooses, passed as is to the collection's `new`.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct CollectionArgs {
    pub name: String,
    pub symbol: String,
    #[serde(default)]
    pub base_uri: String,
    /// Instructions shared by every token. Any kind of prompt.
    pub prompt: String,
    /// The context each token starts from, before its owner shapes it.
    pub starter: String,
    #[serde(default)]
    pub max_supply: Option<U64>,
    #[serde(default)]
    pub tee: Option<TeeRequirement>,
    /// Extension of token images under `base_uri`.
    #[serde(default)]
    pub media_extension: String,
    /// Royalties, the creator's share of conversations, and prices. Passed
    /// through; the collection validates them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terms: Option<near_sdk::serde_json::Value>,
    /// Instructions encrypted to the keeper's sealing key. Passed through.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sealed_prompt: Option<near_sdk::serde_json::Value>,
    /// Whether owners may teach their token from their chat history. Passed through.
    #[serde(default)]
    pub history_import: bool,
    /// `"Character"` or `{"Dataset": {"classes": [...]}}`. Passed through; the collection validates it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<near_sdk::serde_json::Value>,
    /// Samples per class, for a dataset. Passed through.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub class_counts: Vec<U64>,
    /// How many samples a dataset mints to its creator at launch. Passed through.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initial_supply: Option<U64>,
}

/// Whether `kind` names a dataset. Its classes are left for the collection
/// to check; only the shape is checked here, so a malformed kind fails the
/// launch call rather than the collection's set-up.
fn is_dataset(kind: Option<&near_sdk::serde_json::Value>) -> bool {
    let shape = || env::panic_str(r#"kind is "Character" or {"Dataset": {"classes": [...]}}"#);
    match kind {
        None => false,
        Some(near_sdk::serde_json::Value::String(kind)) if kind == "Character" => false,
        Some(near_sdk::serde_json::Value::Object(kind)) if kind.len() == 1 => {
            match kind.get("Dataset").and_then(|d| d.as_object()) {
                Some(dataset)
                    if dataset.len() == 1
                        && dataset.get("classes").is_some_and(|c| {
                            c.as_array()
                                .is_some_and(|classes| classes.iter().all(|c| c.is_string()))
                        }) =>
                {
                    true
                }
                _ => shape(),
            }
        }
        Some(_) => shape(),
    }
}

/// Where every launched collection's context keys come from: NEAR's MPC
/// network. Set by the launchpad, never by a creator, who could otherwise
/// name an MPC contract they control and read every context.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct KeySource {
    pub mpc_contract_id: AccountId,
    /// The CKD domain context keys come from.
    pub domain_id: u64,
}

#[near(serializers = [json])]
pub struct LaunchArgs {
    /// The collection's account is `<slug>.<launchpad>`.
    pub slug: String,
    pub mint_price: NearToken,
    pub collection: CollectionArgs,
    /// Defaults to the launchpad's keeper. A collection that requires a TEE
    /// app the launchpad keeper does not run in names its own.
    pub keeper_id: Option<AccountId>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct CollectionEntry {
    pub creator_id: AccountId,
    pub name: String,
    pub symbol: String,
    /// False while the launch is in flight.
    pub live: bool,
    /// The published code the collection runs.
    pub code_hash: Base58CryptoHash,
}

#[near(serializers = [json])]
#[derive(Debug, PartialEq)]
pub struct CollectionListing {
    pub account_id: AccountId,
    pub creator_id: AccountId,
    pub name: String,
    pub symbol: String,
    pub live: bool,
    pub code_hash: Base58CryptoHash,
}

#[near(serializers = [json])]
pub struct LaunchpadConfig {
    pub admin_id: AccountId,
    pub keeper_id: AccountId,
    pub collection_code_hash: Option<Base58CryptoHash>,
    /// Kept by the launchpad on each successful launch.
    pub launch_fee: NearToken,
    /// Moved to each new collection's account, for its own storage.
    pub collection_funding: NearToken,
    pub fees_accrued: NearToken,
    pub key_source: Option<KeySource>,
    /// The token wallet code every launch's tokens get wallets with, if any.
    pub wallet_code_hash: Option<Base58CryptoHash>,
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct Launchpad {
    admin_id: AccountId,
    keeper_id: AccountId,
    collection_code_hash: Option<CryptoHash>,
    launch_fee: NearToken,
    collection_funding: NearToken,
    fees_accrued: NearToken,
    collections: IterableMap<AccountId, CollectionEntry>,
    /// Slugs that can never be launched, such as names the operator uses.
    reserved: LookupSet<String>,
    /// Versions of the collection code that collections may run. The current
    /// launch version is always one.
    approved: IterableSet<CryptoHash>,
    key_source: Option<KeySource>,
    /// The published token wallet code (`token-wallet/`) launches get. None: no wallets.
    wallet_code_hash: Option<CryptoHash>,
}

#[near]
impl Launchpad {
    #[init]
    pub fn new(
        admin_id: AccountId,
        keeper_id: AccountId,
        launch_fee: NearToken,
        collection_funding: NearToken,
    ) -> Self {
        Self {
            admin_id,
            keeper_id,
            collection_code_hash: None,
            launch_fee,
            collection_funding,
            fees_accrued: NearToken::from_yoctonear(0),
            collections: IterableMap::new(StorageKey::Collections),
            reserved: LookupSet::new(StorageKey::Reserved),
            approved: IterableSet::new(StorageKey::Approved),
            key_source: None,
            wallet_code_hash: None,
        }
    }

    /// Launches a collection owned by the caller: they become its admin and
    /// its treasury, so mint revenue goes to them. The deposit must cover the
    /// launch fee and the collection's funding; everything above the fee
    /// goes to the collection's account. If the launch fails, it is refunded.
    #[payable]
    pub fn launch(&mut self, args: LaunchArgs) -> Promise {
        let code_hash = self
            .collection_code_hash
            .unwrap_or_else(|| env::panic_str("Launching is not open yet"));
        let key_source = self
            .key_source
            .clone()
            .unwrap_or_else(|| env::panic_str("Launching is not open yet: no key source"));
        let deposit = env::attached_deposit();
        let required = self.launch_fee.saturating_add(self.collection_funding);
        require!(
            deposit >= required,
            format!("Deposit too low: need at least {required}")
        );
        let account_id = self.collection_account(&args.slug);
        require!(
            !self.collections.contains_key(&account_id),
            "That name is taken"
        );
        let CollectionArgs { name, symbol, .. } = &args.collection;
        require!(
            !name.trim().is_empty() && !symbol.trim().is_empty(),
            "name and symbol must not be empty"
        );
        let dataset = is_dataset(args.collection.kind.as_ref());
        require!(
            dataset == args.collection.initial_supply.is_some(),
            "A dataset needs an initial_supply, and only a dataset takes one"
        );
        if dataset {
            require!(
                env::prepaid_gas() >= GAS_TO_LAUNCH_DATASET,
                "Attach 280 Tgas to launch a dataset"
            );
        }

        let creator_id = env::predecessor_account_id();
        let keeper_id = args.keeper_id.unwrap_or_else(|| self.keeper_id.clone());
        // Held while the launch is in flight, so nobody can claim the name twice.
        self.collections.insert(
            account_id.clone(),
            CollectionEntry {
                creator_id: creator_id.clone(),
                name: name.clone(),
                symbol: symbol.clone(),
                live: false,
                code_hash: code_hash.into(),
            },
        );
        let init = near_sdk::serde_json::json!({
            "admin_id": creator_id,
            "keeper_id": keeper_id,
            "treasury_id": creator_id,
            "mint_price": args.mint_price,
            "collection": with_key_source(&args.collection, &key_source, self.wallet_code_hash),
            "code_hash": Base58CryptoHash::from(code_hash),
        });
        let init_gas = if dataset {
            GAS_FOR_DATASET_INIT
        } else {
            GAS_FOR_INIT
        };
        Promise::new(account_id.clone())
            .create_account()
            .transfer(deposit.saturating_sub(self.launch_fee))
            .use_global_contract(code_hash)
            .function_call(
                "new",
                init.to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                init_gas,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_LAUNCH_CALLBACK)
                    .on_launched(account_id, creator_id, deposit),
            )
    }

    /// Marks the collection live, or releases its name and refunds the
    /// creator. A failed batch is undone as a whole, so no account is left.
    #[private]
    pub fn on_launched(
        &mut self,
        account_id: AccountId,
        creator_id: AccountId,
        deposit: NearToken,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        if result.is_ok() {
            if let Some(entry) = self.collections.get_mut(&account_id) {
                entry.live = true;
            }
            self.fees_accrued = self.fees_accrued.saturating_add(self.launch_fee);
            return true;
        }
        self.collections.remove(&account_id);
        Promise::new(creator_id).transfer(deposit).detach();
        false
    }

    /// Collections, including any still in flight. Mostly in launch order; a
    /// failed launch moves the newest entry into its place.
    pub fn get_collections(
        &self,
        from_index: Option<U64>,
        limit: Option<U64>,
    ) -> Vec<CollectionListing> {
        let from = from_index.map_or(0, |i| i.0) as usize;
        let limit = limit.map_or(50, |l| l.0).min(100) as usize;
        self.collections
            .iter()
            .skip(from)
            .take(limit)
            .map(|(account_id, entry)| CollectionListing {
                account_id: account_id.clone(),
                creator_id: entry.creator_id.clone(),
                name: entry.name.clone(),
                symbol: entry.symbol.clone(),
                live: entry.live,
                code_hash: entry.code_hash,
            })
            .collect()
    }

    pub fn get_collection(&self, account_id: AccountId) -> Option<CollectionEntry> {
        self.collections.get(&account_id).cloned()
    }

    pub fn total_collections(&self) -> U64 {
        U64(self.collections.len().into())
    }

    /// The account a slug would launch to, or a panic saying why it can't.
    pub fn collection_account(&self, slug: &String) -> AccountId {
        require!(
            !slug.is_empty()
                && slug.len() <= MAX_SLUG_LEN
                && slug
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
                && !slug.starts_with('-')
                && !slug.ends_with('-')
                && !slug.contains("--"),
            "slug must be 1 to 32 lowercase letters, digits or single hyphens"
        );
        require!(!self.reserved.contains(slug), "That name is reserved");
        format!("{slug}.{}", env::current_account_id())
            .parse()
            .unwrap_or_else(|_| env::panic_str("That name makes an account id that is too long"))
    }

    pub fn get_config(&self) -> LaunchpadConfig {
        LaunchpadConfig {
            admin_id: self.admin_id.clone(),
            keeper_id: self.keeper_id.clone(),
            collection_code_hash: self.collection_code_hash.map(Base58CryptoHash::from),
            launch_fee: self.launch_fee,
            collection_funding: self.collection_funding,
            fees_accrued: self.fees_accrued,
            key_source: self.key_source.clone(),
            wallet_code_hash: self.wallet_code_hash.map(Base58CryptoHash::from),
        }
    }

    // Admin

    /// Opens launching, or moves new launches to another published version of
    /// the collection contract. Existing collections keep the code they have.
    #[payable]
    pub fn set_collection_code_hash(&mut self, code_hash: Base58CryptoHash) {
        self.assert_admin();
        self.collection_code_hash = Some(code_hash.into());
        self.approved.insert(code_hash.into());
    }

    /// Lets collections move to this version without making it the one new
    /// launches use. Only approve code that keeps every promise a collection
    /// makes to its buyers.
    /// Sets where the context keys of collections launched from now on come
    /// from. Existing collections keep theirs. Launching is closed while unset.
    #[payable]
    pub fn set_key_source(&mut self, key_source: Option<KeySource>) {
        self.assert_admin();
        self.key_source = key_source;
    }

    /// Gives collections launched from now on wallets for their tokens,
    /// running the token wallet code published by this hash; None stops it.
    #[payable]
    pub fn set_wallet_code_hash(&mut self, code_hash: Option<Base58CryptoHash>) {
        self.assert_admin();
        self.wallet_code_hash = code_hash.map(Into::into);
    }

    #[payable]
    pub fn approve_code_hash(&mut self, code_hash: Base58CryptoHash) {
        self.assert_admin();
        self.approved.insert(code_hash.into());
    }

    /// Stops collections moving to this version. Those already on it stay.
    #[payable]
    pub fn revoke_code_hash(&mut self, code_hash: Base58CryptoHash) {
        self.assert_admin();
        let hash: CryptoHash = code_hash.into();
        require!(
            self.collection_code_hash != Some(hash),
            "The version new launches use can't be revoked; set another first"
        );
        self.approved.remove(&hash);
    }

    pub fn is_code_approved(&self, code_hash: Base58CryptoHash) -> bool {
        self.approved.contains(&CryptoHash::from(code_hash))
    }

    pub fn get_approved_code_hashes(&self) -> Vec<Base58CryptoHash> {
        self.approved.iter().map(|hash| (*hash).into()).collect()
    }

    /// Called by a collection after it has moved to an approved version.
    pub fn record_upgrade(&mut self, code_hash: Base58CryptoHash) {
        let collection = env::predecessor_account_id();
        require!(
            self.approved.contains(&CryptoHash::from(code_hash)),
            "That version is not approved"
        );
        let entry = self
            .collections
            .get_mut(&collection)
            .unwrap_or_else(|| env::panic_str("Not a collection from this launchpad"));
        entry.code_hash = code_hash;
    }

    #[payable]
    pub fn set_keeper(&mut self, keeper_id: AccountId) {
        self.assert_admin();
        self.keeper_id = keeper_id;
    }

    #[payable]
    pub fn set_prices(&mut self, launch_fee: NearToken, collection_funding: NearToken) {
        self.assert_admin();
        self.launch_fee = launch_fee;
        self.collection_funding = collection_funding;
    }

    #[payable]
    pub fn reserve(&mut self, slugs: Vec<String>) {
        self.assert_admin();
        for slug in slugs {
            self.reserved.insert(slug);
        }
    }

    /// Sends the launch fees collected so far to the admin.
    #[payable]
    pub fn withdraw_fees(&mut self) -> Promise {
        self.assert_admin();
        let amount = self.fees_accrued;
        require!(!amount.is_zero(), "Nothing to withdraw");
        self.fees_accrued = NearToken::from_yoctonear(0);
        Promise::new(self.admin_id.clone()).transfer(amount).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_FOR_WITHDRAW_CALLBACK)
                .on_fees_withdrawn(amount),
        )
    }

    #[private]
    pub fn on_fees_withdrawn(
        &mut self,
        amount: NearToken,
        #[callback_result] result: Result<(), PromiseError>,
    ) {
        if result.is_err() {
            self.fees_accrued = self.fees_accrued.saturating_add(amount);
        }
    }
}

impl Launchpad {
    fn assert_admin(&self) {
        assert_one_yocto();
        require!(
            env::predecessor_account_id() == self.admin_id,
            "Only the admin can call this method"
        );
    }
}

/// The creator's choices, with the launchpad's key source and wallet code
/// added. A creator can't set either: `CollectionArgs` has no such fields,
/// and they are added here.
fn with_key_source(
    collection: &CollectionArgs,
    key_source: &KeySource,
    wallet_code_hash: Option<CryptoHash>,
) -> near_sdk::serde_json::Value {
    let mut value = near_sdk::serde_json::to_value(collection)
        .unwrap_or_else(|_| env::panic_str("Collection arguments can't be encoded"));
    value["key_source"] = near_sdk::serde_json::to_value(key_source)
        .unwrap_or_else(|_| env::panic_str("Key source can't be encoded"));
    if let Some(hash) = wallet_code_hash {
        value["wallet_code_hash"] = near_sdk::serde_json::to_value(Base58CryptoHash::from(hash))
            .unwrap_or_else(|_| env::panic_str("Code hash can't be encoded"));
    }
    value
}

/// The launchpad's state before wallets (to 824f1dc).
#[near(serializers = [borsh])]
pub(crate) struct LaunchpadV1 {
    pub admin_id: AccountId,
    pub keeper_id: AccountId,
    pub collection_code_hash: Option<CryptoHash>,
    pub launch_fee: NearToken,
    pub collection_funding: NearToken,
    pub fees_accrued: NearToken,
    pub collections: IterableMap<AccountId, CollectionEntry>,
    pub reserved: LookupSet<String>,
    pub approved: IterableSet<CryptoHash>,
    pub key_source: Option<KeySource>,
}

#[near]
impl Launchpad {
    /// Re-reads the state after new code is deployed, converting the layout
    /// from before wallets when that is what is stored. Launches keep having
    /// no wallets until the admin sets a `wallet_code_hash`.
    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        use near_sdk::borsh::BorshDeserialize;
        let raw =
            env::storage_read(b"STATE").unwrap_or_else(|| env::panic_str("No state to migrate"));
        if let Ok(current) = Self::try_from_slice(&raw) {
            return current;
        }
        let old = LaunchpadV1::try_from_slice(&raw).unwrap_or_else(|_| {
            env::panic_str("Stored state is in a layout this version can't read")
        });
        Self {
            admin_id: old.admin_id,
            keeper_id: old.keeper_id,
            collection_code_hash: old.collection_code_hash,
            launch_fee: old.launch_fee,
            collection_funding: old.collection_funding,
            fees_accrued: old.fees_accrued,
            collections: old.collections,
            reserved: old.reserved,
            approved: old.approved,
            key_source: old.key_source,
            wallet_code_hash: None,
        }
    }
}
