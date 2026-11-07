/**
 * The meerkat every kat is: the same sentry that climbs out of the burrows on
 * the site (`Meerkat` in web/src/components/Savannah.tsx), drawn here as a
 * close-up bust. Its head is that drawing's own paths, scaled up by
 * `BURROW`, so the two can't drift apart.
 *
 * Split into parts so the layers can go between them: the outfit over the
 * body, the eyes over the patches, and whatever the right paw holds between
 * the arm and the claws.
 */
import { BODY, clipIds, INK, type Look, OUTLINE, tint } from "./canvas.ts";

/**
 * Burrow-drawing coordinates (a 180×210 box) to the bust's: the eyes land on
 * EYE_L and EYE_R, the ears at y≈186.
 */
export const BURROW = { scale: 2.3, x: 200 - 91 * 2.3, y: 182 - 64 * 2.3 };
const inBurrow = (svg: string) =>
  `<g transform="matrix(${BURROW.scale} 0 0 ${BURROW.scale} ${BURROW.x.toFixed(2)} ${BURROW.y.toFixed(2)})">${svg}</g>`;
/** Outline width inside the burrow group, so it matches the bust's lines. */
const LINE_IN_BURROW = 5 / BURROW.scale;
const STROKE = `stroke="${INK}" stroke-width="${LINE_IN_BURROW.toFixed(2)}" stroke-linejoin="round" stroke-linecap="round"`;

/** The burrow meerkat's skull, with its tuft of spiky fur on top. */
export const SKULL =
  "M42 64C44 36 60 27 77 25L85 12L91 23L100 17L106 27C128 29 141 48 140 71C142 78 145 82 149 85L142 89L147 95L138 97C128 110 112 117 92 117C72 117 56 110 46 97L37 95L42 89L35 85C39 81 41 76 42 64Z";
/** Where the skull's top edge sits in the bust, for hats. */
export const SKULL_TOP = Math.round(BURROW.y + 25 * BURROW.scale);

/** Clip paths for layers that must stay inside the head or the body. */
export function baseDefs(look: Look): string {
  const clip = clipIds(look);
  // A clipPath may only hold shapes, so the scaling goes on the path itself.
  const matrix = `matrix(${BURROW.scale} 0 0 ${BURROW.scale} ${BURROW.x.toFixed(2)} ${BURROW.y.toFixed(2)})`;
  return `<clipPath id="${clip.head}"><path d="${SKULL}" transform="${matrix}"/></clipPath><clipPath id="${clip.body}"><path d="${BODY.path}"/></clipPath>`;
}

/** Shoulders and chest, under the outfit. */
export function body(look: Look): string {
  const { fur } = look;
  const clip = clipIds(look);
  return [
    `<path d="${BODY.path}" fill="${fur.fur}" ${OUTLINE}/>`,
    `<g clip-path="url(#${clip.body})">`,
    `<path d="M248 262C282 300 304 352 312 405H336V262Z" fill="${fur.shade}"/>`,
    `<path d="${BODY.belly}" fill="${fur.belly}"/>`,
    fur.markings?.(look, "body") ?? "",
    "</g>",
    `<path d="${BODY.path}" fill="none" ${OUTLINE}/>`,
  ].join("");
}

/*
 * The forearm rises from below the frame, as hands do in the reference, so
 * there is no shoulder joint to get wrong; its paw holds the Paws trait up
 * beside the face.
 */

/** Where the paw holds things: what the Paws trait draws is gripped here. */
export const HOLD = { x: 290, y: 300 };

/** The forearm, behind whatever its paw holds. */
export function rightArm(look: Look): string {
  const { fur } = look;
  return [
    `<path d="M252 430C258 384 262 344 270 312L312 306C318 342 322 386 336 430Z" fill="${fur.fur}" ${OUTLINE}/>`,
    `<path d="M300 318C304 352 308 390 318 430H336C322 386 318 342 312 306Z" fill="${fur.shade}"/>`,
    `<path d="M252 430C258 384 262 344 270 312L312 306C318 342 322 386 336 430" fill="none" ${OUTLINE}/>`,
  ].join("");
}

/** The paw's fingers, curled round the front of whatever it holds. */
export function rightPaw(look: Look): string {
  const { fur } = look;
  return [
    `<path d="M264 314C260 292 274 280 292 280C312 280 324 292 320 310C318 324 304 330 290 330C276 330 266 326 264 314Z" fill="${fur.fur}" ${OUTLINE}/>`,
    `<path d="M308 286C318 292 322 302 318 314C314 324 304 328 294 330C306 322 312 312 312 300Z" fill="${fur.shade}"/>`,
    `<path d="M276 288Q274 300 280 308M290 284Q288 298 294 306M304 286Q304 298 308 304" stroke="${INK}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`,
    `<path d="M270 296Q276 288 286 288" stroke="${tint(fur.fur, 0.45)}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
  ].join("");
}

/**
 * The head, in the burrow drawing's own coordinates: ears, skull with its
 * tuft, pale brow arcs, eye patches, muzzle, nose and smile.
 */
export function head(look: Look): string {
  const { fur } = look;
  const clip = clipIds(look);
  const ear = (x: number) =>
    `<ellipse cx="${x}" cy="66" rx="16" ry="22" fill="${fur.shade}" ${STROKE}/><ellipse cx="${x}" cy="67" rx="9" ry="14" fill="${fur.patch}"/>`;
  return [
    inBurrow([ear(43), ear(138), `<path d="${SKULL}" fill="${fur.fur}" ${STROKE}/>`].join("")),
    `<g clip-path="url(#${clip.head})">`,
    inBurrow(
      [
        // the shadow side, in one cel tone
        `<path d="M118 30C142 44 150 74 140 96C130 110 112 118 96 118H160V20Z" fill="${fur.shade}"/>`,
        // the pale crown highlight and a rim of light down the left side
        `<path d="M58 44C66 34 80 30 92 31C80 35 68 42 60 52Z" fill="${tint(fur.fur, 0.4)}"/>`,
        `<path d="M46 74C44 58 48 44 58 36" stroke="${tint(fur.fur, 0.5)}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
        // the jaw in shadow
        `<path d="M40 92C58 116 124 118 146 92V130H36Z" fill="${tint(fur.shade, -0.08)}"/>`,
      ].join(""),
    ),
    fur.markings?.(look, "head") ?? "",
    inBurrow(
      [
        // pale brow arcs over the patches
        `<path d="M49 61C49 40 70 35 82 50M101 50C114 34 133 42 134 61" stroke="${tint(fur.belly, 0.45)}" stroke-width="7" stroke-linecap="round" fill="none"/>`,
        `<ellipse cx="68" cy="66" rx="19" ry="24" fill="${fur.patch}" transform="rotate(12 68 66)"/>`,
        `<ellipse cx="115" cy="66" rx="19" ry="24" fill="${fur.patch}" transform="rotate(-12 115 66)"/>`,
        // muzzle, shaded under the mouth
        `<path d="M53 87C64 77 77 79 91 82C106 79 121 77 133 87C132 106 110 115 91 115C72 115 53 103 53 87Z" fill="${fur.belly}"/>`,
        `<path d="M66 104Q91 120 118 102Q108 116 91 116Q74 116 66 104Z" fill="${tint(fur.belly, -0.12)}"/>`,
        // a soft blush
        `<ellipse cx="52" cy="93" rx="9" ry="5" fill="#ff8a7a" opacity="0.4"/><ellipse cx="131" cy="93" rx="9" ry="5" fill="#ff8a7a" opacity="0.4"/>`,
      ].join(""),
    ),
    "</g>",
    inBurrow(
      [
        `<path d="${SKULL}" fill="none" ${STROKE}/>`,
        // the little marks on the forehead
        `<path d="M78 31L85 35M96 29L100 34" stroke="${tint(fur.fur, -0.2)}" stroke-width="2" stroke-linecap="round"/>`,
        // nose and smile
        `<path d="M81 84Q91 77 101 84Q104 92 91 97Q79 92 81 84Z" fill="#271e18"/>`,
        `<path d="M85 85L91 83" stroke="#776354" stroke-width="2" stroke-linecap="round"/>`,
        `<path d="M91 97V100M73 98Q90 112 112 96" stroke="${INK}" stroke-width="2.5" stroke-linecap="round" fill="none"/>`,
      ].join(""),
    ),
  ].join("");
}

/** An Elder's brows: the pale arcs grown into bushy grey tufts. */
export function elderBrows(): string {
  const tuft =
    "M44 60C42 44 52 34 66 33C76 32 84 38 88 46L82 48L84 54L76 50L72 56L68 48L60 50L58 58L52 52Z";
  const brow = `<path d="${tuft}" fill="#ece6da" ${STROKE}/><path d="M52 44C60 38 72 38 80 42" stroke="#c9c1b2" stroke-width="2" fill="none" stroke-linecap="round"/>`;
  return inBurrow(`${brow}<g transform="matrix(-1 0 0 1 182 0)">${brow}</g>`);
}
