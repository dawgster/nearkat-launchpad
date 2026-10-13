import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { FileJournal, Meter, type MeterJournal, type MeterState } from "../src/meter.ts";
import { FakeChain, NEAR } from "./fakes.ts";

class MemoryJournal implements MeterJournal {
  state: MeterState | null = null;
  load(): MeterState | null {
    return this.state ? structuredClone(this.state) : null;
  }
  save(state: MeterState): void {
    this.state = structuredClone(state);
  }
}

function setup(journal?: MeterJournal) {
  const chain = new FakeChain();
  chain.mint("1", "alice.near", NEAR);
  chain.mint("2", "bob.near", NEAR);
  const logs: string[] = [];
  const meter = new Meter(chain, { journal, log: (message) => logs.push(message) });
  return { chain, meter, logs };
}
const balance = (chain: FakeChain, id: string) => BigInt(chain.kats.get(id)?.balance ?? "-1");

describe("Meter", () => {
  test("adds up charges per kat", () => {
    const { meter } = setup();
    meter.charge("1", 5n);
    meter.charge("1", 7n);
    meter.charge("2", 1n);
    expect(meter.pending("1")).toBe(12n);
    expect(meter.pending("2")).toBe(1n);
    expect(meter.pending("3")).toBe(0n);
  });

  test("settles all pending charges in one numbered batch", async () => {
    const { chain, meter } = setup();
    meter.charge("1", 5n);
    meter.charge("2", 1n);
    await meter.flush();
    expect(chain.debits).toEqual([
      [
        1,
        [
          ["1", "5"],
          ["2", "1"],
        ],
      ],
    ]);
    expect(meter.pending("1")).toBe(0n);
    expect(balance(chain, "1")).toBe(NEAR - 5n);
  });

  test("continues the contract's sequence", async () => {
    const { chain, meter } = setup();
    chain.debitSeq = 7;
    meter.charge("1", 5n);
    await meter.flush();
    meter.charge("1", 5n);
    await meter.flush();
    expect(chain.debits.map(([seq]) => seq)).toEqual([8, 9]);
  });

  test("makes no chain call when nothing is pending", async () => {
    const { chain, meter } = setup();
    await meter.flush();
    expect(chain.debits).toEqual([]);
  });

  test("keeps charges pending when the call never reached the contract", async () => {
    const { chain, meter } = setup();
    meter.charge("1", 5n);
    chain.debitFailure = "lost";
    await expect(meter.flush()).rejects.toThrow("RPC unavailable");
    expect(meter.pending("1")).toBe(5n);
    chain.debitFailure = "none";
    await meter.flush();
    expect(meter.pending("1")).toBe(0n);
    expect(balance(chain, "1")).toBe(NEAR - 5n);
  });

  test("does not charge twice when a batch applied but its confirmation was lost", async () => {
    const { chain, meter } = setup();
    meter.charge("1", 5n);
    chain.debitFailure = "unconfirmed";
    await expect(meter.flush()).rejects.toThrow("RPC timed out");
    expect(meter.pending("1")).toBe(5n);

    chain.debitFailure = "none";
    meter.charge("1", 2n);
    await meter.flush();
    expect(balance(chain, "1")).toBe(NEAR - 7n);
    expect(meter.pending("1")).toBe(0n);
    expect(chain.debits.map(([seq, items]) => [seq, items])).toEqual([
      [1, [["1", "5"]]],
      [2, [["1", "2"]]],
    ]);
  });

  test("settles other kats when one owes more than it has, and writes off the excess", async () => {
    const { chain, meter, logs } = setup();
    (chain.kats.get("1") as { balance: string }).balance = "5";
    meter.charge("1", 9n);
    meter.charge("2", 3n);
    await meter.flush();
    expect(balance(chain, "1")).toBe(0n);
    expect(balance(chain, "2")).toBe(NEAR - 3n);
    expect(meter.pending("1")).toBe(0n);
    expect(meter.pending("2")).toBe(0n);
    expect(logs.join("\n")).toContain("kat 1");
  });

  test("settles other kats when one has no balance left at all", async () => {
    const { chain, meter } = setup();
    (chain.kats.get("1") as { balance: string }).balance = "0";
    meter.charge("1", 9n);
    meter.charge("2", 3n);
    await meter.flush();
    expect(balance(chain, "2")).toBe(NEAR - 3n);
    expect(meter.pending("1")).toBe(0n);
    await meter.flush();
    expect(chain.debits).toHaveLength(1);
  });

  test("keeps working after an overdrawn kat was the only one in a batch", async () => {
    const { chain, meter } = setup();
    (chain.kats.get("1") as { balance: string }).balance = "0";
    meter.charge("1", 9n);
    await meter.flush();
    meter.charge("2", 3n);
    await meter.flush();
    expect(chain.debits).toEqual([[1, [["2", "3"]]]]);
  });

  test("keeps the full charge when the kat was funded right after the batch was refused", async () => {
    const { chain, meter } = setup();
    (chain.kats.get("1") as { balance: string }).balance = "5";
    meter.charge("1", 9n);
    const realGetKat = chain.getKat.bind(chain);
    chain.getKat = async (tokenId) => {
      (chain.kats.get("1") as { balance: string }).balance = "100";
      return realGetKat(tokenId);
    };
    await meter.flush();
    expect(meter.pending("1")).toBe(9n);
    await meter.flush();
    expect(balance(chain, "1")).toBe(91n);
    expect(meter.pending("1")).toBe(0n);
  });

  test("keeps a charge made while a flush is in flight", async () => {
    const { chain, meter } = setup();
    meter.charge("1", 5n);
    const flushing = meter.flush();
    meter.charge("1", 2n);
    expect(meter.pending("1")).toBe(7n);
    await flushing;
    expect(balance(chain, "1")).toBe(NEAR - 7n);
    expect(meter.pending("1")).toBe(0n);
  });

  test("sends one batch when flush is called twice at once", async () => {
    const { chain, meter } = setup();
    meter.charge("1", 5n);
    await Promise.all([meter.flush(), meter.flush()]);
    expect(chain.debits).toHaveLength(1);
    expect(balance(chain, "1")).toBe(NEAR - 5n);
  });

  test("splits many kats into batches of 200", async () => {
    const { chain, meter } = setup();
    for (let id = 3; id <= 252; id++) {
      chain.mint(String(id), "carol.near", NEAR);
      meter.charge(String(id), 1n);
    }
    await meter.flush();
    expect(chain.debits.map(([seq, items]) => [seq, items.length])).toEqual([
      [1, 200],
      [2, 50],
    ]);
  });

  test("restores unsettled charges from its journal after a restart", async () => {
    const journal = new MemoryJournal();
    const first = setup(journal);
    first.meter.charge("1", 5n);

    const { chain, meter } = setup(journal);
    expect(meter.pending("1")).toBe(5n);
    await meter.flush();
    expect(balance(chain, "1")).toBe(NEAR - 5n);
    expect(new Meter(chain, { journal }).pending("1")).toBe(0n);
  });

  test("does not charge twice when it restarts after an unconfirmed batch", async () => {
    const journal = new MemoryJournal();
    const { chain, meter } = setup(journal);
    meter.charge("1", 5n);
    chain.debitFailure = "unconfirmed";
    await expect(meter.flush()).rejects.toThrow();

    chain.debitFailure = "none";
    const restarted = new Meter(chain, { journal });
    expect(restarted.pending("1")).toBe(5n);
    await restarted.flush();
    expect(balance(chain, "1")).toBe(NEAR - 5n);
    expect(restarted.pending("1")).toBe(0n);
  });
});

describe("FileJournal", () => {
  const state: MeterState = {
    pending: { "1": "5" },
    batch: { seq: 3, items: { "2": "7" }, attempted: true },
  };

  test("returns null before anything was saved", async () => {
    const dir = await mkdtemp(join(tmpdir(), "keeper-journal-"));
    expect(new FileJournal(join(dir, "nested", "meter.json")).load()).toBeNull();
  });

  test("returns what was saved, across instances", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "keeper-journal-")), "nested", "meter.json");
    new FileJournal(path).save(state);
    expect(new FileJournal(path).load()).toEqual(state);
  });

  test("refuses to start from a journal it cannot read", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "keeper-journal-")), "meter.json");
    await writeFile(path, "{not json");
    expect(() => new FileJournal(path).load()).toThrow("meter journal");
  });
});
