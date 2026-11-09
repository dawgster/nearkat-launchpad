use near_sdk::serde_json::{self, json, Value};
use near_sdk::{env, near, require, AccountId, Gas, GasWeight, NearToken, Promise, PromiseResult};

const GAS_FOR_CKD: Gas = Gas::from_tgas(15);

#[near(contract_state)]
#[derive(Default)]
pub struct Probe {}

#[near]
impl Probe {
    /// Throwaway probe: one `request_app_private_key` promise per path, joined.
    pub fn fan_out(
        &mut self,
        paths: Vec<String>,
        app_public_keys: Vec<String>,
        domain_id: u64,
        mpc: AccountId,
    ) -> Promise {
        require!(paths.len() == app_public_keys.len() && !paths.is_empty(), "bad input");
        let n = paths.len() as u32;
        let mut joined: Option<Promise> = None;
        for (path, key) in paths.iter().zip(app_public_keys.iter()) {
            let args = json!({
                "request": {
                    "derivation_path": path,
                    "app_public_key": { "AppPublicKey": key },
                    "domain_id": domain_id,
                }
            });
            let p = Promise::new(mpc.clone()).function_call_weight(
                "request_app_private_key",
                args.to_string().into_bytes(),
                NearToken::from_yoctonear(1),
                GAS_FOR_CKD,
                GasWeight(1),
            );
            joined = Some(match joined {
                None => p,
                Some(j) => j.and(p),
            });
        }
        joined.unwrap().then(
            Self::ext(env::current_account_id())
                .with_static_gas(Gas::from_tgas(10))
                .on_keys(n),
        )
    }

    #[private]
    pub fn on_keys(&mut self, n: u32) -> Vec<Option<Value>> {
        (0..n as u64)
            .map(|i| match env::promise_result(i) {
                PromiseResult::Successful(b) => serde_json::from_slice(&b).ok(),
                PromiseResult::Failed => None,
            })
            .collect()
    }
}
