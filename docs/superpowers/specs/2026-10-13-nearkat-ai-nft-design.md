# Nearkat AI NFTs: v1 design

Date: 2026-10-13
Status: awaiting review

## Goal

Each nearkat is an NFT on NEAR with an AI personality its holder can shape and
chat with. Giving the NFT away carries the personality and memories to the
recipient. Only the current owner can read a kat's prompt and memories; nobody
else can, including the operators of the service.

The idea follows Illia Polosukhin's "AI Tamagotchi" suggestion: verifiable
inference through NEAR AI, each character an NFT with NEAR attached that pays
for its inference.

### What the user decided

- Only the current owner may read a kat's prompt and memories in plaintext.
- v1 is NEAR-only. The $NEARKAT token lives on Solana and is not linked in v1.
- The keeper runs in a TEE so the operators cannot read prompts (option C).

### Out of scope for v1

- Any Solana or $NEARKAT integration (holder gating, payment).
- Feeding, dressing, battles, competitions, leaderboards.
- On-chain verification of the keeper's TEE attestation.
- Owner withdrawal of a kat's inference balance.
- Marketplace features beyond standard NFT transfer and approval.

## Architecture

Four units, each with one job and a narrow interface.

```
 Web app ──wallet tx──────────────► NFT contract (NEAR)
    │                                   ▲      ▲
    │ HTTPS (TLS ends in TEE)           │ view │ set_context / debit_batch
    ▼                                   │      │
 Keeper (container in dstack TEE) ──────┴──────┘
    │                │
    │ ciphertext     │ chat completion
    ▼                ▼
 Context store    NEAR AI Cloud (TEE inference, signed responses)
 (NOVA)
```

### 1. NFT contract (`contract/`, Rust, near-sdk)

Implements NEP-171 (core), NEP-177 (metadata), NEP-178 (approvals) and NEP-297
events. Ownership in this contract is the single source of truth for who may
access a kat.

Per-kat state:

| Field | Type | Meaning |
|---|---|---|
| `context_hash` | 32 bytes, optional | SHA-256 of `salt ‖ canonical plaintext context` |
| `context_ref` | string, optional | Opaque locator of the ciphertext in the context store |
| `context_version` | u64 | Starts at 0, increases by exactly 1 per update |
| `balance` | yoctoNEAR | Funds this kat's inference |

Methods:

| Method | Caller | Behaviour |
|---|---|---|
| `new(admin_id, keeper_id, treasury_id, mint_price, base_uri)` | deployer | Initialise. |
| `mint()` payable | anyone | Requires deposit ≥ `mint_price` + storage cost (measured bytes plus a fixed 600-byte reserve for later context, approval and transfer growth). Mints to the caller. Deposit above that amount is credited to the kat's `balance`. Emits a mint event. |
| `fund(token_id)` payable | anyone | Adds the deposit to the kat's `balance`. |
| `set_context(token_id, context_hash, context_ref, version)` | keeper only | Requires `version == context_version + 1`. |
| `debit_batch(seq, items: Vec<(token_id, amount)>)` | keeper only | Moves each amount from the kat's `balance` to the treasury accrual. Fails the whole batch if any kat has insufficient balance. `seq` must be one more than the last applied batch, so a batch re-sent after a lost confirmation cannot apply twice. |
| `get_kat(token_id)` view | anyone | Returns owner, the four fields above. |
| `set_keeper`, `set_mint_price`, `set_treasury`, `withdraw_treasury` | admin only | Administration. Each requires exactly 1 yoctoNEAR attached. A failed treasury transfer restores the accrued amount. |

A kat's `balance` stays with the token on transfer and is not withdrawable by
its owner.

### 2. Keeper (`keeper/`, TypeScript, one Docker container)

The only component that ever sees plaintext context. It runs unchanged in two
modes: locally for development, and inside a dstack TEE (Phala Cloud) for
production. It does not depend on the Shade Agent framework, which has been
unmaintained since 2026-04-19.

Internal modules, each behind an interface so they can be faked in tests:

| Module | Responsibility |
|---|---|
| `auth` | Issue a nonce; verify a NEP-413 signed message; issue a 15-minute session token bound to a NEAR account. |
| `chain` | Read `get_kat` at final finality; send `set_context` and `debit_batch` signed by the keeper's NEAR key. |
| `keys` | Derive the root secret from the TEE (dstack key derivation) or from an env var in local mode. Derive a per-kat AES-256-GCM key with HKDF over the token id. Derive the keeper's NEAR signing key. |
| `store` | `put(ciphertext) → ref` and `get(ref) → ciphertext`. Implementations: `NovaStore` (mainnet), `FileStore` (local and testnet, since NOVA's testnet does not persist uploads). |
| `inference` | Call NEAR AI Cloud's OpenAI-compatible API; return the reply plus the response signature data. |
| `context` | Load, decrypt, validate against the on-chain hash, mutate, re-encrypt, save. |
| `meter` | Accumulate per-kat charges and flush them with `debit_batch`. |

HTTP API (all `/kats/*` routes require a session token, and re-check on-chain
ownership on every request):

| Route | Behaviour |
|---|---|
| `POST /auth/challenge` | Returns a nonce. |
| `POST /auth/session` | Body: NEP-413 signature over the nonce. Returns a session token. |
| `GET /kats/:id/context` | Returns personality, memory summary and context version. |
| `PUT /kats/:id/personality` | Body: `{ prompt }`, at most 4,000 characters. Saves a new context version. |
| `POST /kats/:id/chat` | Body: `{ message }`, at most 4,000 characters. Returns `{ reply, verification, balance }`, where `verification` holds the chat id, model, request and response hashes, and NEAR AI's signature or `null`. |
| `GET /attestation` | Public. Returns the TEE quote, the image hash and the keeper's NEAR public key. In local mode returns `{ mode: "local" }`. |

### 3. Context store (NOVA)

One NOVA group holds all kats' blobs. The keeper's NOVA account is its only
member. NOVA provides storage on FastFS and an on-chain record of every write.

Privacy does not rest on NOVA: the keeper encrypts every blob with its
TEE-held per-kat key before upload. The operators create the NOVA account and
so hold its API key, which is why NOVA's own encryption cannot be the privacy
boundary.

### 4. Web app (`web/`, Next.js)

Pages: mint; my kats; kat detail (chat, edit personality, fund, transfer);
verify. Wallet connection through NEAR Connect. Contract calls go directly
from the wallet; everything touching context goes through the keeper.

The verify page shows, for a given kat: the on-chain `context_hash` and
version; for the owner, a locally recomputed hash of the context returned by
the keeper; the keeper's attestation and whether its public key matches the
`keeper_id` registered in the contract; and the NEAR AI signature of the most
recent reply.

## Data

Context document (plaintext, canonical JSON, encrypted as one blob):

```json
{
  "token_id": "42",
  "version": 7,
  "salt": "<32 random bytes, base64>",
  "personality": "<owner-authored system prompt>",
  "memory_summary": "<model-written summary of past conversations>"
}
```

`context_hash = SHA-256(salt ‖ canonical JSON without the salt field)`. The
salt prevents guessing a personality from its public hash.

## Flows

**Mint.** The wallet calls `mint()`. The keeper finds new kats by probing
consecutive token ids, creates a starter context, stores it, and calls
`set_context` with version 1, free of charge. Until that lands the kat shows
as "waking up".

**Shape.** The owner edits the personality. The keeper writes a new context
version, uploads it, and calls `set_context`.

**Chat.** The keeper loads the context, builds the prompt from personality,
memory summary and the current session's messages, calls NEAR AI, and returns
the reply. Session messages live only in the keeper's memory. After every 20
messages, or after 10 minutes of inactivity, the keeper asks the model to fold
the session into `memory_summary` and saves a new context version.

**Transfer.** A standard `nft_transfer`. No keeper action. The next request
from the old owner fails the ownership check; the new owner's first request
succeeds. In-memory session messages for that kat are dropped when the owner
changes.

**Metering.** Each chat message and each context save adds a charge to the
kat's running total. The meter flushes with `debit_batch` every 5 minutes.
Initial prices, set in keeper config and adjusted after the probes measure
real costs: 0.002 NEAR per chat message, 0.05 NEAR per context save. A request
is refused if the kat's on-chain balance minus unflushed charges would go
below zero. Unsettled charges are journaled to disk so they survive a
restart. If a kat still ends up owing more than it holds, the keeper charges
what it has and writes off the rest, so it cannot hold up other kats.

**Limits.** A memory summary is cut to 2,000 characters. A session keeps at
most 40 unsaved messages. Request bodies are limited to 16 KB. The keeper
runs as a single instance.

## Error handling

| Condition | Behaviour |
|---|---|
| Caller is not the current owner | 403. |
| Kat balance exhausted | 402 with the current balance; the app prompts to fund. |
| Stored context does not match on-chain hash | 500, kat marked "corrupted" in the response; no inference runs. |
| NEAR AI unavailable or times out | 503; nothing is charged. |
| Context store write fails | The save is retried with backoff; the on-chain hash is not updated until the upload succeeds. |
| `set_context` fails after upload | Retried; the uploaded blob is orphaned, which is harmless. |
| Keeper restarts mid-session | Unsaved session messages are lost. Saved context is unaffected. |
| `debit_batch` fails | Charges stay in the meter and the same numbered batch is re-sent on the next flush. |
| Kat transferred while a reply is being generated | 403; the reply is discarded and nothing is charged. |

## Trust model: what v1 does and does not guarantee

Guaranteed when the keeper runs in the TEE:

- Plaintext context exists only inside the TEE and in responses to the
  verified current owner.
- Anyone can check which image is running and that its key is the registered
  keeper.
- The owner can check that the context they see matches the on-chain hash.

Not guaranteed in v1:

- The admin can register a different keeper. Attestation is checked by
  observers, not by the contract.
- If the TEE root secret is lost, all contexts become unreadable. Whether
  dstack preserves derived keys across image upgrades is to be confirmed in
  the probes; the answer decides the upgrade procedure.
- Inference is paid by the operators in NEAR AI credits; the kat balance is a
  meter that pays the treasury, not a direct payment to NEAR AI.
- Neither NOVA nor dstack-based deployments in this stack have a published
  third-party audit.

## Build order

1. **Probes** (`probes/`, throwaway code, mainnet where needed):
   - NOVA: register a group, upload and retrieve from a Node process using
     only an API key; record real fees and size limits.
   - dstack: deploy a hello-world container on Phala Cloud; derive a key;
     fetch an attestation quote; redeploy a changed image and check whether
     the derived key survives.
   - NEAR AI Cloud: one chat completion and its signature verification;
     pick the model and record cost per message.
2. **Contract**, with unit tests and NEAR sandbox tests.
3. **Keeper**, running locally against testnet with `FileStore`.
4. **Web app** against testnet.
5. **TEE deployment**, `NovaStore`, verify page, mainnet.

If the NOVA probe fails, a `FastFsStore` replaces `NovaStore`; nothing else
changes.

## Testing

- **Contract:** unit tests for every method's access control and arithmetic;
  sandbox tests for mint, fund, transfer, `set_context` version ordering and
  `debit_batch` atomicity.
- **Keeper:** unit tests per module with fakes for chain, store and
  inference. Integration test of the full mint → shape → chat → transfer →
  chat-as-new-owner path against a sandbox contract.
- **Web:** one end-to-end test of that same path against local keeper and
  sandbox.

## Inputs needed from the project owner

These do not block the probes or the contract and keeper work:

- Kat artwork and metadata, or a rule for generating it, for `base_uri`.
- Mint price and any supply cap.
- Accounts: a funded NEAR mainnet account, a NOVA account and API key, a
  NEAR AI Cloud API key, a Phala Cloud account.
