import { describe, expect, test } from "vitest";
import { contextHash, openContext, STARTER_PERSONALITY } from "../src/context.ts";
import { CorruptContextError } from "../src/errors.ts";
import { KatService } from "../src/kats.ts";
import { keysFromRootSecret } from "../src/keys.ts";
import { Meter } from "../src/meter.ts";
import { MemoryStore } from "../src/store.ts";
import { FakeChain, FakeInference, NEAR } from "./fakes.ts";

const CHAT = 2n * 10n ** 21n;
const SAVE = 5n * 10n ** 22n;
const keys = keysFromRootSecret(Buffer.alloc(32, 7));

async function setup(balance: bigint = NEAR) {
  const chain = new FakeChain();
  const store = new MemoryStore();
  const inference = new FakeInference();
  const meter = new Meter(chain);
  let now = 1_000_000;
  const kats = new KatService({
    chain,
    store,
    keys,
    inference,
    meter,
    prices: { chat: CHAT, save: SAVE },
    now: () => now,
    retryDelayMs: 0,
  });
  chain.mint("1", "alice.near", balance);
  await kats.wakeNew();
  return { chain, store, inference, meter, kats, advance: (ms: number) => (now += ms) };
}

/** Decrypts whatever context the chain currently points at. */
async function onChainContext(chain: FakeChain, store: MemoryStore, tokenId = "1") {
  const kat = chain.kats.get(tokenId);
  if (!kat?.context_ref || !kat.context_hash) {
    throw new Error("kat has no context");
  }
  return openContext(keys, tokenId, await store.get(kat.context_ref), kat.context_hash);
}

describe("wakeNew", () => {
  test("gives a new kat the starter personality as version 1, free of charge", async () => {
    const { chain, store, meter } = await setup();
    const doc = await onChainContext(chain, store);
    expect(doc).toMatchObject({
      token_id: "1",
      version: 1,
      personality: STARTER_PERSONALITY,
      memory_summary: "",
    });
    expect(chain.kats.get("1")?.context_hash).toBe(contextHash(doc).toString("base64"));
    expect(meter.pending("1")).toBe(0n);
  });

  test("wakes a kat with no balance at all", async () => {
    const { chain } = await setup(0n);
    expect(chain.kats.get("1")?.context_version).toBe("1");
  });

  test("leaves awake kats alone and wakes only new ones", async () => {
    const { chain, kats } = await setup();
    chain.mint("2", "bob.near", NEAR);
    expect(await kats.wakeNew()).toEqual(["2"]);
    expect(await kats.wakeNew()).toEqual([]);
    expect(chain.kats.get("1")?.context_version).toBe("1");
  });

  test("wakes a kat on a later pass when the first attempt failed", async () => {
    const { chain, kats } = await setup();
    chain.mint("2", "bob.near", NEAR);
    chain.failSetContext = 3;
    expect(await kats.wakeNew()).toEqual([]);
    expect(await kats.wakeNew()).toEqual(["2"]);
  });

  test("wakes more kats than fit in one page", async () => {
    const { chain, kats } = await setup();
    for (let id = 2; id <= 120; id++) {
      chain.mint(String(id), "bob.near", NEAR);
    }
    expect(await kats.wakeNew()).toHaveLength(119);
    expect(chain.kats.get("120")?.context_version).toBe("1");
  });
});

describe("getContext", () => {
  test("returns the context to the owner", async () => {
    const { kats } = await setup();
    expect(await kats.getContext("alice.near", "1")).toEqual({
      personality: STARTER_PERSONALITY,
      memory_summary: "",
      version: 1,
    });
  });

  test("refuses anyone who is not the owner", async () => {
    const { kats } = await setup();
    await expect(kats.getContext("bob.near", "1")).rejects.toMatchObject({
      status: 403,
      code: "not_owner",
    });
  });

  test("reports an unknown kat as not found", async () => {
    const { kats } = await setup();
    await expect(kats.getContext("alice.near", "99")).rejects.toMatchObject({ status: 404 });
  });

  test("reports a kat without a context as still waking up", async () => {
    const { chain, kats } = await setup();
    chain.mint("2", "alice.near", NEAR);
    await expect(kats.getContext("alice.near", "2")).rejects.toMatchObject({
      status: 409,
      code: "waking_up",
    });
  });

  test("refuses to serve a context that does not match the on-chain hash", async () => {
    const { chain, kats } = await setup();
    (chain.kats.get("1") as { context_hash: string }).context_hash =
      Buffer.alloc(32).toString("base64");
    await expect(kats.getContext("alice.near", "1")).rejects.toThrow(CorruptContextError);
  });
});

describe("setPersonality", () => {
  test("saves the prompt as the next version and charges one save", async () => {
    const { chain, store, meter, kats } = await setup();
    const view = await kats.setPersonality("alice.near", "1", "You are grumpy.");
    expect(view).toEqual({ personality: "You are grumpy.", memory_summary: "", version: 2 });
    expect(await onChainContext(chain, store)).toMatchObject({
      version: 2,
      personality: "You are grumpy.",
    });
    expect(meter.pending("1")).toBe(SAVE);
  });

  test("refuses anyone who is not the owner and changes nothing", async () => {
    const { chain, kats } = await setup();
    await expect(kats.setPersonality("bob.near", "1", "mine now")).rejects.toMatchObject({
      status: 403,
    });
    expect(chain.kats.get("1")?.context_version).toBe("1");
  });

  test.each([
    ["empty", ""],
    ["only whitespace", "   "],
    ["over 4000 characters", "x".repeat(4001)],
    ["not a string", 42 as unknown as string],
  ])("rejects a prompt that is %s", async (_name, prompt) => {
    const { kats } = await setup();
    await expect(kats.setPersonality("alice.near", "1", prompt)).rejects.toMatchObject({
      status: 400,
      code: "invalid_input",
    });
  });

  test("accepts a prompt of exactly 4000 characters", async () => {
    const { kats } = await setup();
    const view = await kats.setPersonality("alice.near", "1", "x".repeat(4000));
    expect(view.version).toBe(2);
  });

  test("refuses when the kat cannot pay for the save", async () => {
    const { chain, kats } = await setup(SAVE - 1n);
    await expect(kats.setPersonality("alice.near", "1", "grumpy")).rejects.toMatchObject({
      status: 402,
      code: "insufficient_balance",
      extra: { balance: (SAVE - 1n).toString(), required: SAVE.toString() },
    });
    expect(chain.kats.get("1")?.context_version).toBe("1");
  });

  test("counts unsettled charges against the balance", async () => {
    const { kats } = await setup(SAVE + SAVE - 1n);
    await kats.setPersonality("alice.near", "1", "first");
    await expect(kats.setPersonality("alice.near", "1", "second")).rejects.toMatchObject({
      status: 402,
    });
  });

  test("gives concurrent saves consecutive versions", async () => {
    const { chain, kats } = await setup();
    const results = await Promise.all([
      kats.setPersonality("alice.near", "1", "a"),
      kats.setPersonality("alice.near", "1", "b"),
      kats.setPersonality("alice.near", "1", "c"),
    ]);
    expect(results.map((view) => view.version)).toEqual([2, 3, 4]);
    expect(chain.kats.get("1")?.context_version).toBe("4");
  });

  test("keeps working when chain views lag behind its own save", async () => {
    const { chain, kats } = await setup();
    chain.staleViews = true;
    await kats.setPersonality("alice.near", "1", "first");
    const view = await kats.setPersonality("alice.near", "1", "second");
    expect(view.version).toBe(3);
    expect((await kats.getContext("alice.near", "1")).personality).toBe("second");
  });

  test("retries a save the chain rejected twice", async () => {
    const { chain, kats } = await setup();
    chain.failSetContext = 2;
    expect((await kats.setPersonality("alice.near", "1", "grumpy")).version).toBe(2);
  });

  test("gives up after three failed attempts and charges nothing", async () => {
    const { chain, meter, kats } = await setup();
    chain.failSetContext = 3;
    await expect(kats.setPersonality("alice.near", "1", "grumpy")).rejects.toThrow(
      "RPC unavailable",
    );
    expect(meter.pending("1")).toBe(0n);
    expect((await kats.getContext("alice.near", "1")).personality).toBe(STARTER_PERSONALITY);
  });
});

describe("chat", () => {
  test("replies, charges one message and reports the remaining balance", async () => {
    const { meter, kats } = await setup();
    const result = await kats.chat("alice.near", "1", "hello");
    expect(result.reply).toBe("reply 1");
    expect(result.verification.chat_id).toBe("chat-1");
    expect(result.balance).toBe((NEAR - CHAT).toString());
    expect(meter.pending("1")).toBe(CHAT);
  });

  test("prompts the model with the personality, memory and earlier messages", async () => {
    const { inference, kats } = await setup();
    await kats.setPersonality("alice.near", "1", "You are grumpy.");
    await kats.chat("alice.near", "1", "hello");
    await kats.chat("alice.near", "1", "how are you?");
    expect(inference.calls[1]).toEqual([
      { role: "system", content: "You are grumpy." },
      { role: "user", content: "hello" },
      { role: "assistant", content: "reply 1" },
      { role: "user", content: "how are you?" },
    ]);
  });

  test("refuses anyone who is not the owner without calling the model", async () => {
    const { inference, kats } = await setup();
    await expect(kats.chat("bob.near", "1", "hello")).rejects.toMatchObject({ status: 403 });
    expect(inference.calls).toHaveLength(0);
  });

  test.each([
    ["empty", ""],
    ["over 4000 characters", "x".repeat(4001)],
    ["missing", undefined as unknown as string],
  ])("rejects a message that is %s", async (_name, message) => {
    const { kats } = await setup();
    await expect(kats.chat("alice.near", "1", message)).rejects.toMatchObject({ status: 400 });
  });

  test("refuses when the kat cannot pay for a message", async () => {
    const { inference, kats } = await setup(CHAT - 1n);
    await expect(kats.chat("alice.near", "1", "hello")).rejects.toMatchObject({
      status: 402,
      code: "insufficient_balance",
    });
    expect(inference.calls).toHaveLength(0);
  });

  test("stops at the message the balance no longer covers", async () => {
    const { kats } = await setup(CHAT * 2n);
    await kats.chat("alice.near", "1", "one");
    expect((await kats.chat("alice.near", "1", "two")).balance).toBe("0");
    await expect(kats.chat("alice.near", "1", "three")).rejects.toMatchObject({ status: 402 });
  });

  test("charges nothing and remembers nothing when the model is down", async () => {
    const { inference, meter, kats } = await setup();
    inference.down = true;
    await expect(kats.chat("alice.near", "1", "hello")).rejects.toMatchObject({
      status: 503,
      code: "inference_unavailable",
    });
    expect(meter.pending("1")).toBe(0n);
    inference.down = false;
    await kats.chat("alice.near", "1", "again");
    expect(inference.calls[0]).toHaveLength(2);
  });
});

describe("memory", () => {
  test("folds the conversation into memory after twenty messages", async () => {
    const { chain, store, inference, meter, kats } = await setup();
    for (let i = 1; i <= 10; i++) {
      await kats.chat("alice.near", "1", `message ${i}`);
    }
    // Ten chat calls plus the summary call.
    expect(inference.calls).toHaveLength(11);
    expect(inference.calls[10]?.[1]?.content).toContain("user: message 1\nassistant: reply 1");
    expect(await onChainContext(chain, store)).toMatchObject({
      version: 2,
      personality: STARTER_PERSONALITY,
      memory_summary: "reply 11",
    });
    expect(meter.pending("1")).toBe(CHAT * 10n + SAVE);

    await kats.chat("alice.near", "1", "do you remember?");
    expect(inference.calls[11]).toEqual([
      { role: "system", content: `${STARTER_PERSONALITY}\n\nWhat you remember:\nreply 11` },
      { role: "user", content: "do you remember?" },
    ]);
  });

  test("keeps the conversation in the session when the save cannot be paid for", async () => {
    const { chain, inference, kats } = await setup(CHAT * 11n);
    for (let i = 1; i <= 10; i++) {
      await kats.chat("alice.near", "1", `message ${i}`);
    }
    expect(chain.kats.get("1")?.context_version).toBe("1");
    await kats.chat("alice.near", "1", "still there?");
    expect(inference.calls[10]).toHaveLength(22);
  });

  test("keeps the conversation when the summary call fails, and still replies", async () => {
    const { chain, inference, kats } = await setup();
    for (let i = 1; i <= 9; i++) {
      await kats.chat("alice.near", "1", `message ${i}`);
    }
    const original = inference.chat.bind(inference);
    inference.chat = async (messages) => {
      const result = await original(messages);
      inference.down = true;
      return result;
    };
    expect((await kats.chat("alice.near", "1", "message 10")).reply).toBe("reply 10");
    expect(chain.kats.get("1")?.context_version).toBe("1");
  });

  test("folds an idle conversation into memory after ten minutes", async () => {
    const { chain, store, kats, advance } = await setup();
    await kats.chat("alice.near", "1", "hello");
    advance(10 * 60 * 1000 - 1);
    await kats.consolidateIdle();
    expect(chain.kats.get("1")?.context_version).toBe("1");
    advance(1);
    await kats.consolidateIdle();
    expect(await onChainContext(chain, store)).toMatchObject({
      version: 2,
      memory_summary: "reply 2",
    });
    await kats.consolidateIdle();
    expect(chain.kats.get("1")?.context_version).toBe("2");
  });
});

describe("transfer", () => {
  test("hands the personality and memory to the new owner and locks out the old one", async () => {
    const { chain, kats } = await setup();
    await kats.setPersonality("alice.near", "1", "You are grumpy.");
    chain.transfer("1", "bob.near");
    expect((await kats.getContext("bob.near", "1")).personality).toBe("You are grumpy.");
    await expect(kats.getContext("alice.near", "1")).rejects.toMatchObject({ status: 403 });
    await expect(kats.chat("alice.near", "1", "hello?")).rejects.toMatchObject({ status: 403 });
  });

  test("does not show the new owner the previous owner's unsaved conversation", async () => {
    const { chain, inference, kats } = await setup();
    await kats.chat("alice.near", "1", "my secret");
    chain.transfer("1", "bob.near");
    await kats.chat("bob.near", "1", "hello");
    expect(JSON.stringify(inference.calls[1])).not.toContain("my secret");
    expect(inference.calls[1]).toHaveLength(2);
  });

  test("drops an idle conversation instead of saving it once the owner changed", async () => {
    const { chain, inference, kats, advance } = await setup();
    await kats.chat("alice.near", "1", "my secret");
    chain.transfer("1", "bob.near");
    advance(10 * 60 * 1000);
    await kats.consolidateIdle();
    expect(chain.kats.get("1")?.context_version).toBe("1");
    expect(inference.calls).toHaveLength(1);
  });
});
