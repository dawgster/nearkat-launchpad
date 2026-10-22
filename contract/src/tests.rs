use near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval;
use near_contract_standards::non_fungible_token::core::NonFungibleTokenCore;
use near_contract_standards::non_fungible_token::metadata::NonFungibleTokenMetadataProvider;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{env, testing_env, AccountId, NearToken};

use crate::{Collection, Contract};

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(predecessor: &str, deposit: NearToken) {
    // Carry the storage counter over, so usage can be compared across calls.
    let storage_usage = env::storage_usage();
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id(acc(predecessor))
        .attached_deposit(deposit)
        .storage_usage(storage_usage)
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
        collection("Nearkat", "KAT", "https://art.example/"),
        None,
    )
}

fn deploy_as(name: &str, symbol: &str, base_uri: &str) -> Contract {
    ctx("admin.near", NearToken::from_yoctonear(0));
    Contract::new(
        acc("admin.near"),
        acc("keeper.near"),
        acc("treasury.near"),
        PRICE,
        collection(name, symbol, base_uri),
        None,
    )
}

fn collection(name: &str, symbol: &str, base_uri: &str) -> Collection {
    Collection {
        name: name.to_string(),
        symbol: symbol.to_string(),
        base_uri: base_uri.to_string(),
        prompt: String::new(),
        starter: String::new(),
        max_supply: None,
        tee: None,
        media_extension: String::new(),
        terms: crate::Terms::default(),
        sealed_prompt: None,
    }
}

fn deploy_with(collection: Collection) -> Contract {
    ctx("admin.near", NearToken::from_yoctonear(0));
    Contract::new(
        acc("admin.near"),
        acc("keeper.near"),
        acc("treasury.near"),
        PRICE,
        collection,
        None,
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
fn debit_batch_moves_balance_to_the_inference_account() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(3));
    c.mint();
    let before = c.get_kat("1".to_string()).unwrap().balance;
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.debit_batch(
        1.into(),
        vec![("1".to_string(), NearToken::from_millinear(5))],
    );
    let after = c.get_kat("1".to_string()).unwrap().balance;
    assert_eq!(after, before.saturating_sub(NearToken::from_millinear(5)));
    let cfg = c.get_config();
    assert_eq!(cfg.inference_accrued, NearToken::from_millinear(5));
    // Mint revenue and inference charges are owed to different accounts.
    assert_eq!(cfg.treasury_accrued, PRICE);
}

#[test]
#[should_panic(expected = "Insufficient balance for kat 1")]
fn debit_batch_rejects_overdraw() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.debit_batch(1.into(), vec![("1".to_string(), NearToken::from_near(50))]);
}

#[test]
#[should_panic(expected = "Only the keeper")]
fn debit_batch_rejects_admin() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    ctx("admin.near", NearToken::from_yoctonear(0));
    c.debit_batch(
        1.into(),
        vec![("1".to_string(), NearToken::from_millinear(1))],
    );
}

#[test]
#[should_panic(expected = "Insufficient balance for kat 1")]
fn debit_batch_counts_repeated_kat_entries_together() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(3));
    c.mint();
    // Balance is just under 2 NEAR: each entry fits alone, both together do not.
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.debit_batch(
        1.into(),
        vec![
            ("1".to_string(), NearToken::from_millinear(1500)),
            ("1".to_string(), NearToken::from_millinear(1500)),
        ],
    );
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

#[test]
fn admin_can_change_keeper_and_price() {
    let mut c = deploy();
    ctx("admin.near", YOCTO);
    c.set_keeper(acc("keeper2.near"));
    c.set_mint_price(NearToken::from_near(2));
    let cfg = c.get_config();
    assert_eq!(cfg.keeper_id, acc("keeper2.near"));
    assert_eq!(cfg.mint_price, NearToken::from_near(2));
}

#[test]
#[should_panic(expected = "Only the admin")]
fn set_keeper_rejects_non_admin() {
    let mut c = deploy();
    ctx("alice.near", YOCTO);
    c.set_keeper(acc("alice.near"));
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn set_keeper_requires_one_yocto() {
    let mut c = deploy();
    ctx("admin.near", NearToken::from_yoctonear(0));
    c.set_keeper(acc("keeper2.near"));
}

#[test]
fn withdraw_treasury_zeroes_accrued() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    ctx("admin.near", YOCTO);
    let _ = c.withdraw_treasury();
    assert!(c.get_config().treasury_accrued.is_zero());
}

#[test]
#[should_panic(expected = "Nothing to withdraw")]
fn withdraw_treasury_rejects_empty() {
    let mut c = deploy();
    ctx("admin.near", YOCTO);
    let _ = c.withdraw_treasury();
}

#[test]
#[should_panic(expected = "Deposit too low")]
fn mint_uses_the_updated_price() {
    let mut c = deploy();
    ctx("admin.near", YOCTO);
    c.set_mint_price(NearToken::from_near(5));
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
}

#[test]
#[should_panic(expected = "Only the keeper")]
fn replaced_keeper_loses_access() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    ctx("admin.near", YOCTO);
    c.set_keeper(acc("keeper2.near"));
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_context("1".to_string(), hash(7), "ref-1".to_string(), 1.into());
}

#[test]
fn mint_emits_nft_mint_event() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    let logs = get_logs();
    assert_eq!(logs.len(), 1);
    assert!(logs[0].starts_with("EVENT_JSON:"));
    assert!(logs[0].contains(r#""event":"nft_mint""#));
    assert!(logs[0].contains(r#""owner_id":"alice.near""#));
    assert!(logs[0].contains(r#""token_ids":["1"]"#));
}

#[test]
fn mint_charges_price_measured_storage_and_reserve() {
    let mut c = deploy();
    let deposit = NearToken::from_near(3);
    ctx("alice.near", deposit);
    let before = env::storage_usage();
    c.mint();
    let written = env::storage_usage() - before;
    let storage_cost = env::storage_byte_cost()
        .saturating_mul((written + crate::KAT_STORAGE_RESERVE_BYTES).into());
    assert_eq!(
        c.get_kat("1".to_string()).unwrap().balance,
        deposit.saturating_sub(PRICE).saturating_sub(storage_cost)
    );
}

#[test]
fn storage_growth_after_mint_fits_in_the_reserve() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(3));
    c.mint();
    let after_mint = env::storage_usage();

    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_context("1".to_string(), hash(7), "x".repeat(256), 1.into());
    c.kats.flush();
    ctx("alice.near", NearToken::from_millinear(10));
    let _ = c.nft_approve("1".to_string(), acc("market.near"), None);
    ctx("alice.near", YOCTO);
    c.nft_transfer(acc(&"b".repeat(64)), "1".to_string(), None, None);

    // Growth beyond what callers paid for; approval deposits cover only part of it.
    let grown = env::storage_usage() - after_mint;
    assert!(
        grown <= crate::KAT_STORAGE_RESERVE_BYTES,
        "{grown} bytes of growth exceed the reserve"
    );
}

#[test]
fn mint_numbers_tokens_sequentially() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    assert_eq!(c.mint().token_id, "1");
    ctx("bob.near", NearToken::from_near(2));
    assert_eq!(c.mint().token_id, "2");
}

#[test]
#[should_panic(expected = "context_ref must be 1 to 256 bytes")]
fn set_context_rejects_empty_ref() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_context("1".to_string(), hash(7), String::new(), 1.into());
}

#[test]
#[should_panic(expected = "Kat not found")]
fn debit_batch_rejects_unknown_kat() {
    let mut c = deploy();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.debit_batch(
        1.into(),
        vec![("99".to_string(), NearToken::from_millinear(1))],
    );
}

#[test]
fn replacement_keeper_can_set_context() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    ctx("admin.near", YOCTO);
    c.set_keeper(acc("keeper2.near"));
    ctx("keeper2.near", NearToken::from_yoctonear(0));
    c.set_context("1".to_string(), hash(7), "ref-1".to_string(), 1.into());
    assert_eq!(c.get_kat("1".to_string()).unwrap().context_version.0, 1);
}

#[test]
#[should_panic(expected = "Only the admin")]
fn withdraw_treasury_rejects_non_admin() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    ctx("alice.near", YOCTO);
    let _ = c.withdraw_treasury();
}

#[test]
#[should_panic(expected = "Only the admin")]
fn set_mint_price_rejects_non_admin() {
    let mut c = deploy();
    ctx("keeper.near", YOCTO);
    c.set_mint_price(NearToken::from_yoctonear(0));
}

#[test]
fn admin_can_change_treasury() {
    let mut c = deploy();
    ctx("admin.near", YOCTO);
    c.set_treasury(acc("treasury2.near"));
    assert_eq!(c.get_config().treasury_id, acc("treasury2.near"));
}

#[test]
#[should_panic(expected = "Only the admin")]
fn set_treasury_rejects_non_admin() {
    let mut c = deploy();
    ctx("alice.near", YOCTO);
    c.set_treasury(acc("alice.near"));
}

#[test]
fn debit_batch_advances_the_sequence_number() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(3));
    c.mint();
    assert_eq!(c.get_config().debit_seq.0, 0);
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.debit_batch(
        1.into(),
        vec![("1".to_string(), NearToken::from_millinear(5))],
    );
    c.debit_batch(
        2.into(),
        vec![("1".to_string(), NearToken::from_millinear(5))],
    );
    assert_eq!(c.get_config().debit_seq.0, 2);
}

#[test]
#[should_panic(expected = "Batch 1 is not next; last applied is 1")]
fn debit_batch_rejects_a_replayed_batch() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(3));
    c.mint();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.debit_batch(
        1.into(),
        vec![("1".to_string(), NearToken::from_millinear(5))],
    );
    c.debit_batch(
        1.into(),
        vec![("1".to_string(), NearToken::from_millinear(5))],
    );
}

#[test]
#[should_panic(expected = "Batch 2 is not next; last applied is 0")]
fn debit_batch_rejects_a_skipped_sequence_number() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(3));
    c.mint();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.debit_batch(
        2.into(),
        vec![("1".to_string(), NearToken::from_millinear(5))],
    );
}

#[test]
fn collection_and_tokens_carry_the_configured_name() {
    let mut c = deploy_as("Pocket Pals", "PAL", "https://art.example/");
    let meta = c.nft_metadata();
    assert_eq!(meta.name, "Pocket Pals");
    assert_eq!(meta.symbol, "PAL");
    assert_eq!(meta.base_uri.as_deref(), Some("https://art.example/"));

    ctx("alice.near", NearToken::from_near(2));
    let token = c.mint();
    let metadata = token.metadata.unwrap();
    assert_eq!(metadata.title.as_deref(), Some("Pocket Pals #1"));
    assert_eq!(metadata.media.as_deref(), Some("1.png"));
}

#[test]
fn a_collection_without_artwork_has_no_media_links() {
    let mut c = deploy_as("Pocket Pals", "PAL", "");
    assert!(c.nft_metadata().base_uri.is_none());
    ctx("alice.near", NearToken::from_near(2));
    assert!(c.mint().metadata.unwrap().media.is_none());
}

#[test]
#[should_panic(expected = "name and symbol must not be empty")]
fn new_rejects_an_empty_name() {
    deploy_as("", "PAL", "");
}

#[test]
#[should_panic(expected = "name and symbol must not be empty")]
fn new_rejects_an_empty_symbol() {
    deploy_as("Pocket Pals", " ", "");
}

#[test]
fn an_unconfigured_collection_is_the_original_nearkat() {
    let c = deploy();
    let view = c.get_collection();
    assert_eq!(view.prompt, crate::DEFAULT_PROMPT);
    assert_eq!(view.starter, crate::DEFAULT_STARTER);
    assert_eq!(view.max_supply, None);
    assert_eq!(view.tee, None);
    assert_eq!(view.minted.0, 0);
}

#[test]
fn a_collection_publishes_its_own_prompt() {
    let c = deploy_with(Collection {
        prompt: "You are {name} #{token_id}, a patient Latin tutor.".to_string(),
        starter: "Your student has not told you anything yet.".to_string(),
        max_supply: Some(3.into()),
        ..collection("Magister", "LAT", "")
    });
    let view = c.get_collection();
    assert_eq!(view.name, "Magister");
    assert_eq!(
        view.prompt,
        "You are {name} #{token_id}, a patient Latin tutor."
    );
    assert_eq!(view.starter, "Your student has not told you anything yet.");
    assert_eq!(view.max_supply, Some(3.into()));
}

#[test]
fn a_collection_can_require_a_phala_app() {
    let tee = crate::TeeRequirement::Phala {
        app_id: "0a1b2c3d4e5f60718293a4b5c6d7e8f901234567".to_string(),
    };
    let c = deploy_with(Collection {
        tee: Some(tee.clone()),
        ..collection("Magister", "LAT", "")
    });
    assert_eq!(c.get_collection().tee, Some(tee));
}

#[test]
#[should_panic(expected = "app_id must be 1 to 64 lowercase hex characters")]
fn new_rejects_a_malformed_phala_app_id() {
    deploy_with(Collection {
        tee: Some(crate::TeeRequirement::Phala {
            app_id: "not-hex".to_string(),
        }),
        ..collection("Magister", "LAT", "")
    });
}

#[test]
#[should_panic(expected = "prompt must be at most 4000 characters")]
fn new_rejects_an_overlong_prompt() {
    deploy_with(Collection {
        prompt: "a".repeat(4001),
        ..collection("Magister", "LAT", "")
    });
}

#[test]
#[should_panic(expected = "starter must be at most 2000 characters")]
fn new_rejects_an_overlong_starter() {
    deploy_with(Collection {
        starter: "a".repeat(2001),
        ..collection("Magister", "LAT", "")
    });
}

#[test]
#[should_panic(expected = "max_supply must be at least 1")]
fn new_rejects_a_zero_supply() {
    deploy_with(Collection {
        max_supply: Some(0.into()),
        ..collection("Lantern", "LNT", "")
    });
}

#[test]
fn mint_counts_tokens_up_to_the_supply_cap() {
    let mut c = deploy_with(Collection {
        max_supply: Some(2.into()),
        ..collection("Lantern", "LNT", "")
    });
    for _ in 0..2 {
        ctx("alice.near", NearToken::from_near(2));
        c.mint();
    }
    assert_eq!(c.get_collection().minted.0, 2);
}

#[test]
#[should_panic(expected = "Sold out")]
fn mint_refuses_past_the_supply_cap() {
    let mut c = deploy_with(Collection {
        max_supply: Some(1.into()),
        ..collection("Lantern", "LNT", "")
    });
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    ctx("bob.near", NearToken::from_near(2));
    c.mint();
}

#[test]
fn withdraw_inference_zeroes_what_the_keeper_is_owed() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(3));
    c.mint();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.debit_batch(
        1.into(),
        vec![("1".to_string(), NearToken::from_millinear(5))],
    );
    let _ = c.withdraw_inference();
    assert!(c.get_config().inference_accrued.is_zero());
    assert_eq!(c.get_config().treasury_accrued, PRICE);
}

#[test]
#[should_panic(expected = "Only the keeper can call this method")]
fn withdraw_inference_rejects_the_admin() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(3));
    c.mint();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.debit_batch(
        1.into(),
        vec![("1".to_string(), NearToken::from_millinear(5))],
    );
    ctx("admin.near", YOCTO);
    let _ = c.withdraw_inference();
}

#[test]
#[should_panic(expected = "Nothing to withdraw")]
fn withdraw_inference_rejects_empty() {
    let mut c = deploy();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    let _ = c.withdraw_inference();
}

// Terms, royalties and images.

fn with_terms(terms: crate::Terms) -> Contract {
    deploy_with(Collection {
        terms,
        ..collection("Magister", "LAT", "")
    })
}

#[test]
fn debits_split_between_the_creator_and_the_keeper() {
    let mut c = with_terms(crate::Terms {
        creator_share_bps: 2_000,
        ..Default::default()
    });
    ctx("alice.near", NearToken::from_near(3));
    c.mint();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.debit_batch(
        1.into(),
        vec![("1".to_string(), NearToken::from_millinear(10))],
    );
    let cfg = c.get_config();
    // 20% of the charge to the treasury, on top of the mint price.
    assert_eq!(
        cfg.treasury_accrued,
        PRICE.saturating_add(NearToken::from_millinear(2))
    );
    assert_eq!(cfg.inference_accrued, NearToken::from_millinear(8));
}

#[test]
#[should_panic(expected = "royalty_bps must be at most 2500")]
fn new_rejects_an_excessive_royalty() {
    with_terms(crate::Terms {
        royalty_bps: 2_501,
        ..Default::default()
    });
}

#[test]
#[should_panic(expected = "creator_share_bps must be at most 5000")]
fn new_rejects_an_excessive_creator_share() {
    with_terms(crate::Terms {
        creator_share_bps: 5_001,
        ..Default::default()
    });
}

#[test]
fn a_collection_publishes_its_terms() {
    let terms = crate::Terms {
        royalty_bps: 500,
        creator_share_bps: 1_000,
        chat_price: Some(NearToken::from_millinear(5)),
        save_price: None,
    };
    let c = with_terms(terms.clone());
    assert_eq!(c.get_collection().terms, terms);
}

#[test]
fn payout_pays_the_royalty_to_the_treasury_and_the_rest_to_the_owner() {
    let mut c = with_terms(crate::Terms {
        royalty_bps: 1_000,
        ..Default::default()
    });
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    let payout = c.nft_payout("1".to_string(), 1_000.into(), Some(10)).payout;
    assert_eq!(payout.len(), 2);
    assert_eq!(payout[&acc("treasury.near")].0, 100);
    assert_eq!(payout[&acc("alice.near")].0, 900);
}

#[test]
fn payout_without_a_royalty_is_all_the_owners() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    let payout = c.nft_payout("1".to_string(), 1_000.into(), None).payout;
    assert_eq!(payout.len(), 1);
    assert_eq!(payout[&acc("alice.near")].0, 1_000);
}

#[test]
#[should_panic(expected = "more than 1")]
fn payout_respects_the_marketplaces_limit() {
    let mut c = with_terms(crate::Terms {
        royalty_bps: 1_000,
        ..Default::default()
    });
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    c.nft_payout("1".to_string(), 1_000.into(), Some(1));
}

#[test]
fn transfer_payout_moves_the_token_and_pays_the_previous_owner() {
    let mut c = with_terms(crate::Terms {
        royalty_bps: 1_000,
        ..Default::default()
    });
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    ctx("alice.near", YOCTO);
    let payout = c
        .nft_transfer_payout(
            acc("bob.near"),
            "1".to_string(),
            None,
            None,
            1_000.into(),
            None,
        )
        .payout;
    assert_eq!(payout[&acc("alice.near")].0, 900);
    assert_eq!(
        c.get_kat("1".to_string()).unwrap().owner_id,
        acc("bob.near")
    );
}

#[test]
fn token_images_use_the_collections_extension() {
    let mut c = deploy_with(Collection {
        media_extension: "svg".to_string(),
        ..collection("Lantern", "LNT", "https://keeper.example/art/lantern/")
    });
    ctx("alice.near", NearToken::from_near(2));
    let token = c.mint();
    assert_eq!(token.metadata.unwrap().media.unwrap(), "1.svg");
}

#[test]
#[should_panic(expected = "media_extension must be 1 to 8 letters or digits")]
fn new_rejects_a_strange_image_extension() {
    deploy_with(Collection {
        media_extension: "../x".to_string(),
        ..collection("Lantern", "LNT", "")
    });
}

// Sealed prompts.

fn sealed() -> crate::SealedPrompt {
    crate::SealedPrompt {
        ciphertext: "c2VhbGVk".to_string(),
        sealed_to: "ab".repeat(32),
    }
}

fn phala() -> Option<crate::TeeRequirement> {
    Some(crate::TeeRequirement::Phala {
        app_id: "0a1b2c".to_string(),
    })
}

#[test]
#[should_panic(expected = "A sealed prompt needs a TEE requirement")]
fn a_sealed_prompt_needs_a_tee_requirement() {
    deploy_with(Collection {
        sealed_prompt: Some(sealed()),
        ..collection("Secret", "SEC", "")
    });
}

#[test]
#[should_panic(expected = "sealed_to must be a 32-byte hex key")]
fn a_sealed_prompt_names_a_real_key() {
    deploy_with(Collection {
        tee: phala(),
        sealed_prompt: Some(crate::SealedPrompt {
            sealed_to: "nope".to_string(),
            ..sealed()
        }),
        ..collection("Secret", "SEC", "")
    });
}

#[test]
fn the_sealed_key_counts_as_attested_only_when_its_own_key_is() {
    let mut c = deploy_with(Collection {
        tee: phala(),
        sealed_prompt: Some(sealed()),
        ..collection("Secret", "SEC", "")
    });
    let key: near_sdk::PublicKey = "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp"
        .parse()
        .unwrap();
    c.record_attestation(key.clone(), "cd".repeat(32));
    assert!(!c.get_collection().sealed_key_attested);
    c.record_attestation(key, "ab".repeat(32));
    let view = c.get_collection();
    assert!(view.sealed_key_attested);
    assert_eq!(view.sealed_prompt, Some(sealed()));
}

// Where a collection came from.

#[test]
fn a_collection_initialised_by_a_launchpad_remembers_it() {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc("lantern.launch.near"))
        .predecessor_account_id(acc("launch.near"))
        .build());
    let hash: near_sdk::json_types::Base58CryptoHash = [3u8; 32].into();
    let c = Contract::new(
        acc("alice.near"),
        acc("keeper.near"),
        acc("alice.near"),
        PRICE,
        collection("Lantern", "LNT", ""),
        Some(hash),
    );
    let view = c.get_collection();
    assert_eq!(view.factory_id, Some(acc("launch.near")));
    assert_eq!(view.code_hash, Some(hash));
}

#[test]
fn a_collection_its_operator_deployed_has_no_launchpad() {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc("nearkat.near"))
        .predecessor_account_id(acc("nearkat.near"))
        .build());
    let c = Contract::new(
        acc("admin.near"),
        acc("keeper.near"),
        acc("admin.near"),
        PRICE,
        collection("Nearkat", "KAT", ""),
        None,
    );
    assert_eq!(c.get_collection().factory_id, None);
}

#[test]
#[should_panic(expected = "Only the admin can call this method")]
fn only_the_admin_upgrades() {
    let mut c = deploy();
    ctx("alice.near", YOCTO);
    let _ = c.upgrade([1u8; 32].into());
}
