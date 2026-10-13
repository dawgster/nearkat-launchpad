/**
 * The wallet did not do what was asked: the user declined, closed the
 * window, or the wallet failed. Wallets report these in many shapes, so the
 * original value is kept only as text.
 */
export class WalletError extends Error {
  constructor(cause: unknown) {
    const text = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
    super(text);
    this.name = "WalletError";
  }
}
