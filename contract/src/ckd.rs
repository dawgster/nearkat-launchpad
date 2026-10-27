//! Context keys from NEAR's MPC network, and context storage on NEAR itself.
//!
//! The keeper never holds a long-lived secret of its own for a collection's
//! contexts. It asks this contract for the collection's key; the contract
//! forwards the request to the MPC network's confidential key derivation
//! (CKD), which derives a key bound to this account and encrypts it to a
//! throwaway key the keeper made. Because the request must come from this
//! contract, and this contract only forwards it for its keeper (signed with
//! an attested key, for a TEE collection), nobody else can obtain the key.

use near_sdk::{env, near, Gas, GasWeight, NearToken, Promise};

use crate::{Contract, ContractExt};

/// The derivation path of the key that encrypts contexts. Changing it would
/// make every existing context unreadable.
pub const CONTEXT_KEY_PATH: &str = "nearkat/contexts/v1";
/// The MPC contract requires at least 15 Tgas on a CKD request; it also gets
/// whatever gas the keeper attached beyond what this call uses.
const GAS_FOR_CKD: Gas = Gas::from_tgas(15);

#[near]
impl Contract {
    /// Has the MPC network derive this collection's context key and encrypt
    /// it to `app_public_key`, a BLS12-381 G1 key (`bls12381g1:<base58>`) the
    /// keeper generated for this request. Keeper only; for a TEE collection,
    /// signed with an attested key. Returns the MPC network's response.
    pub fn request_context_key(&mut self, app_public_key: String) -> Promise {
        self.assert_keeper();
        let source = self
            .key_source
            .clone()
            .unwrap_or_else(|| env::panic_str("This collection has no key source"));
        let args = near_sdk::serde_json::json!({
            "request": {
                "derivation_path": CONTEXT_KEY_PATH,
                "app_public_key": { "AppPublicKey": app_public_key },
                "domain_id": source.domain_id,
            }
        });
        // The MPC contract asks a deposit of 1 yoctoNEAR per request.
        Promise::new(source.mpc_contract_id).function_call_weight(
            "request_app_private_key",
            args.to_string().into_bytes(),
            NearToken::from_yoctonear(1),
            GAS_FOR_CKD,
            GasWeight(1),
        )
    }

    /// Receives FastFS uploads. The keeper stores each encrypted context as a
    /// FastFS file addressed to this account, so it sits in NEAR's own
    /// transaction history; FastFS indexers serve it from there. The data is
    /// in the call's arguments, so there is nothing to do here.
    #[allow(non_snake_case)]
    pub fn __fastdata_fastfs(&self) {}
}
