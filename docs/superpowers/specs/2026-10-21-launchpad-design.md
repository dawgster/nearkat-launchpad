# Launchpad design

A launchpad where anyone can launch their own collection of prompt-based
NFTs: tokens that share one public prompt, start from the same context, and
then each grow their own way through conversations with whoever owns them.
Nearkat becomes one collection among many.

Status: built end to end (contracts with on-chain TEE attestation, a keeper
serving many collections, web pages). Open items are listed at the end.

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
   `sha256("nearkat-keeper:v1:" + keeper NEAR public key)` followed by zeros.
   Before serving a TEE collection, the keeper fetches Intel's collateral for
   it (Phala's PCCS) and calls `register_keeper_key(public_key, quote,
   collateral, event_log)`. The contract:
   - verifies the quote against Intel's root with `dcap-qvl`, at the block
     time, refusing debug TDs and out-of-date or revoked platforms;
   - checks the report data commits to that key;
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
| `/c/:contract` | A collection: its public prompt and starter, who can open minds, whether this app's keeper serves it, mint, and your tokens. |
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

## Not done yet

1. **Private prompts.** Optionally encrypt the collection prompt to the TEE
   app, so only the enclave reads it. Buyers then trust the TEE instead of
   reading the prompt.
2. **Art from creators.** `base_uri` exists; the launch form should accept
   an image set, and generated SVGs should be served somewhere marketplaces
   can fetch them. Today the art only exists in this web app.
3. **Launchpad economics.** Fee level, creator royalties on resales
   (NEP-199 payouts), and the inference price per collection (the keeper
   charges one price everywhere).
4. **Upgrades.** Collections run immutable code by hash. A path for creators
   to move a live collection to a newer version, with state migration, is
   not designed yet.
5. **Storage.** Contexts are files on the keeper's disk. Encrypted, but a
   lost disk loses them; NOVA or another durable store is the next step.
