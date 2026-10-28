//! A wallet for every token.
//!
//! Each token can have its own NEAR account, `<token_id>.<collection>`,
//! which this contract creates running the token wallet code (`token-wallet/`,
//! published once and used by hash). That account has no keys and only one
//! method, `transfer`, which only this contract may call. So the rules here
//! are the wallet's rules:
//!
//! - the token's owner can send anything from it;
//! - the token's mind (the keeper, acting on the conversation) can send only
//!   within an allowance the owner set: at most `max_payment` at a time and
//!   `daily_allowance` per UTC day. A new owner starts with no allowance.
//!
//! Anyone can send NEAR to it. Every payment out is a call from this
//! contract, checked when it is made, so nothing signed earlier can move the
//! wallet's funds later: a token can change hands at any time, and the
//! wallet goes with it.

use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::json_types::{Base58CryptoHash, U64};
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, Gas, NearToken, Promise, PromiseError,
};

use crate::{Contract, ContractExt};

/// What a wallet account is given on top of its record's storage: enough
/// for its own account storage, with the rest as its first balance.
pub const WALLET_ACCOUNT_FUNDING: NearToken = NearToken::from_millinear(10);
const GAS_FOR_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_FOR_SENT: Gas = Gas::from_tgas(10);
const GAS_FOR_OPENED: Gas = Gas::from_tgas(10);
const NANOS_PER_DAY: u64 = 86_400 * 1_000_000_000;
const MAX_MEMO_CHARS: usize = 64;

/// A token's wallet rules and record, kept from when its wallet is opened.
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
    /// Counts each change of rules, so a refund for a payment that failed
    /// goes back only to the rules it was taken from.
    policy: u32,
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
    /// The wallet's account. Anyone can send NEAR to it once it is open.
    pub account_id: AccountId,
    /// Whether the account exists yet. Anyone can open it with `open_wallet`.
    pub open: bool,
    /// What the mind may send a day, and at most at a time. Zero unless the
    /// current owner allowed it.
    pub daily_allowance: NearToken,
    pub max_payment: NearToken,
    pub spent_today: NearToken,
    pub payments: u32,
    pub last_payment: Option<Payment>,
}

fn today() -> u64 {
    env::block_timestamp() / NANOS_PER_DAY
}

/// A token's wallet account: `<token_id>.<this contract>`.
pub fn wallet_account(token_id: &str) -> AccountId {
    format!("{token_id}.{}", env::current_account_id())
        .parse()
        .unwrap_or_else(|_| env::panic_str("That token can't have a wallet account"))
}

#[near]
impl Contract {
    /// Turns wallets on, with the published token wallet code. Admin only,
    /// once: for a collection launched before wallets existed.
    #[payable]
    pub fn enable_wallets(&mut self, code_hash: Base58CryptoHash) {
        self.assert_admin();
        require!(self.wallet_code_hash.is_none(), "Wallets are already on");
        self.wallet_code_hash = Some(code_hash.into());
    }

    pub fn get_wallet(&self, token_id: TokenId) -> Option<WalletView> {
        self.wallet_code_hash?;
        let owner = self.tokens.owner_by_id.get(&token_id)?;
        let wallet = self.wallets.get(&token_id);
        let current = wallet.filter(|w| w.owner_id == owner);
        let zero = NearToken::from_yoctonear(0);
        Some(WalletView {
            account_id: wallet_account(&token_id),
            open: wallet.is_some(),
            daily_allowance: current.map_or(zero, |w| w.daily_allowance),
            max_payment: current.map_or(zero, |w| w.max_payment),
            spent_today: current
                .filter(|w| w.day == today())
                .map_or(zero, |w| w.spent_today),
            payments: wallet.map_or(0, |w| w.payments),
            last_payment: wallet.and_then(|w| w.last_payment.clone()),
        })
    }

    /// Creates the token's wallet account. Anyone may, for any token. The
    /// deposit pays for the wallet's record and the account's storage; what
    /// is left over becomes the wallet's first balance.
    #[payable]
    pub fn open_wallet(&mut self, token_id: TokenId) -> Promise {
        let code_hash = self
            .wallet_code_hash
            .unwrap_or_else(|| env::panic_str("This collection has no wallets"));
        let owner = self.owner_of(&token_id);
        require!(
            self.wallets.get(&token_id).is_none(),
            "This token's wallet is already open"
        );
        let record_cost = self.create_wallet_record(&token_id, &owner);
        let deposit = env::attached_deposit();
        let needed = record_cost.saturating_add(WALLET_ACCOUNT_FUNDING);
        require!(
            deposit >= needed,
            format!("Attach at least {needed} to open a wallet")
        );
        let funding = deposit.saturating_sub(record_cost);
        Promise::new(wallet_account(&token_id))
            .create_account()
            .transfer(funding)
            .use_global_contract(code_hash)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_OPENED)
                    .on_wallet_opened(token_id, env::predecessor_account_id(), deposit),
            )
    }

    /// Undoes the record if the account couldn't be created, and gives the
    /// opener their deposit back. Returns whether the wallet is open.
    #[private]
    pub fn on_wallet_opened(
        &mut self,
        token_id: TokenId,
        opener: AccountId,
        deposit: NearToken,
        #[callback_result] created: Result<(), PromiseError>,
    ) -> bool {
        if created.is_ok() {
            return true;
        }
        self.wallets.remove(&token_id);
        Promise::new(opener).transfer(deposit).detach();
        false
    }

    /// Sets what the token's mind may send from its wallet. Token owner only,
    /// with a deposit (1 yoctoNEAR is enough), so a limited access key can't.
    /// Changing the rules keeps what was already spent today.
    #[payable]
    pub fn set_wallet_policy(
        &mut self,
        token_id: TokenId,
        daily_allowance: NearToken,
        max_payment: NearToken,
    ) {
        require!(
            !env::attached_deposit().is_zero(),
            "Attach a deposit (at least 1 yoctoNEAR) to change a wallet's rules"
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
        let wallet = self
            .wallets
            .get_mut(&token_id)
            .unwrap_or_else(|| env::panic_str("Open the token's wallet first"));
        if wallet.owner_id != owner {
            // A new owner's rules: nothing carries over from the previous one.
            wallet.owner_id = owner;
            wallet.spent_today = NearToken::from_yoctonear(0);
        }
        if wallet.day != today() {
            wallet.day = today();
            wallet.spent_today = NearToken::from_yoctonear(0);
        }
        wallet.daily_allowance = daily_allowance;
        wallet.max_payment = max_payment;
        wallet.policy += 1;
    }

    /// Sends `amount` from the token's wallet to `receiver_id`. The token's
    /// owner (with 1 yoctoNEAR attached) may send anything; the keeper, for
    /// the token's mind, only within the owner's allowance. Resolves to
    /// whether it was sent; if not (the wallet doesn't hold that much, or the
    /// receiver doesn't exist), the mind's allowance is given back.
    #[payable]
    pub fn wallet_send(
        &mut self,
        token_id: TokenId,
        receiver_id: AccountId,
        amount: NearToken,
        memo: Option<String>,
    ) -> Promise {
        require!(!amount.is_zero(), "amount must be more than zero");
        let memo = memo.unwrap_or_default();
        require!(
            memo.chars().count() <= MAX_MEMO_CHARS,
            "memo must be at most 64 characters"
        );
        require!(
            self.wallets.get(&token_id).is_some(),
            "This token's wallet isn't open"
        );
        let owner = self.owner_of(&token_id);
        let by_mind = env::predecessor_account_id() != owner;
        let policy = if by_mind {
            self.assert_keeper();
            self.reserve_allowance(&token_id, &owner, amount)
        } else {
            assert_one_yocto();
            0
        };
        let payment = Payment {
            receiver_id: receiver_id.clone(),
            amount,
            by_mind,
            memo,
            at: U64(env::block_timestamp()),
        };
        Promise::new(wallet_account(&token_id))
            .function_call(
                "transfer".to_string(),
                near_sdk::serde_json::json!({ "receiver_id": receiver_id, "amount": amount })
                    .to_string()
                    .into_bytes(),
                NearToken::from_yoctonear(0),
                GAS_FOR_TRANSFER,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_SENT)
                    .on_wallet_sent(token_id, owner, policy, payment),
            )
    }

    /// Records a payment that went through, or gives the mind back what one
    /// that didn't had reserved. Never panics: that would undo the refund.
    #[private]
    pub fn on_wallet_sent(
        &mut self,
        token_id: TokenId,
        owner_id: AccountId,
        policy: u32,
        payment: Payment,
        #[callback_result] sent: Result<(), PromiseError>,
    ) -> bool {
        if sent.is_err() {
            if payment.by_mind {
                self.release_allowance(&token_id, &owner_id, policy, payment.amount, payment.at.0);
            }
            env::log_str("The wallet's transfer didn't go through");
            return false;
        }
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
        true
    }
}

impl Contract {
    fn owner_of(&self, token_id: &TokenId) -> AccountId {
        self.tokens
            .owner_by_id
            .get(token_id)
            .unwrap_or_else(|| env::panic_str("Token not found"))
    }

    /// Stores a new wallet record with no allowance, and returns what its
    /// storage costs. It is measured with the largest last payment it can
    /// hold, so it never needs more later.
    fn create_wallet_record(&mut self, token_id: &TokenId, owner: &AccountId) -> NearToken {
        let before = env::storage_usage();
        let largest = Payment {
            receiver_id: "a".repeat(64).parse().expect("valid account id"),
            amount: NearToken::from_yoctonear(u128::MAX),
            by_mind: true,
            memo: "\u{10FFFF}".repeat(MAX_MEMO_CHARS),
            at: U64(u64::MAX),
        };
        self.wallets.insert(
            token_id.clone(),
            Wallet {
                owner_id: owner.clone(),
                daily_allowance: NearToken::from_yoctonear(0),
                max_payment: NearToken::from_yoctonear(0),
                day: today(),
                spent_today: NearToken::from_yoctonear(0),
                payments: 0,
                last_payment: Some(largest),
                policy: 0,
            },
        );
        self.wallets.flush();
        let used = env::storage_usage().saturating_sub(before);
        if let Some(wallet) = self.wallets.get_mut(token_id) {
            wallet.last_payment = None;
        }
        env::storage_byte_cost().saturating_mul(used as u128)
    }

    /// Counts a payment by the mind against the owner's allowance, or refuses
    /// it. Returns the rules' version it was counted against.
    fn reserve_allowance(
        &mut self,
        token_id: &TokenId,
        owner: &AccountId,
        amount: NearToken,
    ) -> u32 {
        let wallet = self
            .wallets
            .get_mut(token_id)
            .filter(|w| &w.owner_id == owner && !w.daily_allowance.is_zero())
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
        wallet.policy
    }

    /// Gives back what a payment that failed had reserved, only to the owner
    /// and rules it was taken from, and only on the same day.
    fn release_allowance(
        &mut self,
        token_id: &TokenId,
        owner: &AccountId,
        policy: u32,
        amount: NearToken,
        at: u64,
    ) {
        if let Some(wallet) = self.wallets.get_mut(token_id) {
            if &wallet.owner_id == owner
                && wallet.policy == policy
                && wallet.day == at / NANOS_PER_DAY
            {
                wallet.spent_today = wallet.spent_today.saturating_sub(amount);
            }
        }
    }
}
