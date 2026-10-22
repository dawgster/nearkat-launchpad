import { createHash, createHmac } from "node:crypto";
import type { ContextStore } from "./store.ts";

/**
 * Durable storage for encrypted contexts on any S3-compatible service (AWS
 * S3, Cloudflare R2, MinIO, Backblaze B2). Blobs are already encrypted and
 * checked against the hash on-chain, so the service is trusted only to keep
 * them, never to keep them secret or unaltered.
 */

const sha256Hex = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) =>
  createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding, as SigV4 requires: everything but unreserved characters. */
const encode = (text: string) =>
  encodeURIComponent(text).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

export interface SignInput {
  method: string;
  url: URL;
  /** Headers to sign, besides host and x-amz-date, which are added. */
  headers: Record<string, string>;
  payloadHash: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  now: Date;
}

/** AWS Signature Version 4. Returns every header the request must carry. */
export function signV4(input: SignInput): Record<string, string> {
  const amzDate = input.now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v.trim()]),
    ),
    host: input.url.host,
    "x-amz-date": amzDate,
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join("");
  const signedHeaders = names.join(";");
  const query = [...input.url.searchParams]
    .map(([k, v]): [string, string] => [encode(k), encode(v)])
    // By name, then value, comparing code units as SigV4 does.
    .sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : 1) : ak < bk ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const path = input.url.pathname
    .split("/")
    .map((segment) => encode(decodeURIComponent(segment)))
    .join("/");
  const canonicalRequest = [
    input.method,
    path || "/",
    query,
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");
  const scope = `${date}/${input.region}/${input.service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const key = hmac(
    hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, date), input.region), input.service),
    "aws4_request",
  );
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

export interface S3Options {
  /** e.g. https://s3.eu-west-1.amazonaws.com, https://<account>.r2.cloudflarestorage.com */
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Key prefix inside the bucket. */
  prefix?: string;
  /** Address the bucket as <bucket>.<host> instead of <host>/<bucket>. */
  virtualHost?: boolean;
  fetch?: typeof fetch;
  now?: () => Date;
}

export class S3Store implements ContextStore {
  readonly #o: S3Options;
  readonly #fetch: typeof fetch;

  constructor(options: S3Options) {
    this.#o = options;
    this.#fetch = options.fetch ?? fetch;
  }

  async put(blob: Uint8Array): Promise<string> {
    const ref = sha256Hex(blob);
    const response = await this.#request("PUT", ref, blob);
    if (!response.ok) {
      throw new Error(`S3 refused to store a context: HTTP ${response.status}`);
    }
    return ref;
  }

  async get(ref: string): Promise<Uint8Array> {
    if (!/^[0-9a-f]{64}$/.test(ref)) {
      throw new Error(`Invalid context ref: ${ref}`);
    }
    const response = await this.#request("GET", ref);
    if (!response.ok) {
      throw new Error(`S3 did not return context ${ref}: HTTP ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  #url(ref: string): URL {
    const base = new URL(this.#o.endpoint);
    const key = `${this.#o.prefix ?? ""}${ref}`;
    if (this.#o.virtualHost) {
      base.host = `${this.#o.bucket}.${base.host}`;
      base.pathname = `/${key}`;
    } else {
      base.pathname = `/${this.#o.bucket}/${key}`;
    }
    return base;
  }

  #request(method: "GET" | "PUT", ref: string, body?: Uint8Array): Promise<Response> {
    const url = this.#url(ref);
    const payloadHash = sha256Hex(body ?? new Uint8Array());
    const headers = signV4({
      method,
      url,
      headers: {
        "x-amz-content-sha256": payloadHash,
        ...(body ? { "content-type": "application/octet-stream" } : {}),
      },
      payloadHash,
      region: this.#o.region,
      service: "s3",
      accessKeyId: this.#o.accessKeyId,
      secretAccessKey: this.#o.secretAccessKey,
      now: this.#o.now?.() ?? new Date(),
    });
    // fetch sets host itself, from the URL.
    const { host: _host, ...sent } = headers;
    return this.#fetch(url, {
      method,
      headers: sent,
      body: body ? Buffer.from(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  }
}

/**
 * Writes every blob to the durable store first and keeps a local copy; reads
 * the local copy when there is one. A lost disk then costs nothing but a
 * re-download.
 */
export class MirroredStore implements ContextStore {
  readonly #local: ContextStore;
  readonly #durable: ContextStore;

  constructor(local: ContextStore, durable: ContextStore) {
    this.#local = local;
    this.#durable = durable;
  }

  async put(blob: Uint8Array): Promise<string> {
    // Only once the durable copy exists may the hash move on-chain.
    const ref = await this.#durable.put(blob);
    await this.#local.put(blob).catch(() => undefined);
    return ref;
  }

  async get(ref: string): Promise<Uint8Array> {
    try {
      return await this.#local.get(ref);
    } catch {
      const blob = await this.#durable.get(ref);
      await this.#local.put(blob).catch(() => undefined);
      return blob;
    }
  }
}
