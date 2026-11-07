/**
 * The kat portrait's canvas: a 400×400 bust, the way BLACKDRAGONFOREVER draws
 * its dragons. Every layer draws in these coordinates, against the anchors
 * below, so any outfit fits any kat and any hat sits on any head.
 */

export const SIZE = 400;

/** Outline colour and width, shared by every layer so the kat reads as one drawing. */
/** The burrow meerkat's dark brown, not black. */
export const INK = "#39271d";
export const LINE = 5;
/** Line attributes for a filled shape with the kat's outline. */
export const OUTLINE = `stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round" stroke-linecap="round"`;

/** The head: an egg, wide at the eyes, narrowing to the muzzle. */
export const HEAD = {
  cx: 200,
  top: 70,
  bottom: 290,
  left: 70,
  right: 330,
  path: "M200 70C292 70 336 128 331 190C327 246 281 286 200 291C119 286 73 246 69 190C64 128 108 70 200 70Z",
};

/** Where each eye's centre is; eyes are drawn about EYE_R across. */
export const EYE_L = { x: 150, y: 182 };
export const EYE_R = { x: 250, y: 182 };
export const EYE_RADIUS = 30;

/** The nose and the mouth under it. */
export const NOSE = { x: 200, y: 228 };
export const MOUTH = { x: 200, y: 258 };

/** The body below the head, cropped by the bottom of the frame. */
export const BODY = {
  neck: 272,
  path: "M128 262C100 300 80 352 70 405H330C320 352 300 300 272 262Z",
  belly: "M162 286C148 326 142 366 142 405H258C258 366 252 326 238 286Z",
};

/** The raised paw, which holds whatever the Paws trait is. */
export const PAW = { x: 302, y: 300 };

/** A kat's colours, from its Fur trait. */
export interface Fur {
  name: string;
  /** Main coat. */
  fur: string;
  /** Cel shadow on the coat. */
  shade: string;
  /** Face, muzzle and belly. */
  belly: string;
  /** The dark patches round the eyes, the ears' insides and the forehead stripe. */
  patch: string;
  /** Extra markings drawn over the coat, inside the head and body outlines. */
  markings?: (look: Look, part: "head" | "body") => string;
}

/** What a layer needs to draw itself. */
export interface Look {
  fur: Fur;
  /** Prefix for ids (gradients, clips), unique per drawing on one page. */
  id: string;
}

/** One value of a trait, with its share of the collection and its drawing. */
export interface TraitValue {
  name: string;
  /** Share of the collection, 0..1. Each layer's shares sum to 1. */
  share: number;
  draw: (look: Look) => string;
}

/** Ids of the clip paths the base defines, for layers that need to stay inside the kat. */
export const clipIds = (look: Look) => ({
  head: `${look.id}clip-head`,
  body: `${look.id}clip-body`,
});

/** Shades a colour towards black (amount < 0) or white (amount > 0). */
export function tint(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number) => {
    const c = (n >> shift) & 255;
    const target = amount < 0 ? 0 : 255;
    return Math.round(c + (target - c) * Math.abs(amount));
  };
  return `#${[16, 8, 0].map((s) => channel(s).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * NEAR's mark, in a 16×16 box: place it with
 * `<path d="${NEAR_MARK}" transform="translate(x y) scale(s)" fill="…"/>`.
 */
export const NEAR_MARK =
  "M13.9017 0.646973C13.3462 0.646973 12.8304 0.929357 12.5394 1.39357L9.40403 5.95741C9.30186 6.10784 9.34331 6.31059 9.49675 6.41075C9.6211 6.49202 9.78561 6.48196 9.89889 6.38645L12.9851 3.76201C13.0364 3.71677 13.1154 3.72137 13.1616 3.77165C13.1825 3.79469 13.1937 3.82444 13.1937 3.85502V12.0719C13.1937 12.1397 13.1377 12.1942 13.0684 12.1942C13.0312 12.1942 12.9962 12.1783 12.9727 12.1502L3.6435 1.20169C3.33966 0.850174 2.89352 0.647392 2.42388 0.646973H2.09782C1.21536 0.646973 0.5 1.34833 0.5 2.2135V13.7863C0.5 14.6515 1.21536 15.3528 2.09782 15.3528C2.65336 15.3528 3.16915 15.0704 3.46017 14.6062L6.59558 10.0424C6.69769 9.89194 6.65624 9.68919 6.50279 9.58903C6.37845 9.50776 6.21394 9.51782 6.10071 9.61334L3.01446 12.2378C2.96318 12.283 2.88412 12.2784 2.83797 12.2281C2.81703 12.2051 2.80592 12.1753 2.80634 12.1447V3.92583C2.80634 3.85796 2.86232 3.80349 2.93155 3.80349C2.96831 3.80349 3.00377 3.81941 3.02728 3.84748L12.3552 14.7981C12.659 15.1496 13.1052 15.3524 13.5749 15.3528H13.9009C14.7833 15.3532 15.4992 14.6523 15.5 13.7871V2.2135C15.5 1.34833 14.7842 0.646973 13.9017 0.646973Z";
