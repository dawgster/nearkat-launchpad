use near_contract_standards::non_fungible_token::core::NonFungibleTokenCore;
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
const YOCTO: NearToken = NearToken::from_yoctonear(1);

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

fn hash(byte: u8) -> near_sdk::json_types::Base64VecU8 {
    vec![byte; 32].into()
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

#[test]
fn set_context_stores_hash_ref_and_version() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_context("1".to_string(), hash(7), "ref-1".to_string(), 1.into());
    let kat = c.get_kat("1".to_string()).unwrap();
    assert_eq!(kat.context_hash.unwrap().0, vec![7u8; 32]);
    assert_eq!(kat.context_ref.unwrap(), "ref-1");
    assert_eq!(kat.context_version.0, 1);
}

#[test]
#[should_panic(expected = "Only the keeper")]
fn set_context_rejects_owner() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    c.set_context("1".to_string(), hash(7), "ref-1".to_string(), 1.into());
}

#[test]
#[should_panic(expected = "Version must be 1")]
fn set_context_rejects_skipped_version() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_context("1".to_string(), hash(7), "ref-1".to_string(), 2.into());
}

#[test]
#[should_panic(expected = "Version must be 2")]
fn set_context_rejects_replayed_version() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_context("1".to_string(), hash(7), "ref-1".to_string(), 1.into());
    c.set_context("1".to_string(), hash(8), "ref-2".to_string(), 1.into());
}

#[test]
#[should_panic(expected = "context_hash must be 32 bytes")]
fn set_context_rejects_short_hash() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_context(
        "1".to_string(),
        vec![1u8; 31].into(),
        "ref-1".to_string(),
        1.into(),
    );
}

#[test]
#[should_panic(expected = "context_ref must be 1 to 256 bytes")]
fn set_context_rejects_oversized_ref() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_context("1".to_string(), hash(7), "x".repeat(257), 1.into());
}

#[test]
#[should_panic(expected = "Kat not found")]
fn set_context_rejects_unknown_kat() {
    let mut c = deploy();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_context("99".to_string(), hash(7), "ref-1".to_string(), 1.into());
}

#[test]
fn debit_batch_moves_balance_to_treasury() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(3));
    c.mint();
    let before = c.get_kat("1".to_string()).unwrap().balance;
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.debit_batch(vec![("1".to_string(), NearToken::from_millinear(5))]);
    let after = c.get_kat("1".to_string()).unwrap().balance;
    assert_eq!(after, before.saturating_sub(NearToken::from_millinear(5)));
    assert_eq!(
        c.get_config().treasury_accrued,
        PRICE.saturating_add(NearToken::from_millinear(5))
    );
}

#[test]
#[should_panic(expected = "Insufficient balance for kat 1")]
fn debit_batch_rejects_overdraw() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.debit_batch(vec![("1".to_string(), NearToken::from_near(50))]);
}

#[test]
#[should_panic(expected = "Only the keeper")]
fn debit_batch_rejects_admin() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    ctx("admin.near", NearToken::from_yoctonear(0));
    c.debit_batch(vec![("1".to_string(), NearToken::from_millinear(1))]);
}

#[test]
#[should_panic(expected = "Insufficient balance for kat 1")]
fn debit_batch_counts_repeated_kat_entries_together() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(3));
    c.mint();
    // Balance is just under 2 NEAR: each entry fits alone, both together do not.
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.debit_batch(vec![
        ("1".to_string(), NearToken::from_millinear(1500)),
        ("1".to_string(), NearToken::from_millinear(1500)),
    ]);
}

#[test]
fn transfer_keeps_context_and_balance_with_the_kat() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(3));
    c.mint();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_context("1".to_string(), hash(7), "ref-1".to_string(), 1.into());
    let before = c.get_kat("1".to_string()).unwrap();
    ctx("alice.near", YOCTO);
    c.nft_transfer(acc("bob.near"), "1".to_string(), None, None);
    let after = c.get_kat("1".to_string()).unwrap();
    assert_eq!(after.owner_id, acc("bob.near"));
    assert_eq!(after.balance, before.balance);
    assert_eq!(after.context_hash, before.context_hash);
    assert_eq!(after.context_version, before.context_version);
}
