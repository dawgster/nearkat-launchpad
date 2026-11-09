import { describe, expect, test } from "vitest";
import { loadConfig } from "../src/config.ts";

const base = { TRAINER_ACCOUNT_ID: "trainer.testnet" };
const SECRET = "ab".repeat(32);

describe("loadConfig", () => {
  test("fills in defaults", () => {
    expect(loadConfig({ ...base, TRAINER_ROOT_SECRET: SECRET })).toMatchObject({
      mode: "local",
      network: "testnet",
      trainerAccountId: "trainer.testnet",
      appId: "local-trainer",
      label: "Hotdog CNN",
      port: 8790,
      authRecipient: "nearkat.xyz",
      webOrigins: ["http://localhost:3000"],
      archivalRpcUrl: "https://archival-rpc.testnet.fastnear.com",
      fastfsGateway: null,
    });
  });

  test("asks for 10 sample keys per call unless told otherwise", () => {
    const local = { ...base, TRAINER_ROOT_SECRET: SECRET };
    expect(loadConfig(local).sampleKeysPerCall).toBe(10);
    expect(loadConfig({ ...local, SAMPLE_KEYS_PER_CALL: "1" }).sampleKeysPerCall).toBe(1);
    for (const bad of ["0", "11", "2.5", "x"]) {
      expect(() => loadConfig({ ...local, SAMPLE_KEYS_PER_CALL: bad }), bad).toThrow(
        /SAMPLE_KEYS_PER_CALL/,
      );
    }
  });

  test("leaves the epochs to train.py unless TRAINER_EPOCHS is set", () => {
    const local = { ...base, TRAINER_ROOT_SECRET: SECRET };
    expect(loadConfig(local).epochs).toBeUndefined();
    expect(loadConfig({ ...local, TRAINER_EPOCHS: "3" }).epochs).toBe(3);
    for (const bad of ["0", "1.5", "x", "1001"]) {
      expect(() => loadConfig({ ...local, TRAINER_EPOCHS: bad }), bad).toThrow(/TRAINER_EPOCHS/);
    }
  });

  test("reads overrides", () => {
    const config = loadConfig({
      ...base,
      TRAINER_ROOT_SECRET: SECRET,
      TRAINER_APP_ID: "mine",
      TRAINER_LABEL: "Cats",
      PORT: "9000",
      WEB_ORIGINS: "http://a.test, http://b.test",
      HELDOUT_DIR: "/data/held",
    });
    expect(config).toMatchObject({
      appId: "mine",
      label: "Cats",
      port: 9000,
      webOrigins: ["http://a.test", "http://b.test"],
      heldoutDir: "/data/held",
    });
  });

  test("refuses a root secret in phala mode", () => {
    expect(() =>
      loadConfig({ ...base, TRAINER_MODE: "phala", TRAINER_ROOT_SECRET: SECRET }),
    ).toThrow(/TRAINER_ROOT_SECRET must not be set in phala mode/);
    expect(loadConfig({ ...base, TRAINER_MODE: "phala" }).rootSecretHex).toBeUndefined();
  });

  test("local mode needs a root secret of 64 hex characters", () => {
    expect(() => loadConfig(base)).toThrow(/TRAINER_ROOT_SECRET/);
    expect(() => loadConfig({ ...base, TRAINER_ROOT_SECRET: "abc" })).toThrow(
      /TRAINER_ROOT_SECRET/,
    );
  });

  test("needs the trainer account, a known mode and network, a sane port", () => {
    expect(() => loadConfig({ TRAINER_ROOT_SECRET: SECRET })).toThrow(/TRAINER_ACCOUNT_ID/);
    expect(() => loadConfig({ ...base, TRAINER_MODE: "x", TRAINER_ROOT_SECRET: SECRET })).toThrow(
      /TRAINER_MODE/,
    );
    expect(() =>
      loadConfig({ ...base, NEAR_NETWORK: "sandbox", TRAINER_ROOT_SECRET: SECRET }),
    ).toThrow(/NEAR_RPC_URL/);
    expect(() => loadConfig({ ...base, PORT: "0", TRAINER_ROOT_SECRET: SECRET })).toThrow(/PORT/);
  });
});
