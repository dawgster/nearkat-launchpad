# Nearkat NFT Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and test the NEAR NFT contract that owns each kat's identity, context hash and inference balance.

**Architecture:** One Rust crate in `contract/`. The NFT standard is delegated to `near-contract-standards`; kat state lives in a separate map keyed by token id, so transfers need no extra code for context and balance to follow the token. Keeper-only and admin-only methods are split into their own modules.

**Tech Stack:** Rust, near-sdk 5.29.1, near-contract-standards 5.29.1, near-workspaces 0.22 (sandbox tests).

**Spec:** `docs/superpowers/specs/2026-10-13-nearkat-ai-nft-design.md` (section "1. NFT contract").

This is plan 1 of 4. Later plans, each written when its predecessor is done: (2) keeper running locally, (3) web app, (4) probes plus TEE and NOVA deployment.

All code in this plan was compiled and run before the plan was written: every task's end state passes its tests, `cargo clippy --all-targets` is clean and `cargo fmt --check` passes.

## Global Constraints

- Implements NEP-171 (core), NEP-177 (metadata), NEP-178 (approvals); mint emits the NEP-297 `nft_mint` event.
- `set_context` and `debit_batch` are callable by the keeper account only.
- `set_context` requires `version == context_version + 1`.
- `mint` requires deposit >= `mint_price` + storage cost; deposit above that is credited to the kat's `balance`.
- A kat's `balance` stays with the token on transfer and is not withdrawable by its owner.
- `debit_batch` fails the whole batch if any kat has insufficient balance.
- Dependency versions: `near-sdk = "5.29.1"`, `near-contract-standards = "5.29.1"`.
- Use checked or saturating arithmetic on every `NearToken` operation.
- Two additions beyond the spec, both small: admin methods require exactly 1 yoctoNEAR attached (so a function-call access key cannot invoke them), and a `get_config` view exposes admin, keeper, treasury, mint price and accrued treasury.
- If cargo fails with `curl ... HTTP2 framing layer`, rerun with `CARGO_HTTP_MULTIPLEXING=false`.

## Review Focus

Each line names an input the spec implies but does not spell out, and the test that pins it.

1. A token id that does not exist reaches `get_kat` or `set_context`: the view returns `null`, the call panics with "Kat not found". Tests `get_kat_returns_none_for_unknown_id` (Task 2), `set_context_rejects_unknown_kat` (Task 4).
2. The same kat appears twice in one `debit_batch` and the entries only overdraw together: the batch fails. Test `debit_batch_counts_repeated_kat_entries_together` (Task 4).
3. The previous owner tries to move a kat they gave away: the call fails and ownership is unchanged. Test `previous_owner_cannot_transfer_back` (Task 6).
4. The admin replaces the keeper: the old keeper is rejected immediately. Test `replaced_keeper_loses_access` (Task 5).
5. The admin raises the mint price: the next mint at the old price fails. Test `mint_uses_the_updated_price` (Task 5).

## File Structure

| File | Responsibility |
|---|---|
| `contract/Cargo.toml` | Crate manifest. |
| `contract/src/lib.rs` | Contract state, `new`, `mint`, `fund`, views. |
| `contract/src/kat.rs` | `Kat` stored record, `KatView` and `ConfigView` JSON views. |
| `contract/src/nft.rs` | NEP-171/177/178 and enumeration, delegated to the standard library. |
| `contract/src/keeper.rs` | `set_context`, `debit_batch`. |
| `contract/src/admin.rs` | `set_keeper`, `set_mint_price`, `withdraw_treasury`. |
| `contract/src/tests.rs` | Unit tests. |
| `contract/tests/sandbox.rs` | Sandbox tests against the compiled wasm. |
| `contract/README.md` | How to test and build. |

---
### Task 1: Crate, state and initialisation

**Files:**
- Create: `contract/Cargo.toml`, `contract/.gitignore`, `contract/src/lib.rs`, `contract/src/kat.rs`
- Test: `contract/src/tests.rs`

**Interfaces:**
- Consumes: nothing.
- Produces: `Contract::new(admin_id: AccountId, keeper_id: AccountId, treasury_id: AccountId, mint_price: NearToken, base_uri: String) -> Contract`; `Contract::get_config(&self) -> ConfigView`; `Kat { context_hash: Option<[u8; 32]>, context_ref: Option<String>, context_version: u64, balance: NearToken }` with `Kat::new(balance)`; `KatView::new(owner_id, &Kat)`; test helpers `acc(&str) -> AccountId`, `ctx(predecessor: &str, deposit: NearToken)`, `deploy() -> Contract`, constant `PRICE` (1 NEAR).

- [ ] **Step 1: Create the manifest and ignore file**

`contract/Cargo.toml`:

```toml
[package]
name = "nearkat-nft"
version = "0.1.0"
edition = "2021"
publish = false

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
near-sdk = "5.29.1"
near-contract-standards = "5.29.1"

[dev-dependencies]
near-sdk = { version = "5.29.1", features = ["unit-testing"] }

[profile.release]
codegen-units = 1
opt-level = "z"
lto = true
debug = false
panic = "abort"
overflow-checks = true
```

`contract/.gitignore`:

```text
target/
```

- [ ] **Step 2: Write the failing test**

`contract/src/tests.rs`:

```rust
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, NearToken};

use crate::Contract;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(predecessor: &str, deposit: NearToken) {
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id(acc(predecessor))
        .attached_deposit(deposit)
        .build());
}

const PRICE: NearToken = NearToken::from_near(1);

fn deploy() -> Contract {
    ctx("admin.near", NearToken::from_yoctonear(0));
    Contract::new(
        acc("admin.near"),
        acc("keeper.near"),
        acc("treasury.near"),
        PRICE,
        "https://art.example/".to_string(),
    )
}

#[test]
fn new_stores_config() {
    let c = deploy();
    let cfg = c.get_config();
    assert_eq!(cfg.admin_id, acc("admin.near"));
    assert_eq!(cfg.keeper_id, acc("keeper.near"));
    assert_eq!(cfg.treasury_id, acc("treasury.near"));
    assert_eq!(cfg.mint_price, PRICE);
    assert!(cfg.treasury_accrued.is_zero());
}
```

- [ ] **Step 3: Write the record and view types**

`contract/src/kat.rs`:

```rust
use near_sdk::json_types::{Base64VecU8, U64};
use near_sdk::{near, AccountId, NearToken};

#[near(serializers = [borsh])]
pub struct Kat {
    pub context_hash: Option<[u8; 32]>,
    pub context_ref: Option<String>,
    pub context_version: u64,
    pub balance: NearToken,
}

impl Kat {
    pub fn new(balance: NearToken) -> Self {
        Self {
            context_hash: None,
            context_ref: None,
            context_version: 0,
            balance,
        }
    }
}

#[near(serializers = [json])]
#[derive(Debug, PartialEq)]
pub struct KatView {
    pub owner_id: AccountId,
    pub context_hash: Option<Base64VecU8>,
    pub context_ref: Option<String>,
    pub context_version: U64,
    pub balance: NearToken,
}

impl KatView {
    pub fn new(owner_id: AccountId, kat: &Kat) -> Self {
        Self {
            owner_id,
            context_hash: kat.context_hash.map(|h| h.to_vec().into()),
            context_ref: kat.context_ref.clone(),
            context_version: kat.context_version.into(),
            balance: kat.balance,
        }
    }
}

#[near(serializers = [json])]
pub struct ConfigView {
    pub admin_id: AccountId,
    pub keeper_id: AccountId,
    pub treasury_id: AccountId,
    pub mint_price: NearToken,
    pub treasury_accrued: NearToken,
}
```

- [ ] **Step 4: Write a lib.rs without `get_config` and confirm the test fails**

Create `contract/src/lib.rs` with the content from Step 5 but leave out the `get_config` method.

Run: `cd contract && cargo test --lib`
Expected: compile error `no method named \`get_config\` found for struct \`Contract\``.

- [ ] **Step 5: Complete lib.rs**

`contract/src/lib.rs`:

```rust
mod kat;

use near_contract_standards::non_fungible_token::{NonFungibleToken, TokenId};
use near_sdk::store::LookupMap;
use near_sdk::{near, AccountId, BorshStorageKey, NearToken, PanicOnDefault};

pub use kat::{ConfigView, Kat, KatView};

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    OwnerById,
    TokenMetadata,
    Enumeration,
    Approval,
    Kats,
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct Contract {
    tokens: NonFungibleToken,
    kats: LookupMap<TokenId, Kat>,
    admin_id: AccountId,
    keeper_id: AccountId,
    treasury_id: AccountId,
    mint_price: NearToken,
    base_uri: String,
    next_token_id: u64,
    treasury_accrued: NearToken,
}

#[near]
impl Contract {
    #[init]
    pub fn new(
        admin_id: AccountId,
        keeper_id: AccountId,
        treasury_id: AccountId,
        mint_price: NearToken,
        base_uri: String,
    ) -> Self {
        Self {
            tokens: NonFungibleToken::new(
                StorageKey::OwnerById,
                admin_id.clone(),
                Some(StorageKey::TokenMetadata),
                Some(StorageKey::Enumeration),
                Some(StorageKey::Approval),
            ),
            kats: LookupMap::new(StorageKey::Kats),
            admin_id,
            keeper_id,
            treasury_id,
            mint_price,
            base_uri,
            next_token_id: 1,
            treasury_accrued: NearToken::from_yoctonear(0),
        }
    }

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            admin_id: self.admin_id.clone(),
            keeper_id: self.keeper_id.clone(),
            treasury_id: self.treasury_id.clone(),
            mint_price: self.mint_price,
            treasury_accrued: self.treasury_accrued,
        }
    }
}

#[cfg(test)]
mod tests;
```

- [ ] **Step 6: Run the test**

Run: `cd contract && cargo test --lib`
Expected: `test result: ok. 1 passed`.

- [ ] **Step 7: Commit**

```bash
git add contract
git commit -m "feat(contract): add crate, state and initialisation"
```

### Task 2: NFT standard, mint and `get_kat`

**Files:**
- Create: `contract/src/nft.rs`
- Modify: `contract/src/lib.rs`, `contract/src/tests.rs`

**Interfaces:**
- Consumes: `Contract`, `Kat::new`, `KatView::new`, test helpers from Task 1.
- Produces: `Contract::mint(&mut self) -> Token` (payable; token ids are `"1"`, `"2"`, ... in mint order); `Contract::get_kat(&self, token_id: TokenId) -> Option<KatView>`; the standard methods `nft_transfer`, `nft_transfer_call`, `nft_token`, `nft_approve`, `nft_revoke`, `nft_revoke_all`, `nft_is_approved`, `nft_total_supply`, `nft_tokens`, `nft_supply_for_owner`, `nft_tokens_for_owner`, `nft_metadata`.

- [ ] **Step 1: Write the failing tests**

Append to `contract/src/tests.rs`:

```rust
#[test]
fn mint_assigns_token_to_caller_and_credits_excess() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(3));
    let token = c.mint();
    assert_eq!(token.token_id, "1");
    assert_eq!(token.owner_id, acc("alice.near"));
    let kat = c.get_kat("1".to_string()).unwrap();
    assert_eq!(kat.owner_id, acc("alice.near"));
    assert_eq!(kat.context_version.0, 0);
    assert!(kat.context_hash.is_none());
    // 3 NEAR minus 1 NEAR price minus a small storage cost
    assert!(kat.balance < NearToken::from_near(2));
    assert!(kat.balance > NearToken::from_millinear(1900));
    assert_eq!(c.get_config().treasury_accrued, PRICE);
}

#[test]
#[should_panic(expected = "Deposit too low")]
fn mint_rejects_deposit_that_only_covers_price() {
    let mut c = deploy();
    ctx("alice.near", PRICE);
    c.mint();
}

#[test]
fn get_kat_returns_none_for_unknown_id() {
    let c = deploy();
    assert!(c.get_kat("99".to_string()).is_none());
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd contract && cargo test --lib`
Expected: compile errors `no method named \`mint\`` and `no method named \`get_kat\``.

- [ ] **Step 3: Add the standard delegation**

`contract/src/nft.rs`:

```rust
use near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval;
use near_contract_standards::non_fungible_token::core::{
    NonFungibleTokenCore, NonFungibleTokenResolver,
};
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NonFungibleTokenMetadataProvider, NFT_METADATA_SPEC,
};
use near_contract_standards::non_fungible_token::{Token, TokenId};
use near_sdk::json_types::U128;
use near_sdk::{near, AccountId, Promise, PromiseOrValue};
use std::collections::HashMap;

use crate::{Contract, ContractExt};

#[near]
impl NonFungibleTokenCore for Contract {
    #[payable]
    fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
    ) {
        self.tokens
            .nft_transfer(receiver_id, token_id, approval_id, memo);
    }

    #[payable]
    fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        self.tokens
            .nft_transfer_call(receiver_id, token_id, approval_id, memo, msg)
    }

    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.tokens.nft_token(token_id)
    }
}

#[near]
impl NonFungibleTokenResolver for Contract {
    #[private]
    fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: TokenId,
        approved_account_ids: Option<HashMap<AccountId, u64>>,
    ) -> bool {
        self.tokens.nft_resolve_transfer(
            previous_owner_id,
            receiver_id,
            token_id,
            approved_account_ids,
        )
    }
}

#[near]
impl NonFungibleTokenApproval for Contract {
    #[payable]
    fn nft_approve(
        &mut self,
        token_id: TokenId,
        account_id: AccountId,
        msg: Option<String>,
    ) -> Option<Promise> {
        self.tokens.nft_approve(token_id, account_id, msg)
    }

    #[payable]
    fn nft_revoke(&mut self, token_id: TokenId, account_id: AccountId) {
        self.tokens.nft_revoke(token_id, account_id);
    }

    #[payable]
    fn nft_revoke_all(&mut self, token_id: TokenId) {
        self.tokens.nft_revoke_all(token_id);
    }

    fn nft_is_approved(
        &self,
        token_id: TokenId,
        approved_account_id: AccountId,
        approval_id: Option<u64>,
    ) -> bool {
        self.tokens
            .nft_is_approved(token_id, approved_account_id, approval_id)
    }
}

#[near]
impl NonFungibleTokenEnumeration for Contract {
    fn nft_total_supply(&self) -> U128 {
        self.tokens.nft_total_supply()
    }

    fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.tokens.nft_tokens(from_index, limit)
    }

    fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        self.tokens.nft_supply_for_owner(account_id)
    }

    fn nft_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u64>,
    ) -> Vec<Token> {
        self.tokens
            .nft_tokens_for_owner(account_id, from_index, limit)
    }
}

#[near]
impl NonFungibleTokenMetadataProvider for Contract {
    fn nft_metadata(&self) -> NFTContractMetadata {
        NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "Nearkat".to_string(),
            symbol: "KAT".to_string(),
            icon: None,
            base_uri: Some(self.base_uri.clone()),
            reference: None,
            reference_hash: None,
        }
    }
}
```

- [ ] **Step 4: Add `mint` and `get_kat` to lib.rs**

Replace the top of `contract/src/lib.rs` (module declarations and imports, down to the `StorageKey` enum) with:

```rust
mod kat;
mod nft;

use near_contract_standards::non_fungible_token::metadata::TokenMetadata;
use near_contract_standards::non_fungible_token::{NonFungibleToken, Token, TokenId};
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault};

pub use kat::{ConfigView, Kat, KatView};
```

Inside the `#[near] impl Contract` block, add after `new`:

```rust
    /// Mints the next kat to the caller. The deposit must cover the mint price
    /// plus storage; anything above that becomes the kat's inference balance.
    #[payable]
    pub fn mint(&mut self) -> Token {
        let deposit = env::attached_deposit();
        let storage_before = env::storage_usage();
        let token_id = self.next_token_id.to_string();
        self.next_token_id += 1;

        let metadata = TokenMetadata {
            title: Some(format!("Nearkat #{token_id}")),
            media: Some(format!("{token_id}.png")),
            ..Default::default()
        };
        let token = self.tokens.internal_mint_with_refund(
            token_id.clone(),
            env::predecessor_account_id(),
            Some(metadata),
            None,
        );
        self.kats
            .insert(token_id, Kat::new(NearToken::from_yoctonear(0)));
        self.kats.flush();

        let storage_cost =
            env::storage_byte_cost().saturating_mul((env::storage_usage() - storage_before).into());
        let required = self.mint_price.saturating_add(storage_cost);
        require!(
            deposit >= required,
            format!("Deposit too low: need at least {required}")
        );
        let balance = deposit.saturating_sub(required);
        self.kats
            .get_mut(&token.token_id)
            .unwrap_or_else(|| env::panic_str("Kat not found"))
            .balance = balance;
        self.treasury_accrued = self.treasury_accrued.saturating_add(self.mint_price);
        token
    }

    pub fn get_kat(&self, token_id: TokenId) -> Option<KatView> {
        let kat = self.kats.get(&token_id)?;
        let owner_id = self.tokens.owner_by_id.get(&token_id)?;
        Some(KatView::new(owner_id, kat))
    }
```

The storage cost is measured after the writes and checked before returning; a failed `require!` reverts every write in the call.

- [ ] **Step 5: Run the tests**

Run: `cd contract && cargo test --lib`
Expected: `test result: ok. 4 passed`.

- [ ] **Step 6: Commit**

```bash
git add contract
git commit -m "feat(contract): add NFT standard, mint and get_kat"
```

### Task 3: Funding a kat

**Files:**
- Modify: `contract/src/lib.rs`, `contract/src/tests.rs`

**Interfaces:**
- Consumes: `Contract::mint`, `Contract::get_kat`.
- Produces: `Contract::fund(&mut self, token_id: TokenId)` (payable, any caller); `Contract::kat_mut(&mut self, token_id: &TokenId) -> &mut Kat` (crate-private; panics with "Kat not found").

- [ ] **Step 1: Write the failing tests**

Append to `contract/src/tests.rs`:

```rust
#[test]
fn fund_adds_to_balance_from_any_account() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    let before = c.get_kat("1".to_string()).unwrap().balance;
    ctx("bob.near", NearToken::from_near(5));
    c.fund("1".to_string());
    let after = c.get_kat("1".to_string()).unwrap().balance;
    assert_eq!(after, before.saturating_add(NearToken::from_near(5)));
}

#[test]
#[should_panic(expected = "Kat not found")]
fn fund_rejects_unknown_kat() {
    let mut c = deploy();
    ctx("bob.near", NearToken::from_near(1));
    c.fund("99".to_string());
}

#[test]
#[should_panic(expected = "Attach NEAR")]
fn fund_rejects_zero_deposit() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    ctx("bob.near", NearToken::from_yoctonear(0));
    c.fund("1".to_string());
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd contract && cargo test --lib`
Expected: compile error `no method named \`fund\``.

- [ ] **Step 3: Implement**

In `contract/src/lib.rs`, inside the `#[near] impl Contract` block, add after `mint`:

```rust
    /// Adds the attached deposit to a kat's inference balance.
    #[payable]
    pub fn fund(&mut self, token_id: TokenId) {
        let deposit = env::attached_deposit();
        require!(!deposit.is_zero(), "Attach NEAR to fund a kat");
        let kat = self.kat_mut(&token_id);
        kat.balance = kat
            .balance
            .checked_add(deposit)
            .unwrap_or_else(|| env::panic_str("Balance overflow"));
    }
```

After that block, before `#[cfg(test)]`, add:

```rust
impl Contract {
    pub(crate) fn kat_mut(&mut self, token_id: &TokenId) -> &mut Kat {
        self.kats
            .get_mut(token_id)
            .unwrap_or_else(|| env::panic_str("Kat not found"))
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `cd contract && cargo test --lib`
Expected: `test result: ok. 7 passed`.

- [ ] **Step 5: Commit**

```bash
git add contract
git commit -m "feat(contract): add kat funding"
```

### Task 4: Keeper methods

**Files:**
- Create: `contract/src/keeper.rs`
- Modify: `contract/src/lib.rs`, `contract/src/tests.rs`

**Interfaces:**
- Consumes: `Contract::kat_mut`, `Contract::mint`, `Contract::get_kat`, `Contract::get_config`, `nft_transfer`.
- Produces: `Contract::set_context(&mut self, token_id: TokenId, context_hash: Base64VecU8, context_ref: String, version: U64)`; `Contract::debit_batch(&mut self, items: Vec<(TokenId, NearToken)>)`; test helper `hash(byte: u8) -> Base64VecU8` and constant `YOCTO`.

Over JSON, `context_hash` is standard base64 of 32 bytes, `version` is a decimal string, and `items` is an array of `[token_id, amount_in_yocto_string]` pairs.

- [ ] **Step 1: Add test helpers**

In `contract/src/tests.rs`, add as the first line of the file:

```rust
use near_contract_standards::non_fungible_token::core::NonFungibleTokenCore;
```

Add directly under the `PRICE` constant:

```rust
const YOCTO: NearToken = NearToken::from_yoctonear(1);
```

Add after the `deploy` function:

```rust
fn hash(byte: u8) -> near_sdk::json_types::Base64VecU8 {
    vec![byte; 32].into()
}
```

- [ ] **Step 2: Write the failing tests**

Append to `contract/src/tests.rs`:

```rust
#[test]
fn set_context_stores_hash_ref_and_version() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_context("1".to_string(), hash(7), "ref-1".to_string(), 1.into());
    let kat = c.get_kat("1".to_string()).unwrap();
    assert_eq!(kat.context_hash.unwrap().0, vec![7u8; 32]);
    assert_eq!(kat.context_ref.unwrap(), "ref-1");
    assert_eq!(kat.context_version.0, 1);
}

#[test]
#[should_panic(expected = "Only the keeper")]
fn set_context_rejects_owner() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    c.set_context("1".to_string(), hash(7), "ref-1".to_string(), 1.into());
}

#[test]
#[should_panic(expected = "Version must be 1")]
fn set_context_rejects_skipped_version() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_context("1".to_string(), hash(7), "ref-1".to_string(), 2.into());
}

#[test]
#[should_panic(expected = "Version must be 2")]
fn set_context_rejects_replayed_version() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_context("1".to_string(), hash(7), "ref-1".to_string(), 1.into());
    c.set_context("1".to_string(), hash(8), "ref-2".to_string(), 1.into());
}

#[test]
#[should_panic(expected = "context_hash must be 32 bytes")]
fn set_context_rejects_short_hash() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_context(
        "1".to_string(),
        vec![1u8; 31].into(),
        "ref-1".to_string(),
        1.into(),
    );
}

#[test]
#[should_panic(expected = "context_ref must be 1 to 256 bytes")]
fn set_context_rejects_oversized_ref() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_context("1".to_string(), hash(7), "x".repeat(257), 1.into());
}

#[test]
#[should_panic(expected = "Kat not found")]
fn set_context_rejects_unknown_kat() {
    let mut c = deploy();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_context("99".to_string(), hash(7), "ref-1".to_string(), 1.into());
}

#[test]
fn debit_batch_moves_balance_to_treasury() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(3));
    c.mint();
    let before = c.get_kat("1".to_string()).unwrap().balance;
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.debit_batch(vec![("1".to_string(), NearToken::from_millinear(5))]);
    let after = c.get_kat("1".to_string()).unwrap().balance;
    assert_eq!(after, before.saturating_sub(NearToken::from_millinear(5)));
    assert_eq!(
        c.get_config().treasury_accrued,
        PRICE.saturating_add(NearToken::from_millinear(5))
    );
}

#[test]
#[should_panic(expected = "Insufficient balance for kat 1")]
fn debit_batch_rejects_overdraw() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.debit_batch(vec![("1".to_string(), NearToken::from_near(50))]);
}

#[test]
#[should_panic(expected = "Only the keeper")]
fn debit_batch_rejects_admin() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    ctx("admin.near", NearToken::from_yoctonear(0));
    c.debit_batch(vec![("1".to_string(), NearToken::from_millinear(1))]);
}

#[test]
#[should_panic(expected = "Insufficient balance for kat 1")]
fn debit_batch_counts_repeated_kat_entries_together() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(3));
    c.mint();
    // Balance is just under 2 NEAR: each entry fits alone, both together do not.
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.debit_batch(vec![
        ("1".to_string(), NearToken::from_millinear(1500)),
        ("1".to_string(), NearToken::from_millinear(1500)),
    ]);
}

#[test]
fn transfer_keeps_context_and_balance_with_the_kat() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(3));
    c.mint();
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_context("1".to_string(), hash(7), "ref-1".to_string(), 1.into());
    let before = c.get_kat("1".to_string()).unwrap();
    ctx("alice.near", YOCTO);
    c.nft_transfer(acc("bob.near"), "1".to_string(), None, None);
    let after = c.get_kat("1".to_string()).unwrap();
    assert_eq!(after.owner_id, acc("bob.near"));
    assert_eq!(after.balance, before.balance);
    assert_eq!(after.context_hash, before.context_hash);
    assert_eq!(after.context_version, before.context_version);
}
```

- [ ] **Step 3: Run to confirm failure**

Run: `cd contract && cargo test --lib`
Expected: compile errors `no method named \`set_context\`` and `no method named \`debit_batch\``.

- [ ] **Step 4: Implement**

`contract/src/keeper.rs`:

```rust
use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::json_types::{Base64VecU8, U64};
use near_sdk::{env, near, require, NearToken};

use crate::{Contract, ContractExt};

const MAX_CONTEXT_REF_LEN: usize = 256;

#[near]
impl Contract {
    /// Records a new encrypted-context version for a kat. Keeper only.
    pub fn set_context(
        &mut self,
        token_id: TokenId,
        context_hash: Base64VecU8,
        context_ref: String,
        version: U64,
    ) {
        self.assert_keeper();
        let hash: [u8; 32] = context_hash
            .0
            .try_into()
            .unwrap_or_else(|_| env::panic_str("context_hash must be 32 bytes"));
        require!(
            !context_ref.is_empty() && context_ref.len() <= MAX_CONTEXT_REF_LEN,
            "context_ref must be 1 to 256 bytes"
        );
        let kat = self.kat_mut(&token_id);
        require!(
            version.0 == kat.context_version + 1,
            format!("Version must be {}", kat.context_version + 1)
        );
        kat.context_hash = Some(hash);
        kat.context_ref = Some(context_ref);
        kat.context_version = version.0;
    }

    /// Moves each amount from a kat's balance to the treasury. Keeper only.
    /// Any kat with insufficient balance fails the whole batch.
    pub fn debit_batch(&mut self, items: Vec<(TokenId, NearToken)>) {
        self.assert_keeper();
        for (token_id, amount) in items {
            let kat = self.kat_mut(&token_id);
            kat.balance = kat.balance.checked_sub(amount).unwrap_or_else(|| {
                env::panic_str(&format!("Insufficient balance for kat {token_id}"))
            });
            self.treasury_accrued = self
                .treasury_accrued
                .checked_add(amount)
                .unwrap_or_else(|| env::panic_str("Treasury overflow"));
        }
    }
}

impl Contract {
    fn assert_keeper(&self) {
        require!(
            env::predecessor_account_id() == self.keeper_id,
            "Only the keeper can call this method"
        );
    }
}
```

In `contract/src/lib.rs`, add `mod keeper;` after `mod kat;`.

- [ ] **Step 5: Run the tests**

Run: `cd contract && cargo test --lib`
Expected: `test result: ok. 19 passed`.

- [ ] **Step 6: Commit**

```bash
git add contract
git commit -m "feat(contract): add keeper-only set_context and debit_batch"
```

### Task 5: Admin methods

**Files:**
- Create: `contract/src/admin.rs`
- Modify: `contract/src/lib.rs`, `contract/src/tests.rs`

**Interfaces:**
- Consumes: `Contract` fields `admin_id`, `keeper_id`, `treasury_id`, `mint_price`, `treasury_accrued`; test helpers `YOCTO`, `hash`.
- Produces: `Contract::set_keeper(&mut self, keeper_id: AccountId)`; `Contract::set_mint_price(&mut self, mint_price: NearToken)`; `Contract::withdraw_treasury(&mut self) -> Promise`. All three are payable and require exactly 1 yoctoNEAR from the admin.

- [ ] **Step 1: Write the failing tests**

Append to `contract/src/tests.rs`:

```rust
#[test]
fn admin_can_change_keeper_and_price() {
    let mut c = deploy();
    ctx("admin.near", YOCTO);
    c.set_keeper(acc("keeper2.near"));
    c.set_mint_price(NearToken::from_near(2));
    let cfg = c.get_config();
    assert_eq!(cfg.keeper_id, acc("keeper2.near"));
    assert_eq!(cfg.mint_price, NearToken::from_near(2));
}

#[test]
#[should_panic(expected = "Only the admin")]
fn set_keeper_rejects_non_admin() {
    let mut c = deploy();
    ctx("alice.near", YOCTO);
    c.set_keeper(acc("alice.near"));
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn set_keeper_requires_one_yocto() {
    let mut c = deploy();
    ctx("admin.near", NearToken::from_yoctonear(0));
    c.set_keeper(acc("keeper2.near"));
}

#[test]
fn withdraw_treasury_zeroes_accrued() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    ctx("admin.near", YOCTO);
    let _ = c.withdraw_treasury();
    assert!(c.get_config().treasury_accrued.is_zero());
}

#[test]
#[should_panic(expected = "Nothing to withdraw")]
fn withdraw_treasury_rejects_empty() {
    let mut c = deploy();
    ctx("admin.near", YOCTO);
    let _ = c.withdraw_treasury();
}

#[test]
#[should_panic(expected = "Deposit too low")]
fn mint_uses_the_updated_price() {
    let mut c = deploy();
    ctx("admin.near", YOCTO);
    c.set_mint_price(NearToken::from_near(5));
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
}

#[test]
#[should_panic(expected = "Only the keeper")]
fn replaced_keeper_loses_access() {
    let mut c = deploy();
    ctx("alice.near", NearToken::from_near(2));
    c.mint();
    ctx("admin.near", YOCTO);
    c.set_keeper(acc("keeper2.near"));
    ctx("keeper.near", NearToken::from_yoctonear(0));
    c.set_context("1".to_string(), hash(7), "ref-1".to_string(), 1.into());
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd contract && cargo test --lib`
Expected: compile errors `no method named \`set_keeper\``, `\`set_mint_price\`` and `\`withdraw_treasury\``.

- [ ] **Step 3: Implement**

`contract/src/admin.rs`:

```rust
use near_sdk::{assert_one_yocto, env, near, require, AccountId, NearToken, Promise};

use crate::{Contract, ContractExt};

#[near]
impl Contract {
    #[payable]
    pub fn set_keeper(&mut self, keeper_id: AccountId) {
        self.assert_admin();
        self.keeper_id = keeper_id;
    }

    #[payable]
    pub fn set_mint_price(&mut self, mint_price: NearToken) {
        self.assert_admin();
        self.mint_price = mint_price;
    }

    /// Sends everything accrued from mints and debits to the treasury account.
    #[payable]
    pub fn withdraw_treasury(&mut self) -> Promise {
        self.assert_admin();
        let amount = self.treasury_accrued;
        require!(!amount.is_zero(), "Nothing to withdraw");
        self.treasury_accrued = NearToken::from_yoctonear(0);
        Promise::new(self.treasury_id.clone()).transfer(amount)
    }
}

impl Contract {
    fn assert_admin(&self) {
        assert_one_yocto();
        require!(
            env::predecessor_account_id() == self.admin_id,
            "Only the admin can call this method"
        );
    }
}
```

In `contract/src/lib.rs`, add `mod admin;` as the first module declaration.

- [ ] **Step 4: Run the tests**

Run: `cd contract && cargo test --lib`
Expected: `test result: ok. 26 passed`.

- [ ] **Step 5: Commit**

```bash
git add contract
git commit -m "feat(contract): add admin methods"
```

### Task 6: Sandbox tests and README

**Files:**
- Modify: `contract/Cargo.toml`
- Create: `contract/tests/sandbox.rs`, `contract/README.md`

**Interfaces:**
- Consumes: every public method from Tasks 1 to 5, called over JSON against the compiled wasm.
- Produces: `target/near/nearkat_nft.wasm` as a by-product of the test run.

These tests exercise finished code, so they are expected to pass on first run. A failure means the contract disagrees with the spec; fix the contract, not the test.

- [ ] **Step 1: Add the sandbox dependencies**

In `contract/Cargo.toml`, replace the `[dev-dependencies]` section with:

```toml
[dev-dependencies]
near-sdk = { version = "5.29.1", features = ["unit-testing"] }
near-workspaces = { version = "0.22", features = ["unstable"] }
# Vendored so the sandbox tests build without system OpenSSL headers.
openssl = { version = "0.10", features = ["vendored"] }
tokio = { version = "1", features = ["full"] }
serde_json = "1"
```

- [ ] **Step 2: Write the sandbox tests**

`contract/tests/sandbox.rs`:

```rust
use near_workspaces::network::Sandbox;
use near_workspaces::types::NearToken;
use near_workspaces::{Account, Contract, Worker};
use serde_json::{json, Value};

const PRICE: NearToken = NearToken::from_near(1);
const YOCTO: NearToken = NearToken::from_yoctonear(1);

struct Env {
    worker: Worker<Sandbox>,
    contract: Contract,
    admin: Account,
    keeper: Account,
    treasury: Account,
}

async fn setup() -> Result<Env, Box<dyn std::error::Error>> {
    let worker = near_workspaces::sandbox().await?;
    let wasm = near_workspaces::compile_project("./").await?;
    let contract = worker.dev_deploy(&wasm).await?;
    let admin = worker.dev_create_account().await?;
    let keeper = worker.dev_create_account().await?;
    let treasury = worker.dev_create_account().await?;
    contract
        .call("new")
        .args_json(json!({
            "admin_id": admin.id(),
            "keeper_id": keeper.id(),
            "treasury_id": treasury.id(),
            "mint_price": PRICE,
            "base_uri": "https://art.example/",
        }))
        .transact()
        .await?
        .into_result()?;
    Ok(Env {
        worker,
        contract,
        admin,
        keeper,
        treasury,
    })
}

async fn mint(
    env: &Env,
    who: &Account,
    deposit: NearToken,
) -> Result<String, Box<dyn std::error::Error>> {
    let token: Value = who
        .call(env.contract.id(), "mint")
        .deposit(deposit)
        .transact()
        .await?
        .into_result()?
        .json()?;
    Ok(token["token_id"].as_str().unwrap().to_string())
}

async fn kat(env: &Env, token_id: &str) -> Result<Value, Box<dyn std::error::Error>> {
    Ok(env
        .contract
        .view("get_kat")
        .args_json(json!({ "token_id": token_id }))
        .await?
        .json()?)
}

fn hash_b64(byte: u8) -> String {
    use near_sdk::base64::Engine;
    near_sdk::base64::engine::general_purpose::STANDARD.encode([byte; 32])
}

#[tokio::test]
async fn personality_and_balance_follow_the_kat_on_transfer(
) -> Result<(), Box<dyn std::error::Error>> {
    let env = setup().await?;
    let alice = env.worker.dev_create_account().await?;
    let bob = env.worker.dev_create_account().await?;

    let id = mint(&env, &alice, NearToken::from_near(3)).await?;
    env.keeper
        .call(env.contract.id(), "set_context")
        .args_json(json!({
            "token_id": id, "context_hash": hash_b64(7), "context_ref": "ref-1", "version": "1",
        }))
        .transact()
        .await?
        .into_result()?;
    let before = kat(&env, &id).await?;
    assert_eq!(before["owner_id"], alice.id().as_str());

    alice
        .call(env.contract.id(), "nft_transfer")
        .args_json(json!({ "receiver_id": bob.id(), "token_id": id }))
        .deposit(YOCTO)
        .transact()
        .await?
        .into_result()?;

    let after = kat(&env, &id).await?;
    assert_eq!(after["owner_id"], bob.id().as_str());
    assert_eq!(after["context_hash"], before["context_hash"]);
    assert_eq!(after["context_ref"], "ref-1");
    assert_eq!(after["context_version"], "1");
    assert_eq!(after["balance"], before["balance"]);
    Ok(())
}

#[tokio::test]
async fn previous_owner_cannot_transfer_back() -> Result<(), Box<dyn std::error::Error>> {
    let env = setup().await?;
    let alice = env.worker.dev_create_account().await?;
    let bob = env.worker.dev_create_account().await?;
    let id = mint(&env, &alice, NearToken::from_near(2)).await?;
    alice
        .call(env.contract.id(), "nft_transfer")
        .args_json(json!({ "receiver_id": bob.id(), "token_id": id }))
        .deposit(YOCTO)
        .transact()
        .await?
        .into_result()?;
    let result = alice
        .call(env.contract.id(), "nft_transfer")
        .args_json(json!({ "receiver_id": alice.id(), "token_id": id }))
        .deposit(YOCTO)
        .transact()
        .await?;
    assert!(result.is_failure());
    assert_eq!(kat(&env, &id).await?["owner_id"], bob.id().as_str());
    Ok(())
}

#[tokio::test]
async fn debit_batch_is_all_or_nothing() -> Result<(), Box<dyn std::error::Error>> {
    let env = setup().await?;
    let alice = env.worker.dev_create_account().await?;
    let rich = mint(&env, &alice, NearToken::from_near(5)).await?;
    let poor = mint(&env, &alice, NearToken::from_millinear(1100)).await?;
    let rich_before = kat(&env, &rich).await?["balance"].clone();
    let poor_before = kat(&env, &poor).await?["balance"].clone();

    let result = env
        .keeper
        .call(env.contract.id(), "debit_batch")
        .args_json(json!({ "items": [
            [rich, NearToken::from_near(1)],
            [poor, NearToken::from_near(1)],
        ]}))
        .transact()
        .await?;
    assert!(result.is_failure());
    assert_eq!(kat(&env, &rich).await?["balance"], rich_before);
    assert_eq!(kat(&env, &poor).await?["balance"], poor_before);
    Ok(())
}

#[tokio::test]
async fn withdraw_pays_mint_price_and_debits_to_treasury() -> Result<(), Box<dyn std::error::Error>>
{
    let env = setup().await?;
    let alice = env.worker.dev_create_account().await?;
    let id = mint(&env, &alice, NearToken::from_near(3)).await?;
    env.keeper
        .call(env.contract.id(), "debit_batch")
        .args_json(json!({ "items": [[id, NearToken::from_millinear(500)]] }))
        .transact()
        .await?
        .into_result()?;

    let before = env.treasury.view_account().await?.balance;
    env.admin
        .call(env.contract.id(), "withdraw_treasury")
        .deposit(YOCTO)
        .transact()
        .await?
        .into_result()?;
    let after = env.treasury.view_account().await?.balance;
    assert_eq!(
        after.as_yoctonear() - before.as_yoctonear(),
        NearToken::from_millinear(1500).as_yoctonear()
    );
    Ok(())
}

#[tokio::test]
async fn mint_storage_is_paid_by_the_minter() -> Result<(), Box<dyn std::error::Error>> {
    let env = setup().await?;
    let alice = env.worker.dev_create_account().await?;
    let id = mint(&env, &alice, NearToken::from_near(2)).await?;

    let account = env.contract.view_account().await?;
    let storage_locked = NearToken::from_yoctonear(account.storage_usage as u128 * 10u128.pow(19));
    let kat_balance: NearToken = serde_json::from_value(kat(&env, &id).await?["balance"].clone())?;
    // The contract must hold enough to cover its storage, the kat's balance and
    // the accrued treasury at the same time.
    let owed = storage_locked
        .saturating_add(kat_balance)
        .saturating_add(PRICE);
    assert!(account.balance >= owed, "{} < {}", account.balance, owed);
    Ok(())
}
```

- [ ] **Step 3: Run everything**

Run: `cd contract && cargo test`
Expected: `test result: ok. 26 passed` for the unit tests and `test result: ok. 5 passed` for `tests/sandbox.rs`. The first run takes several minutes.

- [ ] **Step 4: Lint and format**

Run: `cd contract && cargo clippy --all-targets && cargo fmt --check`
Expected: no warnings, no diff.

- [ ] **Step 5: Write the README**

`contract/README.md`:

````markdown
# Nearkat NFT contract

NEAR contract holding each kat's ownership, context hash and inference balance.
Design: `../docs/superpowers/specs/2026-10-13-nearkat-ai-nft-design.md`.

## Test

```bash
cargo test            # unit tests, then sandbox tests against the compiled wasm
cargo clippy --all-targets
cargo fmt --check
```

The first sandbox run downloads a NEAR sandbox binary and builds the wasm, so
it takes a few minutes.

## Build output

Running the sandbox tests writes the wasm to `target/near/nearkat_nft.wasm`.

`cargo near build` from cargo-near 0.17.0 refuses Rust 1.87 or newer, while the
dependencies need a newer compiler than 1.86. Upgrade cargo-near before using
the CLI to build for deployment.
````

- [ ] **Step 6: Commit**

```bash
git add contract
git commit -m "test(contract): add sandbox tests and README"
```

## Done when

- `cd contract && cargo test` reports 26 unit tests and 5 sandbox tests passing.
- `cargo clippy --all-targets` and `cargo fmt --check` are clean.
- `contract/target/near/nearkat_nft.wasm` exists.

Deployment to testnet and mainnet is part of plan 4.
