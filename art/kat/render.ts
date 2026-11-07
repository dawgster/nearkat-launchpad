/**
 * Draws a kat from its six traits and its growth stage, as one SVG string.
 * Shared by the web app and the keeper, like the rest of the art package.
 */
import { baseDefs, body, elderBrows, HOLD, head, rightArm, rightPaw, SKULL_TOP } from "./base.ts";
import { HEAD, INK, type Look, PAW, SIZE, type TraitValue } from "./canvas.ts";
import { EYES } from "./layers/eyes.ts";
import { FURS, type FurValue } from "./layers/fur.ts";
import { HEADWEAR } from "./layers/headwear.ts";
import { OUTFITS } from "./layers/outfit.ts";
import { PAWS } from "./layers/paws.ts";
import { SKIES } from "./layers/sky.ts";

export type Stage = 0 | 1 | 2 | 3;

/** One kat's traits, by name. */
export interface KatLook {
  sky: string;
  fur: string;
  eyes: string;
  paws: string;
  outfit: string;
  headwear: string;
}

export const LAYERS = {
  sky: SKIES,
  fur: FURS,
  eyes: EYES,
  paws: PAWS,
  outfit: OUTFITS,
  headwear: HEADWEAR,
} as const;

function find<T extends { name: string }>(values: readonly T[], name: string, layer: string): T {
  const value = values.find((candidate) => candidate.name === name);
  if (!value) {
    throw new Error(`No ${layer} called "${name}"`);
  }
  return value;
}

/**
 * How a stage frames the kat. Grown kats fill the frame the way the
 * reference's dragons do (the head about 80% of its width, hats cut off at
 * the top, only the shoulders showing); young ones sit further back.
 */
const ZOOM: Record<Stage, number> = { 0: 1, 1: 1.1, 2: 1.2, 3: 1.2 };
const FOCUS = 180;
const framing = (stage: Stage) =>
  `translate(${FOCUS} ${FOCUS}) scale(${ZOOM[stage]}) translate(${-FOCUS} ${-FOCUS})`;

/**
 * The layers were drawn with heavy outlines; at this size the reference's are
 * crisp, so every dark outline is thinned here, once, for all of them.
 * Coloured strokes (laser beams, rain, stitching) keep their width.
 */
const INK_LINE = 0.6;
function crispOutlines(svg: string): string {
  return svg.replace(/<[^>]+>/g, (tag) =>
    tag.includes(`stroke="${INK}"`)
      ? tag.replace(
          /stroke-width="([\d.]+)"/,
          (_, width: string) => `stroke-width="${(Number(width) * INK_LINE).toFixed(2)}"`,
        )
      : tag,
  );
}

export interface RenderOptions {
  /** Prefix for ids, unique per drawing on one page. */
  id?: string;
  /** Pixel size; omitted, the SVG scales to its container. */
  size?: number;
  /** Accessible name; null hides the art from assistive technology. */
  title?: string | null;
}

const escapeXml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function renderKat(kat: KatLook, stage: Stage, options: RenderOptions = {}): string {
  const fur: FurValue = find(FURS, kat.fur, "fur");
  const look: Look = { fur: fur.colors, id: options.id ?? "k" };
  const layer = (values: readonly TraitValue[], name: string, what: string) =>
    find(values, name, what).draw(look);
  // Hats were drawn for a head whose top is HEAD.top, and items for a paw at
  // PAW; each layer moves as one piece to where the burrow meerkat's are.
  const hats = `<g transform="translate(0 ${SKULL_TOP - HEAD.top})">${layer(HEADWEAR, kat.headwear, "headwear")}</g>`;
  const held = `<g transform="translate(${HOLD.x - PAW.x} ${HOLD.y - PAW.y})">${layer(PAWS, kat.paws, "paws")}</g>`;
  const kat0 = [
    body(look),
    layer(OUTFITS, kat.outfit, "outfit"),
    head(look),
    layer(EYES, kat.eyes, "eyes"),
    stage === 3 ? elderBrows() : "",
    hats,
    rightArm(look),
    held,
    rightPaw(look),
  ].join("");
  const glow =
    stage === 3
      ? `<radialGradient id="${look.id}elder"><stop offset="0" stop-color="#fff6c8" stop-opacity="0.7"/><stop offset="1" stop-color="#fff6c8" stop-opacity="0"/></radialGradient><circle cx="200" cy="190" r="190" fill="url(#${look.id}elder)"/>`
      : "";
  const title = options.title === undefined ? describe(kat, stage) : options.title;
  const size =
    options.size === undefined ? "" : ` width="${options.size}" height="${options.size}"`;
  const a11y = title === null ? ' aria-hidden="true"' : ' role="img"';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}"${size}${a11y}>`,
    title === null ? "" : `<title>${escapeXml(title)}</title>`,
    `<defs>${baseDefs(look)}</defs>`,
    `<g stroke-linejoin="round">`,
    layer(SKIES, kat.sky, "sky"),
    glow,
    `<g transform="${framing(stage)}">${crispOutlines(kat0)}</g>`,
    "</g>",
    "</svg>",
  ].join("");
}

export const STAGE_NAMES = ["Hatchling", "Pup", "Sentry", "Elder"] as const;

/** A short description, for alt text. */
export function describe(kat: KatLook, stage: Stage): string {
  const extras = [kat.eyes, kat.paws, kat.outfit, kat.headwear].filter(
    (name) => !["Round", "Empty Paws", "Bare", "None"].includes(name),
  );
  return `${STAGE_NAMES[stage]} kat, ${kat.fur.toLowerCase()} fur, ${kat.sky.toLowerCase()} sky${
    extras.length ? `, ${extras.join(", ").toLowerCase()}` : ""
  }`;
}
