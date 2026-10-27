import { describe, expect, test } from "vitest";
import { KeeperError } from "../src/lib/keeper.ts";
import { describeProblem } from "../src/lib/problems.ts";
import { WalletAccountChanged } from "../src/lib/session.ts";
import { WalletError } from "../src/wallet/errors.ts";

describe("describeProblem", () => {
  test.each([
    ["insufficient_balance", /out of NEAR/],
    ["not_owner", /Only this kat's owner/],
    ["waking_up", /still waking up/],
    ["inference_unavailable", /Nothing was charged/],
    ["corrupted", /doesn't match its on-chain record/],
    ["invalid_signature", /approve the message/],
  ])("explains the keeper error %s", (code, expected) => {
    expect(describeProblem(new KeeperError(400, code, "raw"))).toMatch(expected);
  });

  test("falls back to the keeper's own message for a code it does not know", () => {
    expect(describeProblem(new KeeperError(500, "internal", "Internal error"))).toBe(
      "Internal error",
    );
  });

  test("explains a wallet that did not sign, without guessing what was sent", () => {
    const message = describeProblem(new WalletError("User rejected the request"));
    expect(message).toMatch(/wallet didn't approve/i);
    expect(message).not.toMatch(/Nothing was sent/);
  });

  test("explains a wallet whose account changed", () => {
    expect(describeProblem(new WalletAccountChanged("alice.near", "bob.near"))).toMatch(
      /wallet is now on bob\.near/,
    );
  });

  test("does not mistake an unrelated failure for a cancelled wallet request", () => {
    expect(describeProblem(new Error("Connection closed by peer"))).toBe(
      "Connection closed by peer",
    );
  });

  test("tells apart input that is too long from input that is missing", () => {
    expect(describeProblem(new KeeperError(413, "too_large", "raw"))).toMatch(/too long/);
    expect(describeProblem(new KeeperError(429, "rate_limited", "raw"))).toMatch(
      /Wait a few seconds/,
    );
    expect(
      describeProblem(new KeeperError(400, "invalid_input", "prompt must be 1 to 4000 characters")),
    ).toBe("prompt must be 1 to 4000 characters");
  });

  test("explains a keeper that does not know the kat", () => {
    expect(describeProblem(new KeeperError(404, "not_found", "raw"))).toMatch(
      /keeper doesn't know this kat/,
    );
  });

  test("never returns an empty or meaningless message", () => {
    expect(describeProblem(new Error(""))).toMatch(/Something went wrong/);
    expect(describeProblem("plain string")).toBe("plain string");
    expect(describeProblem({ code: 4001 })).toMatch(/Something went wrong/);
    expect(describeProblem(undefined)).toMatch(/Something went wrong/);
  });
});
