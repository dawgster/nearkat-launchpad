use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::json_types::{Base64VecU8, U64};
use near_sdk::{env, near, require, NearToken};

use crate::{Contract, ContractExt};

const MAX_CONTEXT_REF_LEN: usize = 256;

#[near]
impl Contract {
    /// Records a new encrypted-context version for a kat. Keeper only.
    pub fn set_context(
        &mut self,
        token_id: TokenId,
        context_hash: Base64VecU8,
        context_ref: String,
        version: U64,
        key_epoch: u32,
    ) {
        self.assert_keeper();
        require!(
            key_epoch == self.key_epoch,
            format!("Contexts are saved under key epoch {}", self.key_epoch)
        );
        let hash: [u8; 32] = context_hash
            .0
            .try_into()
            .unwrap_or_else(|_| env::panic_str("context_hash must be 32 bytes"));
        require!(
            !context_ref.is_empty() && context_ref.len() <= MAX_CONTEXT_REF_LEN,
            "context_ref must be 1 to 256 bytes"
        );
        let kat = self.kat_mut(&token_id);
        require!(
            version.0 == kat.context_version + 1,
            format!("Version must be {}", kat.context_version + 1)
        );
        kat.context_hash = Some(hash);
        kat.context_ref = Some(context_ref);
        kat.context_version = version.0;
        kat.key_epoch = key_epoch;
    }

    /// Moves each amount from a kat's balance: the creator's share to the
    /// treasury, the rest to the inference account, which the keeper
    /// withdraws to pay for inference. Keeper only.
    /// Any kat with insufficient balance fails the whole batch.
    ///
    /// `seq` must be one more than the last applied batch, so a batch that is
    /// re-sent after an ambiguous failure can never be applied twice.
    pub fn debit_batch(&mut self, seq: U64, items: Vec<(TokenId, NearToken)>) {
        self.assert_keeper();
        require!(
            seq.0 == self.debit_seq + 1,
            format!(
                "Batch {} is not next; last applied is {}",
                seq.0, self.debit_seq
            )
        );
        self.debit_seq = seq.0;
        for (token_id, amount) in items {
            let kat = self.kat_mut(&token_id);
            kat.balance = kat.balance.checked_sub(amount).unwrap_or_else(|| {
                env::panic_str(&format!("Insufficient balance for kat {token_id}"))
            });
            // The creator's share of each charge goes to the treasury; the rest
            // to the keeper, which pays for inference.
            let share = NearToken::from_yoctonear(
                amount.as_yoctonear() * u128::from(self.terms.creator_share_bps) / 10_000,
            );
            self.treasury_accrued = self
                .treasury_accrued
                .checked_add(share)
                .unwrap_or_else(|| env::panic_str("Treasury overflow"));
            self.inference_accrued = self
                .inference_accrued
                .checked_add(amount.saturating_sub(share))
                .unwrap_or_else(|| env::panic_str("Inference overflow"));
        }
    }
}

impl Contract {
    pub(crate) fn assert_keeper(&self) {
        require!(
            env::predecessor_account_id() == self.keeper_id,
            "Only the keeper can call this method"
        );
        self.assert_attested_signer();
    }
}
