import { describe, expect, test } from "vitest";
import { KeeperError } from "../src/lib/keeper.ts";
import { describeProblem } from "../src/lib/problems.ts";

describe("describeProblem", () => {
  test.each([
    ["insufficient_balance", /out of NEAR/],
    ["not_owner", /Only this kat's owner/],
    ["waking_up", /still waking up/],
    ["inference_unavailable", /Nothing was charged/],
    ["corrupted", /doesn't match its on-chain record/],
    ["invalid_signature", /approve the message/],
    ["invalid_input", /under 4,000 characters/],
  ])("explains the keeper error %s", (code, expected) => {
    expect(describeProblem(new KeeperError(400, code, "raw"))).toMatch(expected);
  });

  test("falls back to the keeper's own message for a code it does not know", () => {
    expect(describeProblem(new KeeperError(500, "internal", "Internal error"))).toBe(
      "Internal error",
    );
  });

  test.each(["User rejected the request", "Request was cancelled", "Popup closed by user"])(
    "recognises a cancelled wallet request: %s",
    (message) => {
      expect(describeProblem(new Error(message))).toMatch(/cancelled the request/);
    },
  );

  test("never returns an empty message", () => {
    expect(describeProblem(new Error(""))).toMatch(/Something went wrong/);
    expect(describeProblem("plain string")).toBe("plain string");
  });
});
