//! On-chain proof that a keeper key lives inside the Phala app a collection
//! requires. A collection with a `tee` requirement only accepts keeper calls
//! signed by a key registered here, so the operator of the keeper account
//! cannot write contexts with any other key it holds.
//!
//! A registration carries a TDX quote, Intel's collateral for it, and dstack's
//! event log. The contract checks that:
//! 1. the quote verifies against Intel's root of trust at the current time,
//!    with an acceptable TCB status and no debug TD;
//! 2. its report data commits to the key being registered;
//! 3. the event log replays to the quote's RTMR3, and the `app-id` event in it
//!    names the app the collection requires.

use near_sdk::serde::Deserialize;
use near_sdk::{env, near, require, PublicKey};
use sha2::{Digest, Sha256, Sha384};

use crate::{Contract, ContractExt, TeeRequirement};

/// dstack's event type for its runtime events.
const DSTACK_RUNTIME_EVENT_TYPE: u32 = 0x0800_0001;
/// The label the keeper hashes with its key into the quote's report data.
const REPORT_DATA_LABEL: &str = "nearkat-keeper:v1:";
/// TCB statuses a platform may have and still be trusted. Out-of-date and
/// revoked platforms are refused.
const ACCEPTED_STATUSES: [&str; 4] = [
    "UpToDate",
    "SWHardeningNeeded",
    "ConfigurationNeeded",
    "ConfigurationAndSWHardeningNeeded",
];

/// One entry of dstack's event log, as its guest agent returns it.
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct DstackEvent {
    pub imr: u32,
    pub event_type: u32,
    pub digest: String,
    pub event: String,
    #[serde(default)]
    pub event_payload: String,
    /// 1 (binary digest) when absent, or 2 (canonical JSON digest).
    #[serde(default)]
    pub version: Option<u32>,
}

/// The report data a keeper's quote must carry for `public_key`:
/// SHA-256 of the label and the key, then 32 zero bytes.
pub fn expected_report_data(public_key: &str) -> [u8; 64] {
    let mut data = [0u8; 64];
    let digest = Sha256::digest(format!("{REPORT_DATA_LABEL}{public_key}").as_bytes());
    data[..32].copy_from_slice(&digest);
    data
}

/// The digest dstack records for one of its runtime events.
pub fn event_digest(event: &DstackEvent) -> Result<[u8; 48], String> {
    let payload = hex::decode(&event.event_payload).map_err(|_| "event payload is not hex")?;
    let preimage = match event.version.unwrap_or(1) {
        1 => {
            let mut buf = Vec::with_capacity(6 + event.event.len() + payload.len());
            buf.extend_from_slice(&DSTACK_RUNTIME_EVENT_TYPE.to_le_bytes());
            buf.push(b':');
            buf.extend_from_slice(event.event.as_bytes());
            buf.push(b':');
            buf.extend_from_slice(&payload);
            buf
        }
        // RFC 8785 canonical JSON: keys sorted, no whitespace.
        2 => format!(
            "{{\"name\":{},\"payload\":\"{}\",\"type\":{}}}",
            near_sdk::serde_json::to_string(&event.event).map_err(|e| e.to_string())?,
            hex::encode(&payload),
            DSTACK_RUNTIME_EVENT_TYPE
        )
        .into_bytes(),
        other => return Err(format!("unknown event log version {other}")),
    };
    Ok(Sha384::digest(&preimage).into())
}

/// Replays RTMR3 from the event log and returns the app id it records.
/// Fails if the log does not reproduce `rtmr3`, or its `app-id` event is
/// missing or does not match its own digest.
pub fn measured_app_id(events: &[DstackEvent], rtmr3: &[u8; 48]) -> Result<String, String> {
    let mut mr = [0u8; 48];
    let mut app_id = None;
    for event in events.iter().filter(|e| e.imr == 3) {
        let digest = hex::decode(&event.digest).map_err(|_| "event digest is not hex")?;
        let mut padded = [0u8; 48];
        let len = digest.len().min(48);
        padded[..len].copy_from_slice(&digest[..len]);
        let mut hasher = Sha384::new();
        hasher.update(mr);
        hasher.update(padded);
        mr = hasher.finalize().into();
        if event.event == "app-id" && event.event_type == DSTACK_RUNTIME_EVENT_TYPE {
            if event_digest(event)? != padded {
                return Err("the app-id event does not match its digest".to_string());
            }
            app_id = Some(event.event_payload.to_lowercase());
        }
    }
    if &mr != rtmr3 {
        return Err("the event log does not match the quote's RTMR3".to_string());
    }
    app_id.ok_or_else(|| "the event log has no app-id event".to_string())
}

/// What the quote attests, once Intel's signatures and collateral check out.
pub struct VerifiedTd {
    pub status: String,
    pub rtmr3: [u8; 48],
    pub report_data: [u8; 64],
}

pub fn verify_quote(
    quote: &[u8],
    collateral_json: &str,
    now_secs: u64,
) -> Result<VerifiedTd, String> {
    let collateral: dcap_qvl::QuoteCollateralV3 =
        near_sdk::serde_json::from_str(collateral_json)
            .map_err(|e| format!("collateral is not valid: {e}"))?;
    let verified = dcap_qvl::verify::verify(quote, &collateral, now_secs)
        .map_err(|e| format!("quote verification failed: {e}"))?;
    let td = verified
        .report
        .as_td10()
        .ok_or("the quote is not from a TDX trust domain")?;
    Ok(VerifiedTd {
        status: verified.status,
        rtmr3: td.rt_mr3,
        report_data: td.report_data,
    })
}

/// Runs every check for registering `public_key` under `app_id`.
pub fn check_registration(
    app_id: &str,
    public_key: &str,
    td: &VerifiedTd,
    event_log_json: &str,
) -> Result<(), String> {
    if !ACCEPTED_STATUSES.contains(&td.status.as_str()) {
        return Err(format!("platform TCB status {} is not accepted", td.status));
    }
    if td.report_data != expected_report_data(public_key) {
        return Err("the quote's report data does not commit to this key".to_string());
    }
    let events: Vec<DstackEvent> = near_sdk::serde_json::from_str(event_log_json)
        .map_err(|e| format!("event log is not valid: {e}"))?;
    let measured = measured_app_id(&events, &td.rtmr3)?;
    if measured != app_id.to_lowercase() {
        return Err(format!("the quote is from app {measured}, not {app_id}"));
    }
    Ok(())
}

#[near]
impl Contract {
    /// Registers a keeper key proven to live inside the Phala app this
    /// collection requires. Anyone may submit: only that app can produce a
    /// quote that passes. `quote` is hex; `collateral` is dcap-qvl's
    /// `QuoteCollateralV3` as JSON; `event_log` is dstack's event log JSON.
    pub fn register_keeper_key(
        &mut self,
        public_key: PublicKey,
        quote: String,
        collateral: String,
        event_log: String,
    ) {
        let Some(TeeRequirement::Phala { app_id }) = self.tee.clone() else {
            env::panic_str("This collection has no TEE requirement");
        };
        let quote = hex::decode(quote.trim_start_matches("0x"))
            .unwrap_or_else(|_| env::panic_str("quote must be hex"));
        let now_secs = env::block_timestamp() / 1_000_000_000;
        let key = String::from(&public_key);
        let result = verify_quote(&quote, &collateral, now_secs)
            .and_then(|td| check_registration(&app_id, &key, &td, &event_log));
        if let Err(problem) = result {
            env::panic_str(&problem);
        }
        self.attested_keys
            .insert(public_key, env::block_timestamp());
    }

    /// Whether a key has been proven to live inside the required app.
    pub fn is_keeper_key_attested(&self, public_key: PublicKey) -> bool {
        self.attested_keys.contains_key(&public_key)
    }

    /// Removes an attested key, for example one whose platform has since been
    /// found vulnerable. Admin only. It can only stop a keeper, never let one in.
    #[payable]
    pub fn revoke_keeper_key(&mut self, public_key: PublicKey) {
        self.assert_admin();
        self.attested_keys.remove(&public_key);
    }
}

impl Contract {
    /// For a collection with a TEE requirement, keeper calls must be signed
    /// with an attested key, not just come from the keeper account.
    pub(crate) fn assert_attested_signer(&self) {
        if self.tee.is_some() {
            require!(
                self.attested_keys.contains_key(&env::signer_account_pk()),
                "This collection only accepts keeper calls signed by an attested key"
            );
        }
    }
}
