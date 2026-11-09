use near_sdk::json_types::Base58CryptoHash;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, NearToken, PromiseError};

use crate::{CollectionArgs, LaunchArgs, Launchpad, TeeRequirement};

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(predecessor: &str, deposit: NearToken) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc("launch.near"))
        .predecessor_account_id(acc(predecessor))
        .attached_deposit(deposit)
        .build());
}

const FEE: NearToken = NearToken::from_near(1);
const FUNDING: NearToken = NearToken::from_near(2);
const YOCTO: NearToken = NearToken::from_yoctonear(1);

fn code_hash() -> Base58CryptoHash {
    [7u8; 32].into()
}

fn deploy() -> Launchpad {
    ctx("admin.near", NearToken::from_yoctonear(0));
    let mut l = Launchpad::new(acc("admin.near"), acc("keeper.near"), FEE, FUNDING);
    ctx("admin.near", YOCTO);
    l.set_collection_code_hash(code_hash());
    ctx("admin.near", YOCTO);
    l.set_key_source(Some(crate::KeySource {
        mpc_contract_id: acc("v1.signer"),
        domain_id: 2,
    }));
    l
}

fn args(slug: &str) -> LaunchArgs {
    LaunchArgs {
        slug: slug.to_string(),
        mint_price: NearToken::from_near(1),
        collection: CollectionArgs {
            name: "Magister".to_string(),
            symbol: "LAT".to_string(),
            base_uri: String::new(),
            prompt: "You are {name} #{token_id}, a patient Latin tutor.".to_string(),
            starter: "Your student has not told you anything yet.".to_string(),
            max_supply: None,
            tee: None,
            media_extension: String::new(),
            terms: None,
            sealed_prompt: None,
            history_import: false,
            kind: None,
            class_counts: Vec::new(),
            initial_supply: None,
        },
        keeper_id: None,
    }
}

fn launch(l: &mut Launchpad, creator: &str, slug: &str) {
    ctx(creator, NearToken::from_near(3));
    let _ = l.launch(args(slug));
}

#[test]
fn launch_holds_the_name_until_the_collection_is_live() {
    let mut l = deploy();
    launch(&mut l, "alice.near", "magister");
    let listed = l.get_collections(None, None);
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].account_id, acc("magister.launch.near"));
    assert_eq!(listed[0].creator_id, acc("alice.near"));
    assert!(!listed[0].live);
    // Fees are only kept once the launch has worked.
    assert!(l.get_config().fees_accrued.is_zero());
}

#[test]
fn a_successful_launch_goes_live_and_keeps_the_fee() {
    let mut l = deploy();
    launch(&mut l, "alice.near", "magister");
    ctx("launch.near", NearToken::from_yoctonear(0));
    assert!(l.on_launched(
        acc("magister.launch.near"),
        acc("alice.near"),
        NearToken::from_near(3),
        Ok(())
    ));
    assert!(l.get_collection(acc("magister.launch.near")).unwrap().live);
    assert_eq!(l.get_config().fees_accrued, FEE);
}

#[test]
fn a_failed_launch_frees_the_name() {
    let mut l = deploy();
    launch(&mut l, "alice.near", "magister");
    ctx("launch.near", NearToken::from_yoctonear(0));
    assert!(!l.on_launched(
        acc("magister.launch.near"),
        acc("alice.near"),
        NearToken::from_near(3),
        Err(PromiseError::Failed)
    ));
    assert!(l.get_collection(acc("magister.launch.near")).is_none());
    assert!(l.get_config().fees_accrued.is_zero());
    // Someone else can now take it.
    launch(&mut l, "bob.near", "magister");
    assert_eq!(
        l.get_collection(acc("magister.launch.near"))
            .unwrap()
            .creator_id,
        acc("bob.near")
    );
}

#[test]
#[should_panic(expected = "That name is taken")]
fn launch_rejects_a_taken_name() {
    let mut l = deploy();
    launch(&mut l, "alice.near", "magister");
    launch(&mut l, "bob.near", "magister");
}

#[test]
#[should_panic(expected = "Deposit too low")]
fn launch_requires_fee_and_funding() {
    let mut l = deploy();
    ctx("alice.near", FEE);
    let _ = l.launch(args("magister"));
}

#[test]
#[should_panic(expected = "Launching is not open yet")]
fn launch_waits_for_the_code_hash() {
    ctx("admin.near", NearToken::from_yoctonear(0));
    let mut l = Launchpad::new(acc("admin.near"), acc("keeper.near"), FEE, FUNDING);
    launch(&mut l, "alice.near", "magister");
}

#[test]
fn slugs_must_be_plain_names() {
    let l = deploy();
    for bad in [
        "",
        "Caps",
        "under_score",
        "-lead",
        "trail-",
        "two--hyphens",
        "a.b",
    ] {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            l.collection_account(&bad.to_string())
        }));
        assert!(result.is_err(), "{bad:?} should be rejected");
    }
    assert_eq!(
        l.collection_account(&"latin-tutor-2".to_string()),
        acc("latin-tutor-2.launch.near")
    );
}

#[test]
#[should_panic(expected = "That name is reserved")]
fn reserved_names_cannot_be_launched() {
    let mut l = deploy();
    ctx("admin.near", YOCTO);
    l.reserve(vec!["nearkat".to_string()]);
    launch(&mut l, "alice.near", "nearkat");
}

#[test]
#[should_panic(expected = "name and symbol must not be empty")]
fn launch_rejects_an_empty_name() {
    let mut l = deploy();
    ctx("alice.near", NearToken::from_near(3));
    let mut a = args("magister");
    a.collection.name = " ".to_string();
    let _ = l.launch(a);
}

#[test]
fn launch_args_carry_a_tee_requirement_through_to_the_collection() {
    let mut a = args("magister");
    a.collection.tee = Some(TeeRequirement::Phala {
        app_id: "0a1b2c".to_string(),
    });
    let json = near_sdk::serde_json::to_value(&a.collection).unwrap();
    // The same shape the collection contract's `new` takes.
    assert_eq!(json["tee"]["Phala"]["app_id"], "0a1b2c");
}

#[test]
#[should_panic(expected = "Only the admin can call this method")]
fn only_the_admin_sets_the_code_hash() {
    let mut l = deploy();
    ctx("alice.near", YOCTO);
    l.set_collection_code_hash(code_hash());
}

#[test]
fn withdraw_fees_zeroes_what_was_kept() {
    let mut l = deploy();
    launch(&mut l, "alice.near", "magister");
    ctx("launch.near", NearToken::from_yoctonear(0));
    l.on_launched(
        acc("magister.launch.near"),
        acc("alice.near"),
        NearToken::from_near(3),
        Ok(()),
    );
    ctx("admin.near", YOCTO);
    let _ = l.withdraw_fees();
    assert!(l.get_config().fees_accrued.is_zero());
}

#[test]
fn the_launch_version_is_approved_for_upgrades() {
    let l = deploy();
    assert!(l.is_code_approved(code_hash()));
    assert!(!l.is_code_approved([8u8; 32].into()));
}

#[test]
fn the_admin_approves_and_revokes_other_versions() {
    let mut l = deploy();
    ctx("admin.near", YOCTO);
    l.approve_code_hash([8u8; 32].into());
    assert!(l.is_code_approved([8u8; 32].into()));
    assert_eq!(l.get_approved_code_hashes().len(), 2);
    l.revoke_code_hash([8u8; 32].into());
    assert!(!l.is_code_approved([8u8; 32].into()));
}

#[test]
#[should_panic(expected = "can't be revoked")]
fn the_launch_version_cant_be_revoked() {
    let mut l = deploy();
    ctx("admin.near", YOCTO);
    l.revoke_code_hash(code_hash());
}

#[test]
fn a_collection_records_its_upgrade() {
    let mut l = deploy();
    launch(&mut l, "alice.near", "magister");
    ctx("admin.near", YOCTO);
    l.approve_code_hash([8u8; 32].into());
    ctx("magister.launch.near", NearToken::from_yoctonear(0));
    l.record_upgrade([8u8; 32].into());
    assert_eq!(
        l.get_collection(acc("magister.launch.near"))
            .unwrap()
            .code_hash,
        Base58CryptoHash::from([8u8; 32])
    );
}

#[test]
#[should_panic(expected = "Not a collection from this launchpad")]
fn only_collections_record_upgrades() {
    let mut l = deploy();
    ctx("mallory.near", NearToken::from_yoctonear(0));
    l.record_upgrade(code_hash());
}

#[test]
#[should_panic(expected = "That version is not approved")]
fn unapproved_upgrades_are_not_recorded() {
    let mut l = deploy();
    launch(&mut l, "alice.near", "magister");
    ctx("magister.launch.near", NearToken::from_yoctonear(0));
    l.record_upgrade([9u8; 32].into());
}

#[test]
fn launches_carry_the_launchpads_key_source_not_the_creators() {
    let source = crate::KeySource {
        mpc_contract_id: acc("v1.signer"),
        domain_id: 2,
    };
    let collection = args("magister").collection;
    let value = crate::with_key_source(&collection, &source, Some([5u8; 32]));
    assert_eq!(value["key_source"]["mpc_contract_id"], "v1.signer");
    assert_eq!(value["key_source"]["domain_id"], 2);
    // The wallet code goes to its own field, which the collection reads.
    assert_eq!(
        value["wallet_code_hash"],
        near_sdk::serde_json::to_value(Base58CryptoHash::from([5u8; 32])).unwrap()
    );
    // A creator who tries to name their own is ignored: the field isn't theirs to send.
    let sneaky: crate::CollectionArgs =
        near_sdk::serde_json::from_value(near_sdk::serde_json::json!({
            "name": "X", "symbol": "X", "prompt": "p", "starter": "s",
            "key_source": { "mpc_contract_id": "evil.near", "domain_id": 9 },
        }))
        .unwrap();
    assert_eq!(
        crate::with_key_source(&sneaky, &source, None)["key_source"]["mpc_contract_id"],
        "v1.signer"
    );
}

#[test]
#[should_panic(expected = "Launching is not open yet: no key source")]
fn launching_needs_a_key_source() {
    let mut l = deploy();
    ctx("admin.near", YOCTO);
    l.set_key_source(None);
    ctx("creator.near", FEE.saturating_add(FUNDING));
    let _ = l.launch(args("magister"));
}

#[test]
fn the_admin_sets_the_key_source() {
    let mut l = deploy();
    ctx("admin.near", YOCTO);
    l.set_key_source(Some(crate::KeySource {
        mpc_contract_id: acc("v1.signer"),
        domain_id: 2,
    }));
    assert_eq!(l.get_config().key_source.unwrap().domain_id, 2);
}

#[test]
fn migrating_from_before_wallets_keeps_everything_and_adds_no_wallets() {
    let mut l = deploy();
    ctx("creator.near", FEE.saturating_add(FUNDING));
    let _ = l.launch(args("magister"));
    l.collections.flush();
    // Written as the version before wallets stored it.
    let old = crate::LaunchpadV1 {
        admin_id: l.admin_id.clone(),
        keeper_id: l.keeper_id.clone(),
        collection_code_hash: l.collection_code_hash,
        launch_fee: l.launch_fee,
        collection_funding: l.collection_funding,
        fees_accrued: l.fees_accrued,
        collections: l.collections,
        reserved: l.reserved,
        approved: l.approved,
        key_source: Some(crate::KeySource {
            mpc_contract_id: acc("v1.signer"),
            domain_id: 2,
        }),
    };
    near_sdk::env::state_write(&old);
    let migrated = Launchpad::migrate();
    let config = migrated.get_config();
    assert_eq!(config.key_source.unwrap().domain_id, 2);
    assert_eq!(config.wallet_code_hash, None);
    assert!(migrated
        .get_collection(acc("magister.launch.near"))
        .is_some());
}

#[test]
fn launch_passes_dataset_fields_through() {
    let source = crate::KeySource {
        mpc_contract_id: acc("v1.signer"),
        domain_id: 2,
    };
    let mut collection = args("hotdogs").collection;
    collection.kind = Some(near_sdk::serde_json::json!({
        "Dataset": { "classes": ["hotdog", "not_hotdog"] }
    }));
    collection.class_counts = vec![3.into(), 2.into()];
    collection.initial_supply = Some(5.into());
    let value = crate::with_key_source(&collection, &source, None);
    assert_eq!(
        value["kind"]["Dataset"]["classes"],
        near_sdk::serde_json::json!(["hotdog", "not_hotdog"])
    );
    assert_eq!(
        value["class_counts"],
        near_sdk::serde_json::json!(["3", "2"])
    );
    assert_eq!(value["initial_supply"], "5");
    // A character launch sends none of them.
    let plain = crate::with_key_source(&args("magister").collection, &source, None);
    assert!(plain.get("kind").is_none() && plain.get("initial_supply").is_none());
}
