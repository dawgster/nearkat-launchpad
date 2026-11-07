import { describe, expect, test } from "vitest";
import { katForToken } from "../../art/kat/collection.ts";
import { natureOf } from "../../art/kat/natures.ts";
import { KatService } from "../src/kats.ts";
import { Meter } from "../src/meter.ts";
import { MemoryStore } from "../src/store.ts";
import { FakeChain, FakeInference, keyringFor, NEAR } from "./fakes.ts";

const MILLI = 10n ** 21n;
const LINES = ["You're calm and thoughtful.", "You love snacks."];

async function setup(nature?: (tokenId: string) => readonly string[]) {
  const chain = new FakeChain();
  const inference = new FakeInference();
  const kats = new KatService({
    chain,
    store: new MemoryStore(),
    keyring: keyringFor(chain),
    inference,
    meter: new Meter(chain),
    prices: { chat: 2n * MILLI, save: 50n * MILLI },
    nature,
    retryDelayMs: 0,
    log: () => undefined,
  });
  chain.mint("1", "alice.near", NEAR);
  await kats.wakeNew();
  return { chain, inference, kats };
}

describe("a token's nature", () => {
  test("goes into every conversation, before who it has become", async () => {
    const { inference, kats } = await setup(() => LINES);
    await kats.chat("alice.near", "1", "hello");
    const system = inference.calls.at(-1)?.[0]?.content ?? "";
    expect(system).toContain(
      "Your nature, which comes with how you look and never changes:\n- You're calm and thoughtful.\n- You love snacks.",
    );
    expect(system.indexOf("Your nature")).toBeLessThan(system.indexOf("This is who you are now"));
  });

  test("is given to the character update as fixed, so growth stays true to it", async () => {
    const { inference, kats } = await setup(() => LINES);
    for (let i = 0; i < 10; i++) {
      await kats.chat("alice.near", "1", `message ${i}`);
    }
    const update = inference.calls.find((messages) => messages[0]?.content.includes("CHARACTER:"));
    expect(update?.[0]?.content).toContain("The fixed instructions and the nature never change");
    expect(update?.[1]?.content).toContain("Fixed nature:\n- You're calm and thoughtful.");
  });

  test("stays with the token when it is lent", async () => {
    const { chain, inference, kats } = await setup(() => LINES);
    chain.lend("1", "bob.near", { messages: 2 });
    await kats.chat("bob.near", "1", "hi");
    expect(inference.calls.at(-1)?.[0]?.content).toContain("- You love snacks.");
  });

  test("is left out for collections whose tokens have no traits", async () => {
    const { inference, kats } = await setup();
    await kats.chat("alice.near", "1", "hello");
    expect(inference.calls.at(-1)?.[0]?.content).not.toContain("Your nature");
  });

  test("of a kat is one line for each of its six traits", () => {
    const lines = natureOf(katForToken("1"));
    expect(lines).toHaveLength(6);
    expect(new Set(lines).size).toBe(6);
    expect(natureOf(katForToken("1"))).toEqual(lines);
  });
});
