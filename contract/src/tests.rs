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
        .signer_account_id(acc(predecessor))
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
        key_source: crate::tests::mpc_source(),
        wallet_code_hash: Some([5u8; 32].into()),
        history_import: false,
        kind: crate::CollectionKind::Character,
        class_counts: Vec::new(),
        initial_supply: None,
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
    c.set_context("1".to_string(), hash(7), "ref-1".to_string(), 1.into(), 1);
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
    c.set_context("1".to_string(), hash(7), "ref-1".to_string(), 1.into(), 1);
}

#[test]
#[should_panic(expected = "Version must be 1")]
fn set_context_rejects_skipped_version() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_context("1".to_string(), hash(7), "ref-1".to_string(), 2.into(), 1);
}

#[test]
#[should_panic(expected = "Version must be 2")]
fn set_context_rejects_replayed_version() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_context("1".to_string(), hash(7), "ref-1".to_string(), 1.into(), 1);
    c.set_context("1".to_string(), hash(8), "ref-2".to_string(), 1.into(), 1);
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
        1,
    );
}

#[test]
#[should_panic(expected = "context_ref must be 1 to 256 bytes")]
fn set_context_rejects_oversized_ref() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_context("1".to_string(), hash(7), "x".repeat(257), 1.into(), 1);
}

#[test]
#[should_panic(expected = "Kat not found")]
fn set_context_rejects_unknown_kat() {
    let mut c = deploy();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_context("99".to_string(), hash(7), "ref-1".to_string(), 1.into(), 1);
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
    c.set_context("1".to_string(), hash(7), "ref-1".to_string(), 1.into(), 1);
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
    c.set_context("1".to_string(), hash(7), "ref-1".to_string(), 1.into(), 1);
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
    c.set_context("1".to_string(), hash(7), "x".repeat(256), 1.into(), 1);
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
    c.set_context("1".to_string(), hash(7), String::new(), 1.into(), 1);
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
    c.set_context("1".to_string(), hash(7), "ref-1".to_string(), 1.into(), 2);
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
fn history_import_is_the_creators_choice_and_off_unless_chosen() {
    let off = deploy_with(collection("Nearkat", "KAT", ""));
    assert!(!off.get_collection().history_import);
    let on = deploy_with(Collection {
        history_import: true,
        ..collection("Taste", "TST", "")
    });
    assert!(on.get_collection().history_import);
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

// Context keys from NEAR's MPC network.

pub(crate) fn mpc_source() -> crate::KeySource {
    crate::KeySource {
        mpc_contract_id: "v1.signer".parse().unwrap(),
        domain_id: 2,
    }
}

const APP_KEY: &str = "bls12381g1:6qN4d5pLRWcd9RsE3YdQ1ShEJJcTyCa7hxVdT8RT6nUK";

#[test]
fn a_collection_publishes_where_its_keys_come_from_and_starts_at_epoch_1() {
    let c = deploy();
    let view = c.get_collection();
    assert_eq!(view.key_source, mpc_source());
    assert_eq!(view.key_epoch, 1);
}

#[test]
fn the_keeper_can_request_the_current_or_an_earlier_context_key() {
    let mut c = deploy();
    ctx("admin.near", YOCTO);
    c.rotate_context_key();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    let _ = c.request_context_key(APP_KEY.to_string(), None);
    let _ = c.request_context_key(APP_KEY.to_string(), Some(1));
    let _ = c.request_context_key(APP_KEY.to_string(), Some(2));
}

#[test]
#[should_panic(expected = "key_epoch must be at most 1")]
fn nobody_can_request_a_future_epoch() {
    let mut c = deploy();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    let _ = c.request_context_key(APP_KEY.to_string(), Some(2));
}

#[test]
#[should_panic(expected = "Only the keeper can call this method")]
fn nobody_else_can_request_the_context_key() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_yoctonear(0));
    let _ = c.request_context_key(APP_KEY.to_string(), None);
}

#[test]
#[should_panic(expected = "only accepts keeper calls signed by an attested key")]
fn a_tee_collection_releases_its_key_only_to_an_attested_keeper() {
    let mut c = deploy_with(Collection {
        tee: phala(),
        ..collection("Lantern", "LNT", "")
    });
    ctx("keeper.near", NearToken::from_yoctonear(0));
    let _ = c.request_context_key(APP_KEY.to_string(), None);
}

#[test]
fn changing_keeper_moves_to_a_new_key_epoch() {
    let mut c = deploy();
    ctx("admin.near", YOCTO);
    c.set_keeper(acc("keeper.near"));
    assert_eq!(c.get_collection().key_epoch, 1, "same keeper, same key");
    c.set_keeper(acc("other-keeper.near"));
    assert_eq!(c.get_collection().key_epoch, 2);
}

#[test]
#[should_panic(expected = "Only the keeper can call this method")]
fn a_replaced_keeper_can_no_longer_request_keys() {
    let mut c = deploy();
    ctx("admin.near", YOCTO);
    c.set_keeper(acc("other-keeper.near"));
    ctx("keeper.near", NearToken::from_yoctonear(0));
    let _ = c.request_context_key(APP_KEY.to_string(), Some(1));
}

#[test]
#[should_panic(expected = "Only the admin can call this method")]
fn only_the_admin_rotates_the_key() {
    let mut c = deploy();
    ctx("alice.near", YOCTO);
    c.rotate_context_key();
}

#[test]
fn contexts_record_the_epoch_they_were_saved_under() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(3));
    c.mint();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_context("1".to_string(), hash(7), "ref-1".to_string(), 1.into(), 1);
    assert_eq!(c.get_kat("1".to_string()).unwrap().key_epoch, 1);
    ctx("admin.near", YOCTO);
    c.rotate_context_key();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_context("1".to_string(), hash(8), "ref-2".to_string(), 2.into(), 2);
    assert_eq!(c.get_kat("1".to_string()).unwrap().key_epoch, 2);
}

#[test]
#[should_panic(expected = "Contexts are saved under key epoch 2")]
fn a_context_under_an_old_key_is_refused() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(3));
    c.mint();
    ctx("admin.near", YOCTO);
    c.rotate_context_key();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_context("1".to_string(), hash(7), "ref-1".to_string(), 1.into(), 1);
}

// Upgrading from the layout before key epochs.

fn previous_layout(
    c: Contract,
    key_source: Option<crate::KeySource>,
) -> crate::upgrade::ContractV1 {
    crate::upgrade::ContractV1 {
        tokens: c.tokens,
        kats: c.kats,
        admin_id: c.admin_id,
        keeper_id: c.keeper_id,
        treasury_id: c.treasury_id,
        mint_price: c.mint_price,
        base_uri: c.base_uri,
        name: c.name,
        symbol: c.symbol,
        prompt: c.prompt,
        starter: c.starter,
        max_supply: c.max_supply,
        tee: c.tee,
        next_token_id: c.next_token_id,
        treasury_accrued: c.treasury_accrued,
        inference_accrued: c.inference_accrued,
        debit_seq: c.debit_seq,
        attested_keys: c.attested_keys,
        media_extension: c.media_extension,
        terms: c.terms,
        sealed_prompt: c.sealed_prompt,
        sealed_key_attested: c.sealed_key_attested,
        factory_id: c.factory_id,
        code_hash: c.code_hash,
        key_source,
    }
}

/// A collection in the previous layout, with token 1 holding a context saved
/// before epochs. Tokens are written the same way in both layouts.
fn stored_in_previous_layout(key_source: Option<crate::KeySource>) {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(3));
    c.mint();
    // Save the token as the previous version did: no entry in `kat_epochs`.
    let kat = c.kat_mut(&"1".to_string());
    kat.context_hash = Some([7u8; 32]);
    kat.context_ref = Some("ref-old".to_string());
    kat.context_version = 1;
    c.kats.flush();
    near_sdk::env::state_write(&previous_layout(c, key_source));
}

#[test]
fn upgrading_from_before_key_epochs_keeps_tokens_and_starts_at_epoch_1() {
    stored_in_previous_layout(Some(mpc_source()));
    ctx("admin.near", NearToken::from_yoctonear(0));
    let c = Contract::migrate([9u8; 32].into());
    let view = c.get_collection();
    assert_eq!(view.key_epoch, 1);
    assert_eq!(view.key_source, mpc_source());
    let kat = c.get_kat("1".to_string()).unwrap();
    assert_eq!(kat.context_ref.as_deref(), Some("ref-old"));
    assert_eq!(kat.key_epoch, 0, "saved under the key from before epochs");
    assert_eq!(kat.owner_id, acc("alice.near"));
}

#[test]
fn a_migrated_collection_lets_its_keeper_read_the_old_key() {
    stored_in_previous_layout(Some(mpc_source()));
    ctx("keeper.near", NearToken::from_yoctonear(0));
    let mut c = Contract::migrate([9u8; 32].into());
    let _ = c.request_context_key(APP_KEY.to_string(), Some(0));
    assert_eq!(crate::ckd::context_key_path(0), "nearkat/contexts/v1");
    assert_eq!(crate::ckd::context_key_path(1), "nearkat/contexts/v1/1");
}

#[test]
#[should_panic(expected = "this version takes keys only from NEAR's MPC network")]
fn a_collection_without_a_key_source_cannot_take_this_version() {
    stored_in_previous_layout(None);
    ctx("admin.near", NearToken::from_yoctonear(0));
    let _ = Contract::migrate([9u8; 32].into());
}

#[test]
fn migrating_the_current_layout_keeps_it() {
    let mut c = deploy();
    ctx("admin.near", YOCTO);
    c.rotate_context_key();
    near_sdk::env::state_write(&c);
    let c = Contract::migrate([9u8; 32].into());
    assert_eq!(c.get_collection().key_epoch, 2);
}

// Token wallets.

const DAY: u64 = 86_400 * 1_000_000_000;
const MILLI: NearToken = NearToken::from_millinear(1);
const OPEN: NearToken = NearToken::from_millinear(20);

fn ctx_at(predecessor: &str, deposit: NearToken, timestamp: u64) {
    let storage_usage = env::storage_usage();
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc("lantern.near"))
        .predecessor_account_id(acc(predecessor))
        .signer_account_id(acc(predecessor))
        .attached_deposit(deposit)
        .storage_usage(storage_usage)
        .block_timestamp(timestamp)
        .build());
}

/// Token 1, owned by alice, with its wallet open.
fn with_open_wallet() -> Contract {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(3));
    c.mint();
    ctx_at("alice.near", OPEN, DAY);
    let _ = c.open_wallet("1".to_string());
    c
}

/// ...whose owner lets its mind send 10 milliNEAR a day, 4 at a time.
fn with_wallet() -> Contract {
    let mut c = with_open_wallet();
    ctx_at("alice.near", YOCTO, DAY);
    c.set_wallet_policy(
        "1".to_string(),
        MILLI.saturating_mul(10),
        MILLI.saturating_mul(4),
    );
    c
}

fn mind_sends(c: &mut Contract, amount: NearToken, at: u64) {
    ctx_at("keeper.near", NearToken::from_yoctonear(0), at);
    let _ = c.wallet_send(
        "1".to_string(),
        acc("bob.near"),
        amount,
        Some("a gift".to_string()),
    );
}

fn payment(amount: NearToken, by_mind: bool, at: u64) -> crate::wallet::Payment {
    crate::wallet::Payment {
        receiver_id: acc("bob.near"),
        amount,
        by_mind,
        memo: "a gift".to_string(),
        at: at.into(),
    }
}

#[test]
fn every_token_has_a_named_wallet_account_that_starts_closed() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(3));
    c.mint();
    ctx_at("alice.near", NearToken::from_yoctonear(0), DAY);
    let wallet = c.get_wallet("1".to_string()).unwrap();
    assert_eq!(wallet.account_id, acc("1.lantern.near"));
    assert!(!wallet.open);
    assert!(wallet.daily_allowance.is_zero());
    assert!(c.get_wallet("2".to_string()).is_none());
}

#[test]
fn a_collection_without_wallets_has_none() {
    let mut c = deploy_with(Collection {
        wallet_code_hash: None,
        history_import: false,
        ..collection("Lantern", "LNT", "")
    });
    ctx("alice.near", NearToken::from_near(3));
    c.mint();
    assert!(c.get_wallet("1".to_string()).is_none());
}

#[test]
fn opening_a_wallet_records_it() {
    let c = with_open_wallet();
    assert!(c.get_wallet("1".to_string()).unwrap().open);
}

#[test]
#[should_panic(expected = "Attach at least")]
fn opening_a_wallet_pays_for_it() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(3));
    c.mint();
    ctx_at("alice.near", MILLI, DAY);
    let _ = c.open_wallet("1".to_string());
}

#[test]
#[should_panic(expected = "already open")]
fn a_wallet_opens_once() {
    let mut c = with_open_wallet();
    ctx_at("bob.near", OPEN, DAY);
    let _ = c.open_wallet("1".to_string());
}

#[test]
fn a_wallet_that_couldnt_be_created_is_undone() {
    let mut c = with_open_wallet();
    ctx_at("lantern.near", NearToken::from_yoctonear(0), DAY);
    assert!(!c.on_wallet_opened(
        "1".to_string(),
        acc("alice.near"),
        OPEN,
        Err(near_sdk::PromiseError::Failed)
    ));
    assert!(!c.get_wallet("1".to_string()).unwrap().open);
}

#[test]
fn the_mind_sends_within_the_owners_allowance() {
    let mut c = with_wallet();
    mind_sends(&mut c, MILLI.saturating_mul(4), DAY + 1);
    mind_sends(&mut c, MILLI.saturating_mul(4), DAY + 2);
    assert_eq!(
        c.get_wallet("1".to_string()).unwrap().spent_today,
        MILLI.saturating_mul(8)
    );
}

#[test]
#[should_panic(expected = "more than the owner lets the mind send today")]
fn the_mind_cant_go_over_the_daily_allowance() {
    let mut c = with_wallet();
    for i in 0..3 {
        mind_sends(&mut c, MILLI.saturating_mul(4), DAY + i);
    }
}

#[test]
fn the_allowance_comes_back_the_next_day() {
    let mut c = with_wallet();
    mind_sends(&mut c, MILLI.saturating_mul(4), DAY + 1);
    mind_sends(&mut c, MILLI.saturating_mul(4), DAY + 2);
    mind_sends(&mut c, MILLI.saturating_mul(4), 2 * DAY + 1);
    ctx_at("alice.near", NearToken::from_yoctonear(0), 2 * DAY + 2);
    assert_eq!(
        c.get_wallet("1".to_string()).unwrap().spent_today,
        MILLI.saturating_mul(4)
    );
}

#[test]
#[should_panic(expected = "more than the owner lets the mind send at once")]
fn the_mind_cant_go_over_the_largest_payment() {
    let mut c = with_wallet();
    mind_sends(&mut c, MILLI.saturating_mul(5), DAY + 1);
}

#[test]
#[should_panic(expected = "The owner hasn't let this token's mind spend")]
fn the_mind_cant_spend_until_the_owner_allows_it() {
    let mut c = with_open_wallet();
    mind_sends(&mut c, MILLI, DAY + 1);
}

#[test]
#[should_panic(expected = "The owner hasn't let this token's mind spend")]
fn a_new_owner_starts_with_no_allowance_for_the_mind() {
    let mut c = with_wallet();
    ctx("alice.near", YOCTO);
    c.nft_transfer(acc("bob.near"), "1".to_string(), None, None);
    assert!(c
        .get_wallet("1".to_string())
        .unwrap()
        .daily_allowance
        .is_zero());
    mind_sends(&mut c, MILLI, DAY + 1);
}

#[test]
fn the_token_can_change_hands_right_after_its_owner_sends_from_its_wallet() {
    let mut c = with_wallet();
    ctx_at("alice.near", YOCTO, DAY + 1);
    let _ = c.wallet_send(
        "1".to_string(),
        acc("bob.near"),
        NearToken::from_near(1),
        None,
    );
    ctx("alice.near", YOCTO);
    c.nft_transfer(acc("bob.near"), "1".to_string(), None, None);
    // The wallet went with the token, open, to its new owner.
    assert!(c.get_wallet("1".to_string()).unwrap().open);
}

#[test]
#[should_panic(expected = "Only the keeper can call this method")]
fn nobody_else_can_spend_for_the_mind() {
    let mut c = with_wallet();
    ctx_at("mallory.near", NearToken::from_yoctonear(0), DAY + 1);
    let _ = c.wallet_send("1".to_string(), acc("mallory.near"), MILLI, None);
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn the_owner_sends_with_one_yocto() {
    let mut c = with_wallet();
    ctx_at("alice.near", NearToken::from_yoctonear(0), DAY + 1);
    let _ = c.wallet_send("1".to_string(), acc("bob.near"), MILLI, None);
}

#[test]
fn the_owners_payments_dont_use_the_minds_allowance() {
    let mut c = with_wallet();
    ctx_at("alice.near", YOCTO, DAY + 1);
    let _ = c.wallet_send(
        "1".to_string(),
        acc("bob.near"),
        NearToken::from_near(5),
        None,
    );
    assert!(c.get_wallet("1".to_string()).unwrap().spent_today.is_zero());
}

#[test]
#[should_panic(expected = "isn't open")]
fn a_closed_wallet_sends_nothing() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(3));
    c.mint();
    ctx_at("alice.near", YOCTO, DAY);
    let _ = c.wallet_send("1".to_string(), acc("bob.near"), MILLI, None);
}

#[test]
#[should_panic(expected = "Only the token's owner can set its wallet's rules")]
fn only_the_owner_sets_the_rules() {
    let mut c = with_wallet();
    ctx_at("mallory.near", YOCTO, DAY);
    c.set_wallet_policy("1".to_string(), MILLI, MILLI);
}

#[test]
#[should_panic(expected = "Attach a deposit")]
fn a_limited_access_key_cant_change_the_rules() {
    let mut c = with_wallet();
    // Function-call access keys can't attach a deposit.
    ctx_at("alice.near", NearToken::from_yoctonear(0), DAY);
    c.set_wallet_policy(
        "1".to_string(),
        NearToken::from_near(100),
        NearToken::from_near(100),
    );
}

#[test]
fn saving_the_rules_again_keeps_what_was_spent_today() {
    let mut c = with_wallet();
    mind_sends(&mut c, MILLI.saturating_mul(4), DAY + 1);
    ctx_at("alice.near", YOCTO, DAY + 2);
    c.set_wallet_policy(
        "1".to_string(),
        MILLI.saturating_mul(10),
        MILLI.saturating_mul(4),
    );
    assert_eq!(
        c.get_wallet("1".to_string()).unwrap().spent_today,
        MILLI.saturating_mul(4)
    );
}

#[test]
fn a_payment_that_went_through_is_recorded() {
    let mut c = with_wallet();
    ctx_at("lantern.near", NearToken::from_yoctonear(0), DAY);
    let sent = payment(MILLI, true, DAY);
    assert!(c.on_wallet_sent("1".to_string(), acc("alice.near"), 1, sent.clone(), Ok(())));
    let wallet = c.get_wallet("1".to_string()).unwrap();
    assert_eq!(wallet.payments, 1);
    assert_eq!(wallet.last_payment, Some(sent));
}

#[test]
fn a_payment_that_failed_gives_the_mind_its_allowance_back() {
    let mut c = with_wallet();
    mind_sends(&mut c, MILLI.saturating_mul(4), DAY + 1);
    ctx_at("lantern.near", NearToken::from_yoctonear(0), DAY + 2);
    assert!(!c.on_wallet_sent(
        "1".to_string(),
        acc("alice.near"),
        1,
        payment(MILLI.saturating_mul(4), true, DAY + 1),
        Err(near_sdk::PromiseError::Failed),
    ));
    let wallet = c.get_wallet("1".to_string()).unwrap();
    assert!(wallet.spent_today.is_zero());
    assert_eq!(wallet.payments, 0);
}

#[test]
fn a_failed_payment_never_refunds_rules_set_since() {
    let mut c = with_wallet();
    mind_sends(&mut c, MILLI.saturating_mul(4), DAY + 1);
    // The owner changes the rules before the transfer's outcome is in.
    ctx_at("alice.near", YOCTO, DAY + 2);
    c.set_wallet_policy(
        "1".to_string(),
        MILLI.saturating_mul(10),
        MILLI.saturating_mul(4),
    );
    ctx_at("lantern.near", NearToken::from_yoctonear(0), DAY + 3);
    let _ = c.on_wallet_sent(
        "1".to_string(),
        acc("alice.near"),
        1,
        payment(MILLI.saturating_mul(4), true, DAY + 1),
        Err(near_sdk::PromiseError::Failed),
    );
    assert_eq!(
        c.get_wallet("1".to_string()).unwrap().spent_today,
        MILLI.saturating_mul(4)
    );
}

mod lending {
    use super::*;
    use crate::lending::LoanStatus;
    use near_sdk::json_types::U64;

    const SECOND: u64 = 1_000_000_000;
    const STORAGE: NearToken = NearToken::from_millinear(10);

    /// Token 1, owned by alice.
    fn minted() -> Contract {
        let mut c = deploy();
        ctx("alice.near", NearToken::from_near(3));
        c.mint();
        c
    }

    fn lend(
        c: &mut Contract,
        borrower: Option<&str>,
        seconds: Option<u64>,
        fee: Option<NearToken>,
    ) -> crate::lending::LoanView {
        c.lend(
            "1".to_string(),
            borrower.map(acc),
            seconds.map(U64),
            Some(5),
            false,
            false,
            fee,
        )
    }

    #[test]
    fn a_free_loan_to_someone_starts_at_once_and_ends_on_time() {
        let mut c = minted();
        ctx_at("alice.near", STORAGE, 10 * SECOND);
        let loan = lend(&mut c, Some("bob.near"), Some(60), None);
        assert_eq!(loan.status, LoanStatus::Active);
        assert_eq!(loan.borrower_id, Some(acc("bob.near")));
        assert_eq!(loan.ends_at, Some(U64(70 * SECOND)));
        assert_eq!(loan.messages, Some(5));
        assert!(!loan.sees_memory && !loan.learns);
        ctx_at("bob.near", NearToken::from_yoctonear(0), 69 * SECOND);
        assert_eq!(
            c.get_loan("1".to_string()).unwrap().status,
            LoanStatus::Active
        );
        ctx_at("bob.near", NearToken::from_yoctonear(0), 70 * SECOND);
        assert_eq!(
            c.get_loan("1".to_string()).unwrap().status,
            LoanStatus::Over
        );
    }

    #[test]
    fn a_paid_offer_starts_when_someone_pays_for_it() {
        let mut c = minted();
        ctx_at("alice.near", STORAGE, SECOND);
        let fee = NearToken::from_near(1);
        let offer = lend(&mut c, None, Some(3600), Some(fee));
        assert_eq!(offer.status, LoanStatus::Offered);
        assert_eq!(offer.borrower_id, None);
        ctx_at("bob.near", NearToken::from_near(2), 5 * SECOND);
        let loan = c.borrow("1".to_string());
        assert_eq!(loan.status, LoanStatus::Active);
        assert_eq!(loan.borrower_id, Some(acc("bob.near")));
        assert_eq!(loan.ends_at, Some(U64(3605 * SECOND)));
    }

    #[test]
    #[should_panic(expected = "Attach the fee")]
    fn borrowing_needs_the_fee() {
        let mut c = minted();
        ctx("alice.near", STORAGE);
        lend(&mut c, None, Some(60), Some(NearToken::from_near(1)));
        ctx("bob.near", NearToken::from_millinear(500));
        c.borrow("1".to_string());
    }

    #[test]
    #[should_panic(expected = "offered to someone else")]
    fn an_offer_to_someone_is_only_theirs() {
        let mut c = minted();
        ctx("alice.near", STORAGE);
        lend(
            &mut c,
            Some("bob.near"),
            Some(60),
            Some(NearToken::from_near(1)),
        );
        ctx("carol.near", NearToken::from_near(1));
        c.borrow("1".to_string());
    }

    #[test]
    #[should_panic(expected = "isn't on offer")]
    fn a_loan_is_taken_once() {
        let mut c = minted();
        ctx("alice.near", STORAGE);
        lend(&mut c, None, Some(60), Some(NearToken::from_near(1)));
        ctx("bob.near", NearToken::from_near(1));
        c.borrow("1".to_string());
        ctx("carol.near", NearToken::from_near(1));
        c.borrow("1".to_string());
    }

    #[test]
    #[should_panic(expected = "rented out")]
    fn a_rented_token_cant_change_hands() {
        let mut c = minted();
        ctx("alice.near", STORAGE);
        lend(&mut c, None, Some(60), Some(NearToken::from_near(1)));
        ctx("bob.near", NearToken::from_near(1));
        c.borrow("1".to_string());
        ctx("alice.near", YOCTO);
        c.nft_transfer(acc("carol.near"), "1".to_string(), None, None);
    }

    #[test]
    fn giving_a_token_away_ends_a_free_loan() {
        let mut c = minted();
        ctx("alice.near", STORAGE);
        lend(&mut c, Some("bob.near"), None, None);
        ctx("alice.near", YOCTO);
        c.nft_transfer(acc("carol.near"), "1".to_string(), None, None);
        assert_eq!(c.get_loan("1".to_string()), None);
    }

    #[test]
    fn once_its_time_is_up_a_rented_token_can_change_hands() {
        let mut c = minted();
        ctx_at("alice.near", STORAGE, SECOND);
        lend(&mut c, None, Some(60), Some(NearToken::from_near(1)));
        ctx_at("bob.near", NearToken::from_near(1), SECOND);
        c.borrow("1".to_string());
        ctx_at("alice.near", YOCTO, 62 * SECOND);
        c.nft_transfer(acc("carol.near"), "1".to_string(), None, None);
        assert_eq!(
            c.get_kat("1".to_string()).unwrap().owner_id,
            acc("carol.near")
        );
    }

    #[test]
    #[should_panic(expected = "It's rented")]
    fn the_owner_cant_cut_a_paid_loan_short() {
        let mut c = minted();
        ctx("alice.near", STORAGE);
        lend(&mut c, None, Some(60), Some(NearToken::from_near(1)));
        ctx("bob.near", NearToken::from_near(1));
        c.borrow("1".to_string());
        ctx("alice.near", YOCTO);
        c.end_loan("1".to_string());
    }

    #[test]
    fn the_borrower_can_give_it_back_and_the_owner_can_end_a_free_loan() {
        let mut c = minted();
        ctx("alice.near", STORAGE);
        lend(&mut c, None, Some(60), Some(NearToken::from_near(1)));
        ctx("bob.near", NearToken::from_near(1));
        c.borrow("1".to_string());
        ctx("bob.near", YOCTO);
        c.end_loan("1".to_string());
        assert_eq!(c.get_loan("1".to_string()), None);

        ctx("alice.near", STORAGE);
        lend(&mut c, Some("bob.near"), None, None);
        ctx("alice.near", YOCTO);
        c.end_loan("1".to_string());
        assert_eq!(c.get_loan("1".to_string()), None);
    }

    #[test]
    #[should_panic(expected = "Only the borrower or the owner")]
    fn nobody_else_can_end_an_active_loan() {
        let mut c = minted();
        ctx("alice.near", STORAGE);
        lend(&mut c, Some("bob.near"), Some(60), None);
        ctx("carol.near", YOCTO);
        c.end_loan("1".to_string());
    }

    #[test]
    #[should_panic(expected = "already on loan")]
    fn an_active_loan_isnt_replaced() {
        let mut c = minted();
        ctx("alice.near", STORAGE);
        lend(&mut c, Some("bob.near"), Some(60), None);
        ctx("alice.near", STORAGE);
        lend(&mut c, Some("carol.near"), Some(60), None);
    }

    #[test]
    fn an_offer_can_be_changed_before_anyone_takes_it() {
        let mut c = minted();
        ctx("alice.near", STORAGE);
        lend(&mut c, None, Some(60), Some(NearToken::from_near(1)));
        ctx("alice.near", STORAGE);
        let offer = lend(&mut c, None, Some(60), Some(NearToken::from_near(2)));
        assert_eq!(offer.fee, NearToken::from_near(2));
    }

    #[test]
    #[should_panic(expected = "Only the token's owner")]
    fn only_the_owner_lends() {
        let mut c = minted();
        ctx("bob.near", STORAGE);
        lend(&mut c, Some("carol.near"), Some(60), None);
    }

    #[test]
    #[should_panic(expected = "for the loan's storage")]
    fn lending_pays_for_its_storage() {
        let mut c = minted();
        ctx("alice.near", YOCTO);
        lend(&mut c, Some("bob.near"), Some(60), None);
    }

    #[test]
    #[should_panic(expected = "from a second to a year")]
    fn a_loan_has_a_sensible_length() {
        let mut c = minted();
        ctx("alice.near", STORAGE);
        lend(&mut c, Some("bob.near"), Some(0), None);
    }
}

fn dataset(classes: &[&str], counts: &[u64], supply: u64) -> Collection {
    Collection {
        kind: crate::CollectionKind::Dataset {
            classes: classes.iter().map(|c| c.to_string()).collect(),
        },
        class_counts: counts.iter().map(|c| (*c).into()).collect(),
        initial_supply: Some(supply.into()),
        ..collection("Hotdogs", "HOT", "")
    }
}

#[test]
fn a_dataset_mints_every_sample_to_the_creator() {
    let c = deploy_with(dataset(&["hotdog", "not_hotdog"], &[3, 2], 5));
    let view = c.get_collection();
    assert_eq!(view.minted.0, 5);
    assert_eq!(view.max_supply, Some(5.into()));
    assert_eq!(
        view.kind,
        crate::CollectionKind::Dataset {
            classes: vec!["hotdog".to_string(), "not_hotdog".to_string()]
        }
    );
    assert_eq!(view.class_counts, vec![3.into(), 2.into()]);
    let token = c.nft_token("5".to_string()).unwrap();
    assert_eq!(token.owner_id, acc("admin.near"));
    assert_eq!(token.metadata.unwrap().title.as_deref(), Some("Sample #5"));
    assert!(c.get_kat("1".to_string()).is_some());
}

#[test]
fn a_dataset_over_fifty_schedules_the_rest() {
    let mut c = deploy_with(dataset(&["a", "b"], &[100, 20], 120));
    assert_eq!(c.get_collection().minted.0, 50);
    let receipts = near_sdk::test_utils::get_created_receipts();
    assert_eq!(receipts.len(), 1);
    assert_eq!(receipts[0].receiver_id, env::current_account_id());
    match receipts[0].actions.as_slice() {
        [near_sdk::mock::MockAction::FunctionCallWeight {
            method_name, args, ..
        }] => {
            assert_eq!(method_name, b"mint_samples");
            assert_eq!(args, br#"{"count":"70"}"#);
        }
        other => panic!("unexpected actions {other:?}"),
    }
    // The continuation mints the next batch and schedules the last.
    ctx("collection.near", NearToken::from_yoctonear(0));
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc("collection.near"))
        .predecessor_account_id(acc("collection.near"))
        .storage_usage(env::storage_usage())
        .build());
    c.mint_samples(70.into());
    assert_eq!(c.get_collection().minted.0, 100);
    c.mint_samples(20.into());
    assert_eq!(c.get_collection().minted.0, 120);
}

#[test]
fn the_admin_finishes_minting() {
    // The continuation never ran, as if it had failed: 50 of 120 are minted.
    let mut c = deploy_with(dataset(&["a", "b"], &[100, 20], 120));
    assert_eq!(c.get_collection().minted.0, 50);
    ctx("alice.near", NearToken::from_yoctonear(0));
    c.finish_minting();
    assert_eq!(c.get_collection().minted.0, 100);
    // It schedules the last batch, which the collection runs on its own.
    let receipts = near_sdk::test_utils::get_created_receipts();
    assert_eq!(receipts.len(), 1);
    match receipts[0].actions.as_slice() {
        [near_sdk::mock::MockAction::FunctionCallWeight {
            method_name, args, ..
        }] => {
            assert_eq!(method_name, b"mint_samples");
            assert_eq!(args, br#"{"count":"20"}"#);
        }
        other => panic!("unexpected actions {other:?}"),
    }
    ctx("alice.near", NearToken::from_yoctonear(0));
    c.finish_minting();
    assert_eq!(c.get_collection().minted.0, 120);
    assert_eq!(
        c.nft_token("120".to_string()).unwrap().owner_id,
        acc("admin.near")
    );
}

#[test]
#[should_panic(expected = "All samples are minted")]
fn nothing_left_to_mint() {
    let mut c = deploy_with(dataset(&["a", "b"], &[3, 2], 5));
    ctx("alice.near", NearToken::from_yoctonear(0));
    c.finish_minting();
}

#[test]
fn anyone_can_finish_minting() {
    let mut c = deploy_with(dataset(&["a", "b"], &[100, 20], 120));
    ctx("alice.near", NearToken::from_yoctonear(0));
    c.finish_minting();
    assert_eq!(c.get_collection().minted.0, 100);
    // Always to the creator, whoever asked.
    assert_eq!(
        c.nft_token("100".to_string()).unwrap().owner_id,
        acc("admin.near")
    );
}

#[test]
#[should_panic(expected = "initial_supply must equal the sum of class_counts")]
fn dataset_counts_must_add_up() {
    deploy_with(dataset(&["a", "b"], &[3, 2], 6));
}

#[test]
#[should_panic(expected = "class names are 1 to 32 lowercase letters, digits or _")]
fn dataset_class_names_are_checked() {
    deploy_with(dataset(&["Hot Dog", "b"], &[3, 2], 5));
}

#[test]
#[should_panic(expected = "class names must be unique")]
fn dataset_class_names_are_unique() {
    deploy_with(dataset(&["hotdog", "hotdog"], &[3, 2], 5));
}

#[test]
#[should_panic(expected = "initial_supply must be 1 to 1000")]
fn a_dataset_holds_at_most_a_thousand_samples() {
    deploy_with(dataset(&["a", "b"], &[1000, 1], 1001));
}

#[test]
#[should_panic(expected = "A dataset needs an initial_supply")]
fn a_dataset_needs_an_initial_supply() {
    deploy_with(Collection {
        initial_supply: None,
        ..dataset(&["a", "b"], &[3, 2], 5)
    });
}

#[test]
#[should_panic(expected = "This is not a dataset collection")]
fn a_character_collection_has_nothing_to_finish_minting() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_yoctonear(0));
    c.finish_minting();
}

#[test]
#[should_panic(expected = "This collection's samples were all minted at launch")]
fn nobody_mints_from_a_dataset() {
    let mut c = deploy_with(dataset(&["a", "b"], &[3, 2], 5));
    ctx("alice.near", NearToken::from_near(3));
    c.mint();
}

#[test]
fn a_character_collection_reads_as_character() {
    let c = deploy();
    let view = c.get_collection();
    assert_eq!(view.kind, crate::CollectionKind::Character);
    assert!(view.class_counts.is_empty());
}

fn sample_dataset() -> Contract {
    deploy_with(dataset(&["a", "b"], &[3, 2], 5))
}

fn ids(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

#[test]
fn sample_key_paths_name_the_token() {
    assert_eq!(crate::ckd::sample_key_path("17"), "nearkat/samples/v1/17");
}

#[test]
fn the_keeper_requests_ingest_keys_for_unsealed_samples() {
    let mut c = sample_dataset();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    let _ = c.request_ingest_keys(ids(&["1", "2", "3"]), APP_KEY.to_string());
    let receipts = near_sdk::test_utils::get_created_receipts();
    let ckd: Vec<_> = receipts
        .iter()
        .filter(|r| r.receiver_id == acc("v1.signer"))
        .collect();
    assert_eq!(ckd.len(), 3, "{receipts:?}");
    let callbacks = receipts
        .iter()
        .filter(|r| {
            r.actions.iter().any(|a| {
                matches!(a,
                near_sdk::mock::MockAction::FunctionCallWeight { method_name, args, .. }
                if method_name == b"on_sample_keys" && args == br#"{"token_ids":["1","2","3"]}"#)
            })
        })
        .count();
    assert_eq!(callbacks, 1, "{receipts:?}");
}

#[test]
#[should_panic(expected = "Sample 1 is already sealed")]
fn no_ingest_key_once_a_sample_is_sealed() {
    let mut c = sample_dataset();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_samples(vec![("1".to_string(), hash(1), "ref".to_string())]);
    let _ = c.request_ingest_keys(ids(&["2", "1"]), APP_KEY.to_string());
}

#[test]
#[should_panic(expected = "Only the keeper can call this method")]
fn only_the_keeper_requests_ingest_keys() {
    let mut c = sample_dataset();
    ctx("alice.near", NearToken::from_yoctonear(0));
    let _ = c.request_ingest_keys(ids(&["1"]), APP_KEY.to_string());
}

#[test]
#[should_panic(expected = "1 to 10 keys per call")]
fn ingest_keys_are_limited_per_call() {
    let mut c = deploy_with(dataset(&["a", "b"], &[6, 6], 12));
    ctx("keeper.near", NearToken::from_yoctonear(0));
    let all: Vec<String> = (1..=11).map(|i| i.to_string()).collect();
    let _ = c.request_ingest_keys(all, APP_KEY.to_string());
}

#[test]
#[should_panic(expected = "1 to 10 keys per call")]
fn ingest_keys_are_asked_for_at_least_one_sample() {
    let mut c = sample_dataset();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    let _ = c.request_ingest_keys(Vec::new(), APP_KEY.to_string());
}

#[test]
#[should_panic(expected = "Sample 2 is listed twice")]
fn ingest_keys_are_asked_for_once_per_sample() {
    let mut c = sample_dataset();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    let _ = c.request_ingest_keys(ids(&["2", "1", "2"]), APP_KEY.to_string());
}

#[test]
#[should_panic(expected = "This is not a dataset collection")]
fn a_character_collection_has_no_ingest_keys() {
    let mut c = deploy();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    let _ = c.request_ingest_keys(ids(&["1"]), APP_KEY.to_string());
}

#[test]
#[should_panic(expected = "Kat not found")]
fn no_ingest_key_for_a_sample_that_does_not_exist() {
    let mut c = sample_dataset();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    let _ = c.request_ingest_keys(ids(&["6"]), APP_KEY.to_string());
}

/// A call that reached the collection through another contract:
/// `signer` signed the transaction, `predecessor` made the call.
fn relayed(predecessor: &str, signer: &str, signer_pk: Option<&str>, deposit: NearToken) {
    let storage_usage = env::storage_usage();
    let mut builder = VMContextBuilder::new();
    builder
        .predecessor_account_id(acc(predecessor))
        .signer_account_id(acc(signer))
        .attached_deposit(deposit)
        .storage_usage(storage_usage);
    if let Some(key) = signer_pk {
        builder.signer_account_pk(pk(key));
    }
    testing_env!(builder.build());
}

#[test]
#[should_panic(expected = "Call this directly, not through another contract")]
fn ingest_keys_are_requested_directly() {
    let mut c = sample_dataset();
    relayed(
        "keeper.near",
        "mallory.near",
        None,
        NearToken::from_yoctonear(0),
    );
    let _ = c.request_ingest_keys(ids(&["1"]), APP_KEY.to_string());
}

#[test]
#[should_panic(expected = "Call this directly, not through another contract")]
fn samples_are_sealed_directly() {
    let mut c = sample_dataset();
    relayed(
        "keeper.near",
        "mallory.near",
        None,
        NearToken::from_yoctonear(0),
    );
    c.set_samples(vec![("1".to_string(), hash(1), "ref".to_string())]);
}

#[test]
fn set_samples_seals_each_sample_once() {
    let mut c = sample_dataset();
    assert_eq!(c.get_sample("1".to_string()).unwrap().sample_hash, None);
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_samples(vec![
        ("1".to_string(), hash(1), "ref1".to_string()),
        ("2".to_string(), hash(2), "ref2".to_string()),
    ]);
    let s = c.get_sample("1".to_string()).unwrap();
    assert_eq!(s.owner_id, acc("admin.near"));
    assert_eq!(s.sample_hash, Some(hash(1)));
    assert_eq!(s.sample_ref.as_deref(), Some("ref1"));
    assert_eq!(c.get_sample("3".to_string()).unwrap().sample_ref, None);
    assert!(c.get_sample("99".to_string()).is_none());
}

#[test]
#[should_panic(expected = "Sample 1 is already sealed")]
fn set_samples_refuses_a_second_seal() {
    let mut c = sample_dataset();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_samples(vec![("1".to_string(), hash(1), "ref1".to_string())]);
    c.set_samples(vec![("1".to_string(), hash(2), "ref2".to_string())]);
}

#[test]
#[should_panic(expected = "This is not a dataset collection")]
fn character_collections_have_no_samples() {
    let mut c = deploy();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_samples(vec![("1".to_string(), hash(1), "ref".to_string())]);
}

#[test]
#[should_panic(expected = "Samples are sealed with set_samples")]
fn set_context_refuses_samples() {
    let mut c = sample_dataset();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_context("1".to_string(), hash(1), "ref".to_string(), 1.into(), 0);
}

#[test]
#[should_panic(expected = "sample hash must be 32 bytes")]
fn a_sample_hash_is_a_sha256() {
    let mut c = sample_dataset();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_samples(vec![(
        "1".to_string(),
        vec![1; 31].into(),
        "ref".to_string(),
    )]);
}

#[test]
#[should_panic(expected = "sample ref must be 1 to 256 bytes")]
fn a_sample_ref_is_not_empty() {
    let mut c = sample_dataset();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_samples(vec![("1".to_string(), hash(1), String::new())]);
}

#[test]
#[should_panic(expected = "sample ref must be 1 to 256 bytes")]
fn a_sample_ref_is_short() {
    let mut c = sample_dataset();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_samples(vec![("1".to_string(), hash(1), "r".repeat(257))]);
}

#[test]
fn a_sample_ref_may_be_256_bytes() {
    let mut c = sample_dataset();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_samples(vec![("1".to_string(), hash(1), "r".repeat(256))]);
    assert_eq!(
        c.get_sample("1".to_string())
            .unwrap()
            .sample_ref
            .unwrap()
            .len(),
        256
    );
}

#[test]
#[should_panic(expected = "Kat not found")]
fn no_seal_for_a_sample_that_does_not_exist() {
    let mut c = sample_dataset();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_samples(vec![("6".to_string(), hash(1), "ref".to_string())]);
}

#[test]
#[should_panic(expected = "Sample 1 is already sealed")]
fn a_sample_listed_twice_in_one_batch_is_sealed_once() {
    let mut c = sample_dataset();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_samples(vec![
        ("1".to_string(), hash(1), "ref1".to_string()),
        ("1".to_string(), hash(2), "ref2".to_string()),
    ]);
}

#[test]
#[should_panic(expected = "1 to 50 samples per call")]
fn set_samples_needs_a_sample() {
    let mut c = sample_dataset();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_samples(Vec::new());
}

/// `set_context` refuses every sample of a dataset, so a sealed one too.
#[test]
#[should_panic(expected = "Samples are sealed with set_samples")]
fn set_context_refuses_a_sealed_sample_too() {
    let mut c = sample_dataset();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_samples(vec![("1".to_string(), hash(1), "ref".to_string())]);
    c.set_context("1".to_string(), hash(2), "ref2".to_string(), 2.into(), 0);
}

fn tee_deploy() -> Contract {
    deploy_with(Collection {
        tee: Some(crate::TeeRequirement::Phala {
            app_id: "3763bc34552cf3a27ff71ad5f7a90471562a1a2d".to_string(),
        }),
        ..collection("Nearkat", "KAT", "")
    })
}

fn pk(s: &str) -> near_sdk::PublicKey {
    s.parse().unwrap()
}

const APP_KEY_A: &str = "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp";
const APP_KEY_B: &str = "ed25519:4eUKxcVz6kQgHHvJDY2jkm6mYwSj8b8N3pHn1dQd8Z8C";

#[test]
fn the_admin_trusts_app_keys_only_without_a_tee() {
    let mut c = deploy();
    ctx("admin.near", NearToken::from_millinear(10));
    let entry = c.trust_app_key(pk(APP_KEY_A), "dev-trainer".to_string(), "Dev".to_string());
    assert!(entry.trusted_by_admin);
    assert_eq!(c.get_app_key(pk(APP_KEY_A)), Some(entry));
    assert_eq!(c.get_app_key(pk(APP_KEY_B)), None);
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id(acc("admin.near"))
        .signer_account_pk(pk(APP_KEY_A))
        .build());
    assert_eq!(c.signer_app(), Some("dev-trainer".to_string()));
}

#[test]
#[should_panic(expected = "Only the admin can call this method")]
fn trust_app_key_is_admin_only() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_millinear(10));
    c.trust_app_key(pk(APP_KEY_A), "dev".to_string(), "Dev".to_string());
}

#[test]
#[should_panic(expected = "for the key's storage")]
fn trust_app_key_must_pay_its_storage() {
    let mut c = deploy();
    ctx("admin.near", YOCTO);
    c.trust_app_key(pk(APP_KEY_A), "dev".to_string(), "Dev".to_string());
}

#[test]
#[should_panic(expected = "app_id is 1 to 64")]
fn trust_app_key_checks_the_app_id() {
    let mut c = deploy();
    ctx("admin.near", NearToken::from_millinear(10));
    c.trust_app_key(pk(APP_KEY_A), "Not Valid".to_string(), "Dev".to_string());
}

#[test]
#[should_panic(expected = "A label is 1 to 48 printable characters")]
fn app_key_labels_are_checked() {
    let mut c = deploy();
    ctx("admin.near", NearToken::from_millinear(10));
    c.trust_app_key(pk(APP_KEY_A), "dev".to_string(), "bad\nlabel".to_string());
}

#[test]
fn app_key_labels_cant_hide_characters() {
    // Zero-width and bidirectional characters would let one app's label
    // read as another's.
    for label in [
        "Dev\u{200B}",
        "Dev\u{200C}",
        "\u{200F}Dev",
        "\u{202E}veD",
        "D\u{2066}ev",
        "\u{FEFF}Dev",
        "Dev\u{E0041}",
    ] {
        let mut c = deploy();
        ctx("admin.near", NearToken::from_millinear(10));
        let refused = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.trust_app_key(pk(APP_KEY_A), "dev".to_string(), label.to_string());
        }));
        assert!(refused.is_err(), "{label:?} was accepted");
    }
    let mut c = deploy();
    ctx("admin.near", NearToken::from_millinear(10));
    let entry = c.trust_app_key(
        pk(APP_KEY_A),
        "dev".to_string(),
        "Café trainer ✨".to_string(),
    );
    assert_eq!(entry.label, "Café trainer ✨");
    // Emoji joined by U+200D (zero-width joiner) are allowed.
    for label in [
        "\u{1F469}\u{200D}\u{1F4BB} trainer",
        "\u{1F3F3}\u{FE0F}\u{200D}\u{1F308}",
    ] {
        let entry = c.trust_app_key(pk(APP_KEY_A), "dev".to_string(), label.to_string());
        assert_eq!(entry.label, label);
    }
}

#[test]
#[should_panic(expected = "A TEE collection only accepts attested training apps")]
fn trust_app_key_refused_for_tee_collections() {
    let mut c = tee_deploy();
    ctx("admin.near", NearToken::from_millinear(10));
    c.trust_app_key(pk(APP_KEY_A), "dev".to_string(), "Dev".to_string());
}

#[test]
fn training_apps_lists_each_app_once() {
    let mut c = deploy();
    ctx("admin.near", NearToken::from_millinear(10));
    c.trust_app_key(pk(APP_KEY_A), "app-one".to_string(), "First".to_string());
    c.trust_app_key(pk(APP_KEY_B), "app-one".to_string(), "Renamed".to_string());
    c.trust_app_key(
        pk("ed25519:8fWHD35Rjd78yeowbGCfY5zXqmQzy56Dg9d6xRqVnRYX"),
        "app-two".to_string(),
        "Second".to_string(),
    );
    assert_eq!(
        c.training_apps(),
        vec![
            ("app-one".to_string(), "Renamed".to_string()),
            ("app-two".to_string(), "Second".to_string())
        ]
    );
}

#[test]
#[should_panic(expected = "This key is registered to another app")]
fn trusting_a_key_cannot_move_it_to_another_app() {
    let mut c = deploy();
    ctx("admin.near", NearToken::from_millinear(10));
    c.trust_app_key(pk(APP_KEY_A), "app-one".to_string(), "One".to_string());
    c.trust_app_key(pk(APP_KEY_A), "app-two".to_string(), "Two".to_string());
}

#[test]
fn the_admin_takes_an_app_off_the_list() {
    let mut c = deploy();
    ctx("admin.near", NearToken::from_millinear(10));
    c.trust_app_key(pk(APP_KEY_A), "app-one".to_string(), "One".to_string());
    ctx("admin.near", YOCTO);
    c.remove_training_app("app-one".to_string());
    assert!(c.training_apps().is_empty());
    assert!(c.get_app_key(pk(APP_KEY_A)).is_some());
}

#[test]
#[should_panic(expected = "app-two is not a listed training app")]
fn removing_an_unknown_app_is_refused() {
    let mut c = deploy();
    ctx("admin.near", NearToken::from_millinear(10));
    c.trust_app_key(pk(APP_KEY_A), "app-one".to_string(), "One".to_string());
    ctx("admin.near", YOCTO);
    c.remove_training_app("app-two".to_string());
}

#[test]
#[should_panic(expected = "Only the admin can call this method")]
fn only_the_admin_removes_apps() {
    let mut c = deploy();
    ctx("alice.near", YOCTO);
    c.remove_training_app("app-one".to_string());
}

mod sample_loans {
    use super::*;
    use crate::lending::LoanStatus;

    const STORAGE: NearToken = NearToken::from_millinear(50);

    fn register_apps(c: &mut Contract) {
        ctx("admin.near", NearToken::from_millinear(10));
        c.trust_app_key(pk(APP_KEY_A), "app-one".to_string(), "One".to_string());
        c.trust_app_key(pk(APP_KEY_B), "app-two".to_string(), "Two".to_string());
    }

    /// Five samples, all owned by admin; apps one and two registered.
    fn setup() -> Contract {
        let mut c = sample_dataset();
        register_apps(&mut c);
        c
    }

    fn give(c: &mut Contract, id: &str, to: &str) {
        ctx("admin.near", YOCTO);
        c.nft_transfer(acc(to), id.to_string(), None, None);
    }

    /// The yoctoNEAR of each transfer the last call made, to `to` (or to anyone).
    fn transfers(to: Option<&str>) -> Vec<u128> {
        near_sdk::test_utils::get_created_receipts()
            .iter()
            .filter(|r| to.is_none_or(|who| r.receiver_id == acc(who)))
            .flat_map(|r| r.actions.iter())
            .filter_map(|a| match a {
                near_sdk::mock::MockAction::Transfer { deposit, .. } => {
                    Some(deposit.as_yoctonear())
                }
                _ => None,
            })
            .collect()
    }

    fn lend(c: &mut Contract, tokens: &[&str], fee: u128, apps: &[&str]) -> u32 {
        c.lend_many(
            ids(tokens),
            Some(60.into()),
            NearToken::from_yoctonear(fee),
            ids(apps),
        )
    }

    #[test]
    fn lend_many_offers_each_sample_for_one_use() {
        let mut c = setup();
        ctx("admin.near", STORAGE);
        assert_eq!(lend(&mut c, &["1", "2"], 5, &["app-one", "app-two"]), 2);
        for id in ["1", "2"] {
            let loan = c.get_loan(id.to_string()).unwrap();
            assert_eq!(loan.status, LoanStatus::Offered);
            assert_eq!(loan.messages, Some(1));
            assert!(!loan.sees_memory && !loan.learns);
            assert_eq!(loan.borrower_id, None);
            let t = c.get_loan_training(id.to_string()).unwrap();
            assert_eq!(t.apps, ids(&["app-one", "app-two"]));
            assert_eq!(t.app_id, None);
            assert!(!t.spent);
        }
        assert_eq!(
            get_logs()
                .iter()
                .filter(|l| l.contains("loan_offered") && l.contains(r#""token_ids":["1","2"]"#))
                .count(),
            1
        );
    }

    #[test]
    #[should_panic(expected = "is not a registered training app")]
    fn lend_many_names_only_registered_apps() {
        let mut c = setup();
        ctx("admin.near", STORAGE);
        lend(&mut c, &["1"], 5, &["app-one", "rogue"]);
    }

    #[test]
    #[should_panic(expected = "Lend samples with lend_many")]
    fn plain_lend_is_refused_for_samples() {
        let mut c = setup();
        ctx("admin.near", STORAGE);
        c.lend("1".to_string(), None, None, Some(1), false, false, None);
    }

    #[test]
    #[should_panic(expected = "Rent samples with borrow_many")]
    fn plain_borrow_is_refused_for_samples() {
        let mut c = setup();
        ctx("bob.near", STORAGE);
        c.borrow("1".to_string());
    }

    #[test]
    #[should_panic(expected = "Only the owner can lend")]
    fn lend_many_needs_every_sample_owned() {
        let mut c = setup();
        give(&mut c, "2", "carol.near");
        ctx("admin.near", STORAGE);
        lend(&mut c, &["1", "2"], 5, &["app-one"]);
    }

    #[test]
    fn borrow_many_pays_each_lender_once() {
        let mut c = setup();
        give(&mut c, "3", "carol.near");
        ctx("admin.near", STORAGE);
        lend(&mut c, &["1", "2"], 100, &["app-one"]);
        ctx("carol.near", STORAGE);
        lend(&mut c, &["3"], 40, &["app-one", "app-two"]);
        ctx("bob.near", NearToken::from_yoctonear(1000));
        assert_eq!(
            c.borrow_many(ids(&["1", "2", "3"]), "app-one".to_string()),
            3
        );
        assert_eq!(transfers(Some("admin.near")), vec![200]);
        assert_eq!(transfers(Some("carol.near")), vec![40]);
        assert_eq!(transfers(Some("bob.near")), vec![760]);
        for id in ["1", "2", "3"] {
            let t = c.get_loan_training(id.to_string()).unwrap();
            assert_eq!(t.app_id.as_deref(), Some("app-one"));
            assert!(!t.spent);
            let loan = c.get_loan(id.to_string()).unwrap();
            assert_eq!(loan.status, LoanStatus::Active);
            assert_eq!(loan.borrower_id, Some(acc("bob.near")));
        }
    }

    #[test]
    #[should_panic(expected = "Sample 3 isn't offered for app")]
    fn borrow_many_fails_whole_if_one_is_not_on_offer() {
        let mut c = setup();
        ctx("admin.near", STORAGE);
        lend(&mut c, &["1", "2"], 5, &["app-one"]);
        ctx("bob.near", NearToken::from_yoctonear(100));
        c.borrow_many(ids(&["1", "2", "3"]), "app-one".to_string());
    }

    #[test]
    #[should_panic(expected = "Sample 2 isn't offered for app app-two")]
    fn borrow_many_needs_the_app_to_be_named() {
        let mut c = setup();
        ctx("admin.near", STORAGE);
        lend(&mut c, &["1"], 5, &["app-one", "app-two"]);
        lend(&mut c, &["2"], 5, &["app-one"]);
        ctx("bob.near", NearToken::from_yoctonear(100));
        c.borrow_many(ids(&["1", "2"]), "app-two".to_string());
    }

    #[test]
    #[should_panic(expected = "Attach the fees")]
    fn borrow_many_needs_the_fees() {
        let mut c = setup();
        ctx("admin.near", STORAGE);
        lend(&mut c, &["1", "2"], 50, &["app-one"]);
        ctx("bob.near", NearToken::from_yoctonear(99));
        c.borrow_many(ids(&["1", "2"]), "app-one".to_string());
    }

    #[test]
    fn the_training_record_goes_with_its_loan() {
        let mut c = setup();
        ctx("admin.near", STORAGE);
        lend(&mut c, &["1"], 5, &["app-one"]);
        assert!(c.get_loan_training("1".to_string()).is_some());
        give(&mut c, "1", "carol.near");
        assert_eq!(c.get_loan("1".to_string()), None);
        assert_eq!(c.get_loan_training("1".to_string()), None);
    }

    #[test]
    fn the_lender_gets_the_whole_storage_back() {
        let mut c = setup();
        let before = env::storage_usage();
        ctx("admin.near", STORAGE);
        lend(&mut c, &["1"], 5, &["app-one"]);
        let refund: u128 = transfers(None).iter().sum();
        let kept = STORAGE.as_yoctonear() - refund;
        ctx("admin.near", YOCTO);
        c.end_loan("1".to_string());
        assert_eq!(env::storage_usage(), before);
        let back: u128 = transfers(None).iter().sum();
        assert_eq!(back, kept);
    }

    #[test]
    fn the_lender_pays_for_what_the_loan_grows_to_when_taken() {
        // The longest renter, and the longest app it may name.
        let renter = "r".repeat(64);
        let app = "a".repeat(64);
        let mut c = setup();
        ctx("admin.near", NearToken::from_millinear(10));
        c.trust_app_key(
            pk("ed25519:8fWHD35Rjd78yeowbGCfY5zXqmQzy56Dg9d6xRqVnRYX"),
            app.clone(),
            "Long".to_string(),
        );
        let before = env::storage_usage();
        ctx("admin.near", STORAGE);
        c.lend_many(
            ids(&["1"]),
            Some(60.into()),
            NearToken::from_yoctonear(5),
            vec!["app-one".to_string(), app.clone()],
        );
        let kept = STORAGE.as_yoctonear() - transfers(None).iter().sum::<u128>();
        ctx(&renter, NearToken::from_yoctonear(5));
        c.borrow_many(ids(&["1"]), app);
        let used =
            u128::from(env::storage_usage() - before) * env::storage_byte_cost().as_yoctonear();
        assert!(
            used <= kept,
            "the loan uses {used} but the lender paid {kept}"
        );
    }

    #[test]
    fn the_worst_case_offer_fits_the_web_deposit_of_a_hundredth_near() {
        // The web attaches 0.01 NEAR a sample (LOAN_STORAGE_DEPOSIT). The
        // largest record: the highest token id, a 64-char lender and renter,
        // and 8 apps of 64 chars each.
        const WEB_DEPOSIT: NearToken = NearToken::from_millinear(10);
        let lender = "l".repeat(64);
        let renter = "r".repeat(64);
        let apps: Vec<String> = (0..8u8).map(|i| format!("{}{i}", "a".repeat(63))).collect();
        let mut c = deploy_with(dataset(&["a", "b"], &[500, 500], 1000));
        let me = env::current_account_id();
        while c.get_collection().minted.0 < 1000 {
            testing_env!(VMContextBuilder::new()
                .current_account_id(me.clone())
                .predecessor_account_id(me.clone())
                .storage_usage(env::storage_usage())
                .build());
            let left = 1000 - c.get_collection().minted.0;
            c.mint_samples(left.into());
        }
        for (i, app) in apps.iter().enumerate() {
            ctx("admin.near", NearToken::from_millinear(10));
            c.trust_app_key(
                near_sdk::PublicKey::from_parts(
                    near_sdk::CurveType::ED25519,
                    vec![i as u8 + 1; 32],
                )
                .unwrap(),
                app.clone(),
                "x".repeat(48),
            );
        }
        give(&mut c, "1000", &lender);
        let before = env::storage_usage();
        ctx(&lender, WEB_DEPOSIT);
        c.lend_many(
            ids(&["1000"]),
            Some(60.into()),
            NearToken::from_near(1_000_000),
            apps.clone(),
        );
        let kept = WEB_DEPOSIT.as_yoctonear() - transfers(None).iter().sum::<u128>();
        ctx(&renter, NearToken::from_near(1_000_000));
        c.borrow_many(ids(&["1000"]), apps[7].clone());
        let used =
            u128::from(env::storage_usage() - before) * env::storage_byte_cost().as_yoctonear();
        assert!(
            used <= kept && kept <= WEB_DEPOSIT.as_yoctonear(),
            "the loan uses {used} and the lender paid {kept} of {WEB_DEPOSIT}"
        );
        // Report the margin left when this is run with --nocapture.
        println!(
            "worst-case offer: {} of {} bytes",
            kept / env::storage_byte_cost().as_yoctonear(),
            WEB_DEPOSIT.as_yoctonear() / env::storage_byte_cost().as_yoctonear()
        );
    }

    #[test]
    fn an_offer_whose_time_is_up_can_be_replaced() {
        let mut c = setup();
        ctx("admin.near", STORAGE);
        lend(&mut c, &["1"], 5, &["app-one"]);
        ctx("bob.near", NearToken::from_yoctonear(5));
        c.borrow_many(ids(&["1"]), "app-one".to_string());
        // 61 s later the 60 s rental is over, though its use was never spent.
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(acc("admin.near"))
            .signer_account_id(acc("admin.near"))
            .attached_deposit(STORAGE)
            .storage_usage(env::storage_usage())
            .block_timestamp(61 * 1_000_000_000)
            .build());
        assert_eq!(
            c.get_loan("1".to_string()).unwrap().status,
            LoanStatus::Over
        );
        assert_eq!(lend(&mut c, &["1"], 7, &["app-two"]), 1);
        let loan = c.get_loan("1".to_string()).unwrap();
        assert_eq!(loan.status, LoanStatus::Offered);
        assert_eq!(loan.fee, NearToken::from_yoctonear(7));
        assert_eq!(
            c.get_loan_training("1".to_string()).unwrap().apps,
            ids(&["app-two"])
        );
    }

    #[test]
    #[should_panic(expected = "It is already on loan; end that loan first")]
    fn an_active_rental_is_not_replaced() {
        let mut c = setup();
        ctx("admin.near", STORAGE);
        lend(&mut c, &["1"], 5, &["app-one"]);
        ctx("bob.near", NearToken::from_yoctonear(5));
        c.borrow_many(ids(&["1"]), "app-one".to_string());
        ctx("admin.near", STORAGE);
        lend(&mut c, &["1"], 5, &["app-one"]);
    }

    #[test]
    #[should_panic(expected = "Sample 2 is listed twice")]
    fn lend_many_lists_each_sample_once() {
        let mut c = setup();
        ctx("admin.near", STORAGE);
        lend(&mut c, &["1", "2", "2"], 5, &["app-one"]);
    }

    #[test]
    #[should_panic(expected = "Name each app once")]
    fn lend_many_names_each_app_once() {
        let mut c = setup();
        ctx("admin.near", STORAGE);
        lend(&mut c, &["1"], 5, &["app-one", "app-one"]);
    }

    #[test]
    #[should_panic(expected = "Sample 1 is listed twice")]
    fn borrow_many_lists_each_sample_once() {
        let mut c = setup();
        ctx("admin.near", STORAGE);
        lend(&mut c, &["1", "2"], 5, &["app-one"]);
        ctx("bob.near", NearToken::from_yoctonear(100));
        c.borrow_many(ids(&["1", "2", "1"]), "app-one".to_string());
    }

    #[test]
    #[should_panic(expected = "Lend 1 to 50 samples at a time")]
    fn lend_many_takes_at_most_fifty() {
        let mut c = setup();
        ctx("admin.near", STORAGE);
        let many: Vec<String> = (1..=51).map(|i| i.to_string()).collect();
        c.lend_many(many, None, NearToken::from_yoctonear(5), ids(&["app-one"]));
    }

    #[test]
    #[should_panic(expected = "Name 1 to 8 training apps")]
    fn lend_many_names_at_most_eight_apps() {
        let mut c = setup();
        ctx("admin.near", STORAGE);
        let apps: Vec<String> = (1..=9).map(|i| format!("app-{i}")).collect();
        c.lend_many(ids(&["1"]), None, NearToken::from_yoctonear(5), apps);
    }

    #[test]
    #[should_panic(expected = "Rent 1 to 50 samples at a time")]
    fn borrow_many_takes_at_most_fifty() {
        let mut c = setup();
        ctx("bob.near", NearToken::from_yoctonear(100));
        let many: Vec<String> = (1..=51).map(|i| i.to_string()).collect();
        c.borrow_many(many, "app-one".to_string());
    }

    // ---- Training apps get keys for rented samples, and record runs ----

    const TRAINER_DEPOSIT: NearToken = NearToken::from_millinear(100);
    const SHA: &str = "aa11bb22cc33dd44ee55ff6600112233445566778899aabbccddeeff00112233";

    /// A call signed by an app's key, sent from `predecessor`.
    fn as_app(key: &str, predecessor: &str, deposit: NearToken, timestamp: u64) {
        let storage_usage = env::storage_usage();
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(acc(predecessor))
            .signer_account_id(acc(predecessor))
            .signer_account_pk(pk(key))
            .attached_deposit(deposit)
            .storage_usage(storage_usage)
            .block_timestamp(timestamp)
            .build());
    }

    /// Samples 1 to 4 sealed, lent for 60 s to both apps; bob rents 1 to 3
    /// for app one.
    fn rented() -> Contract {
        let mut c = setup();
        ctx("keeper.near", NearToken::from_yoctonear(0));
        c.set_samples(
            (1..=4)
                .map(|i| (i.to_string(), hash(i as u8), format!("ref{i}")))
                .collect(),
        );
        ctx("admin.near", STORAGE);
        lend(&mut c, &["1", "2", "3", "4"], 5, &["app-one", "app-two"]);
        ctx("bob.near", NearToken::from_yoctonear(100));
        c.borrow_many(ids(&["1", "2", "3"]), "app-one".to_string());
        c
    }

    fn record(c: &mut Contract, run_id: &str, tokens: &[&str]) -> crate::dataset::RunView {
        as_app(APP_KEY_A, "trainer.near", TRAINER_DEPOSIT, 0);
        c.record_training(
            run_id.to_string(),
            acc("bob.near"),
            ids(tokens),
            SHA.to_string(),
            9_250,
        )
    }

    #[test]
    fn a_rented_app_requests_keys_for_its_samples() {
        let mut c = rented();
        as_app(APP_KEY_A, "trainer.near", NearToken::from_yoctonear(0), 0);
        let _ = c.request_sample_keys(ids(&["1", "2"]), APP_KEY.to_string());
        let receipts = near_sdk::test_utils::get_created_receipts();
        let paths: Vec<String> = receipts
            .iter()
            .filter(|r| r.receiver_id == acc("v1.signer"))
            .flat_map(|r| r.actions.iter())
            .filter_map(|a| match a {
                near_sdk::mock::MockAction::FunctionCallWeight { args, .. } => {
                    let v: near_sdk::serde_json::Value =
                        near_sdk::serde_json::from_slice(args).unwrap();
                    Some(
                        v["request"]["derivation_path"]
                            .as_str()
                            .unwrap()
                            .to_string(),
                    )
                }
                _ => None,
            })
            .collect();
        assert_eq!(
            paths,
            vec!["nearkat/samples/v1/1", "nearkat/samples/v1/2"],
            "{receipts:?}"
        );
        let callbacks = receipts
            .iter()
            .flat_map(|r| r.actions.iter())
            .filter(|a| {
                matches!(a,
                near_sdk::mock::MockAction::FunctionCallWeight { method_name, args, .. }
                if method_name == b"on_sample_keys" && args == br#"{"token_ids":["1","2"]}"#)
            })
            .count();
        assert_eq!(callbacks, 1, "{receipts:?}");
        // Requesting keys does not spend the rental.
        assert!(!c.get_loan_training("1".to_string()).unwrap().spent);
    }

    #[test]
    #[should_panic(expected = "Only a registered training app")]
    fn others_get_no_sample_keys() {
        let mut c = rented();
        as_app(
            "ed25519:DcA2MzgpJbrUATQLLceocVckhhAqrkingax4oJ9kZ847",
            "bob.near",
            NearToken::from_yoctonear(0),
            0,
        );
        let _ = c.request_sample_keys(ids(&["1"]), APP_KEY.to_string());
    }

    #[test]
    #[should_panic(expected = "Sample 2: rented for another app")]
    fn sample_keys_follow_the_loans_app() {
        let mut c = rented();
        ctx("bob.near", YOCTO);
        c.end_loan("2".to_string());
        ctx("admin.near", STORAGE);
        lend(&mut c, &["2"], 5, &["app-one", "app-two"]);
        ctx("bob.near", NearToken::from_yoctonear(100));
        c.borrow_many(ids(&["2"]), "app-two".to_string());
        as_app(APP_KEY_A, "trainer.near", NearToken::from_yoctonear(0), 0);
        let _ = c.request_sample_keys(ids(&["1", "2"]), APP_KEY.to_string());
    }

    #[test]
    #[should_panic(expected = "Only a registered training app")]
    fn the_keeper_gets_no_sample_keys_for_rentals() {
        let mut c = rented();
        ctx("keeper.near", NearToken::from_yoctonear(0));
        let _ = c.request_sample_keys(ids(&["1"]), APP_KEY.to_string());
    }

    #[test]
    #[should_panic(expected = "Only a registered training app")]
    fn the_admin_gets_no_sample_keys_for_rentals() {
        let mut c = rented();
        ctx("admin.near", NearToken::from_yoctonear(0));
        let _ = c.request_sample_keys(ids(&["1"]), APP_KEY.to_string());
    }

    #[test]
    #[should_panic(expected = "Sample 4: rental ended")]
    fn no_sample_keys_for_a_sample_nobody_rented() {
        let mut c = rented();
        as_app(APP_KEY_A, "trainer.near", NearToken::from_yoctonear(0), 0);
        let _ = c.request_sample_keys(ids(&["1", "4"]), APP_KEY.to_string());
    }

    #[test]
    #[should_panic(expected = "Sample 5 is not sealed yet")]
    fn no_sample_keys_before_the_sample_is_sealed() {
        let mut c = rented();
        ctx("admin.near", STORAGE);
        lend(&mut c, &["5"], 5, &["app-one"]);
        ctx("bob.near", NearToken::from_yoctonear(100));
        c.borrow_many(ids(&["5"]), "app-one".to_string());
        as_app(APP_KEY_A, "trainer.near", NearToken::from_yoctonear(0), 0);
        let _ = c.request_sample_keys(ids(&["5"]), APP_KEY.to_string());
    }

    #[test]
    fn record_training_spends_each_rental_and_lists_the_run() {
        let mut c = rented();
        assert_eq!(c.get_sample("1".to_string()).unwrap().runs, 0);
        let view = record(&mut c, "run-1", &["1", "2"]);
        assert_eq!(view.run_id, "run-1");
        assert_eq!(view.app_id, "app-one");
        assert_eq!(view.renter_id, acc("bob.near"));
        assert_eq!(view.model_sha256, SHA);
        assert_eq!(view.accuracy_bps, 9_250);
        assert_eq!(view.token_count, 2);
        assert_eq!(c.get_run("run-1".to_string()), Some(view));
        assert_eq!(c.get_run("run-2".to_string()), None);
        assert_eq!(
            c.get_run_tokens("run-1".to_string(), 0, 10),
            ids(&["1", "2"])
        );
        assert_eq!(c.get_run_tokens("run-1".to_string(), 1, 10), ids(&["2"]));
        assert_eq!(c.get_sample_runs("1".to_string()), ids(&["run-1"]));
        assert_eq!(c.get_sample_runs("3".to_string()), Vec::<String>::new());
        assert_eq!(c.get_sample("1".to_string()).unwrap().runs, 1);
        assert!(c.get_loan_training("1".to_string()).unwrap().spent);
        assert!(c.get_loan_training("2".to_string()).unwrap().spent);
        assert!(!c.get_loan_training("3".to_string()).unwrap().spent);
        let logs = get_logs();
        let event = logs
            .iter()
            .find(|l| l.contains("\"training_recorded\""))
            .expect("a training_recorded event");
        assert!(event.contains(r#""token_ids":["1","2"]"#), "{event}");
        assert!(event.contains(r#""renter_id":"bob.near""#), "{event}");
        // The storage is charged, and the rest refunded to the trainer.
        let refund: u128 = transfers(Some("trainer.near")).iter().sum();
        assert!(refund > 0 && refund < TRAINER_DEPOSIT.as_yoctonear());
    }

    #[test]
    #[should_panic(expected = "Sample 1: already used")]
    fn record_training_refuses_a_spent_rental() {
        let mut c = rented();
        record(&mut c, "run-1", &["1"]);
        record(&mut c, "run-2", &["1"]);
    }

    #[test]
    #[should_panic(expected = "Sample 1: rental ended")]
    fn record_training_refuses_an_ended_rental() {
        let mut c = rented();
        as_app(
            APP_KEY_A,
            "trainer.near",
            TRAINER_DEPOSIT,
            61 * 1_000_000_000,
        );
        c.record_training(
            "run-1".to_string(),
            acc("bob.near"),
            ids(&["1"]),
            SHA.to_string(),
            9_250,
        );
    }

    #[test]
    #[should_panic(expected = "Sample 2: rented by someone else")]
    fn record_training_names_the_renter() {
        let mut c = rented();
        as_app(APP_KEY_A, "trainer.near", TRAINER_DEPOSIT, 0);
        c.record_training(
            "run-1".to_string(),
            acc("carol.near"),
            ids(&["2"]),
            SHA.to_string(),
            9_250,
        );
    }

    #[test]
    #[should_panic(expected = "Sample 1: rented for another app")]
    fn another_app_cannot_record_the_rental() {
        let mut c = rented();
        as_app(APP_KEY_B, "trainer.near", TRAINER_DEPOSIT, 0);
        c.record_training(
            "run-1".to_string(),
            acc("bob.near"),
            ids(&["1"]),
            SHA.to_string(),
            9_250,
        );
    }

    #[test]
    #[should_panic(expected = "Only a registered training app")]
    fn only_an_app_records_training() {
        let mut c = rented();
        ctx("bob.near", TRAINER_DEPOSIT);
        c.record_training(
            "run-1".to_string(),
            acc("bob.near"),
            ids(&["1"]),
            SHA.to_string(),
            9_250,
        );
    }

    #[test]
    #[should_panic(expected = "Sample 1: already used")]
    fn no_sample_keys_after_the_rental_is_used() {
        let mut c = rented();
        record(&mut c, "run-1", &["1"]);
        as_app(APP_KEY_A, "trainer.near", NearToken::from_yoctonear(0), 0);
        let _ = c.request_sample_keys(ids(&["1"]), APP_KEY.to_string());
    }

    #[test]
    #[should_panic(expected = "Call this directly, not through another contract")]
    fn sample_keys_go_only_to_a_direct_call() {
        // The trainer signed a call to a renter's contract, which relays it.
        let mut c = rented();
        relayed(
            "relay.near",
            "trainer.near",
            Some(APP_KEY_A),
            NearToken::from_yoctonear(0),
        );
        let _ = c.request_sample_keys(ids(&["1"]), APP_KEY.to_string());
    }

    #[test]
    #[should_panic(expected = "Call this directly, not through another contract")]
    fn training_is_recorded_only_by_a_direct_call() {
        let mut c = rented();
        relayed(
            "relay.near",
            "trainer.near",
            Some(APP_KEY_A),
            TRAINER_DEPOSIT,
        );
        c.record_training(
            "run-1".to_string(),
            acc("bob.near"),
            ids(&["1"]),
            SHA.to_string(),
            9_250,
        );
    }

    #[test]
    fn a_used_rental_is_over() {
        let mut c = rented();
        record(&mut c, "run-1", &["1"]);
        ctx("anyone.near", NearToken::from_yoctonear(0));
        assert_eq!(
            c.get_loan("1".to_string()).unwrap().status,
            LoanStatus::Over
        );
        assert_eq!(
            c.get_loan("2".to_string()).unwrap().status,
            LoanStatus::Active
        );
    }

    #[test]
    fn a_used_sample_can_change_hands() {
        let mut c = rented();
        record(&mut c, "run-1", &["1"]);
        give(&mut c, "1", "carol.near");
        assert_eq!(
            c.get_sample("1".to_string()).unwrap().owner_id,
            acc("carol.near")
        );
        assert!(c.get_loan("1".to_string()).is_none());
    }

    #[test]
    #[should_panic(expected = "It's rented out")]
    fn an_unused_rental_still_holds_the_sample() {
        let mut c = rented();
        record(&mut c, "run-1", &["1"]);
        give(&mut c, "2", "carol.near");
    }

    #[test]
    fn anyone_clears_a_used_rental_and_the_lender_gets_the_storage() {
        let mut c = rented();
        record(&mut c, "run-1", &["1"]);
        ctx("carol.near", YOCTO);
        c.end_loan("1".to_string());
        assert!(c.get_loan("1".to_string()).is_none());
        assert!(c.get_loan_training("1".to_string()).is_none());
        let refunded = near_sdk::test_utils::get_created_receipts()
            .iter()
            .filter(|r| r.receiver_id == acc("admin.near"))
            .any(|r| {
                r.actions
                    .iter()
                    .any(|a| matches!(a, near_sdk::mock::MockAction::Transfer { .. }))
            });
        assert!(refunded);
    }

    #[test]
    fn a_used_rental_can_be_listed_again() {
        let mut c = rented();
        record(&mut c, "run-1", &["1"]);
        ctx("admin.near", STORAGE);
        assert_eq!(lend(&mut c, &["1"], 5, &["app-one"]), 1);
        assert_eq!(
            c.get_loan("1".to_string()).unwrap().status,
            LoanStatus::Offered
        );
        assert!(!c.get_loan_training("1".to_string()).unwrap().spent);
    }

    #[test]
    fn a_run_recorded_in_parts_adds_up() {
        let mut c = rented();
        record(&mut c, "run-1", &["1", "2"]);
        let view = record(&mut c, "run-1", &["3"]);
        assert_eq!(view.token_count, 3);
        assert_eq!(c.get_run("run-1".to_string()).unwrap().token_count, 3);
        assert_eq!(
            c.get_run_tokens("run-1".to_string(), 0, 100),
            ids(&["1", "2", "3"])
        );
        assert_eq!(c.get_sample_runs("3".to_string()), ids(&["run-1"]));
    }

    #[test]
    #[should_panic(expected = "Run run-1 was recorded for another app, renter, model or accuracy")]
    fn a_run_continues_only_with_the_same_model() {
        let mut c = rented();
        record(&mut c, "run-1", &["1"]);
        as_app(APP_KEY_A, "trainer.near", TRAINER_DEPOSIT, 0);
        c.record_training(
            "run-1".to_string(),
            acc("bob.near"),
            ids(&["2"]),
            "00".repeat(32),
            9_250,
        );
    }

    #[test]
    #[should_panic(expected = "Run run-1 was recorded for another app, renter, model or accuracy")]
    fn a_run_continues_only_with_the_same_accuracy() {
        let mut c = rented();
        record(&mut c, "run-1", &["1"]);
        as_app(APP_KEY_A, "trainer.near", TRAINER_DEPOSIT, 0);
        c.record_training(
            "run-1".to_string(),
            acc("bob.near"),
            ids(&["2"]),
            SHA.to_string(),
            9_000,
        );
    }

    #[test]
    #[should_panic(expected = "Run run-1 was recorded for another app, renter, model or accuracy")]
    fn a_run_continues_only_for_the_same_app() {
        let mut c = rented();
        record(&mut c, "run-1", &["1"]);
        // Bob rents sample 4 for app two, which then names app one's run.
        ctx("bob.near", NearToken::from_yoctonear(5));
        c.borrow_many(ids(&["4"]), "app-two".to_string());
        as_app(APP_KEY_B, "trainer.near", TRAINER_DEPOSIT, 0);
        c.record_training(
            "run-1".to_string(),
            acc("bob.near"),
            ids(&["4"]),
            SHA.to_string(),
            9_250,
        );
    }

    #[test]
    #[should_panic(expected = "Run run-1 was recorded for another app, renter, model or accuracy")]
    fn a_run_continues_only_for_the_same_renter() {
        let mut c = rented();
        record(&mut c, "run-1", &["1"]);
        // Carol rents sample 4 for the same app, which adds it to Bob's run.
        ctx("carol.near", NearToken::from_yoctonear(5));
        c.borrow_many(ids(&["4"]), "app-one".to_string());
        as_app(APP_KEY_A, "trainer.near", TRAINER_DEPOSIT, 0);
        c.record_training(
            "run-1".to_string(),
            acc("carol.near"),
            ids(&["4"]),
            SHA.to_string(),
            9_250,
        );
    }

    #[test]
    #[should_panic(expected = "Attach at least")]
    fn recording_pays_for_its_storage() {
        let mut c = rented();
        as_app(APP_KEY_A, "trainer.near", NearToken::from_yoctonear(0), 0);
        c.record_training(
            "run-1".to_string(),
            acc("bob.near"),
            ids(&["1"]),
            SHA.to_string(),
            9_250,
        );
    }

    fn record_with(run_id: &str, sha: &str, bps: u16) {
        let mut c = rented();
        as_app(APP_KEY_A, "trainer.near", TRAINER_DEPOSIT, 0);
        c.record_training(
            run_id.to_string(),
            acc("bob.near"),
            ids(&["1"]),
            sha.to_string(),
            bps,
        );
    }

    #[test]
    #[should_panic(expected = "run_id is 1 to 64")]
    fn a_run_id_is_lowercase() {
        record_with("Run_1", SHA, 1);
    }

    #[test]
    #[should_panic(expected = "run_id is 1 to 64")]
    fn a_run_id_is_short() {
        record_with(&"r".repeat(65), SHA, 1);
    }

    #[test]
    #[should_panic(expected = "model_sha256 is 64 hex")]
    fn a_model_hash_is_a_sha256() {
        record_with("run-1", "abc", 1);
    }

    #[test]
    #[should_panic(expected = "accuracy_bps is at most 10000")]
    fn accuracy_is_at_most_one() {
        record_with("run-1", SHA, 10_001);
    }

    #[test]
    fn fifty_sample_batches_fit_the_log_limit() {
        let owner = "a".repeat(64);
        let renter = "b".repeat(64);
        let apps: Vec<String> = "0123456789abcdef"[..8]
            .chars()
            .map(|ch| ch.to_string().repeat(64))
            .collect();
        let mut c = deploy_with(dataset(&["a", "b"], &[50, 50], 100));
        ctx("admin.near", NearToken::from_millinear(10));
        for (i, app) in apps.iter().enumerate() {
            let key = near_sdk::PublicKey::from_parts(
                near_sdk::CurveType::ED25519,
                vec![i as u8 + 1; 32],
            )
            .unwrap();
            c.trust_app_key(key, app.clone(), "App".to_string());
        }
        ctx("admin.near", YOCTO);
        for i in 1..=50 {
            c.nft_transfer(acc(&owner), i.to_string(), None, None);
        }
        let all: Vec<String> = (1..=50).map(|i| i.to_string()).collect();
        ctx(&owner, NearToken::from_near(5));
        c.lend_many(
            all.clone(),
            Some(86_400.into()),
            NearToken::from_millinear(10),
            apps.clone(),
        );
        let bytes: usize = get_logs().iter().map(|l| l.len()).sum();
        assert!(bytes < 16_384, "lend_many logged {bytes} bytes");
        ctx(&renter, NearToken::from_near(5));
        c.borrow_many(all, apps[0].clone());
        let bytes: usize = get_logs().iter().map(|l| l.len()).sum();
        assert!(bytes < 16_384, "borrow_many logged {bytes} bytes");
    }
}
