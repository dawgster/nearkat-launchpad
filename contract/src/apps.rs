//! Training apps: Phala apps that may later be given sample keys. Any app
//! registers a NEAR signing key proven by its TDX quote; the contract records
//! which app id the key belongs to. A collection without a TEE requirement
//! (dev and local mode) lets its admin trust a key by hand instead.

use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::{env, near, require, NearToken, Promise, PublicKey};

use crate::attestation::{check_app_registration, verify_quote};
use crate::{Contract, ContractExt};

/// At most this many distinct apps in the registry.
const MAX_APPS: usize = 32;
const MAX_LABEL_LEN: usize = 48;
const MAX_APP_ID_LEN: usize = 64;
const APPS_KEY: &[u8] = b"apps";

/// A signing key known to belong to a training app.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct AppKey {
    pub app_id: String,
    pub label: String,
    pub seal_public_key: String,
    /// Block timestamp of the registration, in nanoseconds.
    pub attested_at: u64,
    /// True when the admin vouched for the key instead of a quote.
    pub trusted_by_admin: bool,
}

fn app_key_slot(public_key: &PublicKey) -> Vec<u8> {
    let mut key = b"appkey:".to_vec();
    key.extend(borsh::to_vec(public_key).unwrap_or_else(|_| env::abort()));
    key
}

fn label_slot(app_id: &str) -> Vec<u8> {
    [b"applabel:".as_slice(), app_id.as_bytes()].concat()
}

fn read_apps() -> Vec<String> {
    env::storage_read(APPS_KEY)
        .map(|raw| Vec::<String>::try_from_slice(&raw).unwrap_or_else(|_| env::abort()))
        .unwrap_or_default()
}

fn require_label(label: &str) {
    require!(
        (1..=MAX_LABEL_LEN).contains(&label.chars().count())
            && label.chars().all(|c| !c.is_control()),
        "A label is 1 to 48 printable characters"
    );
}

#[near]
impl Contract {
    /// Registers a key proven, by a TDX quote, to live inside the Phala app
    /// its event log names. Anyone may call; the deposit pays the storage
    /// and the rest is refunded. `quote` is hex, `collateral` is
    /// `QuoteCollateralV3` JSON, `event_log` is dstack's event log JSON.
    #[payable]
    pub fn register_app_key(
        &mut self,
        public_key: PublicKey,
        seal_public_key: String,
        label: String,
        quote: String,
        collateral: String,
        event_log: String,
    ) -> AppKey {
        require_label(&label);
        require!(
            seal_public_key.len() == 64 && seal_public_key.bytes().all(|b| b.is_ascii_hexdigit()),
            "seal_public_key must be a 32-byte hex key"
        );
        let seal_public_key = seal_public_key.to_lowercase();
        let quote = hex::decode(quote.trim_start_matches("0x"))
            .unwrap_or_else(|_| env::panic_str("quote must be hex"));
        let now_secs = env::block_timestamp() / 1_000_000_000;
        let key = String::from(&public_key);
        let app_id = verify_quote(&quote, &collateral, now_secs)
            .and_then(|td| check_app_registration(&key, &seal_public_key, &td, &event_log))
            .unwrap_or_else(|problem| env::panic_str(&problem));
        let entry = AppKey {
            app_id,
            label,
            seal_public_key,
            attested_at: env::block_timestamp(),
            trusted_by_admin: false,
        };
        self.store_app_key(public_key, entry, NearToken::from_yoctonear(0))
    }

    /// Admin only, and only for a collection with no TEE requirement: trusts
    /// `public_key` as belonging to `app_id`. The deposit (at least 1 yocto)
    /// pays the storage and the rest is refunded.
    #[payable]
    pub fn trust_app_key(
        &mut self,
        public_key: PublicKey,
        app_id: String,
        label: String,
    ) -> AppKey {
        require!(
            env::predecessor_account_id() == self.admin_id,
            "Only the admin can call this method"
        );
        require!(
            self.tee.is_none(),
            "A TEE collection only accepts attested training apps"
        );
        require!(
            (1..=MAX_APP_ID_LEN).contains(&app_id.len())
                && app_id
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-'),
            "app_id is 1 to 64 lowercase letters, digits or -"
        );
        require_label(&label);
        let entry = AppKey {
            app_id,
            label,
            seal_public_key: String::new(),
            attested_at: env::block_timestamp(),
            trusted_by_admin: true,
        };
        self.store_app_key(public_key, entry, NearToken::from_yoctonear(1))
    }

    pub fn get_app_key(&self, public_key: PublicKey) -> Option<AppKey> {
        env::storage_read(&app_key_slot(&public_key))
            .map(|raw| AppKey::try_from_slice(&raw).unwrap_or_else(|_| env::abort()))
    }

    /// `(app_id, label)` for every registered app, with its latest label.
    pub fn training_apps(&self) -> Vec<(String, String)> {
        read_apps()
            .into_iter()
            .map(|app| {
                let label = env::storage_read(&label_slot(&app))
                    .map(|raw| String::from_utf8(raw).unwrap_or_default())
                    .unwrap_or_default();
                (app, label)
            })
            .collect()
    }
}

impl Contract {
    /// The app id of the key that signed this transaction, if registered.
    #[allow(dead_code)]
    pub(crate) fn signer_app(&self) -> Option<String> {
        self.get_app_key(env::signer_account_pk())
            .map(|key| key.app_id)
    }

    /// Writes the key and its app, charges the storage this took (and at
    /// least `minimum`) from the deposit, and refunds the rest.
    pub(crate) fn store_app_key(
        &mut self,
        public_key: PublicKey,
        entry: AppKey,
        minimum: NearToken,
    ) -> AppKey {
        let before = env::storage_usage();
        let mut apps = read_apps();
        if !apps.contains(&entry.app_id) {
            require!(apps.len() < MAX_APPS, "At most 32 training apps");
            apps.push(entry.app_id.clone());
            env::storage_write(
                APPS_KEY,
                &borsh::to_vec(&apps).unwrap_or_else(|_| env::abort()),
            );
        }
        env::storage_write(&label_slot(&entry.app_id), entry.label.as_bytes());
        env::storage_write(
            &app_key_slot(&public_key),
            &borsh::to_vec(&entry).unwrap_or_else(|_| env::abort()),
        );
        let bytes = env::storage_usage().saturating_sub(before);
        let cost = env::storage_byte_cost().saturating_mul(u128::from(bytes));
        let deposit = env::attached_deposit();
        require!(
            deposit >= cost && deposit >= minimum,
            format!(
                "Attach at least {} for the key's storage",
                cost.max(minimum)
            )
        );
        let refund = deposit.saturating_sub(cost);
        if !refund.is_zero() {
            Promise::new(env::predecessor_account_id())
                .transfer(refund)
                .detach();
        }
        entry
    }
}
