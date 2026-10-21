//! The launchpad: anyone can launch their own collection of prompt-based
//! NFTs. Each collection is a sub-account running the collection contract
//! from `../contract`, published once as a global contract and referenced by
//! its code hash, so every collection runs exactly the same audited code and
//! none pays to store its own copy.

use near_sdk::json_types::{Base58CryptoHash, U64};
use near_sdk::store::{IterableMap, LookupSet};
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, BorshStorageKey, CryptoHash, Gas, NearToken,
    PanicOnDefault, Promise, PromiseError,
};

#[cfg(test)]
mod tests;

const GAS_FOR_INIT: Gas = Gas::from_tgas(30);
const GAS_FOR_LAUNCH_CALLBACK: Gas = Gas::from_tgas(15);
const GAS_FOR_WITHDRAW_CALLBACK: Gas = Gas::from_tgas(5);
const MAX_SLUG_LEN: usize = 32;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Collections,
    Reserved,
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
}

#[near(serializers = [json])]
#[derive(Debug, PartialEq)]
pub struct CollectionListing {
    pub account_id: AccountId,
    pub creator_id: AccountId,
    pub name: String,
    pub symbol: String,
    pub live: bool,
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
            },
        );
        let init = near_sdk::serde_json::json!({
            "admin_id": creator_id,
            "keeper_id": keeper_id,
            "treasury_id": creator_id,
            "mint_price": args.mint_price,
            "collection": args.collection,
        });
        Promise::new(account_id.clone())
            .create_account()
            .transfer(deposit.saturating_sub(self.launch_fee))
            .use_global_contract(code_hash)
            .function_call(
                "new",
                init.to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                GAS_FOR_INIT,
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
        }
    }

    // Admin

    /// Opens launching, or moves new launches to another published version of
    /// the collection contract. Existing collections keep the code they have.
    #[payable]
    pub fn set_collection_code_hash(&mut self, code_hash: Base58CryptoHash) {
        self.assert_admin();
        self.collection_code_hash = Some(code_hash.into());
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
