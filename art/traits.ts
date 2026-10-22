/**
 * Generated token art. Everything about a token's look comes from a seed
 * (its contract and number), so it never changes and needs no storage; only
 * its growth stage changes, as its context is saved on-chain.
 */

/** How grown-up a token is, from how many times its context has been saved. */
export type Stage = 0 | 1 | 2 | 3;

export const STAGE_NAMES = ["Hatchling", "Pup", "Sentry", "Elder"] as const;

/** Stage names for launched collections, which can be any kind of prompt. */
export const PLAIN_STAGE_NAMES = ["New", "Growing", "Seasoned", "Deep"] as const;

/** Version 1 is the starter context; each later version is a saved conversation. */
export function stageOf(contextVersion: number): Stage {
  if (contextVersion >= 8) {
    return 3;
  }
  if (contextVersion >= 4) {
    return 2;
  }
  if (contextVersion >= 2) {
    return 1;
  }
  return 0;
}

/** Saves until the next stage, or null at the last one. */
export function savesToNextStage(contextVersion: number): number | null {
  const next = [2, 4, 8].find((threshold) => threshold > contextVersion);
  return next === undefined ? null : next - Math.max(contextVersion, 1);
}

/** FNV-1a, then a small PRNG: stable across browsers and versions. */
export function seededRandom(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T;
}

export const FURS = [
  { name: "Sand", fur: "#c9a26b", shade: "#9c7a4b", belly: "#ecd7ad" },
  { name: "Cinnamon", fur: "#b9774a", shade: "#8a5533", belly: "#e2b98f" },
  { name: "Ash", fur: "#a89d8b", shade: "#7a705f", belly: "#d9d1c0" },
  { name: "Gold", fur: "#d8b05e", shade: "#a8853c", belly: "#f3dfa9" },
  { name: "Cocoa", fur: "#8f6a4c", shade: "#664a33", belly: "#c9a888" },
  { name: "Cream", fur: "#e0c9a0", shade: "#b49c74", belly: "#f6ead2" },
] as const;

export const SKIES = [
  { name: "Night", top: "#071a24", bottom: "#0f3a3a", glow: "#19f6a1" },
  { name: "Dusk", top: "#2a1838", bottom: "#c8643a", glow: "#f2bd35" },
  { name: "Dawn", top: "#20304f", bottom: "#e7a77a", glow: "#f4ecd9" },
  { name: "Noon", top: "#3d86b8", bottom: "#a9d6e5", glow: "#f2bd35" },
  { name: "Aurora", top: "#06121c", bottom: "#1b4d52", glow: "#7cf2d0" },
] as const;

export const ACCESSORIES = [
  "scarf",
  "flower",
  "beanie",
  "glasses",
  "leaf",
  "bandana",
  "star",
] as const;
export type Accessory = (typeof ACCESSORIES)[number];

export const EYES = ["round", "sleepy", "bright"] as const;
export type Eyes = (typeof EYES)[number];

const TRIMS = ["#19f6a1", "#f2bd35", "#c8643a", "#e86a92", "#6aa8ff", "#f4ecd9"] as const;

export interface KatTraits {
  fur: (typeof FURS)[number];
  sky: (typeof SKIES)[number];
  accessory: Accessory;
  trim: string;
  eyes: Eyes;
  /** Slight head tilt in degrees, for character. */
  tilt: number;
  /** Positions of a few stars, in 0..1 of the sky. */
  stars: Array<[number, number, number]>;
}

export function katTraits(seed: string): KatTraits {
  const random = seededRandom(`kat:${seed}`);
  return {
    fur: pick(random, FURS),
    sky: pick(random, SKIES),
    accessory: pick(random, ACCESSORIES),
    trim: pick(random, TRIMS),
    eyes: pick(random, EYES),
    tilt: Math.round((random() - 0.5) * 16),
    stars: Array.from({ length: 6 }, () => [random(), random() * 0.55, 0.6 + random()]),
  };
}

export interface SigilTraits {
  hue: number;
  /** Points on the outer shape. */
  points: number;
  /** Rotation of the inner shape, degrees. */
  turn: number;
  /** Rings drawn at full growth. */
  rings: number;
  inner: "circle" | "diamond" | "eye";
}

/** Abstract art for launched collections, whose tokens can be any kind of prompt. */
export function sigilTraits(seed: string): SigilTraits {
  const random = seededRandom(`sigil:${seed}`);
  return {
    hue: Math.floor(random() * 360),
    points: 3 + Math.floor(random() * 6),
    turn: Math.floor(random() * 360),
    rings: 2 + Math.floor(random() * 3),
    inner: pick(random, ["circle", "diamond", "eye"] as const),
  };
}

/** A short description of a kat's look, for screen readers and alt text. */
export function describeKat(traits: KatTraits, stage: Stage): string {
  const look = `${traits.fur.name.toLowerCase()} fur under a ${traits.sky.name.toLowerCase()} sky`;
  const extra = stage >= 2 ? `, wearing a ${traits.accessory}` : "";
  return `${STAGE_NAMES[stage]}: ${look}${extra}`;
}
