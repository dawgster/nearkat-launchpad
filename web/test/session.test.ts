import { describe, expect, test, vi } from "vitest";
import { type Keeper, KeeperError } from "../src/lib/keeper.ts";
import {
  forgetSessions,
  KeeperSession,
  type SignMessage,
  WalletAccountChanged,
} from "../src/lib/session.ts";

function setup() {
  let now = 1_000_000;
  let issued = 0;
  const keeper = {
    challenge: vi.fn(async () => ({
      nonce: btoa("n".repeat(32)),
      message: "Sign in",
      recipient: "r",
    })),
    createSession: vi.fn(async (_nonce: string, signed: { accountId: string }) => {
      issued += 1;
      return { token: `token-${issued}`, account_id: signed.accountId, expires_at: now + 900_000 };
    }),
  } as unknown as Keeper;
  const signMessage = vi.fn<SignMessage>(async () => ({
    accountId: "alice.near",
    publicKey: "ed25519:pk",
    signature: "sig",
  }));
  const make = (accountId = "alice.near") =>
    new KeeperSession({
      keeper,
      accountId,
      signMessage,
      now: () => now,
      expect: { message: "Sign in", recipient: "r" },
      callbackUrl: "https://app.example/kat/1",
    });
  return { keeper, signMessage, make, session: make(), advance: (ms: number) => (now += ms) };
}

describe("KeeperSession", () => {
  test("keeps another service's session apart from the keeper's", async () => {
    const { session, signMessage, keeper } = setup();
    const trainer = new KeeperSession({
      keeper,
      accountId: "alice.near",
      signMessage,
      expect: { message: "Sign in", recipient: "r" },
      now: () => 1_000_000,
      scope: "trainer:local-trainer",
    });
    expect(await session.call(async (token) => token)).toBe("token-1");
    expect(await trainer.call(async (token) => token)).toBe("token-2");
    // Each keeps its own token: neither overwrote the other's.
    expect(await session.call(async (token) => token)).toBe("token-1");
    expect(await trainer.call(async (token) => token)).toBe("token-2");
    expect(signMessage).toHaveBeenCalledTimes(2);
    forgetSessions();
    expect(sessionStorage.length).toBe(0);
  });

  test("signs the keeper's challenge and passes the token to the call", async () => {
    const { session, signMessage, keeper } = setup();
    expect(await session.call(async (token) => `used ${token}`)).toBe("used token-1");
    expect(signMessage).toHaveBeenCalledWith({
      message: "Sign in",
      recipient: "r",
      nonce: Uint8Array.from("n".repeat(32), (char) => char.charCodeAt(0)),
      callbackUrl: "https://app.example/kat/1",
    });
    expect(keeper.createSession).toHaveBeenCalledWith(
      btoa("n".repeat(32)),
      { accountId: "alice.near", publicKey: "ed25519:pk", signature: "sig" },
      "https://app.example/kat/1",
    );
  });

  test("asks the wallet once and reuses the token afterwards", async () => {
    const { session, make, signMessage } = setup();
    await session.call(async () => 1);
    await session.call(async () => 2);
    await make().call(async () => 3);
    expect(signMessage).toHaveBeenCalledTimes(1);
  });

  test("shares one wallet prompt between calls made at the same time", async () => {
    const { session, signMessage } = setup();
    const tokens = await Promise.all([
      session.call(async (token) => token),
      session.call(async (token) => token),
    ]);
    expect(tokens).toEqual(["token-1", "token-1"]);
    expect(signMessage).toHaveBeenCalledTimes(1);
  });

  test("signs in again once the token is about to expire", async () => {
    const { session, advance } = setup();
    await session.call(async () => 1);
    advance(900_000 - 30_000);
    expect(await session.call(async (token) => token)).toBe("token-2");
  });

  test("signs in again and retries once when the keeper rejects the token", async () => {
    const { session } = setup();
    const run = vi
      .fn<(token: string) => Promise<string>>()
      .mockRejectedValueOnce(new KeeperError(401, "unauthorized", "expired"))
      .mockImplementation(async (token) => token);
    expect(await session.call(run)).toBe("token-2");
    expect(run).toHaveBeenCalledTimes(2);
  });

  test("does not loop when the keeper keeps rejecting", async () => {
    const { session, signMessage } = setup();
    const run = vi.fn(async () => {
      throw new KeeperError(401, "unauthorized", "no");
    });
    await expect(session.call(run)).rejects.toMatchObject({ status: 401 });
    expect(run).toHaveBeenCalledTimes(2);
    expect(signMessage).toHaveBeenCalledTimes(2);
  });

  test("passes other errors through without signing in again", async () => {
    const { session, signMessage } = setup();
    await expect(
      session.call(async () => {
        throw new KeeperError(403, "not_owner", "no");
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(signMessage).toHaveBeenCalledTimes(1);
  });

  test("keeps each account's token separate", async () => {
    const { make, signMessage } = setup();
    await make("alice.near").call(async () => 1);
    signMessage.mockResolvedValueOnce({
      accountId: "bob.near",
      publicKey: "ed25519:pk",
      signature: "sig",
    });
    expect(await make("bob.near").call(async (token) => token)).toBe("token-2");
    expect(signMessage).toHaveBeenCalledTimes(2);
  });

  test("lets a rejected wallet prompt fail the call, and asks again next time", async () => {
    const { session, signMessage } = setup();
    signMessage.mockRejectedValueOnce(new Error("User rejected"));
    await expect(session.call(async () => 1)).rejects.toThrow("User rejected");
    expect(await session.call(async (token) => token)).toBe("token-1");
  });

  test("asks the wallet only once when the keeper rejects the sign-in itself", async () => {
    const { session, keeper, signMessage } = setup();
    vi.mocked(keeper.createSession).mockRejectedValue(
      new KeeperError(401, "invalid_signature", "no"),
    );
    await expect(session.call(async () => 1)).rejects.toMatchObject({ code: "invalid_signature" });
    expect(signMessage).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["message", { nonce: btoa("n".repeat(32)), message: "Approve transfer", recipient: "r" }],
    ["recipient", { nonce: btoa("n".repeat(32)), message: "Sign in", recipient: "other.app" }],
  ])("refuses to sign a challenge with an unexpected %s", async (_field, challenge) => {
    const { session, keeper, signMessage } = setup();
    vi.mocked(keeper.challenge).mockResolvedValue(challenge);
    await expect(session.call(async () => 1)).rejects.toThrow(/unexpected sign-in request/);
    expect(signMessage).not.toHaveBeenCalled();
  });

  test("refuses a signature made by a different account than the one shown", async () => {
    const { session, signMessage, keeper } = setup();
    signMessage.mockResolvedValue({
      accountId: "bob.near",
      publicKey: "ed25519:pk",
      signature: "sig",
    });
    await expect(session.call(async () => 1)).rejects.toBeInstanceOf(WalletAccountChanged);
    expect(keeper.createSession).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("nearkat.session.alice.near")).toBeNull();
  });

  test("forgets every stored session and proof on request", async () => {
    const { session } = setup();
    await session.call(async () => 1);
    sessionStorage.setItem("nearkat.proof.alice.near.1", "{}");
    sessionStorage.setItem("unrelated", "kept");
    forgetSessions();
    expect(sessionStorage.getItem("nearkat.session.alice.near")).toBeNull();
    expect(sessionStorage.getItem("nearkat.proof.alice.near.1")).toBeNull();
    expect(sessionStorage.getItem("unrelated")).toBe("kept");
  });
});
