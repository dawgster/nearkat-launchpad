//! Lending a token: its owner lets someone else talk to it for a while,
//! without it changing hands.
//!
//! The owner offers a loan, to one account or to anyone, for a time, a number
//! of messages, or both, free or for a fee paid to them. A free loan to a named
//! account starts at once; any other starts when the borrower takes it with
//! `borrow`, paying the fee. The keeper lets the borrower talk to the token
//! while the loan is active, counts their messages, and follows the owner's
//! two choices: whether the token may draw on its memory, and whether what the
//! borrower says may change it. The borrower never reads its mind.
//!
//! A rented token (an active loan with a fee) can't change hands until the
//! loan ends, so a borrower gets the time they paid for. Any other loan ends
//! when the token changes hands. Loans live under their own storage keys, so
//! collections from before lending need no migration.

use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::json_types::U64;
use near_sdk::{assert_one_yocto, env, near, require, AccountId, NearToken, Promise};

use crate::{Contract, ContractExt};

const LOAN_PREFIX: &[u8] = b"loan:";
const NANOS_PER_SECOND: u64 = 1_000_000_000;
/// The longest a loan may last: a year.
const MAX_LOAN_SECONDS: u64 = 365 * 86_400;
const MAX_LOAN_MESSAGES: u32 = 100_000;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Loan {
    /// The owner who offered it. The loan is void once someone else owns the token.
    pub lender_id: AccountId,
    /// Who may borrow; None for anyone, until someone takes it.
    pub borrower_id: Option<AccountId>,
    /// How long it lasts once it starts. None: until it is ended.
    pub duration_s: Option<U64>,
    /// How many messages the borrower may send. None: no limit. The keeper counts them.
    pub messages: Option<u32>,
    /// Whether the token may draw on its memory when talking to the borrower.
    pub sees_memory: bool,
    /// Whether what the borrower says may change the token's memory and character.
    pub learns: bool,
    /// Paid by the borrower to the lender when they take it.
    pub fee: NearToken,
    /// Nanoseconds; set when the loan starts.
    pub started_at: Option<U64>,
    pub ends_at: Option<U64>,
    /// What the record's storage cost the lender; refunded when it goes.
    pub storage: NearToken,
}

#[near(serializers = [json])]
#[derive(Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum LoanStatus {
    /// Waiting for the borrower to take it.
    Offered,
    Active,
    /// Past its end, or void because the token changed hands.
    Over,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct LoanView {
    pub token_id: TokenId,
    pub status: LoanStatus,
    pub lender_id: AccountId,
    pub borrower_id: Option<AccountId>,
    pub duration_s: Option<U64>,
    pub messages: Option<u32>,
    pub sees_memory: bool,
    pub learns: bool,
    pub fee: NearToken,
    pub started_at: Option<U64>,
    pub ends_at: Option<U64>,
}

fn key(token_id: &TokenId) -> Vec<u8> {
    [LOAN_PREFIX, token_id.as_bytes()].concat()
}

fn read(token_id: &TokenId) -> Option<Loan> {
    env::storage_read(&key(token_id)).map(|bytes| {
        near_sdk::borsh::from_slice(&bytes)
            .unwrap_or_else(|_| env::panic_str("Loan record is corrupt"))
    })
}

fn write(token_id: &TokenId, loan: &Loan) {
    let bytes = near_sdk::borsh::to_vec(loan).unwrap_or_else(|_| env::panic_str("Can't encode"));
    env::storage_write(&key(token_id), &bytes);
}

fn log_event(event: &str, data: near_sdk::serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        near_sdk::serde_json::json!({
            "standard": "nearkat",
            "version": "1.0.0",
            "event": event,
            "data": [data],
        })
    ));
}

impl Loan {
    fn status(&self, owner_id: &AccountId) -> LoanStatus {
        if &self.lender_id != owner_id {
            return LoanStatus::Over;
        }
        match (self.started_at, self.ends_at) {
            (None, _) => LoanStatus::Offered,
            (Some(_), Some(end)) if env::block_timestamp() >= end.0 => LoanStatus::Over,
            _ => LoanStatus::Active,
        }
    }

    fn start(&mut self, borrower_id: AccountId) {
        let now = env::block_timestamp();
        self.borrower_id = Some(borrower_id);
        self.started_at = Some(U64(now));
        self.ends_at = self
            .duration_s
            .map(|seconds| U64(now.saturating_add(seconds.0.saturating_mul(NANOS_PER_SECOND))));
    }

    fn view(&self, token_id: &TokenId, owner_id: &AccountId) -> LoanView {
        LoanView {
            token_id: token_id.clone(),
            status: self.status(owner_id),
            lender_id: self.lender_id.clone(),
            borrower_id: self.borrower_id.clone(),
            duration_s: self.duration_s,
            messages: self.messages,
            sees_memory: self.sees_memory,
            learns: self.learns,
            fee: self.fee,
            started_at: self.started_at,
            ends_at: self.ends_at,
        }
    }
}

#[near]
impl Contract {
    /// The token's loan, offered, active or over; None if it has none.
    pub fn get_loan(&self, token_id: TokenId) -> Option<LoanView> {
        let owner_id = self.tokens.owner_by_id.get(&token_id)?;
        read(&token_id).map(|loan| loan.view(&token_id, &owner_id))
    }

    /// Offers the token on loan. Owner only. Attach enough for the record's
    /// storage (0.01 NEAR is plenty); the rest comes back. Replaces an offer
    /// or a loan that is over, but not one that is active.
    #[payable]
    #[allow(clippy::too_many_arguments)]
    pub fn lend(
        &mut self,
        token_id: TokenId,
        borrower_id: Option<AccountId>,
        duration_s: Option<U64>,
        messages: Option<u32>,
        sees_memory: bool,
        learns: bool,
        fee: Option<NearToken>,
    ) -> LoanView {
        let owner_id = self.owner_of(&token_id);
        require!(
            env::predecessor_account_id() == owner_id,
            "Only the token's owner can lend it"
        );
        require!(
            borrower_id.as_ref() != Some(&owner_id),
            "You can't lend a token to yourself"
        );
        if let Some(seconds) = duration_s {
            require!(
                seconds.0 > 0 && seconds.0 <= MAX_LOAN_SECONDS,
                "A loan lasts from a second to a year"
            );
        }
        if let Some(count) = messages {
            require!(
                count > 0 && count <= MAX_LOAN_MESSAGES,
                "A loan allows from 1 to 100,000 messages"
            );
        }
        if let Some(previous) = read(&token_id) {
            require!(
                previous.status(&owner_id) != LoanStatus::Active,
                "It is already on loan; end that loan first"
            );
            self.remove_loan(&token_id, previous);
        }
        let fee = fee.unwrap_or(NearToken::from_yoctonear(0));
        let mut loan = Loan {
            lender_id: owner_id.clone(),
            borrower_id: borrower_id.clone(),
            duration_s,
            messages,
            sees_memory,
            learns,
            fee,
            started_at: None,
            ends_at: None,
            storage: NearToken::from_yoctonear(0),
        };
        // A free loan to a named account starts at once.
        if fee.is_zero() {
            if let Some(borrower) = borrower_id {
                loan.start(borrower);
            }
        }
        // Measured with the record as stored, then stored again with its cost.
        let before = env::storage_usage();
        write(&token_id, &loan);
        let bytes = env::storage_usage().saturating_sub(before);
        let cost = env::storage_byte_cost().saturating_mul(u128::from(bytes));
        loan.storage = cost;
        write(&token_id, &loan);
        let deposit = env::attached_deposit();
        require!(
            deposit >= cost,
            format!("Attach at least {cost} for the loan's storage")
        );
        let refund = deposit.saturating_sub(cost);
        if !refund.is_zero() {
            Promise::new(owner_id.clone()).transfer(refund).detach();
        }
        let view = loan.view(&token_id, &owner_id);
        log_event(
            if view.status == LoanStatus::Active {
                "loan_started"
            } else {
                "loan_offered"
            },
            near_sdk::serde_json::to_value(&view).unwrap_or_default(),
        );
        view
    }

    /// Takes a loan on offer, paying its fee to the lender. Anything attached
    /// beyond the fee comes back.
    #[payable]
    pub fn borrow(&mut self, token_id: TokenId) -> LoanView {
        let owner_id = self.owner_of(&token_id);
        let mut loan = read(&token_id).unwrap_or_else(|| env::panic_str("It isn't on loan"));
        require!(
            loan.status(&owner_id) == LoanStatus::Offered,
            "This loan isn't on offer"
        );
        let borrower = env::predecessor_account_id();
        require!(borrower != owner_id, "You already own it");
        if let Some(named) = &loan.borrower_id {
            require!(named == &borrower, "This loan is offered to someone else");
        }
        let deposit = env::attached_deposit();
        require!(
            !deposit.is_zero() && deposit >= loan.fee,
            format!("Attach the fee, {}, to borrow it", loan.fee)
        );
        loan.start(borrower.clone());
        write(&token_id, &loan);
        if !loan.fee.is_zero() {
            Promise::new(loan.lender_id.clone())
                .transfer(loan.fee)
                .detach();
        }
        let refund = deposit.saturating_sub(loan.fee);
        if !refund.is_zero() {
            Promise::new(borrower).transfer(refund).detach();
        }
        let view = loan.view(&token_id, &owner_id);
        log_event(
            "loan_started",
            near_sdk::serde_json::to_value(&view).unwrap_or_default(),
        );
        view
    }

    /// Ends a loan. The borrower can always give it back early. The owner can
    /// withdraw an offer, or end a free loan, but not a paid one before its
    /// time. Anyone can clear a loan that is over.
    #[payable]
    pub fn end_loan(&mut self, token_id: TokenId) {
        assert_one_yocto();
        let owner_id = self.owner_of(&token_id);
        let loan = read(&token_id).unwrap_or_else(|| env::panic_str("It isn't on loan"));
        let caller = env::predecessor_account_id();
        match loan.status(&owner_id) {
            LoanStatus::Over => {}
            LoanStatus::Offered => require!(caller == owner_id, "Only the owner can withdraw it"),
            LoanStatus::Active => {
                let borrower = loan.borrower_id.as_ref() == Some(&caller);
                let owner_may = caller == owner_id && loan.fee.is_zero();
                require!(
                    borrower || owner_may,
                    if caller == owner_id {
                        "It's rented: the loan ends when its time is up, or when the borrower gives it back"
                    } else {
                        "Only the borrower or the owner can end it"
                    }
                );
            }
        }
        self.remove_loan(&token_id, loan);
        log_event(
            "loan_ended",
            near_sdk::serde_json::json!({ "token_id": token_id }),
        );
    }
}

impl Contract {
    /// Refuses a transfer while the token is rented out.
    pub(crate) fn assert_not_rented(&self, token_id: &TokenId) {
        let Some(owner_id) = self.tokens.owner_by_id.get(token_id) else {
            return;
        };
        if let Some(loan) = read(token_id) {
            require!(
                !(loan.status(&owner_id) == LoanStatus::Active && !loan.fee.is_zero()),
                "It's rented out: it can't change hands until the loan ends"
            );
        }
    }

    /// After a transfer: any loan is void, so its record goes and its storage is refunded.
    pub(crate) fn clear_loan(&mut self, token_id: &TokenId) {
        if let Some(loan) = read(token_id) {
            self.remove_loan(token_id, loan);
        }
    }

    fn remove_loan(&mut self, token_id: &TokenId, loan: Loan) {
        env::storage_remove(&key(token_id));
        if !loan.storage.is_zero() {
            Promise::new(loan.lender_id).transfer(loan.storage).detach();
        }
    }
}
