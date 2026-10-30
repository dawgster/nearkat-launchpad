import type { LoanView } from "./contract.ts";
import { formatNear, shorten } from "./format.ts";

/** When a loan ends, in words; null when it has no end time. */
export function loanEnd(loan: Pick<LoanView, "ends_at">): string | null {
  if (loan.ends_at === null) return null;
  const at = new Date(Number(BigInt(loan.ends_at) / 1_000_000n));
  return at.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const DURATIONS: Array<[number, string]> = [
  [365 * 86_400, "a year"],
  [30 * 86_400, "30 days"],
  [7 * 86_400, "a week"],
  [86_400, "a day"],
  [3_600, "an hour"],
];

/** "a day", "3 hours", "90 seconds". */
export function duration(seconds: number): string {
  const named = DURATIONS.find(([length]) => length === seconds);
  if (named) return named[1];
  if (seconds % 86_400 === 0) return `${seconds / 86_400} days`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600} hours`;
  if (seconds % 60 === 0) return `${seconds / 60} minutes`;
  return `${seconds} seconds`;
}

/** The loan's terms in one sentence, for owner and borrower alike. */
export function describeTerms(loan: LoanView, noun: string): string {
  const parts = [
    loan.duration_s === null ? "until it's ended" : `for ${duration(Number(loan.duration_s))}`,
    loan.messages === null
      ? "as many messages as they like"
      : `${loan.messages} message${loan.messages === 1 ? "" : "s"}`,
    BigInt(loan.fee) === 0n ? "free" : `for ${formatNear(BigInt(loan.fee), 6)} NEAR`,
  ];
  const memory = loan.sees_memory
    ? `The ${noun} can draw on its memory`
    : `The ${noun} talks from its character only, not its memory`;
  const learns = loan.learns
    ? "and what they say can change it."
    : "and comes back unchanged by what they say.";
  return `${parts.join(", ")}. ${memory}, ${learns}`;
}

export const who = (accountId: string | null) =>
  accountId === null ? "anyone" : shorten(accountId, 12);

/** The same text with a capital first letter, to start a sentence. */
export const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
