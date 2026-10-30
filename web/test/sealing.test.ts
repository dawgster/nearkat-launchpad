import { describe, expect, test } from "vitest";
import { IMPORT_INFO as KEEPER_IMPORT_INFO, sealingKey } from "../../keeper/src/sealing.ts";
import { IMPORT_INFO, sealPrompt } from "../src/lib/sealing.ts";

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

  test("seals a large history for import, which only opens as an import", async () => {
    expect(IMPORT_INFO).toBe(KEEPER_IMPORT_INFO);
    const history = JSON.stringify({ source: "claude", messages: ["é".repeat(150_000)] });
    const sealed = await sealPrompt(keeper.publicKeyHex, history, IMPORT_INFO);
    expect(keeper.open(sealed, IMPORT_INFO)).toBe(history);
    expect(() => keeper.open(sealed)).toThrow();
  });

  test("refuses something that isn't a key", async () => {
    await expect(sealPrompt("nope", "secret")).rejects.toThrow(/32 bytes of hex/);
  });
});
