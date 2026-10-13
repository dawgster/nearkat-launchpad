import type { Verification } from "./keeper.ts";

// Keyed by account as well as kat, so one owner's proof is never shown to another.
const key = (accountId: string, tokenId: string) => `nearkat.proof.${accountId}.${tokenId}`;

/** Remembers the proof that came with a kat's latest reply, for the verify page. */
export function rememberProof(
  accountId: string,
  tokenId: string,
  verification: Verification,
): void {
  sessionStorage.setItem(key(accountId, tokenId), JSON.stringify(verification));
}

export function recallProof(accountId: string, tokenId: string): Verification | null {
  try {
    return JSON.parse(
      sessionStorage.getItem(key(accountId, tokenId)) ?? "null",
    ) as Verification | null;
  } catch {
    return null;
  }
}
