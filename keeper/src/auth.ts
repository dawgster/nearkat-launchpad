import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { SignedMessage } from "near-kit";
import { HttpError } from "./errors.ts";

export const SIGN_IN_MESSAGE = "Sign in to Nearkat";
const NONCE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 15 * 60 * 1000;
/** Used nonces remembered at once; sign-in is refused beyond this until some expire. */
const MAX_USED_NONCES = 100_000;
const NONCE_BODY_LEN = 16;

export interface SignInParams {
  message: string;
  recipient: string;
  nonce: Uint8Array;
}

/** Checks a NEP-413 signature and that its key is a full-access key of the account. */
export type VerifySignature = (signed: SignedMessage, params: SignInParams) => Promise<boolean>;

export interface AuthOptions {
  sessionKey: Uint8Array;
  recipient: string;
  verify: VerifySignature;
  now?: () => number;
}

export interface Session {
  token: string;
  account_id: string;
  expires_at: number;
}

export class Auth {
  readonly #sessionKey: Uint8Array;
  readonly #recipient: string;
  readonly #verify: VerifySignature;
  readonly #now: () => number;
  /** Nonces already exchanged, with their expiry. Issued nonces are not stored. */
  readonly #used = new Map<string, number>();

  constructor(options: AuthOptions) {
    this.#sessionKey = options.sessionKey;
    this.#recipient = options.recipient;
    this.#verify = options.verify;
    this.#now = options.now ?? Date.now;
  }

  /**
   * Issues a one-time nonce for the wallet to sign. Nothing is stored: the
   * nonce carries its issue time and a MAC, so anyone can ask for nonces
   * without making the keeper hold state. Layout: time (8, big-endian ms, the
   * near-kit convention) | random (8) | MAC of the first 16 bytes (16).
   */
  challenge(): { nonce: string; message: string; recipient: string } {
    const body = Buffer.alloc(NONCE_BODY_LEN);
    body.writeBigUInt64BE(BigInt(this.#now()));
    randomBytes(8).copy(body, 8);
    const nonce = Buffer.concat([body, this.#nonceMac(body)]).toString("base64");
    return { nonce, message: SIGN_IN_MESSAGE, recipient: this.#recipient };
  }

  /** Exchanges a signed challenge for a session token. Each nonce works once. */
  async createSession(signed: SignedMessage, nonce: string): Promise<Session> {
    const now = this.#now();
    const bytes = Buffer.from(nonce, "base64");
    const body = bytes.subarray(0, NONCE_BODY_LEN);
    const issued =
      bytes.length === 32 && timingSafeEqual(bytes.subarray(NONCE_BODY_LEN), this.#nonceMac(body));
    const age = issued ? now - Number(body.readBigUInt64BE()) : -1;
    if (age < 0 || age >= NONCE_TTL_MS || this.#used.has(nonce)) {
      throw new HttpError(401, "invalid_nonce", "Unknown or expired sign-in nonce");
    }
    if (this.#used.size >= MAX_USED_NONCES) {
      for (const [used, expiry] of this.#used) {
        if (expiry <= now) {
          this.#used.delete(used);
        }
      }
      if (this.#used.size >= MAX_USED_NONCES) {
        throw new HttpError(503, "busy", "Too many sign-ins in progress, try again shortly");
      }
    }
    this.#used.set(nonce, now + NONCE_TTL_MS - age);
    const valid = await this.#verify(signed, {
      message: SIGN_IN_MESSAGE,
      recipient: this.#recipient,
      nonce: Buffer.from(nonce, "base64"),
    });
    if (!valid) {
      throw new HttpError(401, "invalid_signature", "Sign-in signature is not valid");
    }
    const expiresAt = this.#now() + SESSION_TTL_MS;
    const payload = Buffer.from(JSON.stringify({ a: signed.accountId, e: expiresAt })).toString(
      "base64url",
    );
    return {
      token: `${payload}.${this.#mac(payload)}`,
      account_id: signed.accountId,
      expires_at: expiresAt,
    };
  }

  /** Returns the account a token belongs to, or null if it is invalid or expired. */
  verifySession(token: string): string | null {
    const [payload, mac, ...rest] = token.split(".");
    if (!payload || !mac || rest.length > 0) {
      return null;
    }
    const expected = Buffer.from(this.#mac(payload));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      return null;
    }
    try {
      const { a, e } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
        a: unknown;
        e: unknown;
      };
      return typeof a === "string" && typeof e === "number" && e > this.#now() ? a : null;
    } catch {
      return null;
    }
  }

  #nonceMac(body: Uint8Array): Buffer {
    return createHmac("sha256", this.#sessionKey)
      .update("nonce:")
      .update(body)
      .digest()
      .subarray(0, 16);
  }

  #mac(payload: string): string {
    return createHmac("sha256", this.#sessionKey)
      .update("session:")
      .update(payload)
      .digest("base64url");
  }
}
