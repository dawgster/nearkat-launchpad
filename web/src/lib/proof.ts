import type { Verification } from "./keeper.ts";

const key = (tokenId: string) => `nearkat.proof.${tokenId}`;

/** Remembers the proof that came with a kat's latest reply, for the verify page. */
export function rememberProof(tokenId: string, verification: Verification): void {
  sessionStorage.setItem(key(tokenId), JSON.stringify(verification));
}

export function recallProof(tokenId: string): Verification | null {
  try {
    return JSON.parse(sessionStorage.getItem(key(tokenId)) ?? "null") as Verification | null;
  } catch {
    return null;
  }
}
