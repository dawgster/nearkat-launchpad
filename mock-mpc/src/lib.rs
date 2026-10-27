//! A stand-in for NEAR's MPC signer contract, for sandbox tests only.
//!
//! It answers `request_app_private_key` and `public_key` exactly as the real
//! contract does for a CKD domain, with the same derivation and encryption,
//! but from a single master secret held in its own state, where anyone can
//! read it. Never deploy it anywhere real: the real network splits that
//! secret between many independent nodes, so no one ever holds it.

use bls12_381::hash_to_curve::{ExpandMsgXmd, HashToCurve};
use bls12_381::{G1Affine, G1Projective, G2Affine, G2Projective, Scalar};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{env, near, require, NearToken, PanicOnDefault};
use sha3::{Digest, Sha3_256};

/// The same constants the real MPC network uses.
const NEAR_CKD_DOMAIN: &[u8] = b"NEAR BLS12381G1_XMD:SHA-256_SSWU_RO_";
const APP_ID_DERIVATION_PREFIX: &str = "near-mpc v0.1.0 app_id derivation:";

#[derive(Deserialize, Serialize, Clone)]
#[serde(crate = "near_sdk::serde", untagged)]
pub enum AppPublicKey {
    Tagged {
        #[serde(rename = "AppPublicKey")]
        app_public_key: String,
    },
    Plain(String),
}

#[derive(Deserialize, Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct CkdRequestArgs {
    pub derivation_path: String,
    pub app_public_key: AppPublicKey,
    pub domain_id: u64,
}

#[derive(Deserialize, Serialize, Debug, PartialEq)]
#[serde(crate = "near_sdk::serde")]
pub struct CkdResponse {
    pub big_y: String,
    pub big_c: String,
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct MockMpc {
    master_secret: [u8; 64],
    /// `msk·G2`, compressed, computed once at setup.
    public_key: Vec<u8>,
    domain_id: u64,
}

fn scalar(wide: &[u8; 64]) -> Scalar {
    Scalar::from_bytes_wide(wide)
}

fn encode_g1(point: &G1Projective) -> String {
    format!(
        "bls12381g1:{}",
        bs58::encode(G1Affine::from(point).to_compressed()).into_string()
    )
}

fn decode_g1(text: &str) -> G1Projective {
    let raw = text
        .strip_prefix("bls12381g1:")
        .and_then(|b58| bs58::decode(b58).into_vec().ok())
        .and_then(|bytes| <[u8; 48]>::try_from(bytes).ok())
        .unwrap_or_else(|| env::panic_str("app_public_key must be bls12381g1:<base58>"));
    let point = Option::<G1Affine>::from(G1Affine::from_compressed(&raw))
        .unwrap_or_else(|| env::panic_str("app_public_key is not a G1 point"));
    G1Projective::from(point)
}

/// The app id the real network derives for a caller and path.
pub fn derive_app_id(predecessor: &str, path: &str) -> [u8; 32] {
    Sha3_256::digest(format!("{APP_ID_DERIVATION_PREFIX}{predecessor},{path}").as_bytes()).into()
}

#[near]
impl MockMpc {
    /// `master_secret` is hex; it becomes the domain's secret scalar.
    #[init]
    pub fn new(master_secret: String, domain_id: u64) -> Self {
        let bytes = master_secret.as_bytes();
        let mut wide = [0u8; 64];
        let first = env::sha256(bytes);
        wide[..32].copy_from_slice(&first);
        wide[32..].copy_from_slice(&env::sha256(&first));
        let pk = G2Affine::from(G2Projective::generator() * scalar(&wide)).to_compressed();
        Self {
            master_secret: wide,
            public_key: pk.to_vec(),
            domain_id,
        }
    }

    /// The domain's public key, as `bls12381g2:<base58>`.
    pub fn public_key(&self, domain_id: Option<u64>) -> String {
        require!(
            domain_id.unwrap_or(self.domain_id) == self.domain_id,
            "Unknown domain"
        );
        format!(
            "bls12381g2:{}",
            bs58::encode(&self.public_key).into_string()
        )
    }

    /// The derived key for the caller and path, ElGamal-encrypted to the
    /// app public key: `(Y, C) = (y·G1, msk·H(pk ‖ app_id) + y·A)`.
    #[payable]
    pub fn request_app_private_key(&mut self, request: CkdRequestArgs) -> CkdResponse {
        require!(
            env::attached_deposit() >= NearToken::from_yoctonear(1),
            "Attach at least 1 yoctoNEAR"
        );
        require!(request.domain_id == self.domain_id, "Unknown domain");
        let app_key = match &request.app_public_key {
            AppPublicKey::Tagged { app_public_key } | AppPublicKey::Plain(app_public_key) => {
                decode_g1(app_public_key)
            }
        };
        let msk = scalar(&self.master_secret);
        let pk = &self.public_key;
        let app_id = derive_app_id(
            env::predecessor_account_id().as_str(),
            &request.derivation_path,
        );
        let message = [pk.as_slice(), app_id.as_slice()].concat();
        let hashed = <G1Projective as HashToCurve<ExpandMsgXmd<sha2::Sha256>>>::hash_to_curve(
            &message,
            NEAR_CKD_DOMAIN,
        );
        let derived = hashed * msk;
        let mut seed = [0u8; 64];
        seed[..32].copy_from_slice(&env::random_seed_array());
        seed[32..].copy_from_slice(&env::sha256(env::random_seed_array()));
        let y = scalar(&seed);
        CkdResponse {
            big_y: encode_g1(&(G1Projective::generator() * y)),
            big_c: encode_g1(&(derived + app_key * y)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    #[test]
    fn decrypts_to_a_valid_signature_on_the_app_id() {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id("lantern.launch.near".parse().unwrap())
            .attached_deposit(NearToken::from_yoctonear(1))
            .build());
        let mut mpc = MockMpc::new("00".repeat(32), 2);
        let a = scalar(&[9u8; 64]);
        let app = G1Projective::generator() * a;
        let response = mpc.request_app_private_key(CkdRequestArgs {
            derivation_path: "nearkat/contexts/v1".to_string(),
            app_public_key: AppPublicKey::Tagged {
                app_public_key: encode_g1(&app),
            },
            domain_id: 2,
        });
        let derived = decode_g1(&response.big_c) - decode_g1(&response.big_y) * a;
        let pk_text = mpc.public_key(None);
        let pk_bytes: [u8; 96] = bs58::decode(pk_text.strip_prefix("bls12381g2:").unwrap())
            .into_vec()
            .unwrap()
            .try_into()
            .unwrap();
        let pk = G2Affine::from_compressed(&pk_bytes).unwrap();
        let app_id = derive_app_id("lantern.launch.near", "nearkat/contexts/v1");
        let hashed = <G1Projective as HashToCurve<ExpandMsgXmd<sha2::Sha256>>>::hash_to_curve(
            [pk.to_compressed().as_slice(), app_id.as_slice()].concat(),
            NEAR_CKD_DOMAIN,
        );
        assert_eq!(
            bls12_381::pairing(&G1Affine::from(derived), &G2Affine::generator()),
            bls12_381::pairing(&G1Affine::from(hashed), &pk)
        );
    }
}
