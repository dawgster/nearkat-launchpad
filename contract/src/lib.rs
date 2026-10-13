mod admin;
mod kat;
mod keeper;
mod nft;

use near_contract_standards::non_fungible_token::events::NftMint;
use near_contract_standards::non_fungible_token::metadata::TokenMetadata;
use near_contract_standards::non_fungible_token::{NonFungibleToken, Token, TokenId};
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault};

pub use kat::{ConfigView, Kat, KatView};

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
    /// Sequence number of the last applied `debit_batch`.
    debit_seq: u64,
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
            debit_seq: 0,
        }
    }

    /// Mints the next kat to the caller. The deposit must cover the mint price
    /// plus storage (measured usage and a fixed reserve); anything above that
    /// becomes the kat's inference balance.
    #[payable]
    pub fn mint(&mut self) -> Token {
        let deposit = env::attached_deposit();
        let storage_before = env::storage_usage();
        let token_id = self.next_token_id.to_string();
        self.next_token_id += 1;

        let metadata = TokenMetadata {
            title: Some(format!("Nearkat #{token_id}")),
            media: Some(format!("{token_id}.png")),
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
        Some(KatView::new(owner_id, kat))
    }

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            admin_id: self.admin_id.clone(),
            keeper_id: self.keeper_id.clone(),
            treasury_id: self.treasury_id.clone(),
            mint_price: self.mint_price,
            treasury_accrued: self.treasury_accrued,
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
mod tests;
