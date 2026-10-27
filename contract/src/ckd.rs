//! Context keys from NEAR's MPC network, and context storage on NEAR itself.
//!
//! The keeper never holds a long-lived secret of its own for a collection's
//! contexts. It asks this contract for the collection's key; the contract
//! forwards the request to the MPC network's confidential key derivation
//! (CKD), which derives a key bound to this account and encrypts it to a
//! throwaway key the keeper made. Because the request must come from this
//! contract, and this contract only forwards it for its keeper (signed with
//! an attested key, for a TEE collection), nobody else can obtain the key.
//!
//! Keys have epochs. Changing keeper, revoking an attested key, or the admin
//! asking for it moves to the next epoch, whose key the previous keeper never
//! saw. The current keeper may still fetch earlier epochs' keys, to read
//! contexts saved before; each token's next save moves it to the new key.
//! Epoch 0 is the key from before epochs existed (the bare path), which only
//! collections upgraded from that version have contexts under.

use near_sdk::{env, near, require, Gas, GasWeight, NearToken, Promise};

use crate::{Contract, ContractExt};

/// The derivation path prefix of the keys that encrypt contexts; the epoch
/// follows it. Changing it would make every existing context unreadable.
pub const CONTEXT_KEY_PATH: &str = "nearkat/contexts/v1";
/// The MPC contract requires at least 15 Tgas on a CKD request; it also gets
/// whatever gas the keeper attached beyond what this call uses.
const GAS_FOR_CKD: Gas = Gas::from_tgas(15);

pub fn context_key_path(epoch: u32) -> String {
    if epoch == 0 {
        CONTEXT_KEY_PATH.to_string()
    } else {
        format!("{CONTEXT_KEY_PATH}/{epoch}")
    }
}

#[near]
impl Contract {
    /// Has the MPC network derive this collection's context key for
    /// `key_epoch` (default: the current one) and encrypt it to
    /// `app_public_key`, a BLS12-381 G1 key (`bls12381g1:<base58>`) the
    /// keeper generated for this request. Keeper only; for a TEE collection,
    /// signed with an attested key. Returns the MPC network's response.
    pub fn request_context_key(
        &mut self,
        app_public_key: String,
        key_epoch: Option<u32>,
    ) -> Promise {
        self.assert_keeper();
        let epoch = key_epoch.unwrap_or(self.key_epoch);
        require!(
            epoch <= self.key_epoch,
            format!("key_epoch must be at most {}", self.key_epoch)
        );
        let args = near_sdk::serde_json::json!({
            "request": {
                "derivation_path": context_key_path(epoch),
                "app_public_key": { "AppPublicKey": app_public_key },
                "domain_id": self.key_source.domain_id,
            }
        });
        // The MPC contract asks a deposit of 1 yoctoNEAR per request.
        Promise::new(self.key_source.mpc_contract_id.clone()).function_call_weight(
            "request_app_private_key",
            args.to_string().into_bytes(),
            NearToken::from_yoctonear(1),
            GAS_FOR_CKD,
            GasWeight(1),
        )
    }

    /// Moves to a new key epoch. Admin only.
    ///
    /// The keeper named now can fetch the new key too, so this alone doesn't
    /// lock anyone out. It protects what is saved next when a context key
    /// leaked but the keeper's signing keys didn't. If the keeper itself may
    /// be compromised, change keeper (`set_keeper`) or, for a TEE collection,
    /// revoke its key: both move the epoch as well.
    #[payable]
    pub fn rotate_context_key(&mut self) {
        self.assert_admin();
        self.rotate_key_epoch();
    }

    /// Receives FastFS uploads. The keeper stores each encrypted context as a
    /// FastFS file addressed to this account, so it sits in NEAR's own
    /// transaction history; FastFS indexers serve it from there. The data is
    /// in the call's arguments, so there is nothing to do here.
    #[allow(non_snake_case)]
    pub fn __fastdata_fastfs(&self) {}
}

impl Contract {
    pub(crate) fn rotate_key_epoch(&mut self) {
        self.key_epoch += 1;
        env::log_str(&format!("key_epoch {}", self.key_epoch));
    }
}
