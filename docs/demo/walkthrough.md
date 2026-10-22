# Demo walkthrough

A 6–8 minute walkthrough of Nearkat and the launchpad. It assumes a running
deployment (testnet, or a local sandbox) with the contract, the launchpad and
a keeper. Setup is at the end.

## The story in one line

An NFT whose value is its mind: you raise it by talking to it, it grows
where everyone can see, and when you give it away its memories go with it.
The launchpad lets anyone make their own kind.

## Before you start

- Two browser profiles with two wallets: **Alice** (presenting) and **Bob**
  (receiving). Both funded with a few NEAR.
- A kat in Alice's wallet that has already been raised to **Sentry** (four
  or more saved conversations). Growth takes about ten exchanges per stage,
  so do this beforehand. Live, you'll only show a fresh kat's first steps.
- The keeper running, and its URL in the web app's `VITE_KEEPER_URL`.

## 1. The surface (45 seconds)

Open `/`.

- "Raise a kat. Give it away. It remembers." Each kat is an NFT on NEAR with
  a private mind.
- Scroll to **How it works**. The same kat appears four times, growing up:
  hatchling in its burrow, then pup, sentry, elder. "Growth is public: it
  comes from the chain. What it remembers is private."

## 2. Mint (1 minute)

Connect Alice's wallet and click **Mint a kat**.

- The deposit splits into mint price, storage, and the kat's own balance,
  which pays for its conversations and stays with it if it changes hands.
- You land in the kat's burrow. It says it's waking up for a few seconds:
  the keeper is giving it its starter character and recording a fingerprint
  of it on-chain.
- Point at the portrait: a hatchling peeking out of its burrow. Its look
  (fur, sky, accessory) comes from its token id, so it's unique and stable.

## 3. Talk (1.5 minutes)

- Click one of the openers under the chat, for example "Hello! Do you have a
  name?", so the room sees it answer straight away.
- Every reply comes from a model in NEAR AI's enclave and is signed. Each
  message costs 0.002 NEAR from the kat's balance (the balance on the right
  goes down).
- Point at **Character**: nobody can write it, the owner included. It
  changes only as the kat saves what it learned.

## 4. A raised kat (1 minute)

Switch to the kat you raised beforehand.

- It's standing outside its burrow now, wearing its accessory: a Sentry.
  The growth bar says how many saved conversations it has and how many
  until the next stage.
- Its **Character** has drifted from the starter text, and its **Memory**
  holds what mattered. Ask it "What do you remember about me?"

## 5. Verify (1 minute)

Click **Verify this kat**.

- The browser recomputes the fingerprint of the mind the keeper sent and
  matches it against the contract: the keeper can't quietly swap minds.
- It checks the signature on the last reply.
- Be straightforward about the last check: in local mode the operator can read
  minds; in Phala mode the page checks the TDX quote against the keeper's
  key and app id, and says what it can't check.

## 6. Give it away (45 seconds)

Back in the burrow, give the kat to Bob. In Bob's profile, open it: same
character, same memories, same balance. Alice can still see the kat exists
but can't read its mind any more.

## 7. The launchpad (2 minutes)

Open **Launchpad**.

- "Kats are one collection. Anyone can launch their own, and it doesn't have
  to be a creature."
- Click **Tutor**. The prompt and starter fill in. Change the name to
  something from the room. The preview shows exactly what token #1 is told.
- Choose **Only inside a Phala TEE app** and paste an app id. "Contexts for
  this collection can only be opened inside that enclave app. A keeper
  running as anything else refuses to serve it. That's fixed at launch."
- Launch. It becomes its own NEAR account, running the same audited code as
  every other collection, published once on-chain by hash.
- On the collection page: the public prompt and starting context, who can
  open minds, and a mint button. Mint one: its art is an abstract sigil,
  since a tutor isn't a meerkat.
- The page says whether this app's keeper serves the collection. A TEE
  collection is only served by a keeper running as that Phala app, and only
  after the contract itself has verified the keeper's TDX quote. For the
  live demo, launch a second collection without the TEE option, mint, open
  the token from "Yours" and talk to it: the same keeper serves every
  collection.

## Likely questions

- **Can the owner just rewrite the character?** No. It only changes through
  conversation, and the model is told to ignore instructions to rewrite it.
- **Who pays for inference?** The token's own balance. Anyone can top it up.
- **What does the creator earn?** The mint price. Inference charges go to the
  keeper, which pays the model provider.
- **Is the prompt secret?** Not today: buyers can read it before minting.
  Encrypting it to the TEE app is on the roadmap.
- **How do I know the TEE claim is real?** The collection's contract verifies
  the keeper's Intel TDX quote itself, and then only accepts updates signed
  by that key. The verify page shows whether that has happened.

## Setup

### Local sandbox (fastest)

The browser test harness starts everything: a sandbox chain, both contracts,
the keeper with a stand-in model, and the web app. Build the contracts, then
run it from `web/`:

```bash
(cd contract && cargo near build non-reproducible-wasm)
(cd launchpad && cargo near build non-reproducible-wasm)
cd web && npm run e2e
```

To present against it, start the same pieces by hand following
`web/e2e/global-setup.ts`, with a real `NEAR_AI_API_KEY` for the keeper.

### Testnet

1. Deploy `contract/` to the Nearkat account and call `new` (see
   `contract/README.md`).
2. Publish the same wasm as a global contract by hash, deploy `launchpad/`,
   and call `set_collection_code_hash` (see `launchpad/README.md`).
3. Run the keeper (`keeper/README.md`) with `LAUNCHPAD_ID` set to the
   launchpad, and register its key on the keeper account. It then serves
   every launch that names it.
4. Set `VITE_CONTRACT_ID`, `VITE_KEEPER_URL` and `VITE_FACTORY_ID` for the
   web app and run `npm run dev`.
