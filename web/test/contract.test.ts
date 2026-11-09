import { describe, expect, test } from "vitest";
import { pickRentable, returnValue } from "../src/lib/contract.ts";

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

describe("pickRentable", () => {
  const offer = (tokenId: string, lender: string, fee: number, apps = ["app-a"]) => ({
    tokenId,
    lender,
    fee: BigInt(fee),
    apps,
  });
  const offers = [
    offer("1", "alice.near", 5),
    offer("2", "alice.near", 1),
    offer("3", "alice.near", 9),
    offer("4", "bob.near", 2),
    offer("5", "bob.near", 8),
    offer("6", "bob.near", 3),
    offer("7", "carol.near", 4),
    offer("8", "carol.near", 7),
    offer("9", "carol.near", 6),
  ];

  test("spreads across lenders, cheapest first", () => {
    const picked = pickRentable(offers, "app-a", 4);
    expect(picked).toHaveLength(4);
    // Every lender is paid, and each lender's cheapest offer comes before its dearer ones.
    expect(new Set(picked.map((id) => offers.find((o) => o.tokenId === id)?.lender)).size).toBe(3);
    expect([...picked].sort()).toEqual(["2", "4", "6", "7"]);
  });

  test("skips offers for other apps and never exceeds what is offered", () => {
    const mixed = [offer("1", "a.near", 1, ["other"]), offer("2", "b.near", 2)];
    expect(pickRentable(mixed, "app-a", 5)).toEqual(["2"]);
  });
});
