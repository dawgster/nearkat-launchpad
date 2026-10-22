import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { DEFAULT_COLLECTION } from "../src/collection.ts";
import { keysFromRootSecret } from "../src/keys.ts";
import { DstackAgent, keyProof, phalaRootSecret, reportDataFor, teeMismatch } from "../src/tee.ts";

const APP = "0a1b2c3d4e5f60718293a4b5c6d7e8f901234567";
const phala = { ...DEFAULT_COLLECTION, tee: { Phala: { app_id: APP } } };

describe("teeMismatch", () => {
  test("lets any keeper serve a collection without a requirement", () => {
    expect(teeMismatch(DEFAULT_COLLECTION, { mode: "local" })).toBeNull();
    expect(teeMismatch(DEFAULT_COLLECTION, { mode: "phala", appId: "ff" })).toBeNull();
  });

  test("refuses a local keeper for a collection that requires a Phala app", () => {
    expect(teeMismatch(phala, { mode: "local" })).toMatch(/local mode/);
  });

  test("refuses a keeper running as a different Phala app", () => {
    expect(teeMismatch(phala, { mode: "phala", appId: "ff" })).toMatch(/runs as ff/);
  });

  test("accepts the required app", () => {
    expect(teeMismatch(phala, { mode: "phala", appId: APP.toUpperCase() })).toBeNull();
  });
});

describe("reportDataFor", () => {
  test("is the SHA-256 of the labelled key, padded to 64 bytes", () => {
    const data = reportDataFor("ed25519:abc", "11");
    expect(data).toHaveLength(64);
    const digest = createHash("sha256").update("nearkat-keeper:v2:ed25519:abc:11").digest();
    expect(data.subarray(0, 32)).toEqual(digest);
    expect(data.subarray(32)).toEqual(Buffer.alloc(32));
  });
});

describe("DstackAgent against a stand-in guest agent", () => {
  let server: Server;
  let agent: DstackAgent;
  const seen: Array<{ path: string; body: Record<string, unknown> }> = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}");
        seen.push({ path: req.url ?? "", body: parsed });
        const answers: Record<string, unknown> = {
          "/Info": { app_id: APP, instance_id: "i-1", compose_hash: "c0ffee", tcb_info: "{}" },
          "/GetKey": { key: "11".repeat(32), signature_chain: [] },
          "/GetQuote": { quote: "beef", event_log: "[]" },
        };
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(answers[req.url ?? ""] ?? {}));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (typeof address !== "object" || !address) {
      throw new Error("no address");
    }
    agent = new DstackAgent(`http://127.0.0.1:${address.port}`);
  });

  afterAll(() => {
    server.close();
  });

  test("reads which app it runs as", async () => {
    expect(await agent.info()).toEqual({ app_id: APP, instance_id: "i-1", compose_hash: "c0ffee" });
  });

  test("derives the keeper's keys from the KMS key, so they match across instances", async () => {
    const root = await phalaRootSecret(agent);
    expect(root).toEqual(Buffer.alloc(32, 0x11));
    expect(seen.find((call) => call.path === "/GetKey")?.body).toMatchObject({
      path: "nearkat/root",
      purpose: "keeper",
    });
    expect(keysFromRootSecret(root).nearPublicKey()).toMatch(/^ed25519:/);
  });

  test("asks for a quote over the report data, hex encoded", async () => {
    const data = reportDataFor("ed25519:abc", "11");
    expect(await agent.getQuote(data)).toEqual({ quote: "beef", event_log: "[]" });
    expect(seen.find((call) => call.path === "/GetQuote")?.body).toEqual({
      report_data: data.toString("hex"),
    });
  });
});

describe("keyProof", () => {
  test("hands the contract the quote, the event log and hex-encoded collateral", async () => {
    let asked: Uint8Array | null = null;
    const proof = await keyProof(
      "ed25519:abc",
      "11",
      { quote: "0xbeef", event_log: "[]" },
      async (quote) => {
        asked = quote;
        return { root_ca_crl: [1, 2, 255], tcb_info: '{"id":"TDX"}', tcb_info_signature: "abcd" };
      },
    );
    expect(asked).toEqual(Buffer.from("beef", "hex"));
    expect(proof).toEqual({
      public_key: "ed25519:abc",
      seal_public_key: "11",
      quote: "beef",
      event_log: "[]",
      collateral: JSON.stringify({
        root_ca_crl: "0102ff",
        tcb_info: '{"id":"TDX"}',
        tcb_info_signature: "abcd",
      }),
    });
  });
});
