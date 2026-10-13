import { describe, expect, test } from "vitest";
import { loadConfig, nearNetwork } from "../src/lib/config.ts";

const base = { VITE_CONTRACT_ID: "nearkat.testnet" };

describe("loadConfig", () => {
  test("defaults to testnet and a local keeper in development", () => {
    expect(loadConfig(base)).toEqual({
      networkId: "testnet",
      rpcUrl: null,
      contractId: "nearkat.testnet",
      keeperUrl: "http://localhost:8787",
      authRecipient: "nearkat.xyz",
      devWallet: null,
    });
  });

  test("strips trailing slashes from the keeper URL", () => {
    expect(loadConfig({ ...base, VITE_KEEPER_URL: "https://keeper.example//" }).keeperUrl).toBe(
      "https://keeper.example",
    );
  });

  test("keeps the network name when a custom RPC endpoint is set", () => {
    const config = loadConfig({
      ...base,
      VITE_NEAR_NETWORK: "mainnet",
      VITE_NEAR_RPC_URL: "https://rpc.example",
    });
    expect(config).toMatchObject({ networkId: "mainnet", rpcUrl: "https://rpc.example" });
    expect(nearNetwork(config)).toEqual({ rpcUrl: "https://rpc.example", networkId: "mainnet" });
  });

  test("gives near-kit the plain network name when there is no custom endpoint", () => {
    expect(nearNetwork(loadConfig(base))).toBe("testnet");
  });

  test("maps a sandbox to near-kit's local network id", () => {
    const config = loadConfig({
      ...base,
      VITE_NEAR_NETWORK: "sandbox",
      VITE_NEAR_RPC_URL: "http://127.0.0.1:3030",
    });
    expect(nearNetwork(config)).toEqual({ rpcUrl: "http://127.0.0.1:3030", networkId: "localnet" });
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

  describe("in a production build", () => {
    const production = { production: true };

    test("requires the keeper URL instead of assuming localhost", () => {
      expect(() => loadConfig(base, production)).toThrow("VITE_KEEPER_URL");
      expect(
        loadConfig({ ...base, VITE_KEEPER_URL: "https://keeper.example" }, production).keeperUrl,
      ).toBe("https://keeper.example");
    });

    test("refuses a dev wallet, whose key would be readable in the bundle", () => {
      expect(() =>
        loadConfig(
          {
            ...base,
            VITE_KEEPER_URL: "https://keeper.example",
            VITE_DEV_WALLET_ID: "a.testnet",
            VITE_DEV_WALLET_KEY: "ed25519:abc",
          },
          production,
        ),
      ).toThrow(/dev wallet/i);
    });
  });
});
