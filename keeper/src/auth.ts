import { createHmac, timingSafeEqual } from "node:crypto";
import { generateNonce, type SignedMessage } from "near-kit";
import { HttpError } from "./errors.ts";

export const SIGN_IN_MESSAGE = "Sign in to Nearkat";
const NONCE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 15 * 60 * 1000;

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
  readonly #nonces = new Map<string, number>();

  constructor(options: AuthOptions) {
    this.#sessionKey = options.sessionKey;
    this.#recipient = options.recipient;
    this.#verify = options.verify;
    this.#now = options.now ?? Date.now;
  }

  /** Issues a one-time nonce for the wallet to sign. */
  challenge(): { nonce: string; message: string; recipient: string } {
    const now = this.#now();
    for (const [nonce, expiry] of this.#nonces) {
      if (expiry <= now) {
        this.#nonces.delete(nonce);
      }
    }
    const nonce = Buffer.from(generateNonce()).toString("base64");
    this.#nonces.set(nonce, now + NONCE_TTL_MS);
    return { nonce, message: SIGN_IN_MESSAGE, recipient: this.#recipient };
  }

  /** Exchanges a signed challenge for a session token. Each nonce works once. */
  async createSession(signed: SignedMessage, nonce: string): Promise<Session> {
    const expiry = this.#nonces.get(nonce);
    this.#nonces.delete(nonce);
    if (expiry === undefined || expiry <= this.#now()) {
      throw new HttpError(401, "invalid_nonce", "Unknown or expired sign-in nonce");
    }
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

  #mac(payload: string): string {
    return createHmac("sha256", this.#sessionKey).update(payload).digest("base64url");
  }
}
