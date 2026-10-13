import { describe, expect, test } from "vitest";
import { open, seal } from "../src/crypto.ts";

const key = Buffer.alloc(32, 1);
const text = Buffer.from("a kat's secret");

describe("seal and open", () => {
  test("round-trips plaintext", () => {
    expect(open(key, seal(key, text))).toEqual(text);
  });

  test("produces different ciphertext each time", () => {
    expect(seal(key, text)).not.toEqual(seal(key, text));
  });

  test("does not contain the plaintext", () => {
    expect(seal(key, text).includes(text)).toBe(false);
  });

  test("rejects a modified blob", () => {
    const blob = seal(key, text);
    const index = blob.length - 20;
    blob.writeUInt8(blob.readUInt8(index) ^ 1, index);
    expect(() => open(key, blob)).toThrow();
  });

  test("rejects the wrong key", () => {
    expect(() => open(Buffer.alloc(32, 2), seal(key, text))).toThrow();
  });

  test("rejects a blob too short to hold a nonce and tag", () => {
    expect(() => open(key, Buffer.alloc(10))).toThrow("too short");
  });
});
