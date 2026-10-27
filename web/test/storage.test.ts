import { describe, expect, test } from "vitest";
import { contextLocation } from "../src/lib/storage.ts";

const SHA = "ab".repeat(32);
const TX = "4Ze6vaV85aaEsmYasL2K7hTgXUoHoaVWKvjEbjJiAAAA";

describe("contextLocation", () => {
  test("reads a FastFS ref, with the gateway and explorer on mainnet", () => {
    expect(contextLocation(`fastfs:keeper.near:${SHA}:${TX}`, "kats.near", "mainnet")).toEqual({
      kind: "fastfs",
      uploader: "keeper.near",
      sha256: SHA,
      txHash: TX,
      url: `https://keeper.near.fastfs.io/kats.near/nearkat/${SHA}.bin`,
      explorer: `https://nearblocks.io/txns/${TX}`,
    });
  });

  test("has no gateway off mainnet, and no explorer in a sandbox", () => {
    const ref = `fastfs:keeper.testnet:${SHA}:${TX}`;
    expect(contextLocation(ref, "kats.testnet", "testnet")).toMatchObject({
      url: null,
      explorer: `https://testnet.nearblocks.io/txns/${TX}`,
    });
    expect(contextLocation(ref, "kats.test.near", "sandbox")).toMatchObject({ explorer: null });
  });

  test("anything else is kept by the keeper", () => {
    expect(contextLocation(SHA, "kats.near", "mainnet")).toEqual({ kind: "keeper" });
    expect(contextLocation(null, "kats.near", "mainnet")).toEqual({ kind: "keeper" });
  });
});
