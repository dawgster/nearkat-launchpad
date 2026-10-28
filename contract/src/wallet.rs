//! A wallet for every token, signed by NEAR's MPC network.
//!
//! Each token has its own NEAR account: the implicit account of the Ed25519
//! key the MPC network derives for this contract and the path
//! `nearkat/wallet/<token_id>`. Only this contract can have that key sign
//! anything, so the rules here are the wallet's rules:
//!
//! - the token's owner can send anything from it;
//! - the token's mind (the keeper, acting on the conversation) can send only
//!   within an allowance the owner set: at most `max_payment` at a time and
//!   `daily_allowance` per UTC day. A new owner starts with no allowance.
//!
//! The contract builds the transfer transaction itself, so it knows exactly
//! what it asks the network to sign, and returns it signed, ready for anyone
//! to send. The wallet's address comes from the token id, so it goes with
//! the token when it changes hands.

use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::json_types::{Base58CryptoHash, Base64VecU8, U64};
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, Gas, GasWeight, NearToken, Promise,
    PromiseError,
};

use crate::{Contract, ContractExt};

const WALLET_PATH: &str = "nearkat/wallet";
/// The MPC contract requires at least 15 Tgas on a sign request; it also gets
/// whatever gas the caller attached beyond what these calls use.
const GAS_FOR_SIGN: Gas = Gas::from_tgas(15);
const GAS_FOR_SIGNED: Gas = Gas::from_tgas(15);
const NANOS_PER_DAY: u64 = 86_400 * 1_000_000_000;
const MAX_MEMO_CHARS: usize = 64;

pub fn wallet_path(token_id: &str) -> String {
    format!("{WALLET_PATH}/{token_id}")
}

/// A token's wallet rules and record, kept once its owner has set them.
#[near(serializers = [borsh])]
pub struct Wallet {
    /// The owner who set these rules. Under any other owner the mind's
    /// allowance is zero, so a buyer never inherits the seller's settings.
    owner_id: AccountId,
    daily_allowance: NearToken,
    max_payment: NearToken,
    /// The UTC day `spent_today` counts for.
    day: u64,
    spent_today: NearToken,
    payments: u32,
    last_payment: Option<Payment>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Payment {
    pub receiver_id: AccountId,
    pub amount: NearToken,
    /// Whether the token's mind sent it, rather than its owner.
    pub by_mind: bool,
    pub memo: String,
    /// Nanoseconds since the Unix epoch.
    pub at: U64,
}

#[near(serializers = [json])]
#[derive(Debug, PartialEq)]
pub struct WalletView {
    /// The derivation path; the MPC contract's `derived_public_key` gives
    /// the key, whose hex is the wallet's account id.
    pub path: String,
    pub mpc_contract_id: AccountId,
    pub domain_id: u64,
    /// What the mind may still send today, and at most at a time. Zero
    /// unless the current owner allowed it.
    pub daily_allowance: NearToken,
    pub max_payment: NearToken,
    pub spent_today: NearToken,
    pub payments: u32,
    pub last_payment: Option<Payment>,
}

/// What a transfer from the wallet needs from the chain, which a contract
/// can't read: the wallet key's next nonce and a recent block hash. Wrong
/// values only make the signed transaction invalid.
#[near(serializers = [json])]
pub struct WalletTx {
    /// The wallet's key, `ed25519:<base58>`, from `derived_public_key`.
    pub public_key: String,
    pub nonce: U64,
    pub block_hash: Base58CryptoHash,
}

#[near(serializers = [json])]
#[derive(Debug)]
pub struct WalletSigned {
    /// Borsh of the signed transaction, ready for `send_tx`.
    pub signed_transaction: Base64VecU8,
    /// The transaction hash, base58.
    pub hash: String,
}

/// Borsh of a NEAR transaction (V0) with one Transfer action.
pub fn transfer_transaction(
    signer_id: &str,
    public_key: &[u8; 32],
    nonce: u64,
    receiver_id: &str,
    block_hash: &[u8; 32],
    amount: u128,
) -> Vec<u8> {
    let string = |out: &mut Vec<u8>, text: &str| {
        out.extend_from_slice(&(text.len() as u32).to_le_bytes());
        out.extend_from_slice(text.as_bytes());
    };
    let mut tx = Vec::with_capacity(200);
    string(&mut tx, signer_id);
    tx.push(0); // KeyType::ED25519
    tx.extend_from_slice(public_key);
    tx.extend_from_slice(&nonce.to_le_bytes());
    string(&mut tx, receiver_id);
    tx.extend_from_slice(block_hash);
    tx.extend_from_slice(&1u32.to_le_bytes()); // one action
    tx.push(3); // Action::Transfer
    tx.extend_from_slice(&amount.to_le_bytes());
    tx
}

fn ed25519_key(text: &str) -> [u8; 32] {
    text.strip_prefix("ed25519:")
        .and_then(|b58| near_sdk::bs58::decode(b58).into_vec().ok())
        .and_then(|bytes| <[u8; 32]>::try_from(bytes).ok())
        .unwrap_or_else(|| env::panic_str("public_key must be ed25519:<base58>"))
}

fn today() -> u64 {
    env::block_timestamp() / NANOS_PER_DAY
}

#[near]
impl Contract {
    /// Turns wallets on, with the MPC network's Ed25519 signing domain. Admin
    /// only, once: for a collection launched before wallets existed.
    #[payable]
    pub fn enable_wallets(&mut self, domain_id: u64) {
        self.assert_admin();
        require!(self.wallet_domain_id.is_none(), "Wallets are already on");
        self.wallet_domain_id = Some(domain_id);
    }

    pub fn get_wallet(&self, token_id: TokenId) -> Option<WalletView> {
        let domain_id = self.wallet_domain_id?;
        let owner = self.tokens.owner_by_id.get(&token_id)?;
        let wallet = self.wallets.get(&token_id);
        let current = wallet.filter(|w| w.owner_id == owner);
        let spent_today = current
            .filter(|w| w.day == today())
            .map_or(NearToken::from_yoctonear(0), |w| w.spent_today);
        Some(WalletView {
            path: wallet_path(&token_id),
            mpc_contract_id: self.key_source.mpc_contract_id.clone(),
            domain_id,
            daily_allowance: current.map_or(NearToken::from_yoctonear(0), |w| w.daily_allowance),
            max_payment: current.map_or(NearToken::from_yoctonear(0), |w| w.max_payment),
            spent_today,
            payments: wallet.map_or(0, |w| w.payments),
            last_payment: wallet.and_then(|w| w.last_payment.clone()),
        })
    }

    /// Sets what the token's mind may send from its wallet. Token owner only.
    /// The first call stores the rules; attach enough to pay for that storage
    /// (0.01 NEAR covers it), and the rest is refunded.
    #[payable]
    pub fn set_wallet_policy(
        &mut self,
        token_id: TokenId,
        daily_allowance: NearToken,
        max_payment: NearToken,
    ) {
        require!(
            self.wallet_domain_id.is_some(),
            "This collection has no wallets"
        );
        let owner = self.owner_of(&token_id);
        require!(
            env::predecessor_account_id() == owner,
            "Only the token's owner can set its wallet's rules"
        );
        require!(
            max_payment <= daily_allowance,
            "max_payment can't be more than daily_allowance"
        );
        let before = env::storage_usage();
        let previous = self.wallets.remove(&token_id);
        let (payments, last_payment) = previous
            .map(|w| (w.payments, w.last_payment))
            .unwrap_or((0, None));
        self.wallets.insert(
            token_id,
            Wallet {
                owner_id: owner,
                daily_allowance,
                max_payment,
                day: today(),
                spent_today: NearToken::from_yoctonear(0),
                payments,
                last_payment,
            },
        );
        self.wallets.flush();
        let used = env::storage_usage().saturating_sub(before);
        let cost = env::storage_byte_cost().saturating_mul(used as u128);
        let deposit = env::attached_deposit();
        require!(
            deposit >= cost,
            format!("Attach at least {cost} for the wallet's storage")
        );
        let refund = deposit.saturating_sub(cost);
        if !refund.is_zero() {
            Promise::new(env::predecessor_account_id())
                .transfer(refund)
                .detach();
        }
    }

    /// Sends `amount` from the token's wallet to `receiver_id`: builds the
    /// transfer, has the MPC network sign it with the wallet's key, and
    /// returns it signed, for the caller to send (or null if the network
    /// didn't sign; the allowance is then given back). The token's owner (with 1
    /// yoctoNEAR attached) may send anything; the keeper, for the token's
    /// mind, only within the owner's allowance.
    #[payable]
    pub fn wallet_send(
        &mut self,
        token_id: TokenId,
        receiver_id: AccountId,
        amount: NearToken,
        memo: Option<String>,
        tx: WalletTx,
    ) -> Promise {
        let domain_id = self
            .wallet_domain_id
            .unwrap_or_else(|| env::panic_str("This collection has no wallets"));
        require!(!amount.is_zero(), "amount must be more than zero");
        let memo = memo.unwrap_or_default();
        require!(
            memo.chars().count() <= MAX_MEMO_CHARS,
            "memo must be at most 64 characters"
        );
        let owner = self.owner_of(&token_id);
        let by_mind = env::predecessor_account_id() != owner;
        if by_mind {
            self.assert_keeper();
            self.reserve_allowance(&token_id, &owner, amount);
        } else {
            assert_one_yocto();
        }

        let public_key = ed25519_key(&tx.public_key);
        let signer_id = hex::encode(public_key);
        let block_hash: near_sdk::CryptoHash = tx.block_hash.into();
        let transaction = transfer_transaction(
            &signer_id,
            &public_key,
            tx.nonce.0,
            receiver_id.as_str(),
            &block_hash,
            amount.as_yoctonear(),
        );
        let digest = env::sha256(&transaction);
        let request = near_sdk::serde_json::json!({
            "request": {
                "path": wallet_path(&token_id),
                "payload_v2": { "Eddsa": hex::encode(&digest) },
                "domain_id": domain_id,
            }
        });
        Promise::new(self.key_source.mpc_contract_id.clone())
            .function_call_weight(
                "sign",
                request.to_string().into_bytes(),
                NearToken::from_yoctonear(1),
                GAS_FOR_SIGN,
                GasWeight(1),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_SIGNED)
                    .on_wallet_signed(
                        token_id,
                        Base64VecU8(transaction),
                        Payment {
                            receiver_id,
                            amount,
                            by_mind,
                            memo,
                            at: U64(env::block_timestamp()),
                        },
                    ),
            )
    }

    #[private]
    pub fn on_wallet_signed(
        &mut self,
        token_id: TokenId,
        transaction: Base64VecU8,
        payment: Payment,
        #[callback_result] signed: Result<near_sdk::serde_json::Value, PromiseError>,
    ) -> Option<WalletSigned> {
        let signature: Option<[u8; 64]> = signed.ok().and_then(|value| {
            let bytes: Vec<u8> = value
                .get("signature")?
                .as_array()?
                .iter()
                .map(|b| b.as_u64().and_then(|b| u8::try_from(b).ok()))
                .collect::<Option<_>>()?;
            (value.get("scheme")?.as_str()? == "Ed25519")
                .then_some(())
                .and_then(|()| bytes.try_into().ok())
        });
        let Some(signature) = signature else {
            // Not a panic: that would undo giving the allowance back too.
            if payment.by_mind {
                self.release_allowance(&token_id, payment.amount, payment.at.0);
            }
            env::log_str("The MPC network didn't sign the transfer");
            return None;
        };
        if let Some(wallet) = self.wallets.get_mut(&token_id) {
            wallet.payments += 1;
            wallet.last_payment = Some(payment.clone());
        }
        env::log_str(&format!(
            "EVENT_JSON:{}",
            near_sdk::serde_json::json!({
                "standard": "nearkat",
                "version": "1.0.0",
                "event": "wallet_payment",
                "data": [{ "token_id": token_id, "payment": payment }],
            })
        ));
        let hash = near_sdk::bs58::encode(env::sha256(&transaction.0)).into_string();
        let mut signed_transaction = transaction.0;
        signed_transaction.push(0); // Signature::ED25519
        signed_transaction.extend_from_slice(&signature);
        Some(WalletSigned {
            signed_transaction: Base64VecU8(signed_transaction),
            hash,
        })
    }
}

impl Contract {
    fn owner_of(&self, token_id: &TokenId) -> AccountId {
        self.tokens
            .owner_by_id
            .get(token_id)
            .unwrap_or_else(|| env::panic_str("Token not found"))
    }

    /// Counts a payment by the mind against the owner's allowance, or refuses it.
    fn reserve_allowance(&mut self, token_id: &TokenId, owner: &AccountId, amount: NearToken) {
        let wallet = self
            .wallets
            .get_mut(token_id)
            .filter(|w| &w.owner_id == owner)
            .unwrap_or_else(|| env::panic_str("The owner hasn't let this token's mind spend"));
        require!(
            amount <= wallet.max_payment,
            "That's more than the owner lets the mind send at once"
        );
        if wallet.day != today() {
            wallet.day = today();
            wallet.spent_today = NearToken::from_yoctonear(0);
        }
        let spent = wallet.spent_today.saturating_add(amount);
        require!(
            spent <= wallet.daily_allowance,
            "That's more than the owner lets the mind send today"
        );
        wallet.spent_today = spent;
    }

    /// Gives back what a payment that wasn't signed had reserved.
    fn release_allowance(&mut self, token_id: &TokenId, amount: NearToken, at: u64) {
        if let Some(wallet) = self.wallets.get_mut(token_id) {
            if wallet.day == at / NANOS_PER_DAY {
                wallet.spent_today = wallet.spent_today.saturating_sub(amount);
            }
        }
    }
}
