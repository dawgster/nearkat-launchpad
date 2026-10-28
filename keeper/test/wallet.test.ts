import { describe, expect, test } from "vitest";
import { KatService } from "../src/kats.ts";
import { Meter } from "../src/meter.ts";
import { MemoryStore } from "../src/store.ts";
import {
  formatNear,
  parseNear,
  readPayment,
  TokenWallets,
  walletInstructions,
} from "../src/wallet.ts";
import { FakeChain, FakeInference, keyringFor, NEAR } from "./fakes.ts";

const MILLI = 10n ** 21n;
const CHAT = 2n * MILLI;
const SAVE = 50n * MILLI;

async function setup() {
  const chain = new FakeChain();
  const inference = new FakeInference();
  const meter = new Meter(chain);
  const kats = new KatService({
    chain,
    store: new MemoryStore(),
    keyring: keyringFor(chain),
    inference,
    meter,
    prices: { chat: CHAT, save: SAVE },
    wallets: new TokenWallets(chain),
    retryDelayMs: 0,
    log: () => undefined,
  });
  chain.mint("1", "alice.near", NEAR);
  await kats.wakeNew();
  return { chain, inference, meter, kats };
}

describe("pay tool arguments", () => {
  test("give amount, receiver and reason", () => {
    expect(
      readPayment(JSON.stringify({ amount: "0.05", receiver_id: "bob.near", reason: "a gift" })),
    ).toEqual({ amount: 5n * 10n ** 22n, receiverId: "bob.near", memo: "a gift" });
    // A number is read the same.
    expect(readPayment('{"amount":1,"receiver_id":"bob.near","reason":""}').amount).toBe(
      10n ** 24n,
    );
  });

  test("are refused when they aren't a payment", () => {
    expect(() => readPayment("not json")).toThrow(/valid JSON/);
    expect(() => readPayment('{"amount":"-1","receiver_id":"bob.near"}')).toThrow(/amount/);
    expect(() => readPayment('{"amount":"1e3","receiver_id":"bob.near"}')).toThrow(/amount/);
    expect(() => readPayment('{"amount":"1","receiver_id":"Bob Near"}')).toThrow(/receiver_id/);
  });

  test("read amounts exactly", () => {
    expect(parseNear("1")).toBe(10n ** 24n);
    expect(parseNear("0.000000000000000000000001")).toBe(1n);
    expect(formatNear(1_250_000_000_000_000_000_000_000n)).toBe("1.25");
  });

  test("never cut a reason inside a character", () => {
    const { memo } = readPayment(
      JSON.stringify({ amount: "1", receiver_id: "bob.near", reason: "🐱".repeat(70) }),
    );
    expect(memo).toBe("🐱".repeat(64));
  });
});

describe("a token's mind and its wallet", () => {
  const pay = (amount: string, receiver_id = "bob.near", reason = "a gift") => ({
    amount,
    receiver_id,
    reason,
  });

  test("is told about its wallet and offered the pay tool while it may spend", async () => {
    const { chain, inference, kats } = await setup();
    chain.allowWallet(100n * MILLI, 40n * MILLI);
    await kats.chat("alice.near", "1", "do you have money?");
    const system = inference.calls[0]?.[0]?.content ?? "";
    expect(system).toContain("You have your own NEAR wallet, 1.nearkat.testnet");
    expect(system).toContain("Its balance is 1 NEAR");
    expect(system).toContain("at most 0.04 NEAR at a time and 0.1 NEAR a day");
    expect(system).toContain("use the pay tool");
    expect(inference.tools[0]).toEqual(["pay"]);
  });

  test("isn't offered the tool when its owner hasn't let it spend, and is told why", async () => {
    const { chain, inference, kats } = await setup();
    chain.allowWallet(0n, 0n);
    inference.nextPay = [pay("0.01")];
    const reply = await kats.chat("alice.near", "1", "pay bob.near");
    expect(inference.calls[0]?.[0]?.content).toContain("Your owner hasn't let you send from it");
    expect(inference.tools[0]).toEqual([]);
    expect(reply.payment).toBeUndefined();
  });

  test("pays within its allowance, then replies knowing it went through", async () => {
    const { chain, inference, kats, meter } = await setup();
    chain.allowWallet(100n * MILLI, 40n * MILLI);
    inference.nextPay = [pay("0.03")];
    inference.nextReply = "Done! A gift for Bob.";
    const reply = await kats.chat("alice.near", "1", "please send bob.near 0.03");
    expect(reply.reply).toBe("Done! A gift for Bob.");
    expect(reply.payment).toMatchObject({
      status: "sent",
      receiver_id: "bob.near",
      amount: (30n * MILLI).toString(),
      memo: "a gift",
    });
    expect(chain.walletSends).toEqual([
      { receiverId: "bob.near", amount: 30n * MILLI, memo: "a gift" },
    ]);
    // The model's second turn has its call and the tool's result, and no tools.
    const second = inference.calls[1] ?? [];
    expect(second.at(-2)).toMatchObject({ role: "assistant", tool_calls: [{ id: "call-0" }] });
    expect(second.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "call-0",
      content: "You sent 0.03 NEAR to bob.near from your wallet.",
    });
    expect(inference.tools[1]).toEqual([]);
    // A sent payment is charged like a save, on top of the message.
    expect(meter.pending("1")).toBe(CHAT + SAVE);
    // Later turns remember it too.
    await kats.chat("alice.near", "1", "did it work?");
    expect(JSON.stringify(inference.calls[2])).toContain(
      "You sent 0.03 NEAR to bob.near from your wallet.",
    );
  });

  test("pays only an account its owner named in this message", async () => {
    const { chain, inference, kats } = await setup();
    chain.allowWallet(100n * MILLI, 40n * MILLI);
    // Say something in its memory or character steers it to another account.
    inference.nextPay = [pay("0.01", "seller.near", "rent")];
    const reply = await kats.chat("alice.near", "1", "buy bob.near a coffee");
    expect(reply.payment).toMatchObject({
      status: "refused",
      reason: "Your owner didn't name seller.near in this message",
    });
    expect(chain.walletSends).toEqual([]);
    // A name that only contains the account doesn't count either.
    inference.nextPay = [pay("0.01", "bob.near")];
    const again = await kats.chat("alice.near", "1", "pay notbob.nearby");
    expect(again.payment).toMatchObject({ status: "refused" });
    expect(chain.walletSends).toEqual([]);
  });

  test("makes one payment per message", async () => {
    const { chain, inference, kats } = await setup();
    chain.allowWallet(100n * MILLI, 40n * MILLI);
    inference.nextPay = [pay("0.01"), pay("0.01")];
    const reply = await kats.chat("alice.near", "1", "pay bob.near twice");
    expect(reply.payment).toMatchObject({ status: "sent" });
    expect(chain.walletSends).toHaveLength(1);
    expect(inference.calls[1]?.at(-1)).toMatchObject({
      role: "tool",
      tool_call_id: "call-1",
      content: "Not made: only one payment per message.",
    });
  });

  test("is refused beyond its allowance, without a transaction, and is told so", async () => {
    const { chain, inference, kats, meter } = await setup();
    chain.allowWallet(100n * MILLI, 40n * MILLI);
    inference.nextPay = [pay("0.5")];
    const reply = await kats.chat("alice.near", "1", "send bob.near half a NEAR");
    expect(reply.payment).toMatchObject({
      status: "refused",
      reason: "That's more than the owner lets the mind send at once",
    });
    expect(chain.walletSends).toEqual([]);
    expect(meter.pending("1")).toBe(CHAT);
    expect(inference.calls[1]?.at(-1)?.content).toContain("did not go through");
  });

  test("tells the model when its call wasn't a payment", async () => {
    const { chain, inference, kats } = await setup();
    chain.allowWallet(100n * MILLI, 40n * MILLI);
    inference.nextPay = ['{"amount": "lots", "receiver_id": "bob.near"}'];
    const reply = await kats.chat("alice.near", "1", "pay bob.near");
    expect(reply.payment).toMatchObject({ status: "refused" });
    expect(inference.calls[1]?.at(-1)?.content).toBe(
      'Your payment was not made: amount must be a number of NEAR, like "0.05".',
    );
  });

  test("says a payment may still go through when sending it timed out, so the mind won't pay twice", async () => {
    const { chain, inference, kats } = await setup();
    chain.allowWallet(100n * MILLI, 40n * MILLI);
    chain.walletSendFailure = "unknown";
    inference.nextPay = [pay("0.01", "bob.near", "coffee")];
    const reply = await kats.chat("alice.near", "1", "buy bob.near a coffee");
    expect(reply.payment).toMatchObject({ status: "pending", receiver_id: "bob.near" });
    expect(inference.calls[1]?.at(-1)?.content).toContain(
      "may still go through; don't pay it again",
    );
  });

  test("keeps a payment it made when the model can't reply afterwards", async () => {
    const { chain, inference, kats } = await setup();
    chain.allowWallet(100n * MILLI, 40n * MILLI);
    inference.nextPay = [pay("0.01")];
    inference.downAfterTool = true;
    const reply = await kats.chat("alice.near", "1", "pay bob.near");
    expect(reply.payment).toMatchObject({ status: "sent" });
    expect(chain.walletSends).toHaveLength(1);
  });

  test("says a payment the contract refused didn't go through, with its reason", async () => {
    const { chain } = await setup();
    chain.allowWallet(100n * MILLI, 40n * MILLI);
    const wallet = await chain.getWallet("1");
    if (!chain.wallet || !wallet) {
      throw new Error("no wallet");
    }
    // The contract's own count is ahead of what the keeper last read.
    chain.wallet = { ...wallet, spent_today: (90n * MILLI).toString() };
    const wallets = new TokenWallets(chain);
    const outcome = await wallets.pay(
      "1",
      { address: wallet.account_id, balance: NEAR, view: wallet },
      { amount: 20n * MILLI, receiverId: "bob.near", memo: "coffee" },
    );
    expect(outcome).toMatchObject({
      status: "refused",
      reason: "That's more than the owner lets the mind send today",
    });
    expect(chain.walletSends).toEqual([]);
  });

  test("says a transfer that didn't go through was refused, and nothing was spent", async () => {
    const { chain, inference, kats } = await setup();
    chain.allowWallet(100n * MILLI, 40n * MILLI);
    chain.walletSendFailure = "failed";
    inference.nextPay = [pay("0.01", "nobody.near")];
    const reply = await kats.chat("alice.near", "1", "buy nobody.near a coffee");
    expect(reply.payment).toMatchObject({ status: "refused" });
    expect(chain.wallet?.spent_today).toBe("0");
  });

  test("isn't offered the tool for a wallet nobody has opened, and is told how it gets one", async () => {
    const { chain, inference, kats } = await setup();
    chain.allowWallet(100n * MILLI, 40n * MILLI, null, false);
    inference.nextPay = [pay("0.01")];
    const reply = await kats.chat("alice.near", "1", "buy bob.near a coffee");
    expect(inference.calls[0]?.[0]?.content).toContain("nobody has opened it yet");
    expect(inference.tools[0]).toEqual([]);
    expect(reply.payment).toBeUndefined();
  });

  test("can't pay more than its wallet holds", async () => {
    const { chain, inference, kats } = await setup();
    chain.allowWallet(100n * MILLI, 40n * MILLI, 5n * MILLI);
    inference.nextPay = [pay("0.01")];
    const reply = await kats.chat("alice.near", "1", "buy bob.near a coffee");
    expect(reply.payment).toMatchObject({
      status: "refused",
      reason: "The wallet doesn't hold that much",
    });
  });

  test("in a collection without wallets, no tool is offered and nothing is said about wallets", async () => {
    const { inference, kats } = await setup();
    inference.nextPay = [pay("0.01")];
    const reply = await kats.chat("alice.near", "1", "buy bob.near a coffee");
    expect(inference.calls[0]?.[0]?.content).not.toContain("wallet");
    expect(inference.tools[0]).toEqual([]);
    expect(reply.payment).toBeUndefined();
  });
});

describe("walletInstructions", () => {
  test("gives the wallet's account and balance once it's open", () => {
    const text = walletInstructions({
      address: "7.nearkat.testnet",
      balance: 2n * NEAR,
      view: {
        account_id: "7.nearkat.testnet",
        open: true,
        daily_allowance: "0",
        max_payment: "0",
        spent_today: "0",
        payments: 0,
        last_payment: null,
      },
    });
    expect(text).toContain(
      "You have your own NEAR wallet, 7.nearkat.testnet. Its balance is 2 NEAR.",
    );
  });
});
