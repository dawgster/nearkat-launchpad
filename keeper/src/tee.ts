import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { request } from "node:http";
import { type CollectionInfo, requiredPhalaApp } from "./collection.ts";

/**
 * The three calls the keeper makes to the dstack guest agent inside a Phala
 * Cloud CVM. Kept to what is needed rather than pulling in the SDK.
 */
export interface Dstack {
  /** Which app this instance runs as. */
  info(): Promise<{ app_id: string; instance_id: string; compose_hash: string }>;
  /**
   * A key from dstack's KMS. The KMS derives it from the app id, so only
   * instances of the same app, running an allowed compose, ever get it.
   */
  getKey(path: string, purpose: string): Promise<Uint8Array>;
  /** A TDX quote over up to 64 bytes of report data. */
  getQuote(reportData: Uint8Array): Promise<{ quote: string; event_log: string }>;
}

const SOCKETS = ["/var/run/dstack.sock", "/run/dstack.sock", "/var/run/dstack/dstack.sock"];

/** Talks to the guest agent over its unix socket, or to the simulator over HTTP. */
export class DstackAgent implements Dstack {
  readonly #endpoint: string;

  constructor(endpoint?: string) {
    this.#endpoint = endpoint ?? SOCKETS.find((path) => existsSync(path)) ?? "/var/run/dstack.sock";
  }

  async info() {
    const result = await this.#rpc("/Info", {});
    return {
      app_id: String(result.app_id),
      instance_id: String(result.instance_id),
      compose_hash: String(result.compose_hash),
    };
  }

  async getKey(path: string, purpose: string): Promise<Uint8Array> {
    const result = await this.#rpc("/GetKey", { path, purpose, algorithm: "secp256k1" });
    return Buffer.from(String(result.key), "hex");
  }

  async getQuote(reportData: Uint8Array) {
    const result = await this.#rpc("/GetQuote", {
      report_data: Buffer.from(reportData).toString("hex"),
    });
    if (typeof result.error === "string") {
      throw new Error(`dstack quote failed: ${result.error}`);
    }
    return { quote: String(result.quote), event_log: String(result.event_log) };
  }

  #rpc(path: string, payload: object): Promise<Record<string, unknown>> {
    const body = JSON.stringify(payload);
    const http = this.#endpoint.startsWith("http");
    const target = http
      ? new URL(path, this.#endpoint)
      : { socketPath: this.#endpoint, path, hostname: "localhost" };
    return new Promise((resolve, reject) => {
      const req = request(
        target as Parameters<typeof request>[0],
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body),
          },
          timeout: 30_000,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            try {
              resolve(JSON.parse(data) as Record<string, unknown>);
            } catch {
              reject(new Error(`dstack ${path} answered with something that is not JSON`));
            }
          });
        },
      );
      req.on("timeout", () => req.destroy(new Error(`dstack ${path} timed out`)));
      req.on("error", reject);
      req.end(body);
    });
  }
}

/** Where the keeper's root secret comes from inside a Phala app. */
export const ROOT_KEY_PATH = "nearkat/root";

/** Every kat key, the session key and the NEAR key derive from this. */
export async function phalaRootSecret(dstack: Dstack): Promise<Buffer> {
  const key = Buffer.from(await dstack.getKey(ROOT_KEY_PATH, "keeper"));
  if (key.length < 32) {
    throw new Error("dstack returned a key shorter than 32 bytes");
  }
  return key.subarray(0, 32);
}

/**
 * The 64 bytes of report data a keeper's quote carries: SHA-256 of a fixed
 * label and its NEAR public key, then zeros. A browser recomputes it to check
 * the quote speaks for the key the contract trusts.
 */
export function reportDataFor(publicKey: string): Buffer {
  const digest = createHash("sha256").update(`nearkat-keeper:v1:${publicKey}`).digest();
  return Buffer.concat([digest, Buffer.alloc(32)]);
}

/**
 * Says why this keeper must not serve the collection, or null if it may. A
 * collection that names a Phala app is served only from inside that app.
 */
export function teeMismatch(
  collection: CollectionInfo,
  runningAs: { mode: "local" } | { mode: "phala"; appId: string },
): string | null {
  const required = requiredPhalaApp(collection);
  if (required === null) {
    return null;
  }
  if (runningAs.mode !== "phala") {
    return `the collection requires Phala app ${required}, and this keeper is running in local mode`;
  }
  if (runningAs.appId.toLowerCase() !== required.toLowerCase()) {
    return `the collection requires Phala app ${required}, and this keeper runs as ${runningAs.appId}`;
  }
  return null;
}
