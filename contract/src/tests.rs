use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, NearToken};

use crate::Contract;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(predecessor: &str, deposit: NearToken) {
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id(acc(predecessor))
        .attached_deposit(deposit)
        .build());
}

const PRICE: NearToken = NearToken::from_near(1);

fn deploy() -> Contract {
    ctx("admin.near", NearToken::from_yoctonear(0));
    Contract::new(
        acc("admin.near"),
        acc("keeper.near"),
        acc("treasury.near"),
        PRICE,
        "https://art.example/".to_string(),
    )
}

#[test]
fn new_stores_config() {
    let c = deploy();
    let cfg = c.get_config();
    assert_eq!(cfg.admin_id, acc("admin.near"));
    assert_eq!(cfg.keeper_id, acc("keeper.near"));
    assert_eq!(cfg.treasury_id, acc("treasury.near"));
    assert_eq!(cfg.mint_price, PRICE);
    assert!(cfg.treasury_accrued.is_zero());
}

#[test]
fn mint_assigns_token_to_caller_and_credits_excess() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(3));
    let token = c.mint();
    assert_eq!(token.token_id, "1");
    assert_eq!(token.owner_id, acc("alice.near"));
    let kat = c.get_kat("1".to_string()).unwrap();
    assert_eq!(kat.owner_id, acc("alice.near"));
    assert_eq!(kat.context_version.0, 0);
    assert!(kat.context_hash.is_none());
    // 3 NEAR minus 1 NEAR price minus a small storage cost
    assert!(kat.balance < NearToken::from_near(2));
    assert!(kat.balance > NearToken::from_millinear(1900));
    assert_eq!(c.get_config().treasury_accrued, PRICE);
}

#[test]
#[should_panic(expected = "Deposit too low")]
fn mint_rejects_deposit_that_only_covers_price() {
    let mut c = deploy();
    ctx("alice.near", PRICE);
    c.mint();
}

#[test]
fn get_kat_returns_none_for_unknown_id() {
    let c = deploy();
    assert!(c.get_kat("99".to_string()).is_none());
}

#[test]
fn fund_adds_to_balance_from_any_account() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    let before = c.get_kat("1".to_string()).unwrap().balance;
    ctx("bob.near", NearToken::from_near(5));
    c.fund("1".to_string());
    let after = c.get_kat("1".to_string()).unwrap().balance;
    assert_eq!(after, before.saturating_add(NearToken::from_near(5)));
}

#[test]
#[should_panic(expected = "Kat not found")]
fn fund_rejects_unknown_kat() {
    let mut c = deploy();
    ctx("bob.near", NearToken::from_near(1));
    c.fund("99".to_string());
}

#[test]
#[should_panic(expected = "Attach NEAR")]
fn fund_rejects_zero_deposit() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    ctx("bob.near", NearToken::from_yoctonear(0));
    c.fund("1".to_string());
}
