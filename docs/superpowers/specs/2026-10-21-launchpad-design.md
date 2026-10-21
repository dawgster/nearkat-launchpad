# Launchpad design

A launchpad where anyone can launch their own collection of prompt-based
NFTs: tokens that share one public prompt, start from the same context, and
then each grow their own way through conversations with whoever owns them.
Nearkat becomes one collection among many.

Status: first slice built (contracts, keeper changes, web pages). Open items
are listed at the end.

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
inside a given Phala Cloud (dstack) app. The guarantee rests on dstack's key
service, not on NEAR:

1. **Keys.** In `KEEPER_MODE=phala` the keeper takes its root secret from
   dstack's `GetKey`. The KMS derives keys from the app id, and releases them
   only to instances of that app running a compose hash its on-chain auth
   contract allows. Every kat key, the session key and the keeper's NEAR key
   derive from that root. The operator never sees it, and the keeper refuses
   to start in phala mode if `KEEPER_ROOT_SECRET` is set.
2. **Refusal.** Before waking or answering anything, the keeper reads the
   collection's `tee` and exits if it names an app other than the one it runs
   as, or if it runs in local mode.
3. **Evidence.** `/attestation` returns a TDX quote whose report data is
   `sha256("nearkat-keeper:v1:" + keeper NEAR public key)` followed by zeros,
   plus the event log, app id and compose hash.
4. **Browser check.** The verify page confirms the quote commits to the key
   the contract trusts, replays RTMR3 from the event log, recomputes the
   `app-id` event's digest, and compares the app id with the collection's
   requirement. It does not check Intel's signature on the quote or the KMS
   allow-list; it says so and points to Phala's attestation explorer. The
   best this page shows is "Partly checked".

What this does not stop yet:

- The collection admin can still `set_keeper` to another account. A keeper
  outside the app cannot decrypt existing contexts (it can't get the keys),
  but it could wake new tokens with contexts it can read. Closing this
  needs on-chain quote verification at keeper registration (below).
- The NEAR contract does not itself verify the quote. Anyone checking must do
  it off-chain, as the verify page does.

## Web app

| Path | What it is |
|---|---|
| `/launch` | Create a collection: name, symbol, address, prompt (with Character, Tutor and Game master templates), starter, price, supply, and who may open minds. Live preview of what token #1 is told. Lists launched collections. |
| `/c/:contract` | A collection: its public prompt and starter, who can open minds, mint, and your tokens. |

Launched collections get abstract generated art (a sigil seeded by contract
and token id) because their tokens can be anything; the home collection gets
kat portraits. Both grow through four stages as the token's on-chain context
version rises.

## Not done yet (next slices, in order)

1. **Multi-collection keeper.** Today a keeper serves one contract. One keeper
   should serve every collection that names it: per-collection meter and
   debit sequence, routes under `/c/:contract/kats/:id`, kat keys derived per
   contract and token. Until then, chatting with launched collections in the
   web app isn't wired up (the collection page says so).
2. **On-chain keeper attestation.** A `register_keeper(quote, collateral)`
   method that verifies the TDX quote on-chain (as NEAR's MPC contract does
   with `dcap-qvl`), checks the app id against `tee` and the report data
   against the signing key, and only then accepts that key. Then
   `set_keeper` can be closed for TEE collections.
3. **Private prompts.** Optionally encrypt the collection prompt to the TEE
   app, so only the enclave reads it. Buyers then trust the TEE instead of
   reading the prompt.
4. **Art from creators.** `base_uri` exists; the launch form should accept
   an image set, and the keeper or a static host should serve generated
   SVGs so marketplaces show the art.
5. **Launchpad economics.** Fee level, creator royalties on resales
   (NEP-199 payouts), and the inference price per collection.
