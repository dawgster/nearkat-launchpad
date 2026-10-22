//! Moving a live collection to a newer version of the collection code.
//!
//! A collection from the launchpad may only move to code the launchpad has
//! approved, so a creator can't swap in code that drops the promises buyers
//! relied on (the public prompt, the TEE requirement, the terms). A
//! collection its operator deployed directly can move to any published code.
//! Either way the new code runs `migrate` in the same transaction, and the
//! launchpad records which version the collection now runs.

use near_sdk::json_types::Base58CryptoHash;
use near_sdk::{env, near, require, Gas, NearToken, Promise, PromiseError};

use crate::{Contract, ContractExt};

const GAS_FOR_CHECK: Gas = Gas::from_tgas(5);
const GAS_FOR_APPROVED: Gas = Gas::from_tgas(60);
const GAS_FOR_MIGRATE: Gas = Gas::from_tgas(20);
const GAS_FOR_RECORD: Gas = Gas::from_tgas(10);

#[near]
impl Contract {
    /// Moves this collection to the published code `code_hash`. Admin only.
    #[payable]
    pub fn upgrade(&mut self, code_hash: Base58CryptoHash) -> Promise {
        self.assert_admin();
        match &self.factory_id {
            Some(factory) => Promise::new(factory.clone())
                .function_call(
                    "is_code_approved",
                    near_sdk::serde_json::json!({ "code_hash": code_hash })
                        .to_string()
                        .into_bytes(),
                    NearToken::from_yoctonear(0),
                    GAS_FOR_CHECK,
                )
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(GAS_FOR_APPROVED)
                        .on_upgrade_checked(code_hash),
                ),
            None => self.switch_code(code_hash),
        }
    }

    #[private]
    pub fn on_upgrade_checked(
        &mut self,
        code_hash: Base58CryptoHash,
        #[callback_result] approved: Result<bool, PromiseError>,
    ) -> Promise {
        require!(
            matches!(approved, Ok(true)),
            "The launchpad has not approved that version"
        );
        let switch = self.switch_code(code_hash);
        let factory = self
            .factory_id
            .clone()
            .unwrap_or_else(|| env::panic_str("No launchpad"));
        switch.then(
            Promise::new(factory).function_call(
                "record_upgrade",
                near_sdk::serde_json::json!({ "code_hash": code_hash })
                    .to_string()
                    .into_bytes(),
                NearToken::from_yoctonear(0),
                GAS_FOR_RECORD,
            ),
        )
    }

    /// Re-reads the state after new code is in place. Each version that
    /// changes the state layout converts the previous layout here; this one
    /// reads its own.
    #[private]
    #[init(ignore_state)]
    pub fn migrate(code_hash: Base58CryptoHash) -> Self {
        let mut state: Self =
            env::state_read().unwrap_or_else(|| env::panic_str("No state to migrate"));
        state.code_hash = Some(code_hash.into());
        state
    }
}

impl Contract {
    /// Points this account at the published code and migrates, in one batch:
    /// if `migrate` fails, the switch is undone with it.
    fn switch_code(&mut self, code_hash: Base58CryptoHash) -> Promise {
        Promise::new(env::current_account_id())
            .use_global_contract(code_hash)
            .function_call(
                "migrate",
                near_sdk::serde_json::json!({ "code_hash": code_hash })
                    .to_string()
                    .into_bytes(),
                NearToken::from_yoctonear(0),
                GAS_FOR_MIGRATE,
            )
    }
}
