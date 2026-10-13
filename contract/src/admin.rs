use near_sdk::{assert_one_yocto, env, near, require, AccountId, NearToken, Promise};

use crate::{Contract, ContractExt};

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

    /// Sends everything accrued from mints and debits to the treasury account.
    #[payable]
    pub fn withdraw_treasury(&mut self) -> Promise {
        self.assert_admin();
        let amount = self.treasury_accrued;
        require!(!amount.is_zero(), "Nothing to withdraw");
        self.treasury_accrued = NearToken::from_yoctonear(0);
        Promise::new(self.treasury_id.clone()).transfer(amount)
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
