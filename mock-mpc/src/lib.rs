//! A stand-in for NEAR's MPC signer contract, for sandbox tests only.
//!
//! It answers `request_app_private_key`, `sign`, `public_key` and
//! `derived_public_key` as the real contract does for one CKD domain and one
//! Ed25519 signing domain, with the same derivations, but from master secrets
//! held in its own state, where anyone can read them. Never deploy it
//! anywhere real: the real network splits those secrets between many
//! independent nodes, so no one ever holds them.

use bls12_381::hash_to_curve::{ExpandMsgXmd, HashToCurve};
use bls12_381::{G1Affine, G1Projective, G2Affine, G2Projective, Scalar};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{env, near, require, NearToken, PanicOnDefault};
use sha3::{Digest, Sha3_256};

/// The same constants the real MPC network uses.
const NEAR_CKD_DOMAIN: &[u8] = b"NEAR BLS12381G1_XMD:SHA-256_SSWU_RO_";
const APP_ID_DERIVATION_PREFIX: &str = "near-mpc v0.1.0 app_id derivation:";
const TWEAK_DERIVATION_PREFIX: &str = "near-mpc-recovery v0.1.0 epsilon derivation:";

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

/// `sign`'s request, as the real contract takes it.
#[derive(Deserialize, Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct SignRequestArgs {
    pub path: String,
    pub payload_v2: Payload,
    pub domain_id: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(crate = "near_sdk::serde")]
pub enum Payload {
    /// Hex. Signed as is, like any Ed25519 message.
    Eddsa(String),
    Ecdsa(String),
}

/// `sign`'s answer for an Ed25519 domain, in the real contract's JSON shape:
/// `{ "scheme": "Ed25519", "signature": [64 bytes] }`.
#[derive(Deserialize, Serialize, Debug, PartialEq)]
#[serde(crate = "near_sdk::serde", tag = "scheme")]
pub enum SignatureResponse {
    Ed25519 { signature: Vec<u8> },
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct MockMpc {
    master_secret: [u8; 64],
    /// `msk·G2`, compressed, computed once at setup.
    public_key: Vec<u8>,
    domain_id: u64,
    /// The Ed25519 signing domain's master secret scalar and public key.
    ed25519_secret: [u8; 32],
    ed25519_public_key: [u8; 32],
    sign_domain_id: u64,
}

/// The tweak the real network adds to a domain key for a caller and path.
pub fn derive_tweak(predecessor: &str, path: &str) -> [u8; 32] {
    Sha3_256::digest(format!("{TWEAK_DERIVATION_PREFIX}{predecessor},{path}").as_bytes()).into()
}

/// The derived Ed25519 public key: `pk + tweak·B`, as the real network computes it.
pub fn derive_ed25519_public_key(
    master: &curve25519_dalek::EdwardsPoint,
    tweak: &[u8; 32],
) -> curve25519_dalek::EdwardsPoint {
    master
        + curve25519_dalek::EdwardsPoint::mul_base(&curve25519_dalek::Scalar::from_bytes_mod_order(
            *tweak,
        ))
}

/// An Ed25519 signature by the secret scalar `a` (with public key `A`) on `message`:
/// `R = r·B`, `S = r + H(R ‖ A ‖ M)·a`. Any Ed25519 verifier accepts it.
fn sign_ed25519(a: &curve25519_dalek::Scalar, message: &[u8]) -> [u8; 64] {
    use curve25519_dalek::{EdwardsPoint, Scalar};
    use sha2_10::{Digest as _, Sha512};
    let public = EdwardsPoint::mul_base(a).compress();
    let nonce: [u8; 64] = Sha512::new()
        .chain_update(b"mock-mpc nonce")
        .chain_update(a.as_bytes())
        .chain_update(message)
        .finalize()
        .into();
    let r = Scalar::from_bytes_mod_order_wide(&nonce);
    let big_r = EdwardsPoint::mul_base(&r).compress();
    let challenge: [u8; 64] = Sha512::new()
        .chain_update(big_r.as_bytes())
        .chain_update(public.as_bytes())
        .chain_update(message)
        .finalize()
        .into();
    let s = r + Scalar::from_bytes_mod_order_wide(&challenge) * a;
    let mut signature = [0u8; 64];
    signature[..32].copy_from_slice(big_r.as_bytes());
    signature[32..].copy_from_slice(s.as_bytes());
    signature
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

fn decode_hex(text: &str) -> Vec<u8> {
    let valid = text.len() % 2 == 0 && text.bytes().all(|b| b.is_ascii_hexdigit());
    require!(valid, "Payload must be hex");
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
        .collect()
}

/// The app id the real network derives for a caller and path.
pub fn derive_app_id(predecessor: &str, path: &str) -> [u8; 32] {
    Sha3_256::digest(format!("{APP_ID_DERIVATION_PREFIX}{predecessor},{path}").as_bytes()).into()
}

#[near]
impl MockMpc {
    /// `master_secret` is hex; it becomes the domain's secret scalar.
    /// `domain_id` is the CKD domain; `sign_domain_id` (default 1) the Ed25519 one.
    #[init]
    pub fn new(master_secret: String, domain_id: u64, sign_domain_id: Option<u64>) -> Self {
        let bytes = master_secret.as_bytes();
        let mut wide = [0u8; 64];
        let first = env::sha256(bytes);
        wide[..32].copy_from_slice(&first);
        wide[32..].copy_from_slice(&env::sha256(&first));
        let pk = G2Affine::from(G2Projective::generator() * scalar(&wide)).to_compressed();
        let ed25519 = curve25519_dalek::Scalar::from_bytes_mod_order_wide(&{
            use sha2_10::{Digest as _, Sha512};
            let digest: [u8; 64] = Sha512::new()
                .chain_update(b"mock-mpc ed25519")
                .chain_update(wide)
                .finalize()
                .into();
            digest
        });
        let sign_domain_id = sign_domain_id.unwrap_or(1);
        require!(
            sign_domain_id != domain_id,
            "The two domains need different ids"
        );
        Self {
            master_secret: wide,
            public_key: pk.to_vec(),
            domain_id,
            ed25519_secret: ed25519.to_bytes(),
            ed25519_public_key: curve25519_dalek::EdwardsPoint::mul_base(&ed25519)
                .compress()
                .to_bytes(),
            sign_domain_id,
        }
    }

    /// Signs `payload_v2.Eddsa` with the key derived for the caller and path.
    #[payable]
    pub fn sign(&mut self, request: SignRequestArgs) -> SignatureResponse {
        require!(
            env::attached_deposit() >= NearToken::from_yoctonear(1),
            "Attach at least 1 yoctoNEAR"
        );
        require!(request.domain_id == self.sign_domain_id, "Unknown domain");
        let Payload::Eddsa(hex) = request.payload_v2 else {
            env::panic_str("Payload is not EdDSA");
        };
        let message = decode_hex(&hex);
        require!(
            !message.is_empty() && message.len() <= 1232,
            "Payload must be 1 to 1232 bytes"
        );
        let tweak = derive_tweak(env::predecessor_account_id().as_str(), &request.path);
        let secret = curve25519_dalek::Scalar::from_bytes_mod_order(self.ed25519_secret)
            + curve25519_dalek::Scalar::from_bytes_mod_order(tweak);
        SignatureResponse::Ed25519 {
            signature: sign_ed25519(&secret, &message).to_vec(),
        }
    }

    /// The key derived for `predecessor` (default: the caller) and `path`.
    pub fn derived_public_key(
        &self,
        path: String,
        predecessor: Option<near_sdk::AccountId>,
        domain_id: Option<u64>,
    ) -> String {
        let domain_id = domain_id.unwrap_or(self.sign_domain_id);
        if domain_id == self.domain_id {
            return self.public_key(Some(domain_id));
        }
        require!(domain_id == self.sign_domain_id, "Unknown domain");
        let predecessor = predecessor.unwrap_or_else(env::predecessor_account_id);
        let master = curve25519_dalek::edwards::CompressedEdwardsY(self.ed25519_public_key)
            .decompress()
            .unwrap_or_else(|| env::panic_str("Stored key is not a point"));
        let derived =
            derive_ed25519_public_key(&master, &derive_tweak(predecessor.as_str(), &path));
        format!(
            "ed25519:{}",
            bs58::encode(derived.compress().as_bytes()).into_string()
        )
    }

    /// The domain's public key, as `bls12381g2:<base58>`.
    pub fn public_key(&self, domain_id: Option<u64>) -> String {
        if domain_id == Some(self.sign_domain_id) {
            return format!(
                "ed25519:{}",
                bs58::encode(self.ed25519_public_key).into_string()
            );
        }
        require!(
            domain_id.unwrap_or(self.domain_id) == self.domain_id,
            "Unknown domain"
        );
        format!(
            "bls12381g2:{}",
            bs58::encode(&self.public_key).into_string()
        )
    }

    /// A small part of the real contract's `state` view: its one CKD domain,
    /// in the same JSON shape, so tools that look domains up work here too.
    pub fn state(&self) -> near_sdk::serde_json::Value {
        near_sdk::serde_json::json!({
            "Running": {
                "domains": {
                    "domains": [
                        {
                            "id": self.sign_domain_id,
                            "protocol": "Frost",
                            "purpose": "Sign",
                        },
                        {
                            "id": self.domain_id,
                            "protocol": "ConfidentialKeyDerivation",
                            "purpose": "CKD",
                        },
                    ],
                },
            },
        })
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
        let mut mpc = MockMpc::new("00".repeat(32), 2, None);
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

#[cfg(test)]
mod upstream {
    use super::*;
    use bls12_381::{G1Affine, G2Affine};

    /// Values frozen in NEAR's MPC repository (see the keeper's
    /// `test/fixtures/near-mpc-upstream.json`), so this mock is checked
    /// against the network's own code, not just against the keeper.
    fn fixture() -> near_sdk::serde_json::Value {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../keeper/test/fixtures/near-mpc-upstream.json"
        );
        near_sdk::serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    #[test]
    fn derives_the_same_app_ids_as_the_network() {
        for case in fixture()["app_ids"].as_array().unwrap() {
            let id = derive_app_id(
                case["account"].as_str().unwrap(),
                case["path"].as_str().unwrap(),
            );
            let hex: String = id.iter().map(|b| format!("{b:02x}")).collect();
            assert_eq!(hex, case["app_id"].as_str().unwrap());
        }
    }

    #[test]
    fn derives_the_same_tweaks_as_the_network() {
        for case in fixture()["tweaks"].as_array().unwrap() {
            let tweak = derive_tweak(
                case["account"].as_str().unwrap(),
                case["path"].as_str().unwrap(),
            );
            let hex: String = tweak.iter().map(|b| format!("{b:02x}")).collect();
            assert_eq!(hex, case["tweak"].as_str().unwrap());
        }
    }

    #[test]
    fn derives_the_same_ed25519_key_as_the_network() {
        use rand::{Rng, SeedableRng};
        // The same input as the network's own snapshot test.
        let random_bytes: [u8; 32] = rand::rngs::StdRng::from_seed([42u8; 32]).gen();
        let master = curve25519_dalek::EdwardsPoint::mul_base(
            &curve25519_dalek::Scalar::from_bytes_mod_order(random_bytes),
        );
        let derived = derive_ed25519_public_key(&master, &derive_tweak("hello", "my-path"));
        let hex: String = derived
            .compress()
            .as_bytes()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        assert_eq!(
            hex,
            fixture()["ed25519_derivation"]["derived_public_key"]
                .as_str()
                .unwrap()
        );
    }

    #[test]
    fn hashes_to_the_same_point_as_the_network() {
        let pk = G2Affine::from(bls12_381::G2Projective::generator()).to_compressed();
        let message = [pk.as_slice(), &[0u8; 32]].concat();
        let hashed = <G1Projective as HashToCurve<ExpandMsgXmd<sha2::Sha256>>>::hash_to_curve(
            &message,
            NEAR_CKD_DOMAIN,
        );
        let hex: String = G1Affine::from(hashed)
            .to_compressed()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        assert_eq!(hex, fixture()["hash_to_curve"]["point"].as_str().unwrap());
    }
}

#[cfg(test)]
mod signing {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    #[test]
    fn signs_with_the_derived_key_and_any_ed25519_verifier_accepts_it() {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id("lantern.launch.near".parse().unwrap())
            .attached_deposit(NearToken::from_yoctonear(1))
            .build());
        let mut mpc = MockMpc::new("22".repeat(32), 2, None);
        let message = [7u8; 32];
        let SignatureResponse::Ed25519 { signature } = mpc.sign(SignRequestArgs {
            path: "nearkat/wallet/1".to_string(),
            payload_v2: Payload::Eddsa("07".repeat(32)),
            domain_id: 1,
        });
        let key = mpc.derived_public_key(
            "nearkat/wallet/1".to_string(),
            Some("lantern.launch.near".parse().unwrap()),
            Some(1),
        );
        let key: [u8; 32] = bs58::decode(key.strip_prefix("ed25519:").unwrap())
            .into_vec()
            .unwrap()
            .try_into()
            .unwrap();
        let verifying = ed25519_dalek::VerifyingKey::from_bytes(&key).unwrap();
        let signature = ed25519_dalek::Signature::from_slice(&signature).unwrap();
        verifying.verify_strict(&message, &signature).unwrap();
        // Another token's path gives another key, which the signature doesn't verify against.
        let other = mpc.derived_public_key(
            "nearkat/wallet/2".to_string(),
            Some("lantern.launch.near".parse().unwrap()),
            Some(1),
        );
        assert_ne!(
            other,
            format!("ed25519:{}", bs58::encode(key).into_string())
        );
    }

    #[test]
    fn answers_in_the_real_contracts_json_shape() {
        let response = SignatureResponse::Ed25519 {
            signature: vec![1, 2],
        };
        assert_eq!(
            near_sdk::serde_json::to_value(&response).unwrap(),
            near_sdk::serde_json::json!({ "scheme": "Ed25519", "signature": [1, 2] })
        );
    }
}

#[cfg(test)]
mod vector {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    /// Writes a real response for the keeper's tests, so its TypeScript CKD
    /// client is checked against this implementation of the network's maths.
    #[test]
    fn write_vector_for_the_keeper() {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id("lantern.launch.near".parse().unwrap())
            .attached_deposit(NearToken::from_yoctonear(1))
            .random_seed([7u8; 32])
            .build());
        let mut mpc = MockMpc::new("22".repeat(32), 2, None);
        // The app's secret scalar, little-endian.
        let a = Scalar::from(123_456_789u64);
        let app = G1Projective::generator() * a;
        let response = mpc.request_app_private_key(CkdRequestArgs {
            derivation_path: "nearkat/contexts/v1".to_string(),
            app_public_key: AppPublicKey::Tagged {
                app_public_key: encode_g1(&app),
            },
            domain_id: 2,
        });
        let vector = near_sdk::serde_json::json!({
            "caller": "lantern.launch.near",
            "path": "nearkat/contexts/v1",
            "app_secret": "123456789",
            "app_public_key": encode_g1(&app),
            "mpc_public_key": mpc.public_key(None),
            "big_y": response.big_y,
            "big_c": response.big_c,
        });
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../keeper/test/fixtures/ckd-vector.json"
        );
        std::fs::create_dir_all(std::path::Path::new(path).parent().unwrap()).unwrap();
        std::fs::write(
            path,
            near_sdk::serde_json::to_string_pretty(&vector).unwrap(),
        )
        .unwrap();
    }
}
