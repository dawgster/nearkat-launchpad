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
