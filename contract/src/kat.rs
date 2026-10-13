use near_sdk::json_types::{Base64VecU8, U64};
use near_sdk::{near, AccountId, NearToken};

#[near(serializers = [borsh])]
pub struct Kat {
    pub context_hash: Option<[u8; 32]>,
    pub context_ref: Option<String>,
    pub context_version: u64,
    pub balance: NearToken,
}

impl Kat {
    pub fn new(balance: NearToken) -> Self {
        Self {
            context_hash: None,
            context_ref: None,
            context_version: 0,
            balance,
        }
    }
}

#[near(serializers = [json])]
#[derive(Debug, PartialEq)]
pub struct KatView {
    pub owner_id: AccountId,
    pub context_hash: Option<Base64VecU8>,
    pub context_ref: Option<String>,
    pub context_version: U64,
    pub balance: NearToken,
}

impl KatView {
    pub fn new(owner_id: AccountId, kat: &Kat) -> Self {
        Self {
            owner_id,
            context_hash: kat.context_hash.map(|h| h.to_vec().into()),
            context_ref: kat.context_ref.clone(),
            context_version: kat.context_version.into(),
            balance: kat.balance,
        }
    }
}

#[near(serializers = [json])]
pub struct ConfigView {
    pub admin_id: AccountId,
    pub keeper_id: AccountId,
    pub treasury_id: AccountId,
    pub mint_price: NearToken,
    pub treasury_accrued: NearToken,
}
