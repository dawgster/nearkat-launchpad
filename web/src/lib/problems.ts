import { KeeperError } from "./keeper.ts";

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
      case "too_large":
      case "invalid_input":
        return "That's too long. Keep it under 4,000 characters.";
      default:
        return error.message;
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/reject|cancel|denied|closed/i.test(message)) {
    return "You cancelled the request in your wallet. Nothing was sent.";
  }
  return message || "Something went wrong. Try again.";
}
