/** Fur: the kat's own colours. The one layer that changes the base itself. */
import { type Fur, type Look, tint } from "../canvas.ts";

export interface FurValue {
  name: string;
  share: number;
  colors: Fur;
}

const coat = (fur: string, shade: string, belly: string, patch: string) => ({
  fur,
  shade,
  belly,
  patch,
});

/** Small round spots, scattered the same way on every spotted kat. */
const spots = (look: Look, part: "head" | "body") => {
  const at =
    part === "head"
      ? [
          [150, 110, 8],
          [250, 108, 8],
          [118, 140, 6],
          [282, 138, 6],
          [200, 122, 6],
          [174, 98, 5],
          [226, 98, 5],
        ]
      : [
          [100, 360, 10],
          [120, 320, 7],
          [300, 350, 9],
          [286, 312, 7],
          [92, 392, 7],
        ];
  const color = tint(look.fur.fur, -0.45);
  return at.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`).join("");
};

/** The dark back-stripes real meerkats have, here on the crown and the shoulders. */
const stripes = (look: Look, part: "head" | "body") => {
  const color = tint(look.fur.fur, -0.4);
  return part === "head"
    ? `<g fill="${color}"><path d="M140 104q10 16 4 34l-9-2q5-14-3-30Z"/><path d="M260 104q-10 16-4 34l9-2q-5-14 3-30Z"/><path d="M168 96q8 12 4 26l-8-1q3-11-3-23Z"/><path d="M232 96q-8 12-4 26l8-1q-3-11 3-23Z"/></g>`
    : `<g fill="${color}"><path d="M96 330q16 10 18 30l-9 2q-2-16-15-24Z"/><path d="M84 366q16 8 18 30l-9 2q-2-16-15-24Z"/><path d="M304 330q-16 10-18 30l9 2q2-16 15-24Z"/><path d="M316 366q-16 8-18 30l9 2q2-16 15-24Z"/></g>`;
};

/** Tufts of moss, as if it had slept somewhere damp. */
const moss = (_look: Look, part: "head" | "body") => {
  const tufts =
    part === "head"
      ? [
          [140, 110],
          [262, 106],
          [296, 146],
        ]
      : [
          [104, 340],
          [292, 330],
          [110, 388],
        ];
  return tufts
    .map(
      ([x, y]) =>
        `<g transform="translate(${x} ${y})" fill="#5f8a3a"><circle r="9"/><circle cx="8" cy="-4" r="7"/><circle cx="-7" cy="-5" r="6"/><circle cx="2" cy="-3" r="3" fill="#9cc66a"/></g>`,
    )
    .join("");
};

/** Gilded: metal-bright streaks of shine. */
const shine = (_look: Look, part: "head" | "body") =>
  part === "head"
    ? `<g fill="#fffbe0" opacity="0.8"><path d="M118 120q20-30 50-40l4 8q-28 10-46 38Z"/><circle cx="186" cy="80" r="4"/></g>`
    : `<g fill="#fffbe0" opacity="0.7"><path d="M104 360q8-30 26-50l7 5q-16 20-24 47Z"/></g>`;

export const FURS: readonly FurValue[] = [
  {
    name: "Sand",
    share: 0.2,
    colors: { name: "Sand", ...coat("#d4a96a", "#b08550", "#f1dcb2", "#5a3d26") },
  },
  {
    name: "Cinnamon",
    share: 0.15,
    colors: { name: "Cinnamon", ...coat("#c27a48", "#9c5a31", "#ecc39b", "#4e2c18") },
  },
  {
    name: "Ash",
    share: 0.1,
    colors: { name: "Ash", ...coat("#a99f90", "#857b6c", "#ddd6c8", "#3d3730") },
  },
  {
    name: "Gold",
    share: 0.08,
    colors: { name: "Gold", ...coat("#e2b553", "#b98d34", "#f7e3a6", "#6a4a1a") },
  },
  {
    name: "Cocoa",
    share: 0.08,
    colors: { name: "Cocoa", ...coat("#8c6447", "#6b4a33", "#c9a585", "#2f1f15") },
  },
  {
    name: "Cream",
    share: 0.08,
    colors: { name: "Cream", ...coat("#ead6ae", "#c8b187", "#fbf1dc", "#6b5539") },
  },
  {
    name: "Silver",
    share: 0.04,
    colors: { name: "Silver", ...coat("#c3c7cc", "#9aa0a8", "#eef0f2", "#3c4048") },
  },
  {
    name: "Midnight",
    share: 0.04,
    colors: { name: "Midnight", ...coat("#3b3f55", "#2a2d3e", "#6d7290", "#14151d") },
  },
  {
    name: "Frost",
    share: 0.04,
    colors: { name: "Frost", ...coat("#cfe6f2", "#a5c6d8", "#f4fbff", "#4c6a80") },
  },
  {
    name: "Ember",
    share: 0.04,
    colors: { name: "Ember", ...coat("#d9572b", "#a83c19", "#f6b48a", "#3b1408") },
  },
  {
    name: "Spotted",
    share: 0.03,
    colors: {
      name: "Spotted",
      ...coat("#dcb57a", "#b78f57", "#f4e2bd", "#5a3d26"),
      markings: spots,
    },
  },
  {
    name: "Striped",
    share: 0.03,
    colors: {
      name: "Striped",
      ...coat("#c98d58", "#a26c3d", "#efcca6", "#4e2c18"),
      markings: stripes,
    },
  },
  {
    name: "Mossy",
    share: 0.03,
    colors: { name: "Mossy", ...coat("#9a9a6a", "#77774c", "#d8d8b0", "#36401c"), markings: moss },
  },
  {
    name: "Albino",
    share: 0.03,
    colors: { name: "Albino", ...coat("#f6f1ea", "#ddd3c6", "#ffffff", "#e9b7bd") },
  },
  {
    name: "Gilded",
    share: 0.03,
    colors: {
      name: "Gilded",
      ...coat("#f0c64a", "#c9962a", "#fff0b0", "#8a5a10"),
      markings: shine,
    },
  },
];
