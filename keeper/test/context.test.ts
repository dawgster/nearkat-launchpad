import { describe, expect, test } from "vitest";
import {
  canonicalJson,
  contextHash,
  newContext,
  openContext,
  sealContext,
} from "../src/context.ts";
import { CorruptContextError } from "../src/errors.ts";
import { keysFromRootSecret } from "../src/keys.ts";
import type { ContextDoc } from "../src/types.ts";

const keys = keysFromRootSecret(Buffer.alloc(32, 7));
const doc: ContextDoc = {
  token_id: "1",
  version: 3,
  salt: Buffer.alloc(32, 9).toString("base64"),
  personality: "grumpy",
  memory_summary: "likes fish",
};
const hashOf = (d: ContextDoc) => contextHash(d).toString("base64");

describe("contextHash", () => {
  test("does not depend on the order the fields were written in", () => {
    const reordered: ContextDoc = {
      memory_summary: "likes fish",
      personality: "grumpy",
      salt: doc.salt,
      version: 3,
      token_id: "1",
    };
    expect(hashOf(reordered)).toBe(hashOf(doc));
  });

  test("is 32 bytes", () => {
    expect(contextHash(doc)).toHaveLength(32);
  });

  test.each([
    ["personality", { personality: "cheerful" }],
    ["memory", { memory_summary: "likes birds" }],
    ["version", { version: 4 }],
    ["token id", { token_id: "2" }],
    ["salt", { salt: Buffer.alloc(32, 10).toString("base64") }],
  ])("changes when the %s changes", (_name, change) => {
    expect(hashOf({ ...doc, ...change })).not.toBe(hashOf(doc));
  });

  test("keeps the salt out of the hashed JSON", () => {
    expect(canonicalJson(doc)).not.toContain("salt");
  });
});

describe("newContext", () => {
  test("gives equal contents different hashes", () => {
    const a = newContext("1", 1, "same", "");
    const b = newContext("1", 1, "same", "");
    expect(hashOf(a)).not.toBe(hashOf(b));
  });
});

describe("openContext", () => {
  test("returns the sealed context when the hash matches", () => {
    expect(openContext(keys, "1", sealContext(keys, doc), hashOf(doc))).toEqual(doc);
  });

  test("rejects a context whose hash is not the expected one", () => {
    const blob = sealContext(keys, { ...doc, personality: "swapped" });
    expect(() => openContext(keys, "1", blob, hashOf(doc))).toThrow(CorruptContextError);
  });

  test("rejects another kat's context", () => {
    const other = { ...doc, token_id: "2" };
    expect(() => openContext(keys, "1", sealContext(keys, other), hashOf(other))).toThrow(
      CorruptContextError,
    );
  });

  test("rejects bytes that are not a sealed context", () => {
    expect(() => openContext(keys, "1", Buffer.alloc(64), hashOf(doc))).toThrow(
      CorruptContextError,
    );
  });
});
