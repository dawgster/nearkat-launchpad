import type { SignedMessage } from "near-kit";
import { describe, expect, test, vi } from "vitest";
import { Auth, SIGN_IN_MESSAGE, type VerifySignature } from "../src/auth.ts";

const signed: SignedMessage = {
  accountId: "alice.near",
  publicKey: "ed25519:pk",
  signature: "ed25519:sig",
};

function setup(verify: VerifySignature = async () => true) {
  let now = 1_000_000;
  const auth = new Auth({
    sessionKey: Buffer.alloc(32, 3),
    recipient: "nearkat.xyz",
    verify,
    now: () => now,
  });
  return { auth, advance: (ms: number) => (now += ms) };
}

describe("Auth", () => {
  test("turns a signed challenge into a session for the signing account", async () => {
    const { auth } = setup();
    const { nonce } = auth.challenge();
    const session = await auth.createSession(signed, nonce);
    expect(session.account_id).toBe("alice.near");
    expect(session.expires_at).toBe(1_000_000 + 15 * 60 * 1000);
    expect(auth.verifySession(session.token)).toBe("alice.near");
  });

  test("asks the verifier about the issued nonce, message and recipient", async () => {
    const verify = vi.fn<VerifySignature>(async () => true);
    const { auth } = setup(verify);
    const challenge = auth.challenge();
    expect(challenge).toMatchObject({ message: SIGN_IN_MESSAGE, recipient: "nearkat.xyz" });
    await auth.createSession(signed, challenge.nonce);
    expect(verify).toHaveBeenCalledWith(signed, {
      message: SIGN_IN_MESSAGE,
      recipient: "nearkat.xyz",
      nonce: Buffer.from(challenge.nonce, "base64"),
    });
    expect(Buffer.from(challenge.nonce, "base64")).toHaveLength(32);
  });

  test("rejects a signature the verifier does not accept", async () => {
    const { auth } = setup(async () => false);
    await expect(auth.createSession(signed, auth.challenge().nonce)).rejects.toMatchObject({
      status: 401,
      code: "invalid_signature",
    });
  });

  test("accepts each nonce only once", async () => {
    const { auth } = setup();
    const { nonce } = auth.challenge();
    await auth.createSession(signed, nonce);
    await expect(auth.createSession(signed, nonce)).rejects.toMatchObject({
      status: 401,
      code: "invalid_nonce",
    });
  });

  test("burns a nonce even when its signature was rejected", async () => {
    let accept = false;
    const { auth } = setup(async () => accept);
    const { nonce } = auth.challenge();
    await expect(auth.createSession(signed, nonce)).rejects.toMatchObject({ status: 401 });
    accept = true;
    await expect(auth.createSession(signed, nonce)).rejects.toMatchObject({
      code: "invalid_nonce",
    });
  });

  test("accepts a nonce issued by another instance that shares its key", async () => {
    const { auth } = setup();
    const other = setup().auth;
    const session = await auth.createSession(signed, other.challenge().nonce);
    expect(session.account_id).toBe("alice.near");
  });

  test("rejects a nonce whose timestamp was moved forward", async () => {
    const { auth, advance } = setup();
    const bytes = Buffer.from(auth.challenge().nonce, "base64");
    advance(10 * 60 * 1000);
    bytes.writeBigUInt64BE(BigInt(1_000_000 + 10 * 60 * 1000));
    await expect(auth.createSession(signed, bytes.toString("base64"))).rejects.toMatchObject({
      code: "invalid_nonce",
    });
  });

  test("rejects a nonce from an instance with a different key", async () => {
    const { auth } = setup();
    const other = new Auth({
      sessionKey: Buffer.alloc(32, 4),
      recipient: "nearkat.xyz",
      verify: async () => true,
      now: () => 1_000_000,
    });
    await expect(auth.createSession(signed, other.challenge().nonce)).rejects.toMatchObject({
      code: "invalid_nonce",
    });
  });

  test("puts the issue time in the first eight bytes, as near-kit expects", () => {
    const bytes = Buffer.from(setup().auth.challenge().nonce, "base64");
    expect(bytes.readBigUInt64BE()).toBe(1_000_000n);
  });

  test("rejects a nonce it never issued", async () => {
    const { auth } = setup();
    await expect(auth.createSession(signed, "bm9wZQ==")).rejects.toMatchObject({
      code: "invalid_nonce",
    });
  });

  test("rejects a nonce older than five minutes", async () => {
    const { auth, advance } = setup();
    const { nonce } = auth.challenge();
    advance(5 * 60 * 1000);
    await expect(auth.createSession(signed, nonce)).rejects.toMatchObject({
      code: "invalid_nonce",
    });
  });

  test("expires a session after fifteen minutes", async () => {
    const { auth, advance } = setup();
    const session = await auth.createSession(signed, auth.challenge().nonce);
    advance(15 * 60 * 1000 - 1);
    expect(auth.verifySession(session.token)).toBe("alice.near");
    advance(1);
    expect(auth.verifySession(session.token)).toBeNull();
  });

  test("rejects a token whose payload was changed", async () => {
    const { auth } = setup();
    const { token } = await auth.createSession(signed, auth.challenge().nonce);
    const forged = Buffer.from(
      JSON.stringify({ a: "mallory.near", e: 9_999_999_999_999 }),
    ).toString("base64url");
    expect(auth.verifySession(`${forged}.${token.split(".")[1]}`)).toBeNull();
  });

  test("rejects a token signed with another key", async () => {
    const { auth } = setup();
    const other = new Auth({
      sessionKey: Buffer.alloc(32, 4),
      recipient: "nearkat.xyz",
      verify: async () => true,
      now: () => 1_000_000,
    });
    const { token } = await other.createSession(signed, other.challenge().nonce);
    expect(auth.verifySession(token)).toBeNull();
  });

  test.each(["", "abc", "a.b.c", "."])("rejects the malformed token %j", (token) => {
    expect(setup().auth.verifySession(token)).toBeNull();
  });
});
