import { describe, expect, it } from "vitest";
import { drawCollection, katForToken, SUPPLY } from "../../art/kat/collection.ts";
import { NATURES } from "../../art/kat/natures.ts";
import { type KatLook, LAYERS, renderKat } from "../../art/kat/render.ts";

const DEFAULT: KatLook = {
  sky: "Day",
  fur: "Sand",
  eyes: "Round",
  paws: "Empty Paws",
  outfit: "Bare",
  headwear: "None",
};

/** The trait table in docs/superpowers/specs/2026-11-07-kat-traits.md. */
const COUNTS = { sky: 24, fur: 15, eyes: 30, paws: 30, outfit: 40, headwear: 40 };

const wellFormed = (svg: string) => {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  return doc.querySelector("parsererror") === null && doc.documentElement.nodeName === "svg";
};

describe("kat art", () => {
  for (const [layer, values] of Object.entries(LAYERS) as [keyof KatLook, typeof LAYERS.sky][]) {
    describe(layer, () => {
      it("has the values in the trait table, each named once", () => {
        const names = values.map((value) => value.name);
        expect(names).toHaveLength(COUNTS[layer]);
        expect(new Set(names).size).toBe(names.length);
      });

      it("shares the whole collection between its values", () => {
        const total = values.reduce((sum, value) => sum + value.share, 0);
        expect(total).toBeCloseTo(1, 9);
        expect(values.every((value) => value.share > 0)).toBe(true);
      });

      it("draws every value as well-formed SVG", () => {
        for (const value of values) {
          const svg = renderKat({ ...DEFAULT, [layer]: value.name }, 2, { title: value.name });
          expect(wellFormed(svg), `${layer}: ${value.name}`).toBe(true);
        }
      });
    });
  }

  it("draws the same kat the same way every time, at every stage", () => {
    const kat: KatLook = { ...DEFAULT, sky: "Aurora", eyes: "Laser Gold", headwear: "Crown" };
    for (const stage of [0, 1, 2, 3] as const) {
      expect(renderKat(kat, stage)).toBe(renderKat(kat, stage));
      expect(wellFormed(renderKat(kat, stage))).toBe(true);
    }
  });

  it("names a kat for screen readers by its stage and traits", () => {
    const svg = renderKat({ ...DEFAULT, headwear: "Crown" }, 3);
    expect(svg).toContain("<title>Elder kat, sand fur, day sky, crown</title>");
    expect(svg).toContain('role="img"');
  });

  it("refuses a trait that isn't in the table", () => {
    expect(() => renderKat({ ...DEFAULT, eyes: "Lasers" }, 2)).toThrow('No eyes called "Lasers"');
  });
});

describe("kat natures", () => {
  it("give every trait one line, and only traits that exist", () => {
    for (const [layer, values] of Object.entries(LAYERS) as [keyof KatLook, typeof LAYERS.sky][]) {
      const names = values.map((value) => value.name).sort();
      expect(Object.keys(NATURES[layer]).sort(), layer).toEqual(names);
      for (const line of Object.values(NATURES[layer])) {
        expect(line.length, `${layer}: ${line}`).toBeLessThan(110);
        expect(line.startsWith("You"), `${layer}: ${line}`).toBe(true);
      }
    }
  });
});

describe("the kat collection", () => {
  const kats = drawCollection();

  it("draws a kat for every slot, no two alike", () => {
    expect(kats).toHaveLength(SUPPLY);
    expect(new Set(kats.map((kat) => JSON.stringify(kat))).size).toBe(SUPPLY);
  });

  it("puts every value on its share of the supply, to the nearest kat", () => {
    for (const [layer, values] of Object.entries(LAYERS) as [keyof KatLook, typeof LAYERS.sky][]) {
      for (const value of values) {
        const count = kats.filter((kat) => kat[layer] === value.name).length;
        expect(Math.abs(count - value.share * SUPPLY), `${layer}: ${value.name}`).toBeLessThan(1);
      }
    }
  });

  it("is the same list every time it is drawn", () => {
    expect(drawCollection()).toEqual(kats);
    expect(katForToken("1")).toEqual(kats[0]);
    expect(katForToken(String(SUPPLY))).toEqual(kats[SUPPLY - 1]);
  });
});
