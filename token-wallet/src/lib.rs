//! A token's own wallet.
//!
//! Each token of a collection with wallets has its own account,
//! `<token_id>.<collection>`, created by the collection and running this
//! code, published once and referenced by hash. It holds NEAR, and anyone can
//! send to it. It has no keys and no state, and one method: `transfer`, which
//! only the collection that created it may call. So the collection's rules
//! (see `contract/src/wallet.rs`) are the wallet's rules: its owner can send
//! anything, its mind only within its owner's allowance, and nothing anyone
//! signed before a sale can move its funds after.

use near_sdk::{env, near, require, AccountId, NearToken, Promise};

// Default: it needs no initialisation, and a read-only method never writes state.
#[derive(Default)]
#[near(contract_state)]
pub struct TokenWallet {}

/// The account this wallet's account was created under: its collection.
fn collection() -> AccountId {
    let id = env::current_account_id();
    let (_, parent) = id
        .as_str()
        .split_once('.')
        .unwrap_or_else(|| env::panic_str("A wallet lives under its collection's account"));
    parent
        .parse()
        .unwrap_or_else(|_| env::panic_str("A wallet lives under its collection's account"))
}

#[near]
impl TokenWallet {
    /// Sends `amount` to `receiver_id`. Only the collection can ask; it has
    /// already checked who may send what. Reads and writes no state.
    pub fn transfer(&self, receiver_id: AccountId, amount: NearToken) -> Promise {
        require!(
            env::predecessor_account_id() == collection(),
            "Only this wallet's collection can send from it"
        );
        require!(!amount.is_zero(), "amount must be more than zero");
        Promise::new(receiver_id).transfer(amount)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn as_caller(predecessor: &str) {
        testing_env!(VMContextBuilder::new()
            .current_account_id("7.lantern.launch.near".parse().unwrap())
            .predecessor_account_id(predecessor.parse().unwrap())
            .account_balance(NearToken::from_near(5))
            .build());
    }

    #[test]
    fn its_collection_can_send_from_it() {
        as_caller("lantern.launch.near");
        let _ = TokenWallet {}.transfer("bob.near".parse().unwrap(), NearToken::from_near(1));
    }

    #[test]
    #[should_panic(expected = "Only this wallet's collection can send from it")]
    fn nobody_else_can() {
        as_caller("alice.near");
        let _ = TokenWallet {}.transfer("alice.near".parse().unwrap(), NearToken::from_near(1));
    }

    #[test]
    #[should_panic(expected = "Only this wallet's collection can send from it")]
    fn not_even_the_launchpad_above_its_collection() {
        as_caller("launch.near");
        let _ = TokenWallet {}.transfer("launch.near".parse().unwrap(), NearToken::from_near(1));
    }
}
