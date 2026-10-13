import { createHash } from "node:crypto";
import { InferenceError } from "./errors.ts";
import type { ChatMessage } from "./types.ts";

/** Signature data from the inference provider, passed through for the client to verify. */
export interface SignatureInfo {
  text: string;
  signature: string;
  signing_address: string;
  signing_algo: string;
  signature_kind: string;
}

/** What a client needs to check that a reply came from the attested model. */
export interface Verification {
  chat_id: string;
  model: string;
  request_hash: string;
  response_hash: string;
  signature: SignatureInfo | null;
}

export interface ChatResult {
  reply: string;
  verification: Verification;
}

export interface Inference {
  chat(messages: ChatMessage[]): Promise<ChatResult>;
}

export interface NearAiOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
  /** Delay between attempts to fetch a signature that is not ready yet. */
  signatureRetryMs?: number;
  /** Upper bound on the length of a reply, in tokens. */
  maxTokens?: number;
  /** How long to wait for a completion before giving up. */
  timeoutMs?: number;
  /** How long to wait for each signature request. */
  signatureTimeoutMs?: number;
}

const SIGNATURE_ATTEMPTS = 3;
const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** NEAR AI Cloud client (OpenAI-compatible chat completions plus response signatures). */
export class NearAiInference implements Inference {
  readonly #options: NearAiOptions;
  readonly #fetch: typeof fetch;

  constructor(options: NearAiOptions) {
    this.#options = options;
    this.#fetch = options.fetch ?? fetch;
  }

  async chat(messages: ChatMessage[]): Promise<ChatResult> {
    const { baseUrl, apiKey, model, maxTokens = 2048, timeoutMs = 60_000 } = this.#options;
    // The signature covers the exact bytes sent and received, so both are hashed raw.
    const body = Buffer.from(JSON.stringify({ model, messages, max_tokens: maxTokens }), "utf8");
    let response: Response;
    let raw: Buffer;
    try {
      // One deadline covers both the headers and the body.
      response = await this.#fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          "accept-encoding": "identity",
          "x-no-aliasing": "true",
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      raw = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      throw new InferenceError(`Inference request failed: ${String(error)}`);
    }
    if (!response.ok) {
      throw new InferenceError(`Inference returned HTTP ${response.status}`);
    }
    let chatId: unknown;
    let reply: unknown;
    try {
      const parsed = JSON.parse(raw.toString("utf8"));
      chatId = parsed.id;
      const content: unknown = parsed.choices?.[0]?.message?.content;
      reply = typeof content === "string" ? content.trim() : content;
    } catch {
      throw new InferenceError("Inference returned a body that is not JSON");
    }
    if (typeof chatId !== "string" || typeof reply !== "string" || reply.length === 0) {
      throw new InferenceError("Inference returned no reply");
    }
    return {
      reply,
      verification: {
        chat_id: chatId,
        model,
        request_hash: sha256Hex(body),
        response_hash: sha256Hex(raw),
        signature: await this.#signature(chatId),
      },
    };
  }

  /** A missing signature never fails the chat; the client sees `null` and can say so. */
  async #signature(chatId: string): Promise<SignatureInfo | null> {
    const { baseUrl, apiKey, signatureRetryMs = 500, signatureTimeoutMs = 10_000 } = this.#options;
    const url = `${baseUrl}/signature/${encodeURIComponent(chatId)}?signing_algo=ecdsa`;
    for (let attempt = 1; attempt <= SIGNATURE_ATTEMPTS; attempt++) {
      try {
        const response = await this.#fetch(url, {
          headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
          signal: AbortSignal.timeout(signatureTimeoutMs),
        });
        if (response.ok) {
          const info = (await response.json()) as Partial<SignatureInfo> & { error_code?: unknown };
          const complete =
            info.error_code === undefined &&
            typeof info.text === "string" &&
            typeof info.signature === "string" &&
            typeof info.signing_address === "string" &&
            typeof info.signing_algo === "string" &&
            typeof info.signature_kind === "string";
          return complete ? (info as SignatureInfo) : null;
        }
        if (response.status !== 404) {
          return null;
        }
      } catch {
        return null;
      }
      if (attempt < SIGNATURE_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, signatureRetryMs));
      }
    }
    return null;
  }
}
