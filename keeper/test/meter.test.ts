import { describe, expect, test } from "vitest";
import { Meter } from "../src/meter.ts";
import { FakeChain, NEAR } from "./fakes.ts";

function setup() {
  const chain = new FakeChain();
  chain.mint("1", "alice.near", NEAR);
  chain.mint("2", "bob.near", NEAR);
  return { chain, meter: new Meter(chain) };
}

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

  test("settles all pending charges in one batch", async () => {
    const { chain, meter } = setup();
    meter.charge("1", 5n);
    meter.charge("2", 1n);
    await meter.flush();
    expect(chain.debits).toEqual([
      [
        ["1", "5"],
        ["2", "1"],
      ],
    ]);
    expect(meter.pending("1")).toBe(0n);
    expect(chain.kats.get("1")?.balance).toBe((NEAR - 5n).toString());
  });

  test("makes no chain call when nothing is pending", async () => {
    const { chain, meter } = setup();
    await meter.flush();
    expect(chain.debits).toEqual([]);
  });

  test("keeps charges pending when the chain call fails", async () => {
    const { chain, meter } = setup();
    meter.charge("1", 5n);
    chain.failDebits = true;
    await expect(meter.flush()).rejects.toThrow("RPC unavailable");
    expect(meter.pending("1")).toBe(5n);
    chain.failDebits = false;
    await meter.flush();
    expect(meter.pending("1")).toBe(0n);
  });

  test("keeps a charge made while a flush is in flight", async () => {
    const { chain, meter } = setup();
    meter.charge("1", 5n);
    const flushing = meter.flush();
    meter.charge("1", 2n);
    await flushing;
    expect(meter.pending("1")).toBe(2n);
    expect(chain.debits).toEqual([[["1", "5"]]]);
  });
});
