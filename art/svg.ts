/**
 * Token art as SVG markup. Shared by the web app, which draws it on the page,
 * and the keeper, which serves it to wallets and marketplaces, so a token
 * looks the same everywhere. No dependencies, so both can import it as is.
 */
import {
  type Accessory,
  describeKat,
  type KatTraits,
  katTraits,
  PLAIN_STAGE_NAMES,
  type Stage,
  sigilTraits,
} from "./traits.ts";

export interface SvgOptions {
  /** Pixel size; omitted, the SVG scales to its container. */
  size?: number;
  /** Prefix for gradient and clip ids, unique per drawing on one page. */
  idPrefix?: string;
  /** Accessible name. Null hides the art from assistive technology. */
  title?: string | null;
  /** Extra attributes on the root element, already escaped. */
  className?: string;
}

const escapeXml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function root(body: string, defaultTitle: string, options: SvgOptions): string {
  const title = options.title === undefined ? defaultTitle : options.title;
  const size =
    options.size === undefined ? "" : ` width="${options.size}" height="${options.size}"`;
  const cls = options.className ? ` class="${escapeXml(options.className)}"` : "";
  const a11y = title === null ? ' aria-hidden="true"' : ' role="img"';
  const titleTag = title === null ? "" : `<title>${escapeXml(title)}</title>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"${size}${cls}${a11y}>${titleTag}${body}</svg>`;
}

const INK = "#1a110b";
const HOLE_Y = 100;
/** How far down the burrow the kat sits at each stage: it climbs out as it grows. */
const SINK: Record<Stage, number> = { 0: 36, 1: 20, 2: 0, 3: 0 };

function accessory(kind: Accessory, trim: string): string {
  switch (kind) {
    case "scarf":
      return `<g fill="${trim}"><path d="M45 57q15 9 30 0v6q-15 9-30 0Z"/><path d="M66 62l5 14-6 1-3-13Z"/></g>`;
    case "bandana":
      return `<path d="M46 58q14 7 28 0l-14 15Z" fill="${trim}"/>`;
    case "flower": {
      const petals = [0, 72, 144, 216, 288]
        .map((angle) => {
          const cx = Math.cos((angle * Math.PI) / 180) * 3.2;
          const cy = Math.sin((angle * Math.PI) / 180) * 3.2;
          return `<circle cx="${cx.toFixed(3)}" cy="${cy.toFixed(3)}" r="2.6" fill="${trim}"/>`;
        })
        .join("");
      return `<g transform="translate(77 27)">${petals}<circle r="2" fill="#f2bd35"/></g>`;
    }
    case "beanie":
      return `<g fill="${trim}"><path d="M43 30q17-26 34 0Z"/><rect x="42" y="27" width="36" height="5" rx="2.5"/><rect x="42" y="27" width="36" height="5" rx="2.5" fill="#000" opacity="0.2"/><circle cx="60" cy="9" r="3.5"/></g>`;
    case "glasses":
      return `<g fill="none" stroke="${trim}" stroke-width="1.8"><circle cx="51" cy="38" r="6.5"/><circle cx="69" cy="38" r="6.5"/><path d="M57.5 37h5"/></g>`;
    case "leaf":
      return `<g transform="translate(60 19) rotate(-25)"><path d="M0 0c-3-8 2-14 10-15-1 8-4 14-10 15Z" fill="#4caf6a"/><path d="M0 0c3-5 6-9 10-15" stroke="#2e7a45" stroke-width="0.8" fill="none"/></g>`;
    case "star":
      return `<path d="M60 70l2 4.2 4.6.6-3.4 3.2.9 4.6-4.1-2.3-4.1 2.3.9-4.6-3.4-3.2 4.6-.6Z" fill="${trim}"/>`;
  }
}

function kat(t: KatTraits, stage: Stage): string {
  const { fur, shade, belly } = t.fur;
  const eyeR = t.eyes === "bright" ? 3.6 : 3;
  const shine = t.eyes === "bright" ? t.sky.glow : "#fff";
  const eyes =
    t.eyes === "sleepy"
      ? `<path d="M47.6 37.6a3.6 3.6 0 0 1 6.8 0Z" fill="#2a1a10"/><path d="M65.6 37.6a3.6 3.6 0 0 1 6.8 0Z" fill="#2a1a10"/>`
      : `<circle cx="52.2" cy="36.8" r="1.1" fill="${shine}"/><circle cx="70.2" cy="36.8" r="1.1" fill="${shine}"/>`;
  return [
    // body, upright on its haunches
    `<path d="M43 114c-2-24 3-46 17-53 14 7 19 29 17 53Z" fill="${fur}"/>`,
    `<ellipse cx="60" cy="90" rx="9.5" ry="19" fill="${belly}"/>`,
    `<ellipse cx="53" cy="74" rx="3.6" ry="6" fill="${shade}" transform="rotate(18 53 74)"/>`,
    `<ellipse cx="67" cy="74" rx="3.6" ry="6" fill="${shade}" transform="rotate(-18 67 74)"/>`,
    stage >= 2 && t.accessory === "star" ? accessory("star", t.trim) : "",
    `<g transform="rotate(${t.tilt} 60 58)">`,
    // ears sit behind the head
    `<circle cx="42.5" cy="35" r="5" fill="${shade}"/><circle cx="77.5" cy="35" r="5" fill="${shade}"/>`,
    `<path d="M42 38c0-14 8-20 18-20s18 6 18 20c0 10-10 20-18 22-8-2-18-12-18-22Z" fill="${fur}"/>`,
    `<path d="M54 20c2 6 10 6 12 0" fill="none" stroke="${shade}" stroke-width="2"/>`,
    // the dark patches that make a meerkat look like it is wearing sunglasses
    `<ellipse cx="51" cy="38.5" rx="6" ry="7.5" fill="#2a1a10" transform="rotate(16 51 38.5)"/>`,
    `<ellipse cx="69" cy="38.5" rx="6" ry="7.5" fill="#2a1a10" transform="rotate(-16 69 38.5)"/>`,
    `<circle cx="51" cy="38" r="${eyeR}" fill="#050505"/><circle cx="69" cy="38" r="${eyeR}" fill="#050505"/>`,
    eyes,
    `<ellipse cx="60" cy="50.5" rx="7" ry="6.5" fill="${belly}"/>`,
    `<ellipse cx="60" cy="54.5" rx="3.2" ry="2.2" fill="${INK}"/>`,
    `<path d="M58 58.4q2 1.6 4 0" fill="none" stroke="${INK}" stroke-width="0.9" stroke-linecap="round"/>`,
    stage >= 2 && t.accessory !== "star" ? accessory(t.accessory, t.trim) : "",
    "</g>",
  ].join("");
}

/**
 * A kat's portrait. Its look comes from `seed`; how far it has climbed out
 * of its burrow, and what it wears, from its growth stage.
 */
export function katSvg(seed: string, stage: Stage, options: SvgOptions = {}): string {
  const id = options.idPrefix ?? "k";
  const t = katTraits(seed);
  const stars = t.stars
    .map(
      ([x, y, r]) =>
        `<circle cx="${(x * 120).toFixed(2)}" cy="${(y * 120).toFixed(2)}" r="${(r * 0.7).toFixed(3)}" fill="#f4ecd9" opacity="0.7"/>`,
    )
    .join("");
  const sink = `translate(0 ${SINK[stage]})${stage === 0 ? " translate(60 100) scale(0.86) translate(-60 -100)" : ""}`;
  const body = [
    "<defs>",
    `<linearGradient id="${id}sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.sky.top}"/><stop offset="1" stop-color="${t.sky.bottom}"/></linearGradient>`,
    `<radialGradient id="${id}halo"><stop offset="0" stop-color="${t.sky.glow}" stop-opacity="${stage === 3 ? 0.55 : 0.28}"/><stop offset="1" stop-color="${t.sky.glow}" stop-opacity="0"/></radialGradient>`,
    `<clipPath id="${id}frame"><circle cx="60" cy="60" r="60"/></clipPath>`,
    // the kat is hidden below the lip of its burrow
    `<clipPath id="${id}above"><rect width="120" height="${HOLE_Y + 1}"/></clipPath>`,
    "</defs>",
    `<g clip-path="url(#${id}frame)">`,
    `<rect width="120" height="120" fill="url(#${id}sky)"/>`,
    stars,
    `<circle cx="60" cy="58" r="44" fill="url(#${id}halo)"/>`,
    stage === 3
      ? `<circle cx="60" cy="56" r="40" fill="none" stroke="${t.sky.glow}" stroke-opacity="0.5" stroke-width="1.2" stroke-dasharray="2 5"/>`
      : "",
    `<path d="M0 120V101q60-22 120 0v19Z" fill="#4a3323"/>`,
    `<ellipse cx="60" cy="${HOLE_Y}" rx="27" ry="7" fill="#120a05"/>`,
    `<g clip-path="url(#${id}above)"><g transform="${sink}">${kat(t, stage)}</g></g>`,
    `<path d="M0 120v-12q60-10 120 0v12Z" fill="#2a1a10"/>`,
    "</g>",
  ].join("");
  return root(body, describeKat(t, stage), options);
}

function polygon(points: number, radius: number, turn: number): string {
  return Array.from({ length: points }, (_, i) => {
    const angle = ((i / points) * 360 + turn - 90) * (Math.PI / 180);
    return `${(60 + Math.cos(angle) * radius).toFixed(2)},${(60 + Math.sin(angle) * radius).toFixed(2)}`;
  }).join(" ");
}

/**
 * Art for a token of a launched collection. Launched tokens can be any kind
 * of prompt, so the art is abstract: a sigil whose shape comes from `seed`
 * and which gains rings and light as the token grows.
 */
export function sigilSvg(seed: string, stage: Stage, options: SvgOptions = {}): string {
  const id = options.idPrefix ?? "s";
  const t = sigilTraits(seed);
  const main = `hsl(${t.hue} 80% 62%)`;
  const deep = `hsl(${t.hue} 55% 14%)`;
  const accent = `hsl(${(t.hue + 150) % 360} 85% 66%)`;
  const rings = Array.from({ length: Math.min(t.rings, stage + 1) }, (_, i) => {
    const dash = i % 2 ? ' stroke-dasharray="3 4"' : "";
    return `<circle cx="60" cy="60" r="${50 - i * 6}" fill="none" stroke="${main}" stroke-opacity="${(0.55 - i * 0.12).toFixed(2)}" stroke-width="1.2"${dash}/>`;
  }).join("");
  const inner =
    t.inner === "circle"
      ? `<circle cx="60" cy="60" r="9" fill="${main}"/>`
      : t.inner === "diamond"
        ? `<path d="M60 49l11 11-11 11-11-11Z" fill="${main}"/>`
        : `<path d="M44 60q16-14 32 0-16 14-32 0Z" fill="${main}"/><circle cx="60" cy="60" r="4.5" fill="${deep}"/>`;
  const body = [
    "<defs>",
    `<radialGradient id="${id}bg" cx="0.5" cy="0.45" r="0.7"><stop offset="0" stop-color="hsl(${t.hue} 50% 24%)"/><stop offset="1" stop-color="${deep}"/></radialGradient>`,
    `<radialGradient id="${id}core"><stop offset="0" stop-color="${accent}" stop-opacity="${(0.25 + stage * 0.2).toFixed(2)}"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>`,
    "</defs>",
    `<circle cx="60" cy="60" r="60" fill="url(#${id}bg)"/>`,
    `<circle cx="60" cy="60" r="44" fill="url(#${id}core)"/>`,
    rings,
    `<polygon points="${polygon(t.points, 30, t.turn)}" fill="none" stroke="${main}" stroke-width="2.4" stroke-linejoin="round"/>`,
    stage >= 2
      ? `<polygon points="${polygon(t.points, 30, t.turn + 180 / t.points)}" fill="none" stroke="${accent}" stroke-width="1.4" stroke-linejoin="round" opacity="0.8"/>`
      : "",
    inner,
    stage === 3
      ? `<circle cx="60" cy="60" r="56" fill="none" stroke="${accent}" stroke-width="2"/>`
      : "",
  ].join("");
  return root(body, `${PLAIN_STAGE_NAMES[stage]} sigil`, options);
}
