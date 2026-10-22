import { parseKey } from "near-kit";
import { describe, expect, test } from "vitest";
import { keysFromRootSecret, localRootSecret } from "../src/keys.ts";

const root = Buffer.alloc(32, 7);

describe("keysFromRootSecret", () => {
  test("derives the same keys from the same root secret", () => {
    const a = keysFromRootSecret(root);
    const b = keysFromRootSecret(root);
    expect(a.katKey("1")).toEqual(b.katKey("1"));
    expect(a.sessionKey()).toEqual(b.sessionKey());
    expect(a.nearPrivateKey()).toBe(b.nearPrivateKey());
  });

  test("gives every kat its own 32-byte key", () => {
    const keys = keysFromRootSecret(root);
    expect(keys.katKey("1")).toHaveLength(32);
    expect(keys.katKey("1")).not.toEqual(keys.katKey("2"));
    expect(keys.katKey("1")).not.toEqual(keys.sessionKey());
  });

  test("derives different keys from a different root secret", () => {
    const other = keysFromRootSecret(Buffer.alloc(32, 8));
    expect(other.katKey("1")).not.toEqual(keysFromRootSecret(root).katKey("1"));
  });

  test("produces a NEAR key pair that near-kit accepts", () => {
    const keys = keysFromRootSecret(root);
    const pair = parseKey(keys.nearPrivateKey());
    expect(pair.publicKey.toString()).toBe(keys.nearPublicKey());
  });

  test("rejects a root secret that is not 32 bytes", () => {
    expect(() => keysFromRootSecret(Buffer.alloc(16))).toThrow("32 bytes");
  });
});

describe("localRootSecret", () => {
  test("parses 64 hex characters", () => {
    expect(localRootSecret("07".repeat(32))).toEqual(root);
  });

  test.each([undefined, "", "07".repeat(31), "zz".repeat(32)])("rejects %s", (value) => {
    expect(() => localRootSecret(value)).toThrow("KEEPER_ROOT_SECRET");
  });
});

describe("forContract", () => {
  test("gives the same token a different key in each collection", () => {
    const keys = keysFromRootSecret(root);
    const a = keys.forContract("a.near");
    const b = keys.forContract("b.near");
    expect(a.katKey("1")).not.toEqual(b.katKey("1"));
    expect(a.katKey("1")).not.toEqual(keys.katKey("1"));
    expect(a.katKey("1")).toEqual(keysFromRootSecret(root).forContract("a.near").katKey("1"));
  });

  test("keeps the session and NEAR keys shared", () => {
    const keys = keysFromRootSecret(root);
    expect(keys.forContract("a.near").nearPublicKey()).toBe(keys.nearPublicKey());
    expect(keys.forContract("a.near").sessionKey()).toEqual(keys.sessionKey());
  });
});
