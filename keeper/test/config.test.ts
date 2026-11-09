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
      nearAiModel: "z-ai/glm-5.3-flash",
      port: 8787,
      storeDir: "./data/contexts",
      meterJournal: "./data/meter.json",
      maxTokens: 2048,
      chatPrice: 2n * 10n ** 21n,
      savePrice: 5n * 10n ** 22n,
    });
  });

  test("asks for 10 sample keys per call unless told otherwise", () => {
    expect(loadConfig(base).sampleKeysPerCall).toBe(10);
    expect(loadConfig({ ...base, SAMPLE_KEYS_PER_CALL: "1" }).sampleKeysPerCall).toBe(1);
    for (const bad of ["0", "11", "2.5", "x"]) {
      expect(() => loadConfig({ ...base, SAMPLE_KEYS_PER_CALL: bad }), bad).toThrow(
        /SAMPLE_KEYS_PER_CALL/,
      );
    }
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
      webOrigins: ["https://nearkat.xyz"],
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

  test("accepts several web origins separated by commas", () => {
    const config = loadConfig({
      ...base,
      WEB_ORIGIN: "https://nearkat.xyz, https://preview.nearkat.xyz",
    });
    expect(config.webOrigins).toEqual(["https://nearkat.xyz", "https://preview.nearkat.xyz"]);
    expect(loadConfig(base).webOrigins).toEqual(["http://localhost:3000"]);
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

  test("serves only a launchpad's launches when there is no home collection", () => {
    // A keeper for launched collections alone, e.g. datasets, need not serve a home one.
    const config = loadConfig({ ...base, CONTRACT_ID: "", LAUNCHPAD_ID: "launch.near" });
    expect(config.contractId).toBeUndefined();
    expect(config.launchpadId).toBe("launch.near");
    expect(() => loadConfig({ ...base, CONTRACT_ID: "" })).toThrow(
      "CONTRACT_ID is required unless LAUNCHPAD_ID is set",
    );
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

describe("keeper mode", () => {
  const env = {
    CONTRACT_ID: "nearkat.near",
    KEEPER_ACCOUNT_ID: "keeper.near",
    NEAR_AI_API_KEY: "key",
  };

  test("defaults to local", () => {
    expect(loadConfig(env).mode).toBe("local");
  });

  test("accepts phala and a simulator endpoint", () => {
    const config = loadConfig({ ...env, KEEPER_MODE: "phala", DSTACK_ENDPOINT: "http://sim:8090" });
    expect(config).toMatchObject({ mode: "phala", dstackEndpoint: "http://sim:8090" });
  });

  test("refuses a root secret in phala mode, since the operator would know it", () => {
    expect(() =>
      loadConfig({ ...env, KEEPER_MODE: "phala", KEEPER_ROOT_SECRET: "07".repeat(32) }),
    ).toThrow(/must not be set in phala mode/);
  });

  test("rejects an unknown mode", () => {
    expect(() => loadConfig({ ...env, KEEPER_MODE: "sgx" })).toThrow(/local or phala/);
  });
});

describe("serving many collections", () => {
  const env = {
    CONTRACT_ID: "nearkat.near",
    KEEPER_ACCOUNT_ID: "keeper.near",
    NEAR_AI_API_KEY: "key",
  };

  test("serves only the home collection by default, and withdraws from 1 NEAR", () => {
    expect(loadConfig(env)).toMatchObject({
      extraContractIds: [],
      launchpadId: undefined,
      withdrawMinimum: 10n ** 24n,
    });
  });

  test("takes more collections and a launchpad", () => {
    const config = loadConfig({
      ...env,
      CONTRACT_IDS: "a.near, b.near,",
      LAUNCHPAD_ID: "launch.near",
      WITHDRAW_MIN_YOCTO: "5",
    });
    expect(config).toMatchObject({
      extraContractIds: ["a.near", "b.near"],
      launchpadId: "launch.near",
      withdrawMinimum: 5n,
    });
  });
});

describe("storage", () => {
  const env = { CONTRACT_ID: "a.near", KEEPER_ACCOUNT_ID: "k.near", NEAR_AI_API_KEY: "x" };

  test("stores contexts on NEAR with FastFS by default, read back from an archival node", () => {
    const config = loadConfig(env);
    expect(config.storage).toBe("fastfs");
    expect(config.archivalRpcUrl).toBe("https://archival-rpc.testnet.fastnear.com");
    expect(config.fastfsGateway).toBeNull();
  });

  test("uses the FastFS gateway on mainnet", () => {
    const config = loadConfig({ ...env, NEAR_NETWORK: "mainnet" });
    expect(config.fastfsGateway).toBe("https://{uploader}.fastfs.io");
    expect(config.archivalRpcUrl).toBe("https://archival-rpc.mainnet.fastnear.com");
  });

  test("reads a sandbox's transactions from the sandbox itself", () => {
    const config = loadConfig({
      ...env,
      NEAR_NETWORK: "sandbox",
      NEAR_RPC_URL: "http://127.0.0.1:3030",
    });
    expect(config.archivalRpcUrl).toBe("http://127.0.0.1:3030");
  });

  test("can keep contexts on disk only, and refuses other storage", () => {
    expect(loadConfig({ ...env, STORAGE: "file" }).storage).toBe("file");
    expect(() => loadConfig({ ...env, STORAGE: "s3" })).toThrow(/STORAGE/);
  });
});
