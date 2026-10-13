import { type Keeper, KeeperError, type Session, type SignedMessage } from "./keeper.ts";

export type SignMessage = (params: {
  message: string;
  recipient: string;
  nonce: Uint8Array;
  callbackUrl?: string;
}) => Promise<SignedMessage>;

/** The wallet signed as a different account than the one the app is showing. */
export class WalletAccountChanged extends Error {
  readonly expected: string;
  readonly actual: string;

  constructor(expected: string, actual: string) {
    super(`Expected ${expected} but the wallet signed as ${actual}`);
    this.name = "WalletAccountChanged";
    this.expected = expected;
    this.actual = actual;
  }
}

/** Keeps a 30-second margin so a token is never sent just as it expires. */
const EXPIRY_MARGIN_MS = 30_000;
const SESSION_PREFIX = "nearkat.session.";
const PROOF_PREFIX = "nearkat.proof.";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Removes every stored session and reply proof. Called when the wallet disconnects. */
export function forgetSessions(storage: Storage = sessionStorage): void {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  for (const key of keys) {
    if (key?.startsWith(SESSION_PREFIX) || key?.startsWith(PROOF_PREFIX)) {
      storage.removeItem(key);
    }
  }
}

/**
 * Holds the keeper session for one account. Signing in costs the user a
 * wallet prompt, so the token is kept for the browser tab and only renewed
 * when it has expired or the keeper rejects it.
 */
export class KeeperSession {
  readonly #keeper: Keeper;
  readonly #accountId: string;
  readonly #signMessage: SignMessage;
  readonly #expect: { message: string; recipient: string };
  readonly #callbackUrl: string | undefined;
  readonly #storage: Store;
  readonly #now: () => number;
  #signingIn: Promise<string> | null = null;

  constructor(options: {
    keeper: Keeper;
    accountId: string;
    signMessage: SignMessage;
    /**
     * The only sign-in request the wallet will be asked to sign. The keeper
     * supplies just the nonce, so it cannot have the user sign for another app.
     */
    expect: { message: string; recipient: string };
    /** The page URL passed to the wallet. Web wallets sign over it. */
    callbackUrl?: string;
    storage?: Store;
    now?: () => number;
  }) {
    this.#keeper = options.keeper;
    this.#accountId = options.accountId;
    this.#signMessage = options.signMessage;
    this.#expect = options.expect;
    this.#callbackUrl = options.callbackUrl;
    this.#storage = options.storage ?? sessionStorage;
    this.#now = options.now ?? Date.now;
  }

  /** Runs a keeper call with a valid token, signing in first if needed. */
  async call<T>(run: (token: string) => Promise<T>): Promise<T> {
    // A failure to sign in is final: asking the wallet again would not help.
    const token = await this.#token();
    try {
      return await run(token);
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
    return `${SESSION_PREFIX}${this.#accountId}`;
  }

  async #token(): Promise<string> {
    const stored = this.#storage.getItem(this.#key);
    if (stored) {
      try {
        const session = JSON.parse(stored) as Session;
        if (
          session.account_id === this.#accountId &&
          session.expires_at - EXPIRY_MARGIN_MS > this.#now()
        ) {
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
    if (
      challenge.message !== this.#expect.message ||
      challenge.recipient !== this.#expect.recipient
    ) {
      throw new Error("The keeper sent an unexpected sign-in request, so it was not signed.");
    }
    const nonce = Uint8Array.from(atob(challenge.nonce), (char) => char.charCodeAt(0));
    const signed = await this.#signMessage({
      ...this.#expect,
      nonce,
      ...(this.#callbackUrl ? { callbackUrl: this.#callbackUrl } : {}),
    });
    if (signed.accountId !== this.#accountId) {
      throw new WalletAccountChanged(this.#accountId, signed.accountId);
    }
    const session = await this.#keeper.createSession(
      challenge.nonce,
      { accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature },
      this.#callbackUrl,
    );
    if (session.account_id !== this.#accountId) {
      throw new WalletAccountChanged(this.#accountId, session.account_id);
    }
    this.#storage.setItem(this.#key, JSON.stringify(session));
    return session.token;
  }
}
