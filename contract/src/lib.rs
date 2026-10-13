mod kat;

use near_contract_standards::non_fungible_token::{NonFungibleToken, TokenId};
use near_sdk::store::LookupMap;
use near_sdk::{near, AccountId, BorshStorageKey, NearToken, PanicOnDefault};

pub use kat::{ConfigView, Kat, KatView};

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    OwnerById,
    TokenMetadata,
    Enumeration,
    Approval,
    Kats,
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct Contract {
    tokens: NonFungibleToken,
    kats: LookupMap<TokenId, Kat>,
    admin_id: AccountId,
    keeper_id: AccountId,
    treasury_id: AccountId,
    mint_price: NearToken,
    base_uri: String,
    next_token_id: u64,
    treasury_accrued: NearToken,
}

#[near]
impl Contract {
    #[init]
    pub fn new(
        admin_id: AccountId,
        keeper_id: AccountId,
        treasury_id: AccountId,
        mint_price: NearToken,
        base_uri: String,
    ) -> Self {
        Self {
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
            next_token_id: 1,
            treasury_accrued: NearToken::from_yoctonear(0),
        }
    }

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            admin_id: self.admin_id.clone(),
            keeper_id: self.keeper_id.clone(),
            treasury_id: self.treasury_id.clone(),
            mint_price: self.mint_price,
            treasury_accrued: self.treasury_accrued,
        }
    }
}

#[cfg(test)]
mod tests;
