/**
 * Outfit: what the kat wears on its shoulders and chest. Clothing is clipped
 * to the body and outlined along its seams; the arms are drawn over it as
 * bare fur, so everything reads as a vest or a tunic. Props bigger than the
 * kat (a barrel, a box, a life vest) spill past the silhouette.
 */
import {
  BODY,
  clipIds,
  INK,
  type Look,
  NEAR_MARK,
  OUTLINE,
  type TraitValue,
  tint,
} from "../canvas.ts";

/** Ink lines thinner than the outline, for seams, buttons and small parts. */
const line = (width: number) =>
  `stroke="${INK}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"`;
const THIN = line(3);
const MID = line(4);

/** The body's right-hand side in shadow, the same cut as the base's. */
const SHADOW = "M244 262C280 300 302 352 310 405H336V262Z";
const EDGE = `<path d="${BODY.path}" fill="none" ${OUTLINE}/>`;
const MIRROR = "matrix(-1 0 0 1 400 0)";

/** A drawing and its mirror image across the kat's middle. */
const pair = (svg: string) => `${svg}<g transform="${MIRROR}">${svg}</g>`;
const shade = (color: string) => tint(color, -0.22);
const inBody = (look: Look, svg: string) => `<g clip-path="url(#${clipIds(look).body})">${svg}</g>`;

/** A small white shine on the lit shoulder. */
const glint = (d = "M110 312Q115 300 126 291") =>
  `<path d="${d}" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity="0.65"/>`;

const button = (x: number, y: number, fill: string, r = 4.5) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" ${THIN}/>`;

/** A garment covering the whole body: its cloth, one cel shadow, the details, and the kat's outline. */
const garment = (look: Look, color: string, details = "", shadow = shade(color)) =>
  inBody(
    look,
    `<path d="${BODY.path}" fill="${color}"/><path d="${SHADOW}" fill="${shadow}"/>${details}`,
  ) + EDGE;

/** A filled shape whose inner details stay inside it, outlined last. */
function piece(
  look: Look,
  name: string,
  d: string,
  fill: string,
  inner = "",
  outline = OUTLINE,
): string {
  const id = `${look.id}outfit-${name}`;
  return `<clipPath id="${id}"><path d="${d}"/></clipPath><path d="${d}" fill="${fill}"/><g clip-path="url(#${id})">${inner}</g><path d="${d}" fill="none" ${outline}/>`;
}

/** A shadow down the right of a shape, from x at the top. */
const rightShade = (x: number, color: string) =>
  `<path d="M${x} 240C${x + 30} 300 ${x + 48} 350 ${x + 54} 405H420V240Z" fill="${color}"/>`;

/** The kat's own chest, redrawn inside a clip (for props it stands inside). */
const chest = (look: Look) =>
  `<path d="${BODY.path}" fill="${look.fur.fur}"/><path d="${SHADOW}" fill="${look.fur.shade}"/><path d="${BODY.belly}" fill="${look.fur.belly}"/>${look.fur.markings?.(look, "body") ?? ""}<path d="${BODY.path}" fill="none" ${OUTLINE}/>`;

/** A five-pointed star. */
function star(x: number, y: number, r: number): string {
  const points = Array.from({ length: 10 }, (_, i) => {
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const radius = i % 2 === 0 ? r : r * 0.45;
    return `${(x + radius * Math.cos(angle)).toFixed(1)} ${(y + radius * Math.sin(angle)).toFixed(1)}`;
  });
  return `M${points.join("L")}Z`;
}

/** Points along the curve a necklace hangs in, with the angle of the curve there. */
function drape(count: number, from = 132, to = 268, top = 276, low = 376) {
  return Array.from({ length: count }, (_, i) => {
    const t = (i + 0.5) / count;
    const x = (1 - t) ** 2 * from + 2 * (1 - t) * t * 200 + t ** 2 * to;
    const y = (1 - t) ** 2 * top + 2 * (1 - t) * t * low + t ** 2 * top;
    const dx = 2 * (1 - t) * (200 - from) + 2 * t * (to - 200);
    const dy = 2 * (1 - t) * (low - top) + 2 * t * (top - low);
    return { x, y, angle: (Math.atan2(dy, dx) * 180) / Math.PI, i };
  });
}
const at = (p: { x: number; y: number; angle: number }) =>
  `transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${p.angle.toFixed(1)})"`;

/* ---- shared cuts ---- */

/** An open jacket front, showing what is under it. */
const OPENING = "M160 276L188 405H212L240 276Z";
/** The left lapel of an open jacket; mirrored for the right. */
const LAPEL = "M160 276L190 368L172 330L146 318L156 300L144 282Z";
/** A V-neck down to the chest. */
const VNECK = "M164 276L200 338L236 276Z";
/** The left point of a shirt collar; mirrored for the right. */
const COLLAR = "M164 280L190 316L198 292L176 276Z";

/** An open jacket over a shirt, with lapels. */
const jacket = (
  look: Look,
  color: string,
  shirt: string,
  lapel: string,
  extra = "",
  shadow = shade(color),
) =>
  garment(
    look,
    color,
    `<path d="${OPENING}" fill="${shirt}" ${MID}/>${extra}${pair(`<path d="${LAPEL}" fill="${lapel}" ${MID}/>`)}${glint()}`,
    shadow,
  );

/* ---- the outfits ---- */

function burrowScarf(look: Look): string {
  const red = "#d8433b";
  const rib = tint(red, -0.3);
  const band = "M106 270C140 304 260 304 294 270L304 302C262 336 138 336 96 302Z";
  const tail = "M204 306L242 304L250 384L210 390Z";
  const ribs = Array.from({ length: 13 }, (_, i) => {
    const x = 110 + i * 15;
    const y = 300 + Math.sin(((x - 100) / 200) * Math.PI) * 22;
    return `<path d="M${x - 5} ${y - 9}l5 6 5-6M${x - 5} ${y + 1}l5 6 5-6" fill="none" stroke="${rib}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join("");
  const stripes = `<path d="M200 330H260V344H200ZM200 358H260V372H200Z" fill="#f4e6c4"/>`;
  const fringe = [212, 222, 232, 242]
    .map(
      (x, i) =>
        `<path d="M${x} ${388 - i}l-2 14" stroke="${red}" stroke-width="6" stroke-linecap="round"/>`,
    )
    .join("");
  const fringeInk = [212, 222, 232, 242]
    .map(
      (x, i) =>
        `<path d="M${x} ${388 - i}l-2 14" stroke="${INK}" stroke-width="10" stroke-linecap="round"/>`,
    )
    .join("");
  return [
    fringeInk,
    fringe,
    piece(
      look,
      "tail",
      tail,
      red,
      `${stripes}<path d="M234 300L242 300L250 392H240Z" fill="${shade(red)}"/>`,
    ),
    piece(
      look,
      "band",
      band,
      red,
      `${rightShade(254, shade(red))}${ribs}${glint("M112 296Q126 310 146 318")}`,
    ),
  ].join("");
}

function sentryVest(look: Look): string {
  const olive = "#5f6f30";
  const pocket = (x: number) =>
    `<path d="M${x} 302H${x + 38}V338Q${x + 19} 344 ${x} 338Z" fill="${tint(olive, 0.12)}" ${MID}/><path d="M${x - 2} 298H${x + 40}V312H${x - 2}Z" fill="${shade(olive)}" ${MID}/>${button(x + 19, 307, "#c9a75a", 3.5)}`;
  return garment(
    look,
    olive,
    [
      `<path d="M200 280V405" stroke="#2a2f18" stroke-width="7"/><path d="M200 284V405" stroke="#c9c2a0" stroke-width="2.5" stroke-dasharray="3 3"/>`,
      pocket(140),
      pocket(222),
      `<path d="${star(241, 326, 9)}" fill="#ffd23f" ${line(2.5)}/>`,
      `<path d="M120 290C140 300 160 300 178 296M280 290C260 300 240 300 222 296" fill="none" stroke="#e8dcb0" stroke-width="2.5" stroke-dasharray="5 4"/>`,
      `<path d="M150 360H190V405M210 405V360H250" fill="${tint(olive, 0.12)}" ${MID}/>`,
      glint(),
    ].join(""),
  );
}

function goldChain(look: Look): string {
  const gold = "#f4c430";
  const links = drape(14)
    .map((p) =>
      p.i % 2 === 0
        ? `<ellipse rx="9" ry="6.5" ${at(p)} fill="${gold}" ${THIN}/><ellipse rx="3.5" ry="1.8" ${at(p)} fill="${INK}"/>`
        : `<ellipse rx="9" ry="3.2" ${at(p)} fill="${tint(gold, -0.15)}" ${THIN}/>`,
    )
    .join("");
  const medal = piece(
    look,
    "medal",
    "M200 330a22 22 0 1 1 0 44a22 22 0 1 1 0-44Z",
    gold,
    `${rightShade(206, tint(gold, -0.18))}<circle cx="200" cy="352" r="15" fill="none" stroke="${tint(gold, -0.3)}" stroke-width="2.5"/><path d="${NEAR_MARK}" transform="translate(189 341) scale(1.38)" fill="${INK}"/><path d="M186 340q4-6 10-7" stroke="#fff" stroke-width="3.5" fill="none" stroke-linecap="round" opacity="0.8"/>`,
  );
  return `${links}<path d="M200 322v10" stroke="${INK}" stroke-width="8" stroke-linecap="round"/><path d="M200 322v10" stroke="${gold}" stroke-width="3.5" stroke-linecap="round"/>${medal}`;
}

function explorerJacket(look: Look): string {
  const rust = "#b5652f";
  const strap = "#5b3a1e";
  return jacket(
    look,
    rust,
    "#f1e3c2",
    tint(rust, 0.12),
    [
      `<path d="M180 282L200 312L220 282Z" fill="#2f8f6a" ${MID}/>`,
      `<path d="M126 284L142 278L300 405H272Z" fill="${strap}" ${MID}/>`,
      `<circle cx="222" cy="358" r="15" fill="#d9b44a" ${MID}/><circle cx="222" cy="358" r="9" fill="#f4f0e2" ${THIN}/><path d="M218 362L226 354" stroke="#d8433b" stroke-width="3" stroke-linecap="round"/>`,
    ].join(""),
  );
}

function raincoat(look: Look): string {
  const yellow = "#ffcd2a";
  const toggle = (y: number) =>
    `<path d="M200 ${y}h-16" stroke="${INK}" stroke-width="3"/><rect x="200" y="${y - 4}" width="20" height="8" rx="4" fill="#9a6232" ${THIN}/>`;
  return garment(
    look,
    yellow,
    [
      `<path d="M204 280V405" stroke="${INK}" stroke-width="4"/>`,
      toggle(318),
      toggle(352),
      toggle(386),
      pair(
        `<path d="M120 282C140 298 170 310 200 306L196 324C164 330 132 316 112 296Z" fill="${tint(yellow, -0.08)}" ${MID}/>`,
      ),
      `<path d="M108 330Q112 312 124 300" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity="0.75"/><circle cx="116" cy="340" r="3" fill="#fff" opacity="0.75"/>`,
    ].join(""),
    tint(yellow, -0.18),
  );
}

function hoodie(look: Look): string {
  const pink = "#ee6fa6";
  const string = (x: number, end: number) =>
    `<path d="M${x} 300Q${x - 4} ${end - 20} ${x + 2} ${end}" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/><path d="M${x} 300Q${x - 4} ${end - 20} ${x + 2} ${end}" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/><rect x="${x - 2}" y="${end - 2}" width="8" height="12" rx="2" fill="#d6d6d6" ${line(2.5)}/>`;
  return garment(
    look,
    pink,
    [
      `<path d="M98 300C110 268 150 270 200 274C250 270 290 268 302 300C270 316 240 304 200 306C160 304 130 316 98 300Z" fill="${tint(pink, -0.12)}" ${MID}/>`,
      `<path d="M148 405L160 358H240L252 405" fill="${tint(pink, 0.1)}" ${MID}/>`,
      string(186, 344),
      string(212, 352),
      glint(),
    ].join(""),
  );
}

function bomberJacket(look: Look): string {
  const sage = "#8a9a5b";
  const knit = `<path d="M110 286C140 304 260 304 290 286L294 300C262 320 138 320 106 300Z" fill="#2f3a3f" ${MID}/><path d="M112 294C140 310 260 310 288 294" fill="none" stroke="#f08a2a" stroke-width="3"/>`;
  return garment(
    look,
    sage,
    [
      `<path d="M194 300H206V405H194Z" fill="#f08a2a" ${THIN}/><path d="M200 304V405" stroke="#c9c2a0" stroke-width="3" stroke-dasharray="3 3"/>`,
      knit,
      `<path d="M222 330L250 322L254 330L226 338Z" fill="${tint(sage, -0.3)}" ${THIN}/>`,
      `<rect x="140" y="320" width="34" height="10" rx="3" fill="${tint(sage, -0.3)}" ${THIN}/>`,
      glint(),
    ].join(""),
  );
}

function tracksuit(look: Look): string {
  const navy = "#24357a";
  const stripes = pair(
    `<path d="M128 266C106 300 90 350 82 405" fill="none" stroke="#fff" stroke-width="20"/><path d="M128 266C106 300 90 350 82 405" fill="none" stroke="${navy}" stroke-width="5"/>`,
  );
  return garment(
    look,
    navy,
    [
      stripes,
      `<path d="M150 278C168 300 232 300 250 278L254 304C232 324 168 324 146 304Z" fill="${tint(navy, 0.08)}" ${MID}/>`,
      `<path d="M200 312V405" stroke="${INK}" stroke-width="5"/><path d="M200 314V405" stroke="#d9dde6" stroke-width="2" stroke-dasharray="2 3"/><rect x="194" y="318" width="12" height="16" rx="3" fill="#e6e9ef" ${THIN}/>`,
      `<path d="M226 312h18" stroke="#fff" stroke-width="5" stroke-linecap="round"/>`,
      glint("M112 312Q117 302 124 296"),
    ].join(""),
    tint(navy, -0.3),
  );
}

function labCoat(look: Look): string {
  const white = "#f5f7fa";
  return jacket(
    look,
    white,
    "#8fc3ee",
    "#e8edf3",
    [
      `<path d="M192 300L208 300L212 360L200 374L188 360Z" fill="#2c3e66" ${THIN}/>`,
      `<path d="M214 334H246V368H214Z" fill="#e8edf3" ${THIN}/>`,
      `<path d="M222 336V322" stroke="${INK}" stroke-width="8" stroke-linecap="round"/><path d="M222 336V322" stroke="#3b6fd6" stroke-width="4" stroke-linecap="round"/><path d="M234 336V318" stroke="${INK}" stroke-width="8" stroke-linecap="round"/><path d="M234 336V318" stroke="#d8433b" stroke-width="4" stroke-linecap="round"/>`,
    ].join(""),
    "#cdd6e0",
  );
}

function chefApron(look: Look): string {
  const white = "#f7f7f2";
  const apron = "M154 300H246L256 405H144Z";
  return [
    inBody(
      look,
      `<path d="M156 302L134 268M244 302L266 268" stroke="${INK}" stroke-width="9"/><path d="M156 302L134 268M244 302L266 268" stroke="${white}" stroke-width="4"/>`,
    ),
    piece(
      look,
      "apron",
      apron,
      white,
      `<path d="M226 300L232 405H260V300Z" fill="#d9dbd2"/><path d="M174 350H226V384H174Z" fill="${white}" ${MID}/><path d="M200 350V384" stroke="${INK}" stroke-width="3"/>`,
    ),
    `<path d="M168 282L200 316L232 282Z" fill="#d8433b" ${MID}/><circle cx="200" cy="300" r="8" fill="#b8302a" ${THIN}/>`,
  ].join("");
}

function tuxedo(look: Look): string {
  const black = "#24262e";
  const satin = "#3d4150";
  return garment(
    look,
    black,
    [
      `<path d="M160 276L200 380L240 276Z" fill="#fbfbfb" ${MID}/>`,
      `<path d="M200 316V372" stroke="#d9d9d9" stroke-width="2"/>${button(200, 334, INK, 3)}${button(200, 354, INK, 3)}`,
      pair(`<path d="M160 276L200 380L176 352L146 330L158 312L140 286Z" fill="${satin}" ${MID}/>`),
      `<path d="M150 300L170 340" stroke="#fff" stroke-width="3.5" stroke-linecap="round" opacity="0.5"/>`,
      `<path d="M200 304L178 292V318ZM200 304L222 292V318Z" fill="${INK}" ${MID}/><rect x="194" y="298" width="12" height="12" rx="3" fill="${INK}" ${THIN}/>`,
      `<path d="M226 344l16-4" stroke="#fff" stroke-width="5" stroke-linecap="round"/>`,
      glint(),
    ].join(""),
    "#15161b",
  );
}

function hawaiianShirt(look: Look): string {
  const teal = "#19b3c2";
  const flower = (x: number, y: number, r: number) =>
    `<g transform="translate(${x} ${y})">${[0, 72, 144, 216, 288]
      .map(
        (a) =>
          `<ellipse cx="0" cy="${-r * 0.55}" rx="${r * 0.42}" ry="${r * 0.6}" transform="rotate(${a})" fill="#ff6f91" ${line(2.5)}/>`,
      )
      .join("")}<circle r="${r * 0.22}" fill="#ffd23f" ${line(2)}/></g>`;
  const leaf = (x: number, y: number, a: number) =>
    `<path d="M0 0Q10-12 24 0Q10 12 0 0Z" transform="translate(${x} ${y}) rotate(${a})" fill="#2e9e4a" ${line(2.5)}/>`;
  return garment(
    look,
    teal,
    [
      leaf(230, 300, -30),
      leaf(160, 360, 200),
      leaf(250, 390, 20),
      leaf(110, 330, 60),
      flower(238, 320, 20),
      flower(176, 346, 18),
      flower(220, 390, 16),
      flower(118, 302, 16),
      `<path d="${VNECK}" fill="${look.fur.belly}" ${MID}/>`,
      pair(`<path d="M150 278L200 340L180 300L168 316Z" fill="${tint(teal, 0.25)}" ${MID}/>`),
      button(200, 360, "#fff", 4),
      button(200, 388, "#fff", 4),
      glint(),
    ].join(""),
  );
}

function knitSweater(look: Look): string {
  const green = "#2f7d4f";
  const cable = (x: number) =>
    `<path d="M${x} 292${Array.from({ length: 6 }, () => "q8 9 0 18").join("")}M${x} 292${Array.from({ length: 6 }, () => "q-8 9 0 18").join("")}" fill="none" stroke="${tint(green, 0.28)}" stroke-width="4" stroke-linecap="round"/>`;
  const zigzag = `<path d="M60 360${Array.from({ length: 14 }, () => "l10-10 10 10").join("")}" fill="none" stroke="#f4e6c4" stroke-width="5" stroke-linejoin="round"/>`;
  return garment(
    look,
    green,
    [
      cable(200),
      cable(166),
      cable(234),
      zigzag,
      `<path d="M60 374${Array.from({ length: 14 }, () => "l10 10 10-10").join("")}" fill="none" stroke="#d8433b" stroke-width="5" stroke-linejoin="round"/>`,
      `<path d="M140 280C160 304 240 304 260 280L262 296C240 320 160 320 138 296Z" fill="${tint(green, -0.1)}" ${MID}/>`,
      `<path d="M150 296v8M162 302v8M174 306v8M186 308v8M198 309v8M210 308v8M222 306v8M234 302v8M246 296v8" stroke="${tint(green, -0.35)}" stroke-width="3" stroke-linecap="round"/>`,
      glint(),
    ].join(""),
  );
}

function pufferJacket(look: Look): string {
  const red = "#e2383f";
  const dark = shade(red);
  const band = (top: number, bottom: number, inset: number) =>
    `M${68 + inset} ${top}C${70 + inset} ${top - 8} 330 ${top - 8} ${332 - inset} ${top}C${344 - inset} ${(top + bottom) / 2} ${344 - inset} ${(top + bottom) / 2} ${332 - inset} ${bottom}C330 ${bottom + 8} ${70 + inset} ${bottom + 8} ${68 + inset} ${bottom}C${56 + inset} ${(top + bottom) / 2} ${56 + inset} ${(top + bottom) / 2} ${68 + inset} ${top}Z`;
  const bands = [
    [362, 405, -12],
    [326, 364, 2],
    [292, 328, 16],
  ] as const;
  return [
    garment(look, dark),
    bands
      .map(([top, bottom, inset], i) =>
        piece(
          look,
          `puff${i}`,
          band(top, bottom, inset),
          red,
          `${rightShade(250 - i * 6, dark)}<path d="M${110 + inset} ${top + 12}Q${140 + inset} ${top + 6} ${170 + inset} ${top + 8}" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.6"/>`,
        ),
      )
      .join(""),
    `<path d="M150 272C168 290 232 290 250 272L256 300C232 318 168 318 144 300Z" fill="${red}" ${OUTLINE}/>`,
    `<path d="M200 308V405" stroke="${INK}" stroke-width="5"/><rect x="194" y="312" width="12" height="16" rx="3" fill="#e6e9ef" ${THIN}/>`,
  ].join("");
}

function overalls(look: Look): string {
  const denim = "#2f5c9e";
  const bib = "M150 320H250L258 405H142Z";
  const tee = `<path d="M60 300H340V318H60ZM60 336H340V354H60ZM60 372H340V390H60Z" fill="#d8433b"/>`;
  return [
    garment(look, "#fff2d6", `${tee}${glint()}`, "#e8d6b0"),
    inBody(
      look,
      `<path d="M156 322L138 270M244 322L262 270" stroke="${INK}" stroke-width="20"/><path d="M156 322L138 270M244 322L262 270" stroke="${denim}" stroke-width="13"/>`,
    ),
    piece(
      look,
      "bib",
      bib,
      denim,
      `<path d="M232 320L240 405H262V320Z" fill="${shade(denim)}"/><path d="M178 338H222V368Q200 376 178 368Z" fill="${tint(denim, 0.12)}" ${MID}/><path d="M154 326H246" stroke="#f2a33a" stroke-width="2" stroke-dasharray="4 3"/>`,
    ),
    button(160, 330, "#f2c230", 6),
    button(240, 330, "#f2c230", 6),
  ].join("");
}

function kimono(look: Look): string {
  const indigo = "#2e3d8f";
  const blossom = (x: number, y: number) =>
    `<g transform="translate(${x} ${y})" fill="#ffb3c7">${[0, 72, 144, 216, 288]
      .map((a) => `<circle cx="0" cy="-5" r="4.5" transform="rotate(${a})"/>`)
      .join("")}<circle r="2.5" fill="#ffd23f"/></g>`;
  return garment(
    look,
    indigo,
    [
      [
        [120, 300],
        [236, 312],
        [176, 352],
        [258, 362],
        [96, 366],
        [300, 330],
      ]
        .map(([x, y]) => blossom(x ?? 0, y ?? 0))
        .join(""),
      `<path d="M236 276L256 278L206 360L192 346Z" fill="#d8433b" ${MID}/>`,
      `<path d="M150 276L174 274L262 380L238 392Z" fill="#f4efe4" ${MID}/>`,
      `<path d="M60 372H340V405H60Z" fill="#c0392b" ${MID}/><path d="M60 386H340" stroke="#ffd23f" stroke-width="4"/>`,
      `<path d="M194 386l-10 18M206 386l8 18" stroke="${INK}" stroke-width="7" stroke-linecap="round"/><path d="M194 386l-10 18M206 386l8 18" stroke="#ffd23f" stroke-width="3" stroke-linecap="round"/><circle cx="200" cy="386" r="6" fill="#ffd23f" ${THIN}/>`,
      glint(),
    ].join(""),
  );
}

function poncho(look: Look): string {
  const base = "#d1495b";
  const shape = "M122 268C84 318 46 370 28 405H372C354 370 316 318 278 268Z";
  const zig = (y: number, color: string, h: number) =>
    `<path d="M0 ${y}${Array.from({ length: 21 }, () => `l10 -${h} 10 ${h}`).join("")}V${y + 10}${Array.from({ length: 21 }, () => `l-10 ${h} -10 -${h}`).join("")}Z" fill="${color}"/>`;
  return piece(
    look,
    "poncho",
    shape,
    base,
    [
      `<path d="M0 300H400V320H0ZM0 340H400V352H0Z" fill="#ffd23f"/>`,
      zig(326, "#1a9c8e", 6),
      `<path d="M0 368H400V386H0Z" fill="#f4e6c4"/>`,
      zig(373, "#2e3d8f", 5),
      `<path d="M0 392H400V400H0Z" fill="#ffd23f"/>`,
      rightShade(250, "rgba(40,10,20,0.22)"),
      `<path d="M96 336Q110 310 126 292" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.6"/>`,
    ].join(""),
  );
}

function superheroCape(look: Look): string {
  const red = "#d8302f";
  const blue = "#2b59c3";
  const cape = "M126 266C98 304 80 352 70 405H20C30 350 60 296 112 268Z";
  return [
    pair(
      `<path d="${cape}" fill="${red}" ${OUTLINE}/><path d="M60 330Q46 366 40 405" stroke="${shade(red)}" stroke-width="8" fill="none" stroke-linecap="round"/>`,
    ),
    garment(
      look,
      blue,
      [
        `<path d="M200 312L238 324L226 362L200 382L174 362L162 324Z" fill="#ffd23f" ${MID}/>`,
        `<path d="M206 322L186 352H200L192 374L216 340H202L210 322Z" fill="${red}" ${line(2.5)}/>`,
        `<path d="M60 395H340V405H60Z" fill="#ffd23f" ${MID}/>`,
        glint(),
      ].join(""),
    ),
    pair(
      `<circle cx="124" cy="286" r="10" fill="#ffd23f" ${MID}/><circle cx="121" cy="283" r="3" fill="#fff"/>`,
    ),
  ].join("");
}

function wizardRobe(look: Look): string {
  const violet = "#4b2a85";
  const gold = "#f4c430";
  return garment(
    look,
    violet,
    [
      `<path d="${star(124, 302, 9)}${star(250, 314, 8)}${star(176, 384, 7)}${star(296, 380, 7)}${star(96, 370, 7)}" fill="${gold}" ${line(2.5)}/>`,
      `<path d="M226 350a14 14 0 1 0 14 18a11 11 0 1 1-14-18Z" fill="${gold}" ${line(2.5)}/>`,
      `<path d="M162 276L200 352L238 276Z" fill="${tint(violet, -0.35)}"/>`,
      `<path d="M162 276L200 352L238 276" fill="none" stroke="${INK}" stroke-width="16" stroke-linejoin="round"/><path d="M162 276L200 352L238 276" fill="none" stroke="${gold}" stroke-width="9" stroke-linejoin="round"/>`,
      `<path d="M200 352V405" stroke="${INK}" stroke-width="16"/><path d="M200 356V405" stroke="${gold}" stroke-width="9"/>`,
      `<circle cx="200" cy="352" r="9" fill="#5fd3f3" ${MID}/>`,
      glint(),
    ].join(""),
  );
}

function knightArmour(look: Look): string {
  const steel = "#aab4c0";
  const dark = "#7d8897";
  const rivets = (points: number[][]) =>
    points
      .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="#e6ebf0" ${line(2)}/>`)
      .join("");
  const pauldron = `<path d="M58 336C54 294 88 266 136 270L140 300C112 300 92 314 86 340Z" fill="${steel}" ${OUTLINE}/><path d="M70 350C68 320 86 300 112 300L116 324C100 326 92 336 92 356Z" fill="${dark}" ${OUTLINE}/><path d="M72 314Q90 286 120 282" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" opacity="0.7"/>`;
  return [
    garment(
      look,
      steel,
      [
        `<path d="M200 280V405" stroke="${INK}" stroke-width="4"/><path d="M200 280V405H260C252 360 234 320 200 280Z" fill="${dark}" opacity="0.35"/>`,
        `<path d="M60 360C120 340 280 340 340 360" fill="none" stroke="${INK}" stroke-width="4"/>`,
        `<path d="M60 384C120 366 280 366 340 384" fill="none" stroke="${INK}" stroke-width="4"/>`,
        rivets([
          [150, 302],
          [250, 302],
          [180, 334],
          [220, 334],
        ]),
        `<path d="M176 300Q186 330 186 354" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round" opacity="0.7"/>`,
      ].join(""),
      dark,
    ),
    pair(pauldron),
  ].join("");
}

function astronautSuit(look: Look): string {
  const white = "#f2f4f7";
  return garment(
    look,
    white,
    [
      `<path d="M60 340H340V352H60Z" fill="#f08a2a"/>`,
      `<path d="M112 278C140 304 260 304 288 278L294 302C258 330 142 330 106 302Z" fill="#9aa5b4" ${MID}/><path d="M118 296C150 318 250 318 282 296" fill="none" stroke="#dfe5ec" stroke-width="3"/>`,
      `<rect x="172" y="324" width="56" height="44" rx="6" fill="#c3ccd8" ${MID}/>`,
      `<rect x="180" y="332" width="22" height="14" rx="2" fill="#2fd1a8" ${THIN}/>`,
      button(214, 339, "#d8433b", 4),
      button(186, 357, "#ffd23f", 3.5),
      button(200, 357, "#3b6fd6", 3.5),
      button(214, 357, "#2fd1a8", 3.5),
      `<circle cx="252" cy="318" r="13" fill="#1d2a52" ${MID}/><path d="${NEAR_MARK}" transform="translate(245 311) scale(0.88)" fill="#fff"/>`,
      `<path d="M228 368Q246 384 252 405" fill="none" stroke="${INK}" stroke-width="9"/><path d="M228 368Q246 384 252 405" fill="none" stroke="#9aa5b4" stroke-width="4" stroke-dasharray="4 3"/>`,
      glint(),
    ].join(""),
    "#c9d1dc",
  );
}

function divingSuit(look: Look): string {
  const brass = "#d9a43a";
  const canvas = "#8c7a5c";
  const plate = "M78 306C106 276 294 276 322 306L328 344C284 366 116 366 72 344Z";
  const rim = "M72 338C116 360 284 360 328 338";
  const bolts = [92, 128, 164, 200, 236, 272, 308]
    .map((x) => {
      const y = 338 + 21 * Math.sin(((x - 72) / 256) * Math.PI);
      return `<circle cx="${x}" cy="${y.toFixed(1)}" r="5" fill="#f6dc8e" ${line(2.5)}/>`;
    })
    .join("");
  return [
    garment(
      look,
      canvas,
      `<path d="M60 380H340" stroke="${tint(canvas, -0.3)}" stroke-width="3" stroke-dasharray="6 4"/>`,
    ),
    piece(
      look,
      "plate",
      plate,
      brass,
      `${rightShade(256, tint(brass, -0.2))}<path d="${rim}" fill="none" stroke="${INK}" stroke-width="20"/><path d="${rim}" fill="none" stroke="#3b3f46" stroke-width="13"/>${bolts}<path d="M100 318Q130 298 160 294" stroke="#fff6d0" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.85"/>`,
    ),
    `<path d="M118 280C150 304 250 304 282 280L288 296C252 324 148 324 112 296Z" fill="${tint(brass, -0.12)}" ${OUTLINE}/>`,
    [130, 166, 200, 234, 270]
      .map(
        (x) =>
          `<circle cx="${x}" cy="${(306 - Math.abs(x - 200) * 0.14).toFixed(1)}" r="3.5" fill="#f6dc8e" ${line(2)}/>`,
      )
      .join(""),
  ].join("");
}

function pilotJacket(look: Look): string {
  const leather = "#6b3f22";
  const fleece = "#f1e4c8";
  const collar =
    "M104 290C120 266 160 272 200 280L190 332L160 318L150 336C122 326 104 310 104 290Z";
  return garment(
    look,
    leather,
    [
      `<path d="${OPENING}" fill="#c9b48c" ${MID}/>`,
      `<path d="M200 300V405" stroke="#a69068" stroke-width="3"/>`,
      pair(
        `<path d="${collar}" fill="${fleece}" ${MID}/><path d="M132 300q6 4 12 0M150 296q6 4 12 0M124 314q6 4 12 0M168 300q6 4 12 0" fill="none" stroke="#d6c39c" stroke-width="3" stroke-linecap="round"/>`,
      ),
      `<path d="M214 352q16-10 36 0q-16 4-18 12q-2-8-18-12Z" fill="#f4c430" ${line(2.5)}/>`,
      `<path d="M114 340Q120 326 130 318" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.5"/>`,
    ].join(""),
  );
}

function safariShirt(look: Look): string {
  const khaki = "#cbb57a";
  const pocket = (x: number) =>
    `<path d="M${x} 314H${x + 34}V344Q${x + 17} 350 ${x} 344Z" fill="${khaki}" ${MID}/><path d="M${x - 2} 310H${x + 36}L${x + 17} 326Z" fill="${tint(khaki, -0.12)}" ${MID}/>${button(x + 17, 322, "#6b4a2a", 3)}`;
  return garment(
    look,
    khaki,
    [
      pocket(146),
      pocket(220),
      `<path d="${VNECK}" fill="${look.fur.belly}" ${MID}/>`,
      pair(`<path d="M150 278L200 338L182 300L166 318Z" fill="${tint(khaki, 0.15)}" ${MID}/>`),
      pair(
        `<path d="M114 284L148 292L144 304L106 298Z" fill="${tint(khaki, -0.1)}" ${MID}/>${button(140, 297, "#6b4a2a", 3)}`,
      ),
      `<path d="M200 338V405" stroke="${INK}" stroke-width="3"/>${button(206, 360, "#6b4a2a", 3.5)}${button(206, 386, "#6b4a2a", 3.5)}`,
      glint("M104 330Q108 318 114 310"),
    ].join(""),
  );
}

function refereeShirt(look: Look): string {
  const stripes = Array.from(
    { length: 10 },
    (_, i) => `<rect x="${64 + i * 28}" y="250" width="14" height="160" fill="#1c1c1f"/>`,
  ).join("");
  return garment(
    look,
    "#fbfbfb",
    [
      stripes,
      `<path d="M150 280C170 300 230 300 250 280L254 296C230 316 170 316 146 296Z" fill="#1c1c1f" ${MID}/>`,
      pair(`<path d="M164 284L194 322L200 300Z" fill="#1c1c1f" ${MID}/>`),
      `<path d="M178 302Q186 344 214 352" fill="none" stroke="${INK}" stroke-width="7"/><path d="M178 302Q186 344 214 352" fill="none" stroke="#d8433b" stroke-width="3"/>`,
      `<path d="M210 344H236A10 10 0 0 1 236 364H222L210 356Z" fill="#c9ced6" ${MID}/><circle cx="234" cy="354" r="3" fill="${INK}"/><path d="M214 348h12" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`,
    ].join(""),
    "#d6d8dc",
  );
}

function sailorSuit(look: Look): string {
  const navy = "#1f3477";
  return garment(
    look,
    "#fbfbfb",
    [
      `<path d="M96 300C110 280 140 276 160 276L200 340L240 276C260 276 290 280 304 300L310 330L200 360L90 330Z" fill="${navy}" ${MID}/>`,
      `<path d="M100 318L200 350L300 318" fill="none" stroke="#fff" stroke-width="4"/>`,
      `<path d="M168 280L200 332L232 280Z" fill="${look.fur.belly}" ${MID}/>`,
      `<path d="M200 344L176 330L180 362ZM200 344L224 330L220 362Z" fill="#d8433b" ${MID}/><path d="M196 350L186 386L200 378L214 386L204 350Z" fill="#d8433b" ${MID}/><circle cx="200" cy="344" r="7" fill="#b8302a" ${THIN}/>`,
      glint(),
    ].join(""),
    "#d9dee6",
  );
}

function pajamas(look: Look): string {
  const blue = "#a9c8f5";
  const piping = "#2c3e80";
  const dots = Array.from({ length: 30 }, (_, i) => {
    const x = 70 + (i % 6) * 48 + (Math.floor(i / 6) % 2) * 24;
    const y = 290 + Math.floor(i / 6) * 26;
    return `<circle cx="${x}" cy="${y}" r="4" fill="#fff"/>`;
  }).join("");
  return garment(
    look,
    blue,
    [
      dots,
      `<path d="${VNECK}" fill="${look.fur.belly}" ${MID}/>`,
      pair(
        `<path d="M150 278L200 340L180 302L166 320Z" fill="${blue}" ${MID}/><path d="M156 284L194 334" stroke="${piping}" stroke-width="3.5"/>`,
      ),
      `<path d="M200 340V405" stroke="${piping}" stroke-width="4"/>`,
      button(208, 360, "#fff", 4),
      button(208, 388, "#fff", 4),
      `<path d="M214 312H246V340H214Z" fill="${blue}" ${MID}/><path d="M214 318H246" stroke="${piping}" stroke-width="3.5"/>`,
      glint(),
    ].join(""),
  );
}

function tieDyeTee(look: Look): string {
  const colors = ["#e84a8a", "#f08a2a", "#ffd23f", "#4cc36a", "#2fa8e0", "#7b4bd0"];
  const rings = Array.from({ length: 13 }, (_, i) => {
    const r = 170 - i * 13;
    return `<circle cx="${206 - i * 2}" cy="${356 - i * 3}" r="${r}" fill="${colors[i % colors.length]}"/>`;
  }).join("");
  return garment(
    look,
    "#e84a8a",
    [
      rings,
      `<path d="M150 280C170 304 230 304 250 280L254 294C230 318 170 318 146 294Z" fill="#ffd23f" ${MID}/>`,
      `<path d="M244 262C280 300 302 352 310 405H336V262Z" fill="#000" opacity="0.15"/>`,
      glint(),
    ].join(""),
    "transparent",
  );
}

function varsityJacket(look: Look): string {
  const maroon = "#8e2338";
  const cream = "#f4e6c4";
  const knit = `<path d="M146 280C168 302 232 302 254 280L258 298C232 320 168 320 142 298Z" fill="${maroon}" ${MID}/><path d="M146 289C170 310 230 310 254 289" fill="none" stroke="${cream}" stroke-width="3"/>`;
  return garment(
    look,
    maroon,
    [
      pair(`<path d="M60 262H144C126 288 114 312 108 340L60 360Z" fill="${cream}" ${MID}/>`),
      `<path d="M200 300V405" stroke="${INK}" stroke-width="3"/>`,
      button(200, 330, cream, 4.5),
      button(200, 360, cream, 4.5),
      button(200, 390, cream, 4.5),
      knit,
      `<path d="M220 304H232V320L246 304H260L242 324L262 346H248L232 328V346H220Z" fill="${cream}" ${MID}/>`,
      glint("M140 312Q146 302 154 296"),
    ].join(""),
  );
}

function denimJacket(look: Look): string {
  const denim = "#5b8fd0";
  const stitch = "#f2a33a";
  const pocket = (x: number) =>
    `<path d="M${x} 318H${x + 34}V346H${x}Z" fill="${tint(denim, -0.08)}" ${MID}/><path d="M${x} 318H${x + 34}V328L${x + 17} 334L${x} 328Z" fill="${tint(denim, 0.1)}" ${MID}/>${button(x + 17, 328, "#c47a3a", 3.5)}`;
  return garment(
    look,
    denim,
    [
      `<path d="M60 312C120 302 280 302 340 312" fill="none" stroke="${stitch}" stroke-width="2.5" stroke-dasharray="5 4"/>`,
      pocket(148),
      pocket(218),
      `<path d="M204 300V405" stroke="${INK}" stroke-width="3"/><path d="M212 300V405" stroke="${stitch}" stroke-width="2.5" stroke-dasharray="5 4"/>`,
      button(204, 362, "#c47a3a", 4.5),
      button(204, 390, "#c47a3a", 4.5),
      pair(
        `<path d="M120 280C150 296 176 300 200 300L196 318L164 330L150 312C132 306 118 296 120 280Z" fill="${tint(denim, 0.12)}" ${MID}/>`,
      ),
      glint("M108 340Q112 328 118 320"),
    ].join(""),
  );
}

function leatherJacket(look: Look): string {
  const black = "#26262b";
  const studs = [
    [150, 292],
    [160, 312],
    [242, 292],
    [236, 312],
  ]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.5" fill="#e6ebf0" ${line(2)}/>`)
    .join("");
  return garment(
    look,
    black,
    [
      `<path d="M164 276L196 405H222L236 276Z" fill="#f2f2f2" ${MID}/>`,
      `<path d="M164 276L200 380L178 344L140 330L152 306L138 286Z" fill="#3a3a42" ${MID}/>`,
      `<path d="M236 276L214 360L232 336L262 326L250 302L262 284Z" fill="#3a3a42" ${MID}/>`,
      `<path d="M200 380L222 405" stroke="#c9ced6" stroke-width="4"/>`,
      studs,
      `<path d="M150 346Q160 360 172 366" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" opacity="0.5"/>`,
      `<path d="M240 350l16-6" stroke="#c9ced6" stroke-width="4" stroke-linecap="round"/>`,
      glint(),
    ].join(""),
    "#17171a",
  );
}

function flannel(look: Look): string {
  const id = `${look.id}outfit-plaid`;
  const pattern = `<pattern id="${id}" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="40" height="40" fill="#c8302c"/><rect width="40" height="14" fill="#1c1c1f" opacity="0.55"/><rect width="14" height="40" fill="#1c1c1f" opacity="0.55"/><path d="M0 26H40M26 0V40" stroke="#ffd23f" stroke-width="2"/></pattern>`;
  return (
    pattern +
    jacket(
      look,
      `url(#${id})`,
      "#8a8f98",
      "#c8302c",
      `${pair(`<path d="${COLLAR}" fill="#a3221f" ${MID}/>`)}${button(170, 340, "#f4e6c4", 3.5)}`,
      "rgba(0,0,0,0.2)",
    )
  );
}

function lifeVest(look: Look): string {
  const orange = "#ff7a1c";
  const panel = "M108 278C76 300 58 352 60 405H192C194 360 190 318 176 280Z";
  const panelR = "M292 278C324 300 342 352 340 405H208C206 360 210 318 224 280Z";
  const reflect = `<path d="M40 312H400V326H40Z" fill="#e6ebf0"/><path d="M40 312H400M40 326H400" stroke="${INK}" stroke-width="3"/>`;
  return [
    `<path d="M96 296C110 258 290 258 304 296C270 284 130 284 96 296Z" fill="${tint(orange, -0.1)}" ${OUTLINE}/>`,
    piece(
      look,
      "left",
      panel,
      orange,
      `${reflect}<path d="M86 360Q90 330 104 304" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.6"/>`,
    ),
    piece(look, "right", panelR, orange, `${reflect}${rightShade(268, shade(orange))}`),
    `<path d="M176 352H226" stroke="${INK}" stroke-width="12"/><path d="M176 352H226" stroke="#2c2c30" stroke-width="7"/><rect x="190" y="344" width="20" height="16" rx="3" fill="#ffd23f" ${THIN}/>`,
  ].join("");
}

function hiVisVest(look: Look): string {
  const lime = "#d2f53a";
  const silver = "#d6dbe2";
  const panel = "M60 262H174C168 320 172 360 180 405H60Z";
  const stripes = `<path d="M40 322H400V336H40ZM40 362H400V376H40Z" fill="${silver}"/><path d="M40 322H400M40 336H400M40 362H400M40 376H400" stroke="${INK}" stroke-width="3"/>`;
  return inBody(
    look,
    [
      piece(
        look,
        "left",
        panel,
        lime,
        `${stripes}<path d="M108 312Q114 298 126 290" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.7"/>`,
      ),
      `<g transform="${MIRROR}">${piece(look, "right", panel, lime, `${stripes}<path d="M60 262H120C100 300 92 352 90 405H60Z" fill="${tint(lime, -0.2)}"/>`)}</g>`,
    ].join(""),
  ).concat(EDGE);
}

function beetleBandolier(look: Look): string {
  const strap = "#6b4325";
  const beetle = (x: number, y: number, color: string) =>
    `<g transform="translate(${x} ${y}) rotate(36)"><path d="M-12-6l-6-4M-12 6l-6 4M0-9l-2-8M0 9l-2 8M10-6l6-5M10 6l6 5" stroke="${INK}" stroke-width="3" stroke-linecap="round"/><circle cx="-14" cy="0" r="6" fill="${INK}"/><ellipse rx="14" ry="10" fill="${color}" ${MID}/><path d="M-6 0H14" stroke="${INK}" stroke-width="2.5"/><ellipse cx="2" cy="-5" rx="4" ry="2" fill="#fff" opacity="0.7"/></g>`;
  return [
    inBody(
      look,
      `<path d="M114 290L138 270L330 404L296 414Z" fill="${strap}" ${MID}/><path d="M124 286L310 412" stroke="#c9a46a" stroke-width="2.5" stroke-dasharray="5 4"/>`,
    ),
    EDGE,
    `<rect x="-11" y="-14" width="22" height="28" rx="3" transform="translate(178 324) rotate(36)" fill="#f4c430" ${MID}/>`,
    beetle(148, 300, "#2fbf71"),
    beetle(212, 348, "#3b6fd6"),
    `<rect x="-9" y="-12" width="18" height="24" rx="3" transform="translate(240 366) rotate(36)" fill="${tint(strap, 0.2)}" ${MID}/>`,
    beetle(282, 396, "#d8433b"),
  ].join("");
}

function scarabNecklace(): string {
  const beads = drape(13)
    .map(
      (p) =>
        `<circle r="5.5" ${at(p)} fill="${p.i % 3 === 1 ? "#f4c430" : "#2fc0b4"}" ${line(2.5)}/>`,
    )
    .join("");
  const scarab = [
    `<path d="M184 340C160 330 150 346 156 362C170 362 180 356 186 350Z" fill="#f4c430" ${MID}/>`,
    `<path d="M216 340C240 330 250 346 244 362C230 362 220 356 214 350Z" fill="#f4c430" ${MID}/>`,
    `<ellipse cx="200" cy="356" rx="16" ry="20" fill="#2a7fd4" ${MID}/>`,
    `<path d="M200 340V376" stroke="${INK}" stroke-width="2.5"/>`,
    `<path d="M188 336a12 9 0 0 1 24 0Z" fill="#1c5aa0" ${MID}/>`,
    `<path d="M192 348q2-4 5-5" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.8"/>`,
    `<circle cx="200" cy="378" r="5" fill="#d8433b" ${line(2.5)}/>`,
  ].join("");
  return `${beads}${scarab}`;
}

function barrel(look: Look): string {
  const wood = "#b0753e";
  const hoop = "#5a5f66";
  const front = "M66 304A134 22 0 0 0 334 304C346 340 346 372 338 405H62C54 372 54 340 66 304Z";
  const staves = [96, 132, 166, 200, 234, 268, 304]
    .map(
      (x) =>
        `<path d="M${x} ${330 - Math.abs(x - 200) * 0.05}Q${x + (x - 200) * 0.08} 370 ${x} 405" fill="none" stroke="${tint(wood, -0.35)}" stroke-width="3"/>`,
    )
    .join("");
  const band = (y: number) =>
    `<path d="M40 ${y}Q200 ${y + 28} 360 ${y}V${y + 14}Q200 ${y + 42} 40 ${y + 14}Z" fill="${hoop}" ${MID}/><path d="M60 ${y + 5}Q120 ${y + 16} 160 ${y + 19}" stroke="#c9ced6" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  const id = `${look.id}outfit-mouth`;
  return [
    `<clipPath id="${id}"><ellipse cx="200" cy="304" rx="134" ry="22"/></clipPath>`,
    `<ellipse cx="200" cy="304" rx="134" ry="22" fill="#3a2414" ${OUTLINE}/>`,
    `<g clip-path="url(#${id})">${chest(look)}</g>`,
    piece(
      look,
      "barrel",
      front,
      wood,
      `${rightShade(256, shade(wood))}${staves}${band(338)}${band(378)}<path d="M84 344Q86 324 92 314" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.5"/>`,
    ),
    `<path d="M66 304A134 22 0 0 0 334 304" fill="none" stroke="${tint(wood, 0.25)}" stroke-width="4" transform="translate(0 5)"/>`,
  ].join("");
}

function cardboardBox(look: Look): string {
  const card = "#c68a4c";
  const front = "M60 312H340L332 405H68Z";
  const id = `${look.id}outfit-boxmouth`;
  const mouth = "M60 312L86 290H314L340 312Z";
  return [
    `<path d="M60 312L22 282L58 266L86 290Z" fill="${tint(card, -0.1)}" ${OUTLINE}/>`,
    `<path d="M340 312L378 282L342 266L314 290Z" fill="${shade(card)}" ${OUTLINE}/>`,
    `<clipPath id="${id}"><path d="${mouth}"/></clipPath>`,
    `<path d="${mouth}" fill="#5a3a1e" ${OUTLINE}/>`,
    `<g clip-path="url(#${id})">${chest(look)}</g>`,
    piece(
      look,
      "box",
      front,
      card,
      [
        `<path d="M268 300H360V420H276Z" fill="${shade(card)}"/>`,
        `<path d="M184 300H216V420H184Z" fill="#e3c08a" opacity="0.85"/><path d="M184 300V420M216 300V420" stroke="${tint(card, -0.3)}" stroke-width="2"/>`,
        `<path d="M222 334l8-10 8 10M226 334v12M234 334v12M238 334l8-10 8 10M242 334v12M250 334v12M222 352H254" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
        `<path d="M86 330Q90 322 98 318" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.55"/>`,
      ].join(""),
    ),
  ].join("");
}

function bubbleWrap(look: Look): string {
  const sheet = "M78 304C130 290 270 290 322 304L338 405H62Z";
  const bubbles = Array.from({ length: 40 }, (_, i) => {
    const row = Math.floor(i / 10);
    const x = 70 + (i % 10) * 28 + (row % 2) * 14;
    const y = 312 + row * 26;
    return `<circle cx="${x}" cy="${y}" r="10" fill="#e8f6ff" fill-opacity="0.55" stroke="#5aa6d6" stroke-width="2.5"/><path d="M${x - 5} ${y - 2}q1-4 5-5" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
  }).join("");
  return [
    piece(look, "wrap", sheet, "#bfe3fb", `${bubbles}${rightShade(258, "rgba(40,90,140,0.18)")}`),
    `<path d="M300 380L332 372L336 392L304 400Z" fill="#e8d39a" fill-opacity="0.85" ${THIN}/>`,
  ].join("");
}

const each = 0.48 / 37;

export const OUTFITS: readonly TraitValue[] = [
  { name: "Bare", share: 0.25, draw: () => "" },
  { name: "Burrow Scarf", share: 0.15, draw: burrowScarf },
  { name: "Sentry Vest", share: 0.12, draw: sentryVest },
  { name: "Gold Chain", share: each, draw: goldChain },
  { name: "Explorer Jacket", share: each, draw: explorerJacket },
  { name: "Raincoat", share: each, draw: raincoat },
  { name: "Hoodie", share: each, draw: hoodie },
  { name: "Bomber Jacket", share: each, draw: bomberJacket },
  { name: "Tracksuit", share: each, draw: tracksuit },
  { name: "Lab Coat", share: each, draw: labCoat },
  { name: "Chef Apron", share: each, draw: chefApron },
  { name: "Tuxedo", share: each, draw: tuxedo },
  { name: "Hawaiian Shirt", share: each, draw: hawaiianShirt },
  { name: "Knit Sweater", share: each, draw: knitSweater },
  { name: "Puffer Jacket", share: each, draw: pufferJacket },
  { name: "Overalls", share: each, draw: overalls },
  { name: "Kimono", share: each, draw: kimono },
  { name: "Poncho", share: each, draw: poncho },
  { name: "Superhero Cape", share: each, draw: superheroCape },
  { name: "Wizard Robe", share: each, draw: wizardRobe },
  { name: "Knight Armour", share: each, draw: knightArmour },
  { name: "Astronaut Suit", share: each, draw: astronautSuit },
  { name: "Diving Suit", share: each, draw: divingSuit },
  { name: "Pilot Jacket", share: each, draw: pilotJacket },
  { name: "Safari Shirt", share: each, draw: safariShirt },
  { name: "Referee Shirt", share: each, draw: refereeShirt },
  { name: "Sailor Suit", share: each, draw: sailorSuit },
  { name: "Pajamas", share: each, draw: pajamas },
  { name: "Tie-Dye Tee", share: each, draw: tieDyeTee },
  { name: "Varsity Jacket", share: each, draw: varsityJacket },
  { name: "Denim Jacket", share: each, draw: denimJacket },
  { name: "Leather Jacket", share: each, draw: leatherJacket },
  { name: "Flannel", share: each, draw: flannel },
  { name: "Life Vest", share: each, draw: lifeVest },
  { name: "Hi-Vis Vest", share: each, draw: hiVisVest },
  { name: "Beetle Bandolier", share: each, draw: beetleBandolier },
  { name: "Scarab Necklace", share: each, draw: scarabNecklace },
  { name: "Barrel", share: each, draw: barrel },
  { name: "Cardboard Box", share: each, draw: cardboardBox },
  { name: "Bubble Wrap", share: each, draw: bubbleWrap },
];
