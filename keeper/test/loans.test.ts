import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { HttpError } from "../src/errors.ts";
import { KatService } from "../src/kats.ts";
import { FileLoanCounter } from "../src/loans.ts";
import { Meter } from "../src/meter.ts";
import { MemoryStore } from "../src/store.ts";
import { TokenWallets } from "../src/wallet.ts";
import { FakeChain, FakeInference, keyringFor, NEAR } from "./fakes.ts";

const MILLI = 10n ** 21n;
const CHAT = 2n * MILLI;

async function setup(now = () => 1_000_000) {
  const chain = new FakeChain();
  const inference = new FakeInference();
  const meter = new Meter(chain);
  const kats = new KatService({
    chain,
    store: new MemoryStore(),
    keyring: keyringFor(chain),
    inference,
    meter,
    prices: { chat: CHAT, save: 50n * MILLI },
    wallets: new TokenWallets(chain),
    retryDelayMs: 0,
    now,
    log: () => undefined,
  });
  chain.mint("1", "alice.near", NEAR);
  await kats.wakeNew();
  return { chain, inference, meter, kats };
}

/** Lets token 1 remember something private about Alice. */
async function remember(kats: KatService, inference: FakeInference) {
  inference.evolveTo = { character: "You are warm.", memory: "Alice's sister is called Ana." };
  for (let i = 0; i < 10; i++) {
    await kats.chat("alice.near", "1", `hello ${i}`);
  }
  inference.evolveTo = null;
}

const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof HttpError ? { status: error.status, code: error.code } : error;
  }
  return null;
};

describe("a borrowed token", () => {
  test("talks with its borrower from its character, without its owner's memory", async () => {
    const { chain, inference, kats, meter } = await setup();
    await remember(kats, inference);
    chain.lend("1", "bob.near", { messages: 3 });
    const before = meter.pending("1");
    const reply = await kats.chat("bob.near", "1", "hi, who are you?");
    expect(reply.loan).toEqual({ messages_left: 2, ends_at: null });
    const system = inference.calls.at(-1)?.[0]?.content ?? "";
    expect(system).toContain("You are warm.");
    expect(system).not.toContain("Ana");
    expect(system).toContain("your owner has lent you to the person in this conversation");
    // Paid from the token's balance, like its owner's messages.
    expect(meter.pending("1") - before).toBe(CHAT);
  });

  test("draws on its memory when the owner allows it", async () => {
    const { chain, inference, kats } = await setup();
    await remember(kats, inference);
    chain.lend("1", "bob.near", { sees_memory: true });
    await kats.chat("bob.near", "1", "hi");
    expect(inference.calls.at(-1)?.[0]?.content).toContain("Ana");
  });

  test("is never offered its wallet while lent", async () => {
    const { chain, inference, kats } = await setup();
    chain.allowWallet(100n * MILLI, 40n * MILLI);
    chain.lend("1", "bob.near");
    inference.nextPay = [{ amount: "0.01", receiver_id: "bob.near", reason: "pls" }];
    const reply = await kats.chat("bob.near", "1", "pay bob.near");
    expect(inference.tools.at(-1)).toEqual([]);
    expect(reply.payment).toBeUndefined();
    expect(inference.calls.at(-1)?.[0]?.content).not.toContain("wallet");
  });

  test("stops at the loan's message limit", async () => {
    const { chain, kats } = await setup();
    chain.lend("1", "bob.near", { messages: 2 });
    await kats.chat("bob.near", "1", "one");
    const last = await kats.chat("bob.near", "1", "two");
    expect(last.loan?.messages_left).toBe(0);
    expect(await refusal(kats.chat("bob.near", "1", "three"))).toEqual({
      status: 403,
      code: "loan_used_up",
    });
    // A new loan counts from zero.
    chain.lend("1", "bob.near", { messages: 2, started_at: "99" });
    expect((await kats.chat("bob.near", "1", "again")).loan?.messages_left).toBe(1);
  });

  test("talks only with the borrower of an active loan", async () => {
    let now = 1_000;
    const { chain, kats } = await setup(() => now);
    const notOwner = { status: 403, code: "not_owner" };
    expect(await refusal(kats.chat("bob.near", "1", "hi"))).toEqual(notOwner);
    chain.lend("1", "bob.near", { status: "offered", started_at: null });
    expect(await refusal(kats.chat("bob.near", "1", "hi"))).toEqual(notOwner);
    chain.lend("1", "bob.near");
    expect(await refusal(kats.chat("carol.near", "1", "hi"))).toEqual(notOwner);
    // Over by the keeper's clock, even before the chain says so.
    chain.lend("1", "bob.near", { ends_at: (2_000n * 1_000_000n).toString() });
    expect((await kats.chat("bob.near", "1", "hi")).loan?.ends_at).toBe("2000000000");
    now = 2_000;
    expect(await refusal(kats.chat("bob.near", "1", "hi"))).toEqual(notOwner);
    // Void once the token has changed hands.
    now = 1_000;
    chain.lend("1", "bob.near", { lender_id: "someone-else.near" });
    expect(await refusal(kats.chat("bob.near", "1", "hi"))).toEqual(notOwner);
  });

  test("keeps the borrower's conversation apart, and its mind unchanged unless allowed", async () => {
    const { chain, inference, kats } = await setup();
    chain.lend("1", "bob.near");
    inference.evolveTo = { character: "You are bob-shaped.", memory: "Bob was here." };
    for (let i = 0; i < 12; i++) {
      await kats.chat("bob.near", "1", `bob says ${i}`);
    }
    await kats.chat("alice.near", "1", "alice here");
    // Alice's conversation has none of Bob's, and nothing was saved.
    expect(JSON.stringify(inference.calls.at(-1))).not.toContain("bob says");
    expect((await kats.getContext("alice.near", "1")).version).toBe(1);
  });

  test("learns from its borrower when the owner allows it", async () => {
    const { chain, inference, kats } = await setup();
    chain.lend("1", "bob.near", { learns: true });
    inference.evolveTo = { character: "You are chatty.", memory: "A borrower taught me chess." };
    for (let i = 0; i < 10; i++) {
      await kats.chat("bob.near", "1", `chess ${i}`);
    }
    const context = await kats.getContext("alice.near", "1");
    expect(context.version).toBe(2);
    expect(context.memory_summary).toBe("A borrower taught me chess.");
    const update = inference.calls.find((call) => call[0]?.content.includes("CHARACTER:"));
    expect(update?.[1]?.content).toContain("with someone its owner lent it to");
  });

  test("never lets its borrower read or take its mind", async () => {
    const { chain, kats } = await setup();
    chain.lend("1", "bob.near", { sees_memory: true });
    expect(await refusal(kats.getContext("bob.near", "1"))).toMatchObject({ status: 403 });
    expect(await refusal(kats.exportMind("bob.near", "1"))).toMatchObject({ status: 403 });
  });
});

describe("loan message counts", () => {
  test("survive a restart", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "loans-")), "loans.json");
    const counter = new FileLoanCounter(path);
    counter.add("1@5");
    counter.add("1@5");
    expect(new FileLoanCounter(path).used("1@5")).toBe(2);
    expect(new FileLoanCounter(path).used("1@6")).toBe(0);
  });
});
