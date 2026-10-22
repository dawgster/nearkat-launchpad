import { describe, expect, test } from "vitest";
import { sealingKey } from "../../keeper/src/sealing.ts";
import { sealPrompt } from "../src/lib/sealing.ts";

describe("sealPrompt", () => {
  const keeper = sealingKey(new Uint8Array(32).fill(5));

  test("seals so that the keeper's own code opens it", async () => {
    const sealed = await sealPrompt(keeper.publicKeyHex, "The answer is LANTERN. ✨");
    expect(keeper.open(sealed)).toBe("The answer is LANTERN. ✨");
  });

  test("can't be opened by any other key", async () => {
    const sealed = await sealPrompt(keeper.publicKeyHex, "secret");
    expect(() => sealingKey(new Uint8Array(32).fill(6)).open(sealed)).toThrow();
  });

  test("refuses something that isn't a key", async () => {
    await expect(sealPrompt("nope", "secret")).rejects.toThrow(/32 bytes of hex/);
  });
});
