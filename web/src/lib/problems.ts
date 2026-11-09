import { WalletError } from "../wallet/errors.ts";
import { PartialBatchError } from "./contract.ts";
import { KeeperError } from "./keeper.ts";
import { WalletAccountChanged } from "./session.ts";

/** Turns any failure into one sentence that says what happened and what to do. */
export function describeProblem(error: unknown): string {
  if (error instanceof KeeperError) {
    switch (error.code) {
      case "insufficient_balance":
        return "This kat is out of NEAR. Add some to its balance to keep going.";
      case "not_owner":
        return "Only this kat's owner can do that. Check which wallet is connected.";
      case "waking_up":
        return "This kat is still waking up. Try again in a few seconds.";
      case "inference_unavailable":
        return "The kat can't think right now. Nothing was charged. Try again in a moment.";
      case "corrupted":
        return "This kat's stored mind doesn't match its on-chain record, so the keeper won't open it.";
      case "unreachable":
        return error.message;
      case "invalid_signature":
      case "invalid_nonce":
        return "Sign-in didn't go through. Try again, and approve the message in your wallet.";
      case "not_found":
        return "The keeper doesn't know this kat. It may be watching a different contract.";
      case "too_large":
        return "That's too long. Keep it under 4,000 characters.";
      case "rate_limited":
        return "That's faster than the keeper allows. Wait a few seconds and send it again.";
      default:
        return error.message;
    }
  }
  if (error instanceof PartialBatchError) {
    const cause = describeProblem(error.cause);
    return `${error.done} ${error.done === 1 ? "sample" : "samples"} went through before the rest failed. ${cause}`;
  }
  if (error instanceof WalletAccountChanged) {
    return `Your wallet is now on ${error.actual}, not ${error.expected}. Disconnect and connect again.`;
  }
  if (error instanceof WalletError) {
    return "Your wallet didn't approve the request. If you declined it by mistake, try again.";
  }
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message || "Something went wrong. Try again.";
}
