/**
 * The whole kat collection, drawn up front: one combination of traits per
 * slot, every value on exactly its share of the supply, and no two kats
 * alike (docs/superpowers/specs/2026-11-07-kat-traits.md, "No two alike").
 *
 * The draw is deterministic, from a fixed seed, so the web app, the keeper
 * and anyone checking can recompute the same list instead of storing it.
 */
import { seededRandom } from "../traits.ts";
import { type KatLook, LAYERS } from "./render.ts";

export const SUPPLY = 5000;
const SEED = "nearkat-collection-v1";

type Layer = keyof KatLook;
const ORDER = Object.keys(LAYERS) as Layer[];

/** Each value's exact count: its share of `supply`, by largest remainder so they sum to it. */
function counts(layer: Layer, supply: number): Array<[string, number]> {
  const values = LAYERS[layer];
  const exact = values.map((value) => value.share * supply);
  const whole = exact.map(Math.floor);
  let left = supply - whole.reduce((sum, n) => sum + n, 0);
  const byRemainder = exact
    .map((x, i) => [x - Math.floor(x), i] as const)
    .sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of byRemainder) {
    if (left <= 0) {
      break;
    }
    whole[i] = (whole[i] ?? 0) + 1;
    left--;
  }
  return values.map((value, i) => [value.name, whole[i] ?? 0]);
}

function shuffle<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j] as T, items[i] as T];
  }
  return items;
}

const keyOf = (kat: KatLook) => ORDER.map((layer) => kat[layer]).join("|");

/** Draws the collection. Same inputs, same list, on every machine. */
export function drawCollection(supply = SUPPLY, seed = SEED): KatLook[] {
  const random = seededRandom(seed);
  const columns = Object.fromEntries(
    ORDER.map((layer) => [
      layer,
      shuffle(
        counts(layer, supply).flatMap(([name, n]) => Array.from({ length: n }, () => name)),
        random,
      ),
    ]),
  ) as Record<Layer, string[]>;
  const row = (i: number) =>
    Object.fromEntries(ORDER.map((layer) => [layer, columns[layer][i]])) as unknown as KatLook;

  // Break clashes by swapping one layer's value between two slots, which
  // keeps every value's count exact. A swap is kept only if both slots end up
  // with combinations nobody else has, so it can never make a new clash.
  const taken = new Map<string, number>();
  const add = (key: string, by: number) => taken.set(key, (taken.get(key) ?? 0) + by);
  for (let i = 0; i < supply; i++) {
    add(keyOf(row(i)), 1);
  }
  for (let i = 0; i < supply; i++) {
    while ((taken.get(keyOf(row(i))) ?? 0) > 1) {
      const layer = ORDER[Math.floor(random() * ORDER.length)] as Layer;
      const j = Math.floor(random() * supply);
      const column = columns[layer];
      if (j === i || column[i] === column[j]) {
        continue;
      }
      const before = [keyOf(row(i)), keyOf(row(j))] as const;
      add(before[0], -1);
      add(before[1], -1);
      [column[i], column[j]] = [column[j] as string, column[i] as string];
      const after = [keyOf(row(i)), keyOf(row(j))] as const;
      if (after[0] !== after[1] && !taken.get(after[0]) && !taken.get(after[1])) {
        add(after[0], 1);
        add(after[1], 1);
      } else {
        [column[i], column[j]] = [column[j] as string, column[i] as string];
        add(before[0], 1);
        add(before[1], 1);
      }
    }
  }
  return Array.from({ length: supply }, (_, i) => row(i));
}

let drawn: KatLook[] | null = null;

/**
 * The traits of a token. Until the contract hands each mint a random slot,
 * token #n takes slot n - 1.
 */
export function katForToken(tokenId: string): KatLook {
  drawn ??= drawCollection();
  const n = Number(tokenId);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Not a kat token id: ${tokenId}`);
  }
  return drawn[(n - 1) % drawn.length] as KatLook;
}
