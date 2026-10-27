import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { TokenChain } from "./chain.ts";

/** The contract's gas limit allows about 500 items per call; stay well under it. */
const MAX_BATCH_ITEMS = 200;

/** Unsettled charges, as written to the journal. Amounts are yoctoNEAR strings. */
export interface MeterState {
  /** Charges not yet assigned to a batch. */
  pending: Record<string, string>;
  /** The batch being settled. `attempted` means it may already have been applied. */
  batch: { seq: number; items: Record<string, string>; attempted: boolean } | null;
}

/** Keeps unsettled charges across restarts. */
export interface MeterJournal {
  load(): MeterState | null;
  save(state: MeterState): void;
}

export class FileJournal implements MeterJournal {
  readonly #path: string;

  constructor(path: string) {
    this.#path = path;
  }

  load(): MeterState | null {
    let text: string;
    try {
      text = readFileSync(this.#path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
    try {
      return JSON.parse(text) as MeterState;
    } catch {
      throw new Error(`Cannot read the meter journal at ${this.#path}`);
    }
  }

  save(state: MeterState): void {
    mkdirSync(dirname(this.#path), { recursive: true });
    // Write then rename, so a crash never leaves a half-written journal.
    const temporary = `${this.#path}.tmp`;
    writeFileSync(temporary, JSON.stringify(state));
    renameSync(temporary, this.#path);
  }
}

export interface MeterOptions {
  journal?: MeterJournal;
  log?: (message: string) => void;
}

interface Batch {
  seq: number;
  items: Map<string, bigint>;
  attempted: boolean;
}

/** Accumulates per-kat charges and settles them on-chain in numbered batches. */
export class Meter {
  readonly #chain: TokenChain;
  readonly #journal: MeterJournal | undefined;
  readonly #log: (message: string) => void;
  readonly #pending = new Map<string, bigint>();
  #batch: Batch | null = null;
  #lastSeq: number | null = null;
  #flushing: Promise<void> | null = null;
  /** Kats put back by `#shrink`; skipped until the next flush so a flush always ends. */
  readonly #deferred = new Set<string>();

  constructor(chain: TokenChain, options: MeterOptions = {}) {
    this.#chain = chain;
    this.#journal = options.journal;
    this.#log = options.log ?? console.error;
    const state = this.#journal?.load();
    if (state) {
      for (const [tokenId, amount] of Object.entries(state.pending)) {
        this.#pending.set(tokenId, BigInt(amount));
      }
      if (state.batch) {
        const items = Object.entries(state.batch.items).map(
          ([tokenId, amount]) => [tokenId, BigInt(amount)] as const,
        );
        this.#batch = { ...state.batch, items: new Map(items) };
      }
    }
  }

  charge(tokenId: string, amount: bigint): void {
    this.#pending.set(tokenId, (this.#pending.get(tokenId) ?? 0n) + amount);
    this.#persist();
  }

  /** Everything this kat has been charged that is not yet settled on-chain. */
  pending(tokenId: string): bigint {
    return (this.#pending.get(tokenId) ?? 0n) + (this.#batch?.items.get(tokenId) ?? 0n);
  }

  /**
   * Settles everything pending. Throws when the chain cannot be reached; the
   * unsettled charges stay pending and the same batch is re-sent next time.
   */
  flush(): Promise<void> {
    this.#flushing ??= this.#settle().finally(() => {
      this.#flushing = null;
      this.#deferred.clear();
    });
    return this.#flushing;
  }

  async #settle(): Promise<void> {
    for (;;) {
      const batch = this.#batch ?? (await this.#nextBatch());
      if (!batch) {
        return;
      }
      const mayHaveApplied = batch.attempted;
      batch.attempted = true;
      this.#persist();

      const items = [...batch.items].map(([id, amount]): [string, string] => [
        id,
        amount.toString(),
      ]);
      const result = await this.#chain.debitBatch(batch.seq, items);

      if (result.status === "applied") {
        this.#lastSeq = batch.seq;
        this.#batch = null;
      } else if (result.status === "out_of_sequence") {
        this.#lastSeq = result.lastApplied;
        if (mayHaveApplied && result.lastApplied >= batch.seq) {
          // An earlier attempt went through although its confirmation was lost.
          this.#batch = null;
        } else {
          batch.seq = result.lastApplied + 1;
          batch.attempted = false;
        }
      } else {
        await this.#shrink(batch, result.tokenId);
      }
      this.#persist();
    }
  }

  /** Moves up to one batch of charges out of `#pending`. */
  async #nextBatch(): Promise<Batch | null> {
    const due = ([tokenId, amount]: [string, bigint]) =>
      amount > 0n && !this.#deferred.has(tokenId);
    if (![...this.#pending].some(due)) {
      return null;
    }
    this.#lastSeq ??= await this.#chain.getDebitSeq();
    // No awaits from here on: a charge must land either in this batch or after it.
    const items = new Map<string, bigint>();
    for (const entry of this.#pending) {
      if (due(entry) && items.size < MAX_BATCH_ITEMS) {
        items.set(entry[0], entry[1]);
      }
    }
    for (const tokenId of items.keys()) {
      this.#pending.delete(tokenId);
    }
    this.#batch = { seq: this.#lastSeq + 1, items, attempted: false };
    return this.#batch;
  }

  /**
   * The contract refused the batch because this kat owes more than it holds.
   * Charge what it has and write off the rest, so one kat cannot block the others.
   */
  async #shrink(batch: Batch, tokenId: string): Promise<void> {
    const owed = batch.items.get(tokenId) ?? 0n;
    const balance = BigInt((await this.#chain.getKat(tokenId))?.balance ?? "0");
    batch.items.delete(tokenId);
    if (balance >= owed) {
      // Funded since the refusal: nothing to write off, settle it next time.
      this.#pending.set(tokenId, (this.#pending.get(tokenId) ?? 0n) + owed);
      this.#deferred.add(tokenId);
    } else {
      this.#log(
        `Writing off ${owed - balance} yoctoNEAR owed by kat ${tokenId}: it holds only ${balance}`,
      );
      if (balance > 0n) {
        batch.items.set(tokenId, balance);
      }
    }
    // The contract rejected the batch, so it certainly was not applied.
    batch.attempted = false;
    if (batch.items.size === 0) {
      this.#batch = null;
    }
  }

  #persist(): void {
    const strings = (amounts: Map<string, bigint>) =>
      Object.fromEntries([...amounts].map(([id, amount]) => [id, amount.toString()]));
    this.#journal?.save({
      pending: strings(this.#pending),
      batch: this.#batch ? { ...this.#batch, items: strings(this.#batch.items) } : null,
    });
  }
}
