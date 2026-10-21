use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, Gas, NearToken, Promise, PromiseError,
};

use crate::{Contract, ContractExt};

const GAS_FOR_WITHDRAW_CALLBACK: Gas = Gas::from_tgas(5);

#[near]
impl Contract {
    #[payable]
    pub fn set_keeper(&mut self, keeper_id: AccountId) {
        self.assert_admin();
        self.keeper_id = keeper_id;
    }

    #[payable]
    pub fn set_mint_price(&mut self, mint_price: NearToken) {
        self.assert_admin();
        self.mint_price = mint_price;
    }

    #[payable]
    pub fn set_treasury(&mut self, treasury_id: AccountId) {
        self.assert_admin();
        self.treasury_id = treasury_id;
    }

    /// Sends everything accrued from mints to the treasury account.
    /// If the transfer fails, the callback puts the amount back.
    #[payable]
    pub fn withdraw_treasury(&mut self) -> Promise {
        self.assert_admin();
        let amount = self.treasury_accrued;
        require!(!amount.is_zero(), "Nothing to withdraw");
        self.treasury_accrued = NearToken::from_yoctonear(0);
        Promise::new(self.treasury_id.clone())
            .transfer(amount)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_WITHDRAW_CALLBACK)
                    .on_treasury_withdrawn(amount),
            )
    }

    /// Sends everything debited for inference to the keeper, which pays the
    /// inference provider. Keeper only, and always to the keeper's own account.
    pub fn withdraw_inference(&mut self) -> Promise {
        require!(
            env::predecessor_account_id() == self.keeper_id,
            "Only the keeper can call this method"
        );
        let amount = self.inference_accrued;
        require!(!amount.is_zero(), "Nothing to withdraw");
        self.inference_accrued = NearToken::from_yoctonear(0);
        Promise::new(self.keeper_id.clone()).transfer(amount).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_FOR_WITHDRAW_CALLBACK)
                .on_inference_withdrawn(amount),
        )
    }

    #[private]
    pub fn on_inference_withdrawn(
        &mut self,
        amount: NearToken,
        #[callback_result] result: Result<(), PromiseError>,
    ) {
        if result.is_err() {
            self.inference_accrued = self
                .inference_accrued
                .checked_add(amount)
                .unwrap_or_else(|| env::panic_str("Inference overflow"));
        }
    }

    #[private]
    pub fn on_treasury_withdrawn(
        &mut self,
        amount: NearToken,
        #[callback_result] result: Result<(), PromiseError>,
    ) {
        if result.is_err() {
            self.treasury_accrued = self
                .treasury_accrued
                .checked_add(amount)
                .unwrap_or_else(|| env::panic_str("Treasury overflow"));
        }
    }
}

impl Contract {
    fn assert_admin(&self) {
        assert_one_yocto();
        require!(
            env::predecessor_account_id() == self.admin_id,
            "Only the admin can call this method"
        );
    }
}
