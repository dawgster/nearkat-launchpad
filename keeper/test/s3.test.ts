import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { MirroredStore, S3Store, signV4 } from "../src/s3.ts";
import { MemoryStore } from "../src/store.ts";

const sha256Hex = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

describe("signV4", () => {
  test("matches the worked example in AWS's Signature Version 4 documentation", () => {
    const headers = signV4({
      method: "GET",
      url: new URL("https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08"),
      headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
      payloadHash: sha256Hex(""),
      region: "us-east-1",
      service: "iam",
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      now: new Date("2015-08-30T12:36:00Z"),
    });
    expect(headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, " +
        "SignedHeaders=content-type;host;x-amz-date, " +
        "Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7",
    );
    expect(headers["x-amz-date"]).toBe("20150830T123600Z");
  });
});

describe("S3Store against a stand-in S3", () => {
  let server: Server;
  let endpoint: string;
  const objects = new Map<string, Buffer>();
  const seen: Array<{ method: string; path: string; auth: string; sha: string }> = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        seen.push({
          method: req.method ?? "",
          path: req.url ?? "",
          auth: String(req.headers.authorization ?? ""),
          sha: String(req.headers["x-amz-content-sha256"] ?? ""),
        });
        if (req.method === "PUT") {
          objects.set(req.url ?? "", body);
          res.end();
        } else {
          const object = objects.get(req.url ?? "");
          res.statusCode = object ? 200 : 404;
          res.end(object ?? "");
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (typeof address !== "object" || !address) {
      throw new Error("no address");
    }
    endpoint = `http://127.0.0.1:${address.port}`;
  });

  afterAll(() => {
    server.close();
  });

  const store = () =>
    new S3Store({
      endpoint,
      bucket: "contexts",
      region: "auto",
      accessKeyId: "id",
      secretAccessKey: "secret",
      prefix: "nearkat/",
    });

  test("stores a blob under its hash and reads it back", async () => {
    const blob = new Uint8Array([1, 2, 3, 250]);
    const ref = await store().put(blob);
    expect(ref).toBe(sha256Hex(blob));
    expect(await store().get(ref)).toEqual(blob);
    const put = seen.find((r) => r.method === "PUT");
    expect(put?.path).toBe(`/contexts/nearkat/${ref}`);
    expect(put?.auth).toMatch(/^AWS4-HMAC-SHA256 Credential=id\/\d{8}\/auto\/s3\/aws4_request/);
    expect(put?.sha).toBe(ref);
  });

  test("says when a blob is missing", async () => {
    await expect(store().get("0".repeat(64))).rejects.toThrow(/HTTP 404/);
  });

  test("refuses refs that aren't hashes", async () => {
    await expect(store().get("../secret")).rejects.toThrow(/Invalid context ref/);
  });

  test("mirrors: writes durably first, and restores a lost local copy on read", async () => {
    const local = new MemoryStore();
    const mirrored = new MirroredStore(local, store());
    const blob = new Uint8Array([9, 9, 9]);
    const ref = await mirrored.put(blob);
    expect(objects.get(`/contexts/nearkat/${ref}`)).toEqual(Buffer.from(blob));
    expect(await local.get(ref)).toEqual(blob);

    // A keeper on a fresh disk still finds the context.
    const fresh = new MemoryStore();
    expect(await new MirroredStore(fresh, store()).get(ref)).toEqual(blob);
    expect(await fresh.get(ref)).toEqual(blob);
  });
});
