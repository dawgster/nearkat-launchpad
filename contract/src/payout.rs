//! NEP-199 royalties: marketplaces ask how a sale's proceeds split, and pay
//! the creator's royalty to the treasury.

use std::collections::HashMap;

use near_contract_standards::non_fungible_token::core::NonFungibleTokenCore;
use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId};

use crate::{Contract, ContractExt};

#[near(serializers = [json])]
#[derive(Debug, PartialEq)]
pub struct Payout {
    pub payout: HashMap<AccountId, U128>,
}

impl Contract {
    fn payout_for(
        &self,
        owner_id: AccountId,
        balance: U128,
        max_len_payout: Option<u32>,
    ) -> Payout {
        let royalty = balance.0 * u128::from(self.terms.royalty_bps) / 10_000;
        let mut payout = HashMap::new();
        if royalty > 0 {
            payout.insert(self.treasury_id.clone(), U128(royalty));
        }
        // The owner may be the treasury itself; the amounts then add up.
        let entry = payout.entry(owner_id).or_insert(U128(0));
        entry.0 += balance.0 - royalty;
        if let Some(max) = max_len_payout {
            require!(
                payout.len() <= max as usize,
                format!("The payout has {} entries, more than {max}", payout.len())
            );
        }
        Payout { payout }
    }
}

#[near]
impl Contract {
    /// How a sale of `balance` yoctoNEAR splits between the creator's royalty
    /// and the current owner.
    pub fn nft_payout(
        &self,
        token_id: TokenId,
        balance: U128,
        max_len_payout: Option<u32>,
    ) -> Payout {
        let owner_id = self
            .tokens
            .owner_by_id
            .get(&token_id)
            .unwrap_or_else(|| env::panic_str("Token not found"));
        self.payout_for(owner_id, balance, max_len_payout)
    }

    /// Transfers the token, as `nft_transfer` does, and returns how the sale
    /// splits, computed for the owner before the transfer.
    #[payable]
    pub fn nft_transfer_payout(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        balance: U128,
        max_len_payout: Option<u32>,
    ) -> Payout {
        let payout = self.nft_payout(token_id.clone(), balance, max_len_payout);
        self.nft_transfer(receiver_id, token_id, approval_id, memo);
        payout
    }
}
