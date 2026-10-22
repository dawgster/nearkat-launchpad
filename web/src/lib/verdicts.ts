import type { ContextDoc } from "./keeper.ts";
import type { PhalaCheck } from "./tdx.ts";
import { contextHash, type SignatureCheck } from "./verify.ts";

/**
 * How far a check got. "partial" means what could be checked held, but
 * something this page cannot check is still needed before it proves anything.
 */
export type Verdict = "pass" | "partial" | "fail" | "unknown";

/** Whether the owner's copy of the mind is the one recorded on-chain. */
export function recordVerdict(
  context: ContextDoc | null,
  kat: { context_hash: string | null; context_version: string },
): "match" | "mismatch" | "behind" | "unknown" {
  if (!context || !kat.context_hash) {
    return "unknown";
  }
  // The keeper may have saved a newer version since the contract was read
  // (or the reverse). That is a timing gap, not evidence of a swapped mind.
  if (String(context.version) !== kat.context_version) {
    return "behind";
  }
  try {
    return contextHash(context) === kat.context_hash ? "match" : "mismatch";
  } catch {
    return "mismatch";
  }
}

/**
 * A valid signature over this reply is still only "partial": the signer's
 * address came from the keeper, and this page cannot yet tie it to the
 * model's enclave.
 */
export function signatureVerdict(check: SignatureCheck | null): Verdict {
  if (!check || check.status === "missing" || check.status === "unsupported") {
    return "unknown";
  }
  return check.status === "valid" && check.coversReply ? "partial" : "fail";
}

/**
 * `held` is whether the account the contract trusts holds the key the keeper
 * reports, or null if that could not be looked up. Holding it is "partial":
 * public keys are public, so reporting one does not prove controlling it.
 */
export function keyVerdict(held: boolean | null): Verdict {
  return held === null ? "unknown" : held ? "partial" : "fail";
}

/**
 * Whether only the owner can read a token's mind, as far as the browser can
 * tell. A Phala report that holds up in every way this page can check is
 * "partial": this page can't check Intel's signature on the quote. It is a
 * pass only when the collection requires the app and its contract has itself
 * verified the quote, Intel's signature included, for the keeper's key.
 */
export function privacyVerdict(
  mode: string | null,
  check: PhalaCheck | null,
  requiredAppId: string | null,
  attestedOnChain: boolean | null = null,
): Verdict {
  if (mode === "local") {
    return "fail";
  }
  if (mode !== "phala" || !check) {
    return "unknown";
  }
  if (check.status === "unreadable") {
    return "fail";
  }
  const holds = check.bindsKey && check.logMatchesQuote && check.claimMatchesLog;
  const rightApp = requiredAppId === null || check.appId === requiredAppId.toLowerCase();
  if (!holds || !rightApp) {
    return "fail";
  }
  if (requiredAppId !== null && attestedOnChain === false) {
    // The contract would refuse this keeper's writes.
    return "fail";
  }
  return requiredAppId !== null && attestedOnChain === true ? "pass" : "partial";
}
