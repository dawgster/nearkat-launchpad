import { describe, expect, test } from "vitest";
import { keysFromRootSecret } from "../src/keys.ts";
import { sealingKey, sealTo } from "../src/sealing.ts";

describe("sealed prompts", () => {
  const key = sealingKey(Buffer.alloc(32, 9));

  test("open what was sealed to this key", () => {
    expect(key.open(sealTo(key.publicKeyHex, "the secret instructions ✨"))).toBe(
      "the secret instructions ✨",
    );
  });

  test("can't be opened with another key", () => {
    const other = sealingKey(Buffer.alloc(32, 10));
    expect(() => other.open(sealTo(key.publicKeyHex, "secret"))).toThrow();
  });

  test("can't be changed without it showing", () => {
    const sealed = Buffer.from(sealTo(key.publicKeyHex, "secret"), "base64");
    sealed.writeUInt8(sealed.readUInt8(50) ^ 1, 50);
    expect(() => key.open(sealed.toString("base64"))).toThrow();
  });

  test("seal differently every time", () => {
    expect(sealTo(key.publicKeyHex, "x")).not.toBe(sealTo(key.publicKeyHex, "x"));
  });

  test("use the same key in every instance of the app, and a different one per root", () => {
    const root = Buffer.alloc(32, 7);
    expect(keysFromRootSecret(root).sealing().publicKeyHex).toBe(
      keysFromRootSecret(root).sealing().publicKeyHex,
    );
    expect(keysFromRootSecret(root).sealing().publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(keysFromRootSecret(Buffer.alloc(32, 8)).sealing().publicKeyHex).not.toBe(
      keysFromRootSecret(root).sealing().publicKeyHex,
    );
  });
});
