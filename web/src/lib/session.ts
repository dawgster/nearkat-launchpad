import { type Keeper, KeeperError, type Session, type SignedMessage } from "./keeper.ts";

export type SignMessage = (params: {
  message: string;
  recipient: string;
  nonce: Uint8Array;
}) => Promise<SignedMessage>;

/** Keeps a 30-second margin so a token is never sent just as it expires. */
const EXPIRY_MARGIN_MS = 30_000;

/**
 * Holds the keeper session for one account. Signing in costs the user a
 * wallet prompt, so the token is kept for the browser tab and only renewed
 * when it has expired or the keeper rejects it.
 */
export class KeeperSession {
  readonly #keeper: Keeper;
  readonly #accountId: string;
  readonly #signMessage: SignMessage;
  readonly #storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  readonly #now: () => number;
  #signingIn: Promise<string> | null = null;

  constructor(options: {
    keeper: Keeper;
    accountId: string;
    signMessage: SignMessage;
    storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
    now?: () => number;
  }) {
    this.#keeper = options.keeper;
    this.#accountId = options.accountId;
    this.#signMessage = options.signMessage;
    this.#storage = options.storage ?? sessionStorage;
    this.#now = options.now ?? Date.now;
  }

  /** Runs a keeper call with a valid token, signing in first if needed. */
  async call<T>(run: (token: string) => Promise<T>): Promise<T> {
    try {
      return await run(await this.#token());
    } catch (error) {
      if (!(error instanceof KeeperError) || error.status !== 401) {
        throw error;
      }
      // The keeper no longer accepts the token (for example, it restarted).
      this.#storage.removeItem(this.#key);
      return run(await this.#token());
    }
  }

  get #key(): string {
    return `nearkat.session.${this.#accountId}`;
  }

  async #token(): Promise<string> {
    const stored = this.#storage.getItem(this.#key);
    if (stored) {
      try {
        const session = JSON.parse(stored) as Session;
        if (session.expires_at - EXPIRY_MARGIN_MS > this.#now()) {
          return session.token;
        }
      } catch {
        // fall through to a fresh sign-in
      }
    }
    // Several calls may need a token at once; they share one wallet prompt.
    this.#signingIn ??= this.#signIn().finally(() => {
      this.#signingIn = null;
    });
    return this.#signingIn;
  }

  async #signIn(): Promise<string> {
    const challenge = await this.#keeper.challenge();
    const nonce = Uint8Array.from(atob(challenge.nonce), (char) => char.charCodeAt(0));
    const signed = await this.#signMessage({
      message: challenge.message,
      recipient: challenge.recipient,
      nonce,
    });
    const session = await this.#keeper.createSession(challenge.nonce, {
      accountId: signed.accountId,
      publicKey: signed.publicKey,
      signature: signed.signature,
    });
    this.#storage.setItem(this.#key, JSON.stringify(session));
    return session.token;
  }
}
