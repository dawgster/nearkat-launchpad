use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, NearToken, PublicKey};
use sha2::{Digest, Sha384};

use crate::attestation::{
    check_registration, event_digest, expected_report_data, measured_app_id, verify_quote,
    DstackEvent, VerifiedTd,
};
use crate::{Collection, Contract, TeeRequirement};

const INTEL_QUOTE: &[u8] = include_bytes!("../tests/fixtures/intel-tdx-quote.bin");
const INTEL_COLLATERAL: &str = include_str!("../tests/fixtures/intel-tdx-collateral.json");
const DSTACK_REPORT: &str = include_str!("../tests/fixtures/dstack-quote-report.json");
/// The app the dstack fixture's CVM ran as.
const DSTACK_APP: &str = "3763bc34552cf3a27ff71ad5f7a90471562a1a2d";
/// 2026-10-20, inside the Intel fixture's collateral validity.
const VALID_NOW: u64 = 1_792_454_400;
const KEY: &str = "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp";
const SEAL: &str = "11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa";

fn dstack() -> (Vec<DstackEvent>, [u8; 48], String) {
    let report: near_sdk::serde_json::Value =
        near_sdk::serde_json::from_str(DSTACK_REPORT).unwrap();
    let log = report["event_log"].as_str().unwrap().to_string();
    let quote = hex::decode(report["quote"].as_str().unwrap()).unwrap();
    let parsed = dcap_qvl::quote::Quote::parse(&quote).unwrap();
    let rtmr3 = parsed.report.as_td10().unwrap().rt_mr3;
    (near_sdk::serde_json::from_str(&log).unwrap(), rtmr3, log)
}

#[test]
fn verifies_a_real_quote_against_intels_collateral() {
    let td = verify_quote(INTEL_QUOTE, INTEL_COLLATERAL, VALID_NOW).unwrap();
    assert!(!td.status.is_empty());
}

#[test]
fn refuses_a_quote_once_its_collateral_has_expired() {
    // 2026-12-01: the TCB info's next update was due on 2026-11-07.
    let error = verify_quote(INTEL_QUOTE, INTEL_COLLATERAL, 1_796_083_200)
        .err()
        .unwrap();
    assert!(error.contains("quote verification failed"), "{error}");
}

#[test]
fn refuses_a_tampered_quote() {
    let mut quote = INTEL_QUOTE.to_vec();
    // A byte inside the TD report, which the quoting enclave signed.
    quote[48 + 520] ^= 1;
    assert!(verify_quote(&quote, INTEL_COLLATERAL, VALID_NOW).is_err());
}

#[test]
fn reads_the_app_id_from_a_real_dstack_event_log() {
    let (events, rtmr3, _) = dstack();
    assert_eq!(measured_app_id(&events, &rtmr3).unwrap(), DSTACK_APP);
}

#[test]
fn refuses_an_event_log_that_does_not_replay_to_the_quote() {
    let (events, mut rtmr3, _) = dstack();
    rtmr3[0] ^= 1;
    let error = measured_app_id(&events, &rtmr3).unwrap_err();
    assert!(error.contains("does not match the quote's RTMR3"));
}

#[test]
fn refuses_an_app_id_whose_payload_was_swapped() {
    let (mut events, rtmr3, _) = dstack();
    let app = events.iter_mut().find(|e| e.event == "app-id").unwrap();
    // The digest still replays, but no longer matches the payload.
    app.event_payload = "ff".repeat(20);
    let error = measured_app_id(&events, &rtmr3).unwrap_err();
    assert!(error.contains("does not match its digest"));
}

#[test]
fn computes_dstack_v2_digests_over_canonical_json() {
    // The vector from dstack's own test of v2 events.
    let event = DstackEvent {
        imr: 3,
        event_type: 0x0800_0001,
        digest: String::new(),
        event: "compose-hash".to_string(),
        event_payload: "abcd".to_string(),
        version: Some(2),
    };
    let expected: [u8; 48] =
        Sha384::digest(br#"{"name":"compose-hash","payload":"abcd","type":134217729}"#).into();
    assert_eq!(event_digest(&event).unwrap(), expected);
}

fn td(status: &str, key: &str) -> VerifiedTd {
    let (_, rtmr3, _) = dstack();
    VerifiedTd {
        status: status.to_string(),
        rtmr3,
        report_data: expected_report_data(key, SEAL),
    }
}

#[test]
fn accepts_a_quote_for_this_key_from_the_required_app() {
    let (_, _, log) = dstack();
    check_registration(DSTACK_APP, KEY, SEAL, &td("UpToDate", KEY), &log).unwrap();
}

#[test]
fn refuses_a_quote_made_for_another_key() {
    let (_, _, log) = dstack();
    let error = check_registration(
        DSTACK_APP,
        KEY,
        SEAL,
        &td("UpToDate", "ed25519:other"),
        &log,
    )
    .unwrap_err();
    assert!(error.contains("does not commit to these keys"));
}

#[test]
fn refuses_a_quote_made_for_another_sealing_key() {
    let (_, _, log) = dstack();
    let other_seal = "22".repeat(32);
    let error =
        check_registration(DSTACK_APP, KEY, &other_seal, &td("UpToDate", KEY), &log).unwrap_err();
    assert!(error.contains("does not commit to these keys"));
}

#[test]
fn refuses_a_quote_from_another_app() {
    let (_, _, log) = dstack();
    let error = check_registration("0a1b2c", KEY, SEAL, &td("UpToDate", KEY), &log).unwrap_err();
    assert!(error.contains(&format!("from app {DSTACK_APP}")));
}

#[test]
fn refuses_out_of_date_and_revoked_platforms() {
    let (_, _, log) = dstack();
    for status in ["OutOfDate", "Revoked", "OutOfDateConfigurationNeeded"] {
        assert!(check_registration(DSTACK_APP, KEY, SEAL, &td(status, KEY), &log).is_err());
    }
}

// The contract's side: who may write contexts.

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn key(s: &str) -> PublicKey {
    s.parse().unwrap()
}

fn ctx(predecessor: &str, signer_pk: &str, deposit: NearToken) {
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id(acc(predecessor))
        .signer_account_id(acc(predecessor))
        .signer_account_pk(key(signer_pk))
        .attached_deposit(deposit)
        .build());
}

const OPERATOR_KEY: &str = "ed25519:4eUKxcVz6kQgHHvJDY2jkm6mYwSj8b8N3pHn1dQd8Z8C";

fn tee_collection() -> Contract {
    ctx("admin.near", OPERATOR_KEY, NearToken::from_yoctonear(0));
    let mut c = Contract::new(
        acc("admin.near"),
        acc("keeper.near"),
        acc("admin.near"),
        NearToken::from_near(1),
        Collection {
            name: "Magister".to_string(),
            symbol: "LAT".to_string(),
            base_uri: String::new(),
            prompt: String::new(),
            starter: String::new(),
            max_supply: None,
            tee: Some(TeeRequirement::Phala {
                app_id: DSTACK_APP.to_string(),
            }),
            media_extension: String::new(),
            terms: crate::Terms::default(),
            sealed_prompt: None,
            key_source: crate::tests::mpc_source(),
            wallet_code_hash: None,
            history_import: false,
            kind: crate::CollectionKind::Character,
            class_counts: Vec::new(),
            initial_supply: None,
        },
        None,
    );
    ctx("alice.near", OPERATOR_KEY, NearToken::from_near(2));
    c.mint();
    c
}

fn attested() -> crate::attestation::AttestedKey {
    crate::attestation::AttestedKey {
        attested_at: 0,
        seal_public_key: SEAL.to_string(),
    }
}

fn set_context(c: &mut Contract) {
    c.set_context(
        "1".to_string(),
        vec![7u8; 32].into(),
        "ref".to_string(),
        1.into(),
        1,
    );
}

#[test]
#[should_panic(expected = "only accepts keeper calls signed by an attested key")]
fn a_tee_collection_refuses_the_keeper_account_signing_with_another_key() {
    let mut c = tee_collection();
    ctx("keeper.near", OPERATOR_KEY, NearToken::from_yoctonear(0));
    set_context(&mut c);
}

#[test]
fn a_tee_collection_accepts_the_keeper_signing_with_an_attested_key() {
    let mut c = tee_collection();
    c.attested_keys.insert(key(KEY), attested());
    ctx("keeper.near", KEY, NearToken::from_yoctonear(0));
    set_context(&mut c);
    assert!(c.is_keeper_key_attested(key(KEY)));
    assert!(!c.is_keeper_key_attested(key(OPERATOR_KEY)));
}

#[test]
#[should_panic(expected = "only accepts keeper calls signed by an attested key")]
fn a_tee_collection_refuses_debits_signed_with_another_key() {
    let mut c = tee_collection();
    ctx("keeper.near", OPERATOR_KEY, NearToken::from_yoctonear(0));
    c.debit_batch(
        1.into(),
        vec![("1".to_string(), NearToken::from_millinear(1))],
    );
}

#[test]
fn the_admin_can_revoke_an_attested_key() {
    let mut c = tee_collection();
    c.attested_keys.insert(key(KEY), attested());
    ctx("admin.near", OPERATOR_KEY, NearToken::from_yoctonear(1));
    c.revoke_keeper_key(key(KEY));
    assert!(!c.is_keeper_key_attested(key(KEY)));
}

#[test]
#[should_panic(expected = "This collection has no TEE requirement")]
fn registration_needs_a_tee_requirement() {
    ctx("admin.near", OPERATOR_KEY, NearToken::from_yoctonear(0));
    let mut c = Contract::new(
        acc("admin.near"),
        acc("keeper.near"),
        acc("admin.near"),
        NearToken::from_near(1),
        Collection {
            name: "Nearkat".to_string(),
            symbol: "KAT".to_string(),
            base_uri: String::new(),
            prompt: String::new(),
            starter: String::new(),
            max_supply: None,
            tee: None,
            media_extension: String::new(),
            terms: crate::Terms::default(),
            sealed_prompt: None,
            key_source: crate::tests::mpc_source(),
            wallet_code_hash: None,
            history_import: false,
            kind: crate::CollectionKind::Character,
            class_counts: Vec::new(),
            initial_supply: None,
        },
        None,
    );
    c.register_keeper_key(
        key(KEY),
        SEAL.to_string(),
        String::new(),
        String::new(),
        String::new(),
    );
}

#[test]
#[should_panic(expected = "quote verification failed")]
fn registration_runs_the_quote_through_intels_checks() {
    let mut c = tee_collection();
    // The real quote is from a different app; it is refused before that is
    // even checked, because the block time here is outside its collateral.
    ctx("anyone.near", OPERATOR_KEY, NearToken::from_yoctonear(0));
    c.register_keeper_key(
        key(KEY),
        SEAL.to_string(),
        hex::encode(INTEL_QUOTE),
        INTEL_COLLATERAL.to_string(),
        "[]".to_string(),
    );
}

#[test]
fn an_app_key_registers_under_the_app_its_quote_measures() {
    // The recorded fixtures are not one matching quote and collateral set, so
    // the quote's checks run here on the dstack fixture's TD data, then the
    // contract stores the app id the event log measured.
    let (_, _, log) = dstack();
    let app =
        crate::attestation::check_app_registration(KEY, SEAL, &td("UpToDate", KEY), &log).unwrap();
    assert_eq!(app, DSTACK_APP);
    let mut c = tee_collection();
    ctx("anyone.near", OPERATOR_KEY, NearToken::from_near(1));
    let entry = crate::apps::AppKey {
        app_id: app,
        label: "trainer".to_string(),
        seal_public_key: SEAL.to_string(),
        attested_at: 0,
        trusted_by_admin: false,
    };
    c.store_app_key(key(KEY), entry, NearToken::from_yoctonear(0));
    let stored = c.get_app_key(key(KEY)).unwrap();
    assert_eq!(stored.app_id, DSTACK_APP);
    assert!(!stored.trusted_by_admin);
    assert_eq!(
        c.training_apps(),
        vec![(DSTACK_APP.to_string(), "trainer".to_string())]
    );
}

#[test]
fn an_app_key_with_the_wrong_report_data_is_refused() {
    let (_, _, log) = dstack();
    let error = crate::attestation::check_app_registration(
        KEY,
        SEAL,
        &td("UpToDate", "ed25519:other"),
        &log,
    )
    .unwrap_err();
    assert!(error.contains("does not commit to these keys"));
}

#[test]
#[should_panic(expected = "Sign the registration with the key being registered")]
fn an_app_key_must_be_registered_by_its_own_signer() {
    let mut c = tee_collection();
    ctx("anyone.near", OPERATOR_KEY, NearToken::from_near(1));
    c.register_app_key(
        key(KEY),
        SEAL.to_string(),
        "trainer".to_string(),
        String::new(),
        String::new(),
        String::new(),
    );
}

#[test]
#[should_panic(expected = "quote verification failed")]
fn register_app_key_passes_proof_of_possession_then_checks_the_quote() {
    let mut c = tee_collection();
    ctx("anyone.near", KEY, NearToken::from_near(1));
    c.register_app_key(
        key(KEY),
        SEAL.to_string(),
        "trainer".to_string(),
        hex::encode(INTEL_QUOTE),
        INTEL_COLLATERAL.to_string(),
        "[]".to_string(),
    );
}

fn entry(app: &str, label: &str) -> crate::apps::AppKey {
    crate::apps::AppKey {
        app_id: app.to_string(),
        label: label.to_string(),
        seal_public_key: SEAL.to_string(),
        attested_at: 0,
        trusted_by_admin: false,
    }
}

#[test]
#[should_panic(expected = "This key is registered to another app")]
fn a_key_cannot_move_to_another_app() {
    let mut c = tee_collection();
    ctx("anyone.near", KEY, NearToken::from_near(1));
    c.store_app_key(key(KEY), entry("app-x", "x"), NearToken::from_yoctonear(0));
    c.store_app_key(key(KEY), entry("app-y", "y"), NearToken::from_yoctonear(0));
}

#[test]
fn a_key_can_be_re_registered_by_its_own_app() {
    let mut c = tee_collection();
    ctx("anyone.near", KEY, NearToken::from_near(1));
    c.store_app_key(
        key(KEY),
        entry("app-x", "old"),
        NearToken::from_yoctonear(0),
    );
    c.store_app_key(
        key(KEY),
        entry("app-x", "new"),
        NearToken::from_yoctonear(0),
    );
    assert_eq!(c.get_app_key(key(KEY)).unwrap().label, "new");
    assert_eq!(
        c.training_apps(),
        vec![("app-x".to_string(), "new".to_string())]
    );
}
