import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * A token's loan as the contract shows it (`get_loan`). The keeper lets the
 * borrower talk to the token while it is active, and counts their messages.
 * Times are nanoseconds and amounts yoctoNEAR, as strings.
 */
export interface LoanView {
  token_id: string;
  status: "offered" | "active" | "over";
  lender_id: string;
  borrower_id: string | null;
  duration_s: string | null;
  /** How many messages the borrower may send; null for no limit. */
  messages: number | null;
  /** Whether the token may draw on its memory with the borrower. */
  sees_memory: boolean;
  /** Whether what the borrower says may change the token. */
  learns: boolean;
  fee: string;
  started_at: string | null;
  ends_at: string | null;
}

/** What a borrower is told about their loan with each reply. */
export interface LoanStanding {
  /** Messages they may still send; null for no limit. */
  messages_left: number | null;
  /** Nanoseconds; null when the loan has no end time. */
  ends_at: string | null;
}

/** One loan: a token, from when it started. A new loan counts from zero. */
export const loanKey = (loan: LoanView): string => `${loan.token_id}@${loan.started_at ?? ""}`;

/** Messages sent on each loan, so a message limit holds across restarts. */
export interface LoanCounter {
  used(key: string): number;
  add(key: string): void;
}

export class MemoryLoanCounter implements LoanCounter {
  readonly #counts = new Map<string, number>();

  used(key: string): number {
    return this.#counts.get(key) ?? 0;
  }

  add(key: string): void {
    this.#counts.set(key, this.used(key) + 1);
  }
}

/** Kept in a small JSON file, written whole after each message. */
export class FileLoanCounter implements LoanCounter {
  readonly #path: string;
  readonly #counts: Record<string, number>;

  constructor(path: string) {
    this.#path = path;
    let counts: Record<string, number> = {};
    try {
      counts = JSON.parse(readFileSync(path, "utf8")) as Record<string, number>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error(`Cannot read the loan counts at ${path}`);
      }
    }
    this.#counts = counts;
  }

  used(key: string): number {
    return this.#counts[key] ?? 0;
  }

  add(key: string): void {
    this.#counts[key] = this.used(key) + 1;
    mkdirSync(dirname(this.#path), { recursive: true });
    // Write then rename, so a crash never leaves a half-written file.
    const temporary = `${this.#path}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.#counts));
    renameSync(temporary, this.#path);
  }
}
