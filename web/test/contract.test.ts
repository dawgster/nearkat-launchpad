import { describe, expect, test } from "vitest";
import { returnValue } from "../src/lib/contract.ts";

const outcome = (value: unknown) => ({
  // The chain returns the method's JSON as base64 of its UTF-8 bytes.
  status: { SuccessValue: Buffer.from(JSON.stringify(value), "utf8").toString("base64") },
  transaction: {},
});

describe("returnValue", () => {
  test("decodes what the contract method returned", () => {
    expect(returnValue(outcome({ token_id: "7", owner_id: "alice.near" }))).toEqual({
      token_id: "7",
      owner_id: "alice.near",
    });
  });

  test("decodes non-ASCII text", () => {
    expect(returnValue(outcome({ title: "Pal — №1 🐾" }))).toEqual({ title: "Pal — №1 🐾" });
  });

  test.each([
    ["a method that returns nothing", { status: { SuccessValue: "" } }],
    ["a failed transaction", { status: { Failure: {} } }],
    ["a value that is not JSON", { status: { SuccessValue: btoa("not json") } }],
    ["an outcome of an unexpected shape", { ok: true }],
    ["nothing at all", undefined],
  ])("gives null for %s", (_name, value) => {
    expect(returnValue(value)).toBeNull();
  });
});
