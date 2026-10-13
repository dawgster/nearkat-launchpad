import { describe, expect, test } from "vitest";
import { loadConfig } from "../src/lib/config.ts";

const base = { VITE_CONTRACT_ID: "nearkat.testnet" };

describe("loadConfig", () => {
  test("defaults to testnet and a local keeper", () => {
    expect(loadConfig(base)).toEqual({
      network: "testnet",
      contractId: "nearkat.testnet",
      keeperUrl: "http://localhost:8787",
      devWallet: null,
    });
  });

  test("strips trailing slashes from the keeper URL", () => {
    expect(loadConfig({ ...base, VITE_KEEPER_URL: "https://keeper.example//" }).keeperUrl).toBe(
      "https://keeper.example",
    );
  });

  test("builds a custom network for a sandbox", () => {
    const config = loadConfig({
      ...base,
      VITE_NEAR_NETWORK: "sandbox",
      VITE_NEAR_RPC_URL: "http://127.0.0.1:3030",
    });
    expect(config.network).toEqual({ rpcUrl: "http://127.0.0.1:3030", networkId: "localnet" });
  });

  test("reads the dev wallet when both of its variables are set", () => {
    const config = loadConfig({
      ...base,
      VITE_DEV_WALLET_ID: "alice.test",
      VITE_DEV_WALLET_KEY: "ed25519:abc",
    });
    expect(config.devWallet).toEqual({ accountId: "alice.test", privateKey: "ed25519:abc" });
  });

  test.each([
    ["no contract id", {}, "VITE_CONTRACT_ID"],
    ["an unknown network", { ...base, VITE_NEAR_NETWORK: "devnet" }, "VITE_NEAR_NETWORK"],
    [
      "a sandbox without an RPC URL",
      { ...base, VITE_NEAR_NETWORK: "sandbox" },
      "VITE_NEAR_RPC_URL",
    ],
    [
      "a dev wallet on mainnet",
      {
        ...base,
        VITE_NEAR_NETWORK: "mainnet",
        VITE_DEV_WALLET_ID: "a.near",
        VITE_DEV_WALLET_KEY: "ed25519:abc",
      },
      "mainnet",
    ],
  ])("rejects %s", (_name, env, message) => {
    expect(() => loadConfig(env)).toThrow(message);
  });
});
