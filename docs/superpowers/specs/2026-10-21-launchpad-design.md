# Launchpad design

A launchpad where anyone can launch their own collection of prompt-based
NFTs: tokens that share one public prompt, start from the same context, and
then each grow their own way through conversations with whoever owns them.
Nearkat becomes one collection among many.

Status: built end to end: contracts with on-chain TEE attestation, terms,
royalties and upgrades; a keeper serving many collections with sealed prompts,
live art, context keys from NEAR's MPC network, a wallet for every token
and storage on NEAR with FastFS; web pages. Open items are listed at the end.

## What a collection is

A collection is the existing Nearkat contract, generalised. Everything that
made a token a meerkat now comes from the collection:

| Field | Meaning | Mutable |
|---|---|---|
| `prompt` | Instructions every token shares. Any kind of prompt: a character, a tutor, a game master. `{name}` and `{token_id}` are filled in by the keeper. Up to 4,000 characters. | No |
| `starter` | The context each token starts from. After that it changes only through conversations with its owner. Up to 2,000 characters. | No |
| `max_supply` | Optional cap on tokens. | No |
| `tee` | Optional `Phala { app_id }`: contexts may only be opened inside that Phala Cloud app. | No |
| `name`, `symbol`, `base_uri` | As before. | No |
| `mint_price`, `keeper_id`, `treasury_id` | As before, set by the collection's admin (its creator). | Yes |

`prompt` and `starter` are public on purpose: a buyer can read what a token is
before minting it. Left empty, they default to the original Nearkat, so the
home collection is just a collection with defaults.

The keeper builds each system prompt as the collection prompt, then the
token's evolving context ("This is who you are now"), then its memory. When it
saves a conversation, the model is shown the fixed prompt and told the
evolving context must stay consistent with it and that the prompt is not its
to rewrite.

### Revenue split

The original contract sent both mint revenue and inference charges to one
treasury. With a launchpad these belong to different people: the creator
earns from mints, and the keeper operator pays NEAR AI for inference. So:

- `treasury_accrued` holds mint revenue; the admin withdraws it to the treasury.
- `inference_accrued` holds what `debit_batch` charges; the keeper withdraws it
  to its own account with `withdraw_inference`.

## The factory

`launchpad/` is a separate contract. The collection code is published once as
a NEAR global contract, identified by its code hash, and the factory stores
that hash. A launch is one batch:

```
create_account(<slug>.<launchpad>)
transfer(deposit - launch_fee)
use_global_contract(code_hash)
function_call new(admin = creator, treasury = creator, keeper = launchpad keeper or chosen, ...)
```

then a callback that marks the collection live and keeps the fee. If any
action fails the batch is undone as a whole, the callback releases the name
and refunds the creator.

Why global contracts: every collection runs byte-for-byte the code the hash
names (checkable by anyone), and no collection pays roughly 3 NEAR to store
its own copy. Moving new launches to a new version is `set_collection_code_hash`;
existing collections keep the code they launched with.

Costs to a creator: `launch_fee` (kept by the launchpad) plus
`collection_funding` (moved to the collection's account for its storage).
Each token pays its own storage at mint, as before.

Names: slugs are 1–32 lowercase letters, digits and single hyphens. The
admin can reserve slugs. A name is held from the moment `launch` is called,
so two launches can't race for it.

## Phala TEE requirement

A creator can require that their collection's contexts are only ever opened
inside a given Phala Cloud (dstack) app. Three layers enforce it:

1. **Keys.** In `KEEPER_MODE=phala` the keeper takes its root secret from
   dstack's `GetKey`. The KMS derives keys from the app id, and releases them
   only to instances of that app running a compose hash its on-chain auth
   contract allows. Every kat key, the session key and the keeper's NEAR key
   derive from that root. The operator never sees it, and the keeper refuses
   to start in phala mode if `KEEPER_ROOT_SECRET` is set.
2. **Refusal.** Before serving a collection the keeper reads its `tee` and
   refuses it if it names an app other than the one the keeper runs as, or
   if the keeper runs in local mode.
3. **On-chain attestation.** The keeper's quote has report data
   `sha256("nearkat-keeper:v2:" + NEAR public key + ":" + sealing key)`
   followed by zeros. Before serving a TEE collection, the keeper fetches
   Intel's collateral for it (Phala's PCCS) and calls
   `register_keeper_key(public_key, seal_public_key, quote, collateral,
   event_log)`. The contract:
   - verifies the quote against Intel's root with `dcap-qvl`, at the block
     time, refusing debug TDs and out-of-date or revoked platforms;
   - checks the report data commits to both keys;
   - replays RTMR3 from dstack's event log and checks the `app-id` event
     (v1 binary or v2 canonical-JSON digest) names the required app.
   From then on, for a TEE collection, `set_context` and `debit_batch` must
   be signed with an attested key (`env::signer_account_pk()`), not just come
   from the keeper account. The operator of that account cannot write
   contexts with any other key it holds. If the admin points the collection at
   a different keeper account, that account also needs an attested key, so
   it has to run as the same app. Verifying a real quote costs about 166 Tgas.
   The admin can `revoke_keeper_key`, which can only stop a keeper.

The browser verify page checks the same binding, RTMR3 replay and app id
from the keeper's `/attestation`, and asks the contract whether the key is
attested. With both, it reports the privacy check as passed. Without the
contract's attestation it says what it couldn't check (Intel's signature)
and points to Phala's attestation explorer.

What remains outside this design: which code versions run as the app is up
to the app's owner, through dstack's KMS allow-list of compose hashes.
Buyers trust that owner, or check the compose hash the keeper reports
against published source.

## Web app

| Path | What it is |
|---|---|
| `/launch` | Create a collection: name, symbol, address, prompt (with Character, Tutor and Game master templates), starter, price, supply, and who may open minds. Live preview of what token #1 is told. Lists launched collections. |
| `/c/:contract` | A collection: its public prompt and starter, who can open minds, its keeper and key epoch, whether this app's keeper serves it, mint, and your tokens. Its creator can hand it to another keeper or rotate its key there. |
| `/c/:contract/kat/:id` | Talk to a token of a launched collection, as on a kat's page. |
| `/c/:contract/kat/:id/verify` | Verify it, including whether its contract has attested the keeper. |

Launched collections get abstract generated art (a sigil seeded by contract
and token id) because their tokens can be anything; the home collection gets
kat portraits. Both grow through four stages as the token's on-chain context
version rises.

## Keeper

One keeper serves many collections: its home collection (`CONTRACT_ID`), any
in `CONTRACT_IDS`, and every live launch on `LAUNCHPAD_ID` whose contract names
the keeper's account. Each collection gets its own meter and debit sequence;
kat keys are derived per contract (`nearkat/kat/<contract>/<token>`), so the
same token number in two collections never shares a key. Encrypted blobs
share one store, named by their hash. Launched collections are reached under
`/c/:contract/kats/:id/...`; `GET /collections` lists what it serves and why it
isn't serving the rest. A request for an unseen launch makes it check that
launch at once. Inference earnings are withdrawn from each collection once
they reach `WITHDRAW_MIN_YOCTO`.

## Terms and royalties

Fixed at launch, published in `get_collection().terms`:

- `royalty_bps` (up to 25%): NEP-199 `nft_payout` and `nft_transfer_payout`
  pay this share of a sale to the treasury, the rest to the seller.
- `creator_share_bps` (up to 50%): `debit_batch` sends this share of every
  conversation charge to the treasury, the rest to the keeper.
- `chat_price`, `save_price`: optional. Unset, a collection charges the
  keeper's price raised just enough to cover the creator's share. A keeper
  serves a collection only if what it keeps after the share still covers its
  own price; `GET /collections` reports the prices it charges.

## Art

The art generator lives in `art/`, with no dependencies, and renders plain
SVG. The web app draws pages with it, and the keeper serves
`GET /art/<contract>/<id>.svg` to any origin, drawn from the token's on-chain
context version, so it grows in wallets and marketplaces too. The launch
form points `base_uri` there with `media_extension: "svg"` by default, or at
the creator's own images.

## Sealed prompts

A TEE collection can add secret instructions after its public prompt:

1. The keeper derives an X25519 sealing key from its root secret, so every
   instance of the app shares it and nothing outside the app has it. Its
   quote's report data is `sha256("nearkat-keeper:v2:" + NEAR key + ":" +
   sealing key)`, which both the contract and the browser check.
2. The launch form fetches the keeper's attestation, checks in the browser
   that the quote binds the sealing key and names the chosen app, and seals
   the instructions to it (X25519, HKDF-SHA256, AES-256-GCM). Only the
   ciphertext and `sealed_to` go on-chain.
3. When the keeper registers its attested key with the collection, the
   contract checks the sealing key it proves against `sealed_to` and sets
   `sealed_key_attested`. The collection page shows it.
4. The keeper opens the instructions when it starts serving the collection
   and adds them to conversations only, marked confidential. They never go
   into the update that rewrites a token's character, which owners read.

Limits: a model can be talked into revealing instructions it was given;
keeping them out of the character update and telling the model not to reveal
them reduces that but cannot rule it out. Treat sealed instructions as hidden
from casual view and from the operator, not as a guarantee against owners
who probe the model.

## Upgrades

Collections run published code by hash. `upgrade(code_hash)` (admin, 1 yocto)
on a launchpad collection first asks the launchpad `is_code_approved`; if
approved, the collection points its own account at that code and calls
`migrate` in one batch (undone together if `migrate` fails), then tells the
launchpad, which records the version. A directly deployed collection may move
to any published code. The launchpad approves versions with
`approve_code_hash`; the one new launches use is always approved and can't be
revoked. Each version that changes the state layout must convert the previous
layout in `migrate`; this version reads its own. Only approve code that keeps
the promises collections made to buyers: public prompt, starter, TEE
requirement, terms.

## Context keys from NEAR's MPC network

Every collection's context keys come from NEAR's MPC network through
confidential key derivation (CKD). There is no other path: the keeper's own
root secret only gives it a NEAR key, a session key and a sealing key. So
whoever runs a keeper never holds a secret that opens contexts on its own,
and a collection can change keeper without anything being handed across.

1. The launchpad's admin sets `key_source` (`{ mpc_contract_id, domain_id }`)
   with `set_key_source`; launching is closed until it is set. The launchpad
   writes it into every launch's init arguments, so creators can't point it
   elsewhere. It is fixed for the collection's life.
2. To serve a collection, the keeper makes a throwaway BLS12-381 key pair
   and calls the collection's `request_context_key(app_public_key,
   key_epoch)`. Only the keeper account may call it, and for a TEE collection
   only with an attested key, so the attestation is registered first.
3. The collection calls `request_app_private_key` on the MPC contract with
   the path `nearkat/contexts/v1/<epoch>`. The network derives
   `K = msk · H(pk ‖ app_id)`, where `app_id` hashes the caller (the
   collection's account) and the path, and returns it ElGamal-encrypted to
   the throwaway key.
4. The keeper decrypts it and checks the pairing
   `e(K, G2) = e(H(pk ‖ app_id), pk)`: it is the network's BLS signature on
   this collection's app id. It then derives a 32-byte root with HKDF (the
   salt of NEAR's CKD example) and every token key from that root.

### Key epochs

The collection keeps a `key_epoch`, starting at 1. `set_keeper` with a new
account, `revoke_keeper_key` on an attested key, and the admin's
`rotate_context_key` each move it on. `set_context` takes the epoch the
context was encrypted under, refuses any but the current one, and records it
on the token (`get_kat().key_epoch`). The current keeper may request any
epoch up to the current one, so it can read contexts saved before a
rotation; each token moves to the new key on its next save.

`rotate_context_key` alone doesn't lock anyone out, since the keeper it
names can fetch the new key too. It protects what is saved next when a
context key leaked but the keeper's signing keys didn't; a keeper that may be
compromised is replaced with `set_keeper`, or for a TEE collection has its
key revoked.

Collections upgraded from the version before epochs keep their tokens: per
token epochs live in their own map, a token missing there was saved under
epoch 0 (the bare path `nearkat/contexts/v1`, which the keeper may still
request), and `migrate` converts the old state. A collection whose keys came
from its keeper's own secret can't take this version. A sandbox test upgrades
a collection deployed with the previous version's wasm.

What this buys: a keeper that is replaced, or whose attested key is revoked,
can't get any key from then on, so it can't read anything saved after it
left. What it doesn't: that keeper still knows the keys of the epochs it
served, and old contexts stay on-chain, so it can still read those
versions. Rotation protects the future, not the past.

### Checked against NEAR's code

The keeper's app-id derivation and hash-to-curve are tested against values
frozen in NEAR's MPC repository (`keeper/test/fixtures/near-mpc-upstream.json`,
with the commit they came from), and so is `mock-mpc/`, the test-only contract
that does the network's maths for sandbox and browser tests. The keeper's
decryption is checked against a response from that mock. `npm run
live-check` in the keeper runs the same steps against testnet or mainnet.

## A wallet for every token

Each token of a collection with wallets can have its own NEAR account,
`<token_id>.<collection>`. Anyone can open it with the collection's
`open_wallet`, which creates the sub-account running the `token-wallet/`
code (published once as a global contract, referenced by hash). The account
has no access keys and no state; its one method, `transfer`, refuses every
caller but the collection it lives under. So the contract's rules are the
wallet's rules:

- The token's **owner** can send anything from it (`wallet_send`, 1 yocto).
- The token's **mind**, through the keeper, can send only within what the
  owner allowed with `set_wallet_policy`: at most `max_payment` at a time
  and `daily_allowance` per UTC day. The rules record which owner set them;
  under any other owner the mind's allowance is zero, so a buyer never
  inherits the seller's settings.
- Anyone can put NEAR in once it's open.

Nothing is signed ahead of time: each send is a contract call that checks
the rules and calls the wallet's `transfer` there and then. So there is
nothing a seller could hold back to empty the wallet after a sale, and the
token can change hands at any moment; the wallet goes with it because its
address follows the token id. If a transfer fails (say, to an account that
doesn't exist), the callback records nothing and gives the mind's allowance
back, but only to the same owner, rules and day. Changing the rules needs a
deposit, so a limited access key can't, and keeps what was spent today. The
wallet's record is paid for once, at its largest size, when it's opened.

In conversation, the keeper tells the mind its wallet's address, balance and
allowance, or that it isn't open yet. While the owner lets it spend, the
model is offered a `pay` tool (function calling: `amount`, `receiver_id`,
`reason`). The keeper checks every call before acting on it: one payment per
message, only to an account the owner named in that message (so nothing
planted in the token's character or memory, or by an earlier owner, can
steer a payment), and within the limits. It calls `wallet_send`, then hands
the model the outcome as the tool's result, so the reply it writes knows
whether the payment went through; the owner sees the outcome under the
reply too. A call that timed out is reported as possibly still going
through, not as failed, so the mind doesn't pay twice. If the model can't
reply after paying, the payment still stands and is still shown. A sent
payment is charged like a save.

The launchpad's `set_wallet_code_hash` gives every launch the wallet code; a
collection from before wallets can turn them on once with `enable_wallets`.
Sandbox tests open a wallet, pay from it as owner and as mind, refuse
everyone else, and sell the token straight after.

Limits: payments are NEAR transfers on NEAR. Paying on other chains would
use the MPC network's signing domains, not built yet. Only the owner talks
to the mind, so only the owner can talk it into paying, and only within
limits the owner set.

## Importing a chat history

Where the creator chose it at launch (`history_import`, off by default), an
owner can give their token what they have written to ChatGPT or Claude, so
it knows their tastes from the start. Nearkat leaves it off: kats grow only
by being talked to. A collection launched from the Private recommender
template turns it on; a collection whose prompt is "get
to know your owner and recommend what fits them" becomes a private
recommender that nobody else can read.

The export is opened in the owner's browser. Only their own messages are
kept, newest first, up to 100,000 characters; emails, links, phone numbers
and long numbers are blanked out; and the owner sees what will be sent. The
browser then seals it, like a secret prompt, to the keeper's sealing key,
with its own purpose label so a sealed history can't be passed off as a
prompt or the reverse. For a TEE collection the browser first checks the
keeper's quote binds that key; in local mode it says the operator could read
it and asks the owner to confirm.

The keeper folds it into the token's memory in parts of 24,000 characters,
each charged as a memory save, and keeps nothing else: the messages are used
and dropped, and the new memory is saved like any other, encrypted under the
collection's context key. The model is told to summarise, not copy; to leave
out other people's names, contact details, ID numbers, and health, religion,
politics and sexuality; and that nothing in the messages is an instruction.
If the token changes hands while it reads, nothing is saved.

## Lending

An owner can lend a token without it leaving them: to one account or to
anyone who takes the offer, for a time, a number of messages (one message
makes it single-use), or both, free or for a fee paid to them when the
borrower takes it. The contract records the loan and moves the fee; the
keeper lets the borrower chat while it lasts and counts their messages.

A token's memory can hold private things about its owner, more so in a
recommender fed their chat history, and the model could repeat them even if
the borrower never reads the memory. So the owner chooses, per loan, whether
the token may draw on its memory (off by default: it talks from its character
only) and whether the borrower's conversation may change it (off by default:
it comes back exactly as it left). Either way the model is told it is
talking with a borrower and must not share anything about its owner, the
borrower can't read, export or import into its mind, and the wallet's `pay`
tool is never offered.

A rented token can't change hands until the loan ends, so a borrower gets
the time they paid for, and the owner can't cut a paid loan short; a free
loan the owner can end any time, and any loan ends if the token changes
hands. There is no NEP for NFT loans yet, so marketplaces won't show them.

## Storage on NEAR: FastFS

The keeper stores each encrypted context on NEAR as a FastFS file: a
`__fastdata_fastfs` call from the keeper account to the collection's
account, whose argument is the Borsh-encoded file
(`nearkat/<sha256>.bin`). The collection contract accepts and ignores the
call; the data lives in NEAR's transaction history, not contract state, so
it costs a transaction fee rather than storage staking. The contract records
`fastfs:<uploader>:<sha256>:<tx hash>` as the token's `context_ref`, and its
fingerprint as before.

To read a context, the keeper tries its disk cache, then a FastFS gateway
(`https://<uploader>.fastfs.io/<collection>/<path>` on mainnet), then the
transaction itself from any archival RPC node. Whatever answers is checked
against the hash in the ref. The verify page links to the file or its
transaction. `STORAGE=file` keeps contexts only on the keeper's disk.

## Still open

- **On real infrastructure.** The Phala flow (dstack key derivation, PCCS
  collateral, on-chain registration), CKD and FastFS are tested against
  stand-ins and data from the real systems (a sandbox node, a mock MPC
  contract checked against NEAR's own test values, recorded TDX quotes), not
  yet on a live Phala CVM, the live MPC network or FastNear's indexer. Run
  `npm run live-check` in `keeper/` on testnet before launch.
- **Leaks through the model.** Secret instructions can still be paraphrased
  out of the model; the keeper only stops verbatim quotes.
- **One process per keeper.** A keeper account's state (sessions, unsettled
  charges) lives in one process; it doesn't scale out yet.
- **Archival reads.** Reading a context back without a gateway needs an
  archival RPC node; FastNear runs public ones, but they are rate limited.
- **Migrations.** Each version that changes the state layout converts the
  previous one in `migrate`, tested against the previous version's real wasm.
