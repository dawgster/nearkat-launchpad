import { describe, expect, test } from "vitest";
import { loadConfig } from "../src/config.ts";

const base = {
  CONTRACT_ID: "nearkat.testnet",
  KEEPER_ACCOUNT_ID: "keeper.testnet",
  NEAR_AI_API_KEY: "key",
};

describe("loadConfig", () => {
  test("fills in defaults", () => {
    expect(loadConfig(base)).toMatchObject({
      network: "testnet",
      contractId: "nearkat.testnet",
      keeperAccountId: "keeper.testnet",
      nearAiBaseUrl: "https://cloud-api.near.ai/v1",
      port: 8787,
      storeDir: "./data/contexts",
      meterJournal: "./data/meter.json",
      maxTokens: 1024,
      chatPrice: 2n * 10n ** 21n,
      savePrice: 5n * 10n ** 22n,
    });
  });

  test("reads overrides", () => {
    const config = loadConfig({
      ...base,
      NEAR_NETWORK: "mainnet",
      PORT: "9000",
      CHAT_PRICE_YOCTO: "7",
      WEB_ORIGIN: "https://nearkat.xyz",
    });
    expect(config).toMatchObject({
      network: "mainnet",
      port: 9000,
      chatPrice: 7n,
      webOrigin: "https://nearkat.xyz",
    });
  });

  test("accepts a local sandbox node when given its RPC URL", () => {
    const config = loadConfig({
      ...base,
      NEAR_NETWORK: "sandbox",
      NEAR_RPC_URL: "http://127.0.0.1:3030",
    });
    expect(config).toMatchObject({ network: "sandbox", rpcUrl: "http://127.0.0.1:3030" });
  });

  test("leaves the RPC URL unset by default", () => {
    expect(loadConfig(base).rpcUrl).toBeUndefined();
  });

  test("requires an RPC URL for a sandbox", () => {
    expect(() => loadConfig({ ...base, NEAR_NETWORK: "sandbox" })).toThrow("NEAR_RPC_URL");
  });

  test.each(["CONTRACT_ID", "KEEPER_ACCOUNT_ID", "NEAR_AI_API_KEY"])("requires %s", (name) => {
    expect(() => loadConfig({ ...base, [name]: "" })).toThrow(name);
  });

  test.each([
    ["NEAR_NETWORK", "devnet"],
    ["PORT", "0"],
    ["PORT", "http"],
    ["PORT", "70000"],
    ["CHAT_PRICE_YOCTO", "-5"],
    ["SAVE_PRICE_YOCTO", "1.5"],
    ["CHAT_PRICE_YOCTO", "cheap"],
    ["NEAR_AI_MAX_TOKENS", "0"],
  ])("rejects %s=%s", (name, value) => {
    expect(() => loadConfig({ ...base, [name]: value })).toThrow(name);
  });
});
