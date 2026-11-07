/** Headwear: what sits on, or above, the head. */
import { INK, LINE, type Look, NEAR_MARK, OUTLINE, type TraitValue, tint } from "../canvas.ts";

/**
 * A filled shape with the kat's outline and one cel-shadow tone: the shadow is
 * what the shape, nudged up and left towards the light, no longer covers.
 * `inner` is drawn over the fill, clipped to the shape.
 */
const part = (
  look: Look,
  key: string,
  d: string,
  color: string,
  inner = "",
  shade = tint(color, -0.25),
) => {
  const id = `${look.id}hw-${key}`;
  return [
    `<clipPath id="${id}"><path d="${d}"/></clipPath>`,
    `<path d="${d}" fill="${shade}"/>`,
    `<g clip-path="url(#${id})"><path d="${d}" fill="${color}" transform="translate(-10 -8)"/>${inner}</g>`,
    `<path d="${d}" fill="none" ${OUTLINE}/>`,
  ].join("");
};

/** A stroke with the outline round it: stems, bands, cords. */
const line = (d: string, color: string, width: number) =>
  `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${width + 2 * LINE}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;

/** The small white highlight. */
const gleam = (x: number, y: number, rx: number, ry: number, turn = -30) =>
  `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" transform="rotate(${turn} ${x} ${y})" fill="#fff" opacity="0.75"/>`;

/** The same drawing on the other side of the face. */
const mirror = (svg: string) => `<g transform="matrix(-1 0 0 1 400 0)">${svg}</g>`;

const round = (n: number) => Math.round(n * 10) / 10;

/** A five-pointed star. */
const star = (x: number, y: number, r: number, color: string, outline = true) => {
  const points = Array.from({ length: 10 }, (_, i) => {
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const radius = i % 2 === 0 ? r : r * 0.45;
    return `${round(x + radius * Math.cos(angle))} ${round(y + radius * Math.sin(angle))}`;
  });
  const stroke = outline ? OUTLINE.replace(`stroke-width="${LINE}"`, 'stroke-width="3"') : "";
  return `<path d="M${points.join("L")}Z" fill="${color}" ${stroke}/>`;
};

/** A fluffy, scalloped circle, for pompoms and muffs. */
const fluff = (x: number, y: number, r: number, bumps: number) => {
  const at = (angle: number, radius: number) =>
    `${round(x + radius * Math.cos(angle))} ${round(y + radius * Math.sin(angle))}`;
  const step = (2 * Math.PI) / bumps;
  const arcs = Array.from(
    { length: bumps },
    (_, i) => `Q${at(step * (i + 0.5), r * 1.22)} ${at(step * (i + 1), r)}`,
  );
  return `M${at(0, r)}${arcs.join("")}Z`;
};

/** A point on the quadratic curve from (x0, y0) through control (cx, cy) to (x1, y1). */
const onCurve = (
  t: number,
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
) => ({
  x: round((1 - t) ** 2 * x0 + 2 * t * (1 - t) * cx + t ** 2 * x1),
  y: round((1 - t) ** 2 * y0 + 2 * t * (1 - t) * cy + t ** 2 * y1),
});

/** A knitted cuff from (70,144) to (330,144), its ribs following its curve. */
const cuff = (look: Look, key: string, color: string) => {
  const d = "M70 144Q200 104 330 144L324 106Q200 70 76 106Z";
  const ribs = Array.from({ length: 15 }, (_, i) => {
    const t = (i + 1) / 16;
    const low = onCurve(t, 70, 144, 200, 104, 330, 144);
    const high = onCurve(t, 76, 106, 200, 70, 324, 106);
    return `M${low.x} ${low.y}L${high.x} ${high.y}`;
  }).join("");
  return part(
    look,
    key,
    d,
    color,
    `<path d="${ribs}" stroke="${tint(color, -0.3)}" stroke-width="3"/>`,
  );
};

const leafSprig = () => {
  const leaf = (x: number, y: number, turn: number, len: number) =>
    `<g transform="translate(${x} ${y}) rotate(${turn})"><path d="M0 0C-${len * 0.36} -${len * 0.25} -${len * 0.34} -${len * 0.75} 0 -${len}C${len * 0.34} -${len * 0.75} ${len * 0.36} -${len * 0.25} 0 0Z" fill="#6cc04a"/><path d="M0 0C${len * 0.36} -${len * 0.25} ${len * 0.34} -${len * 0.75} 0 -${len}Z" fill="#4a9a34"/><path d="M0 0C-${len * 0.36} -${len * 0.25} -${len * 0.34} -${len * 0.75} 0 -${len}C${len * 0.34} -${len * 0.75} ${len * 0.36} -${len * 0.25} 0 0Z" fill="none" ${OUTLINE}/><path d="M0 -6V-${len * 0.72}" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>${gleam(-len * 0.14, -len * 0.55, 3, len * 0.12, 10)}</g>`;
  return [
    line("M200 86C198 66 196 54 204 40", "#5aa83c", 7),
    leaf(199, 68, -62, 56),
    leaf(201, 56, 58, 50),
    leaf(204, 42, 6, 38),
  ].join("");
};

const beanie = (look: Look) =>
  [
    part(
      look,
      "beanie",
      "M78 122C72 46 130 18 200 18C270 18 328 46 322 122Z",
      "#e8505b",
      `<path d="M140 30C126 60 122 90 124 116M200 20V110M260 30C274 60 278 90 276 116" stroke="${tint("#e8505b", -0.3)}" stroke-width="3" fill="none"/>`,
    ),
    cuff(look, "beanie-cuff", "#e8505b"),
    part(look, "beanie-pom", fluff(200, 14, 26, 11), "#fff4e4", "", "#e2cdb4"),
    gleam(188, 4, 7, 4),
    gleam(128, 52, 12, 6, -50),
  ].join("");

const explorerHat = (look: Look) =>
  [
    part(look, "explorer-brim", "M28 122Q200 70 372 122Q200 134 28 122Z", "#cdb27a"),
    part(
      look,
      "explorer-dome",
      "M86 112C82 34 136 0 200 0C264 0 318 34 314 112Q200 94 86 112Z",
      "#dcc28a",
    ),
    part(look, "explorer-band", "M88 112Q200 94 312 112L310 88Q200 70 90 88Z", "#6b4a2b"),
    `<ellipse cx="200" cy="2" rx="16" ry="9" fill="#b89a60" ${OUTLINE}/>`,
    `<path d="M120 50C130 30 150 18 170 14" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity="0.7" fill="none"/>`,
  ].join("");

const nightcap = (look: Look) =>
  [
    part(
      look,
      "nightcap",
      "M80 118C76 36 160 -6 246 12C312 26 350 82 352 146C338 112 318 94 296 92L320 118Z",
      "#3d5bd9",
      [
        star(130, 70, 11, "#ffd84a", false),
        star(206, 40, 9, "#ffd84a", false),
        star(266, 70, 12, "#ffd84a", false),
        star(320, 104, 7, "#ffd84a", false),
      ].join(""),
    ),
    cuff(look, "nightcap-cuff", "#f2f2ff"),
    part(look, "nightcap-pom", fluff(352, 154, 18, 9), "#f2f2ff", "", "#c6c9e6"),
    gleam(140, 42, 12, 5, -40),
  ].join("");

const crown = (look: Look) => {
  const tips: Array<[number, number]> = [
    [60, 40],
    [136, 22],
    [200, 8],
    [264, 22],
    [340, 40],
  ];
  return [
    part(
      look,
      "crown",
      "M74 134Q200 108 326 134L340 40L296 80L264 22L232 74L200 8L168 74L136 22L104 80L60 40Z",
      "#f5c33b",
    ),
    part(look, "crown-band", "M74 134Q200 108 326 134L330 106Q200 80 70 106Z", "#e9a925"),
    tips.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="10" fill="#ffe27a" ${OUTLINE}/>`).join(""),
    `<path d="M200 96L214 108L200 120L186 108Z" fill="#e8344a" ${OUTLINE}/>`,
    `<circle cx="136" cy="111" r="9" fill="#3aa0ff" ${OUTLINE}/><circle cx="264" cy="111" r="9" fill="#2fc46b" ${OUTLINE}/>`,
    gleam(110, 70, 4, 14, 20),
    gleam(196, 104, 3, 2),
  ].join("");
};

const halo = () =>
  [
    `<ellipse cx="200" cy="40" rx="122" ry="38" fill="#fff6c8" opacity="0.5"/>`,
    `<ellipse cx="200" cy="40" rx="96" ry="24" fill="none" stroke="${INK}" stroke-width="24"/>`,
    `<ellipse cx="200" cy="40" rx="96" ry="24" fill="none" stroke="#f5c33b" stroke-width="14"/>`,
    `<path d="M120 30Q160 16 210 16" fill="none" stroke="#fff6b0" stroke-width="5" stroke-linecap="round"/>`,
    `<path d="M196 58Q260 60 290 44" fill="none" stroke="#c9922a" stroke-width="5" stroke-linecap="round"/>`,
    `<g fill="#fff">${["M74 20l4 10 10 4-10 4-4 10-4-10-10-4 10-4Z", "M326 64l3 8 8 3-8 3-3 8-3-8-8-3 8-3Z"].map((d) => `<path d="${d}"/>`).join("")}</g>`,
  ].join("");

const flowerCrown = () => {
  const colors = ["#ff7eb6", "#fff", "#b48cff", "#ffb03a", "#ff7eb6", "#fff", "#b48cff"];
  const at = (t: number) => onCurve(t, 78, 132, 200, 64, 322, 132);
  const leaves = [0.08, 0.25, 0.42, 0.58, 0.75, 0.92]
    .map((t, i) => {
      const { x, y } = at(t);
      const turn = i % 2 === 0 ? -40 : 140;
      return `<path d="M0 0C6 -10 18 -12 26 -6C18 4 6 4 0 0Z" transform="translate(${x} ${y}) rotate(${turn})" fill="#5aa83c" ${OUTLINE.replace(`stroke-width="${LINE}"`, 'stroke-width="3"')}/>`;
    })
    .join("");
  const flowers = colors
    .map((color, i) => {
      const { x, y } = at(i / 6);
      const petals = Array.from({ length: 5 }, (_, p) => {
        const angle = (2 * Math.PI * p) / 5 - Math.PI / 2;
        return `<circle cx="${round(x + 11 * Math.cos(angle))}" cy="${round(y + 11 * Math.sin(angle))}" r="10" fill="${color}" ${OUTLINE.replace(`stroke-width="${LINE}"`, 'stroke-width="3.5"')}/>`;
      }).join("");
      return `${petals}<circle cx="${x}" cy="${y}" r="7" fill="#ffd84a" stroke="${INK}" stroke-width="3"/>`;
    })
    .join("");
  return [line("M78 132Q200 64 322 132", "#4a9a34", 8), leaves, flowers].join("");
};

const propellerCap = (look: Look) =>
  [
    `<path d="M197 10H203V26H197Z" fill="#9aa3ad" ${OUTLINE}/>`,
    part(
      look,
      "propeller-cap",
      "M84 124C80 48 134 22 200 22C266 22 320 48 316 124Q200 98 84 124Z",
      "#e8414b",
      `<path d="M200 22C176 40 162 80 160 118L240 118C238 80 224 40 200 22Z" fill="#ffd23a" stroke="${INK}" stroke-width="3"/><path d="M200 22C236 30 290 50 300 112L340 112V20Z" fill="#2f6fdb" stroke="${INK}" stroke-width="3"/><path d="M200 22C164 30 110 50 100 112L60 112V20Z" fill="#2f6fdb" stroke="${INK}" stroke-width="3"/>`,
    ),
    part(
      look,
      "propeller-brim",
      "M136 118Q200 100 264 118Q256 134 200 134Q144 134 136 118Z",
      "#ffd23a",
    ),
    `<ellipse cx="164" cy="12" rx="34" ry="9" fill="#e8414b" ${OUTLINE}/><ellipse cx="236" cy="12" rx="34" ry="9" fill="#2fc46b" ${OUTLINE}/><circle cx="200" cy="12" r="8" fill="#ffd23a" ${OUTLINE}/>`,
    gleam(132, 56, 12, 5, -50),
  ].join("");

const cowboyHat = (look: Look) =>
  [
    part(
      look,
      "cowboy-crown",
      "M110 108C102 48 116 12 150 14C174 16 186 30 200 26C214 30 226 16 250 14C284 12 298 48 290 108Z",
      "#c98a4b",
    ),
    part(look, "cowboy-band", "M108 106Q200 92 292 106L294 84Q200 70 106 84Z", "#5a3420"),
    part(
      look,
      "cowboy-brim",
      "M14 86C30 120 96 130 200 126C304 130 370 120 386 86C366 102 310 106 200 102C90 106 34 102 14 86Z",
      "#c98a4b",
    ),
    `<path d="M200 30V80" stroke="${tint("#c98a4b", -0.35)}" stroke-width="4" stroke-linecap="round"/>`,
    gleam(132, 40, 6, 14, 10),
  ].join("");

const topHat = (look: Look) =>
  [
    part(look, "top-hat", "M108 112L118 -20H282L292 112Z", "#3a3448", "", "#24202e"),
    part(look, "top-hat-band", "M110 106L113 66Q200 74 287 66L290 106Q200 114 110 106Z", "#d9434e"),
    part(
      look,
      "top-hat-brim",
      "M64 126Q200 96 336 126Q346 108 320 102Q200 86 80 102Q54 108 64 126Z",
      "#3a3448",
      "",
      "#24202e",
    ),
    `<path d="M136 -20H148L144 56H132Z" fill="#fff" opacity="0.3"/>`,
  ].join("");

const bowler = (look: Look) =>
  [
    part(look, "bowler", "M104 114C100 34 142 16 200 16C258 16 300 34 296 114Z", "#5a3828"),
    part(look, "bowler-band", "M103 108Q200 96 297 108L299 88Q200 74 101 88Z", "#2a1a12"),
    part(
      look,
      "bowler-brim",
      "M68 128C60 112 82 100 104 106Q200 94 296 106C318 100 340 112 332 128Q200 108 68 128Z",
      "#5a3828",
    ),
    gleam(140, 44, 14, 6, -40),
  ].join("");

const beret = (look: Look) =>
  [
    `<path d="M194 40L190 18" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>`,
    part(
      look,
      "beret",
      "M74 132C36 122 28 64 108 42C188 20 322 28 346 72C362 104 332 124 300 126Q200 108 74 132Z",
      "#d7263d",
    ),
    `<path d="M84 124Q200 102 302 118" stroke="${tint("#d7263d", -0.35)}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    gleam(110, 60, 16, 6, -20),
  ].join("");

const bucketHat = (look: Look) =>
  [
    part(
      look,
      "bucket",
      "M110 104C108 38 144 26 200 26C256 26 292 38 290 104Z",
      "#2aa198",
      `<path d="M114 84Q200 72 286 84" stroke="#fff" stroke-width="2.5" stroke-dasharray="6 6" fill="none"/>`,
    ),
    part(
      look,
      "bucket-brim",
      "M50 136C70 116 84 104 100 98Q200 84 300 98C316 104 330 116 350 136Q200 112 50 136Z",
      "#2aa198",
      `<path d="M70 126Q200 98 330 126" stroke="#fff" stroke-width="2.5" stroke-dasharray="6 6" fill="none"/>`,
    ),
    gleam(140, 46, 12, 5, -40),
  ].join("");

const capDome = "M78 122C74 44 130 16 200 16C270 16 326 44 322 122Q200 96 78 122Z";
const capSeams = (color: string) =>
  `<path d="M200 16V108M200 16C164 38 144 70 140 112M200 16C236 38 256 70 260 112" stroke="${tint(color, -0.35)}" stroke-width="3" fill="none"/>`;

const baseballCap = (look: Look) =>
  [
    part(
      look,
      "cap",
      capDome,
      "#2f6fdb",
      `${capSeams("#2f6fdb")}<circle cx="200" cy="66" r="26" fill="#fff" stroke="${INK}" stroke-width="3"/><path d="${NEAR_MARK}" transform="translate(186 52) scale(1.75)" fill="#1a110b"/>`,
    ),
    `<circle cx="200" cy="16" r="8" fill="#2f6fdb" ${OUTLINE}/>`,
    part(look, "cap-visor", "M98 118Q200 90 302 118Q294 134 200 134Q106 134 98 118Z", "#2559b8"),
    gleam(126, 52, 12, 5, -50),
  ].join("");

const backwardsCap = (look: Look) =>
  [
    part(look, "cap-visor", "M112 34C130 -22 270 -22 288 34Z", "#b8302a"),
    part(look, "cap", capDome, "#e2453c", capSeams("#e2453c")),
    `<path d="M170 110V96Q170 76 200 76Q230 76 230 96V110Q200 106 170 110Z" fill="${look.fur.fur}" ${OUTLINE}/>`,
    `<path d="M164 98H236V108H164Z" fill="#7a1f1a" ${OUTLINE.replace(`stroke-width="${LINE}"`, 'stroke-width="3"')}/>`,
    `<circle cx="200" cy="16" r="8" fill="#e2453c" ${OUTLINE}/>`,
    gleam(126, 52, 12, 5, -50),
  ].join("");

const headphones = (look: Look) => {
  const cup = (key: string) =>
    [
      `<path d="M90 158H108V214H90Z" fill="#3a3a48" ${OUTLINE}/>`,
      part(
        look,
        key,
        "M62 144H80Q104 144 104 168V204Q104 228 80 228H62Q38 228 38 204V168Q38 144 62 144Z",
        "#ff5c8a",
      ),
      `<circle cx="71" cy="186" r="14" fill="${tint("#ff5c8a", -0.25)}" stroke="${INK}" stroke-width="3"/>`,
      gleam(54, 162, 5, 9, 10),
    ].join("");
  return [
    line("M72 160C66 20 334 20 328 160", "#3a3a48", 14),
    `<path d="M92 92C110 60 150 44 196 42" stroke="#fff" stroke-width="4" opacity="0.5" fill="none" stroke-linecap="round"/>`,
    cup("phones-l"),
    mirror(cup("phones-r")),
  ].join("");
};

/** A coiled spring from (x0, y0) to (x1, y1). */
const spring = (x0: number, y0: number, x1: number, y1: number) => {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const [ux, uy] = [(x1 - x0) / len, (y1 - y0) / len];
  const coils = 9;
  const points = Array.from({ length: coils + 1 }, (_, i) => {
    const along = (len * i) / coils;
    const side = i === 0 || i === coils ? 0 : i % 2 === 0 ? 7 : -7;
    return `${round(x0 + ux * along - uy * side)} ${round(y0 + uy * along + ux * side)}`;
  });
  return `M${points.join("L")}`;
};

const antennaHeadband = () =>
  [
    line(spring(156, 82, 120, 16), "#c9d1da", 4),
    line(spring(244, 82, 280, 16), "#c9d1da", 4),
    line("M84 132C80 50 320 50 316 132", "#8a4fff", 10),
    `<circle cx="120" cy="16" r="17" fill="#a6ff4d" ${OUTLINE}/><circle cx="280" cy="16" r="17" fill="#a6ff4d" ${OUTLINE}/>`,
    `<path d="M126 26a12 12 0 0 1 -16 -4M286 26a12 12 0 0 1 -16 -4" stroke="#6cc02a" stroke-width="4" fill="none"/>`,
    gleam(114, 10, 5, 3),
    gleam(274, 10, 5, 3),
  ].join("");

const partyHat = (look: Look) =>
  `<g transform="rotate(-10 200 106)">${[
    part(
      look,
      "party",
      "M128 106L200 16L272 106Q200 122 128 106Z",
      "#3fc1ff",
      `<g fill="#ffd23a"><circle cx="186" cy="40" r="7"/><circle cx="216" cy="62" r="8"/><circle cx="170" cy="78" r="8"/><circle cx="236" cy="90" r="6"/><circle cx="200" cy="96" r="5"/></g><g fill="#ff5c8a"><circle cx="204" cy="26" r="5"/><circle cx="190" cy="66" r="5"/><circle cx="226" cy="76" r="4"/><circle cx="160" cy="94" r="5"/></g>`,
    ),
    part(
      look,
      "party-trim",
      "M122 114Q200 132 278 114L272 98Q200 114 128 98Z",
      "#fff",
      "",
      "#d2dce6",
    ),
    part(look, "party-pom", fluff(200, 16, 16, 9), "#ff5c8a"),
    gleam(172, 60, 3, 14, 30),
  ].join("")}</g>`;

const chefHat = (look: Look) =>
  [
    part(
      look,
      "chef-puff",
      "M100 92C54 82 52 14 108 14C112 -24 176 -30 200 -6C224 -30 288 -24 292 14C348 14 346 82 300 92Z",
      "#fbfbf7",
      `<path d="M150 88C146 60 150 40 162 24M250 88C254 60 250 40 238 24M200 90V40" stroke="#c9d2de" stroke-width="4" fill="none" stroke-linecap="round"/>`,
      "#d5dce6",
    ),
    part(
      look,
      "chef-band",
      "M92 130Q200 104 308 130L304 84Q200 62 96 84Z",
      "#fbfbf7",
      "",
      "#d5dce6",
    ),
    gleam(98, 40, 10, 6, -40),
  ].join("");

const pirateHat = (look: Look) =>
  [
    part(
      look,
      "pirate",
      "M30 124C48 64 112 22 200 36C288 22 352 64 370 124C320 102 270 116 200 116C130 116 80 102 30 124Z",
      "#2b2735",
      `<path d="M30 118C80 96 130 108 200 108C270 108 320 96 370 118" stroke="#f1c040" stroke-width="8" fill="none"/>`,
      "#1a1720",
    ),
    line("M178 92L222 56M178 56L222 92", "#fff", 6),
    `<path d="M184 74C184 56 216 56 216 74C216 82 210 84 210 88H190C190 84 184 82 184 74Z" fill="#fff" ${OUTLINE.replace(`stroke-width="${LINE}"`, 'stroke-width="3"')}/>`,
    `<circle cx="193" cy="72" r="4" fill="${INK}"/><circle cx="207" cy="72" r="4" fill="${INK}"/>`,
    gleam(100, 70, 14, 5, -35),
  ].join("");

const wizardHat = (look: Look) =>
  [
    part(look, "wizard-brim", "M38 120Q200 84 362 120Q200 136 38 120Z", "#6a3fd1"),
    part(
      look,
      "wizard",
      "M108 108Q160 50 214 -20H256Q264 50 292 108Q200 96 108 108Z",
      "#6a3fd1",
      [
        star(170, 70, 12, "#ffd84a", false),
        star(234, 30, 9, "#ffd84a", false),
        star(250, 82, 7, "#ffd84a", false),
      ].join(""),
    ),
    part(look, "wizard-band", "M110 106Q200 94 290 106L284 86Q200 74 116 86Z", "#ffc93a"),
    gleam(186, 30, 4, 16, 35),
  ].join("");

const knightHelmet = (look: Look) => {
  const rivets = [0.1, 0.25, 0.4, 0.6, 0.75, 0.9]
    .map((t) => {
      const { x, y } = onCurve(t, 84, 136, 200, 92, 316, 136);
      return `<circle cx="${x}" cy="${y - 8}" r="4" fill="#e8edf2" stroke="${INK}" stroke-width="2.5"/>`;
    })
    .join("");
  return [
    part(
      look,
      "knight",
      "M64 154C52 50 124 6 200 6C276 6 348 50 336 154H314Q316 128 300 120Q200 92 100 120Q84 128 86 154Z",
      "#b8c2cc",
      `<path d="M200 6V40" stroke="${INK}" stroke-width="4"/><path d="M84 138Q90 116 112 110Q200 88 288 110Q310 116 316 138" stroke="#7d8894" stroke-width="16" fill="none"/>`,
    ),
    rivets,
    part(
      look,
      "knight-visor",
      "M96 92C96 52 140 38 200 38C260 38 304 52 304 92Q200 70 96 92Z",
      "#9aa6b2",
    ),
    `<path d="M128 70Q200 54 272 70M136 82Q200 66 264 82" stroke="${INK}" stroke-width="6" stroke-linecap="round" fill="none"/>`,
    gleam(116, 52, 12, 5, -45),
    part(
      look,
      "plume",
      "M194 30C196 -8 296 -16 346 46C322 34 304 38 294 52C280 34 256 30 244 44C230 32 212 32 204 40Z",
      "#e8344a",
      `<path d="M210 30Q270 4 330 36" stroke="${tint("#e8344a", -0.3)}" stroke-width="3" fill="none"/>`,
    ),
    `<path d="M188 40V24H212V40Z" fill="#9aa6b2" ${OUTLINE}/>`,
  ].join("");
};

const spaceHelmet = () =>
  [
    `<circle cx="200" cy="176" r="156" fill="#bfe8ff" opacity="0.1"/>`,
    `<path d="M58 300Q200 376 342 300L330 268Q200 344 70 268Z" fill="#c9d1da" ${OUTLINE}/>`,
    `<path d="M70 286Q200 356 330 286" stroke="#8d97a3" stroke-width="5" fill="none"/>`,
    `<circle cx="200" cy="176" r="156" fill="none" ${OUTLINE}/>`,
    `<circle cx="200" cy="176" r="148" fill="none" stroke="#fff" stroke-width="3" opacity="0.6"/>`,
    `<path d="M70 118A136 136 0 0 1 150 46" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round" opacity="0.85"/>`,
    `<circle cx="172" cy="38" r="6" fill="#fff" opacity="0.85"/>`,
    `<path d="M310 120A136 136 0 0 1 330 170" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity="0.5"/>`,
    line("M200 20V4", "#9aa3ad", 4),
    `<circle cx="200" cy="2" r="9" fill="#e8344a" ${OUTLINE}/>`,
  ].join("");

const minerLamp = (look: Look) =>
  [
    `<path d="M184 70L110 -10H290L216 70Z" fill="#fff4a8" opacity="0.5"/>`,
    part(look, "miner-strap", "M74 142Q200 94 326 142L312 110Q200 64 88 110Z", "#3a3f58"),
    `<path d="M164 114V84H236V114Z" fill="#7d8894" ${OUTLINE}/>`,
    `<circle cx="200" cy="88" r="34" fill="#9aa3ad" ${OUTLINE}/>`,
    `<circle cx="200" cy="88" r="22" fill="#ffe066" stroke="${INK}" stroke-width="3.5"/>`,
    `<circle cx="200" cy="88" r="10" fill="#fffbe0"/>`,
    gleam(184, 68, 7, 3),
  ].join("");

const hardHat = (look: Look) =>
  [
    part(look, "hard-hat", "M88 122C84 34 140 10 200 10C260 10 316 34 312 122Z", "#ffc21a"),
    part(look, "hard-hat-ridge", "M174 16Q200 6 226 16L228 112H172Z", "#ffcf3e"),
    part(
      look,
      "hard-hat-brim",
      "M56 136Q200 104 344 136Q354 118 332 112Q200 88 68 112Q46 118 56 136Z",
      "#ffc21a",
    ),
    gleam(130, 50, 14, 6, -45),
  ].join("");

const bandana = (look: Look) =>
  [
    part(
      look,
      "bandana-tails",
      "M326 120C350 98 372 92 390 96C380 112 362 124 338 130ZM334 136C360 142 374 158 380 178C362 174 346 160 330 144Z",
      "#e03a3a",
    ),
    part(
      look,
      "bandana",
      "M72 140C62 62 126 50 200 50C274 50 338 62 328 140Q200 104 72 140Z",
      "#e03a3a",
      `<g fill="#fff"><circle cx="120" cy="96" r="6"/><circle cx="160" cy="72" r="5"/><circle cx="210" cy="64" r="6"/><circle cx="256" cy="82" r="5"/><circle cx="290" cy="104" r="6"/><circle cx="182" cy="100" r="4"/><circle cx="234" cy="104" r="4"/><circle cx="96" cy="124" r="4"/></g>`,
    ),
    `<circle cx="328" cy="128" r="14" fill="#c42d2d" ${OUTLINE}/>`,
    gleam(118, 70, 12, 5, -35),
  ].join("");

const sweatband = (look: Look) =>
  part(
    look,
    "sweatband",
    "M72 146Q200 104 328 146L302 106Q200 74 98 106Z",
    "#f6f6f2",
    `<path d="M74 128Q200 88 326 128" stroke="#e8344a" stroke-width="10" fill="none"/>`,
    "#cfd6de",
  );

const mohawk = (look: Look) =>
  [
    part(
      look,
      "mohawk",
      "M148 100L108 34L158 62L148 -8L188 46L200 -22L212 46L252 -8L242 62L292 34L252 100Q200 86 148 100Z",
      "#ff3fa4",
      `<path d="M170 92L150 40M200 88V20M230 92L250 40" stroke="${tint("#ff3fa4", -0.3)}" stroke-width="4" stroke-linecap="round"/>`,
    ),
    gleam(176, 40, 3, 12, -10),
  ].join("");

const birdsNest = (look: Look) =>
  `<g transform="translate(200 96) scale(1.2) translate(-200 -96)">${[
    `<ellipse cx="200" cy="72" rx="92" ry="20" fill="#5e3a1a" ${OUTLINE}/>`,
    `<ellipse cx="164" cy="64" rx="14" ry="18" fill="#8fd3f0" ${OUTLINE}/><ellipse cx="238" cy="64" rx="14" ry="18" fill="#8fd3f0" ${OUTLINE}/>`,
    `<circle cx="200" cy="52" r="22" fill="#ffd84a" ${OUTLINE}/>`,
    `<circle cx="192" cy="48" r="3.5" fill="${INK}"/><circle cx="208" cy="48" r="3.5" fill="${INK}"/><path d="M194 56L200 64L206 56Z" fill="#ff8c2a" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>`,
    `<path d="M194 30Q198 20 206 24" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
    part(
      look,
      "nest",
      "M106 70C108 112 292 112 294 70Q200 94 106 70Z",
      "#8a5a2b",
      `<path d="M112 84Q200 104 288 84M120 96Q200 112 280 96M140 76L176 104M240 76L204 102M160 92L196 80M250 96L280 80" stroke="${tint("#8a5a2b", -0.4)}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
    ),
    line("M108 74L88 62M292 72L314 64M130 96L112 104M276 94L298 100", "#8a5a2b", 3),
    gleam(158, 56, 3, 6, 10),
  ].join("")}</g>`;

const snailFriend = (look: Look) =>
  `<g transform="translate(210 92) scale(1.2) translate(-210 -92)">${[
    line("M296 52L292 26M306 54L316 30", "#e8c88f", 4),
    `<circle cx="292" cy="24" r="6" fill="#e8c88f" ${OUTLINE.replace(`stroke-width="${LINE}"`, 'stroke-width="3"')}/><circle cx="316" cy="28" r="6" fill="#e8c88f" ${OUTLINE.replace(`stroke-width="${LINE}"`, 'stroke-width="3"')}/>`,
    `<circle cx="293" cy="24" r="2.5" fill="${INK}"/><circle cx="317" cy="28" r="2.5" fill="${INK}"/>`,
    part(
      look,
      "snail",
      "M118 96C140 70 240 62 272 72C278 54 290 44 302 46C318 48 320 70 308 80C298 88 286 90 272 92C230 76 160 78 118 96Z",
      "#e8c88f",
    ),
    `<path d="M296 70Q302 74 308 68" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
    part(look, "shell", "M190 8A40 40 0 1 1 189.9 8Z", "#f29e4c"),
    `<path d="M196 50A6 6 0 1 0 186 44A14 14 0 1 0 206 56A24 24 0 1 0 172 28" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    gleam(170, 24, 8, 4, -40),
  ].join("")}</g>`;

const mushroomCap = (look: Look) =>
  [
    part(
      look,
      "mushroom",
      "M36 128C30 20 120 -14 200 -14C280 -14 370 20 364 128C320 108 270 100 200 100C130 100 80 108 36 128Z",
      "#e23b3b",
      `<g fill="#fff8ec">${[
        [120, 40, 20],
        [200, 12, 16],
        [278, 42, 22],
        [86, 92, 12],
        [320, 96, 12],
        [200, 66, 14],
        [154, 84, 9],
        [248, 86, 10],
      ]
        .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`)
        .join("")}</g>`,
    ),
    gleam(84, 50, 16, 6, -50),
  ].join("");

const cactusHat = (look: Look) =>
  `<g transform="translate(200 94) scale(1.12) translate(-200 -94)">${[
    part(
      look,
      "cactus",
      "M182 62V34Q182 16 200 16Q218 16 218 34V62ZM184 50H164Q154 50 154 40V30Q154 22 161 22Q168 22 168 30V38H184ZM216 44H236Q246 44 246 34V24Q246 16 239 16Q232 16 232 24V32H216Z",
      "#4fae4a",
      `<path d="M194 26V62M206 26V62" stroke="${tint("#4fae4a", -0.35)}" stroke-width="2.5"/>`,
    ),
    `<path d="M188 36l-4-2M212 32l4-2M188 52l-4 2M212 50l4 2M160 34l-4-1M240 28l4-1" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`,
    `<g transform="translate(200 16)">${Array.from({ length: 5 }, (_, p) => `<circle cx="${round(7 * Math.cos((2 * Math.PI * p) / 5))}" cy="${round(7 * Math.sin((2 * Math.PI * p) / 5))}" r="6" fill="#ff7eb6" stroke="${INK}" stroke-width="2.5"/>`).join("")}<circle r="4" fill="#ffd84a"/></g>`,
    part(look, "pot", "M164 94L158 72H242L236 94Q200 100 164 94Z", "#d9774b"),
    part(look, "pot-rim", "M150 74V62Q150 58 154 58H246Q250 58 250 62V74Z", "#e88a5c"),
  ].join("")}</g>`;

const strawHat = (look: Look) =>
  [
    part(
      look,
      "straw-brim",
      "M8 112Q200 58 392 112Q200 138 8 112Z",
      "#f2cf63",
      `<path d="M40 104L60 120M80 96L104 122M124 90L148 124M252 90L252 124M300 94L290 124M346 102L330 122" stroke="${tint("#f2cf63", -0.3)}" stroke-width="2.5"/>`,
    ),
    part(
      look,
      "straw",
      "M114 102C112 38 150 28 200 28C250 28 288 38 286 102Q200 112 114 102Z",
      "#f2cf63",
      `<path d="M118 60Q200 46 282 60M116 40Q200 26 284 40" stroke="${tint("#f2cf63", -0.3)}" stroke-width="2.5" fill="none"/>`,
    ),
    part(look, "straw-ribbon", "M114 98Q200 110 286 98L286 78Q200 88 114 78Z", "#e8344a"),
    `<g transform="translate(262 88)">${Array.from({ length: 5 }, (_, p) => `<circle cx="${round(9 * Math.cos((2 * Math.PI * p) / 5))}" cy="${round(9 * Math.sin((2 * Math.PI * p) / 5))}" r="8" fill="#fff" stroke="${INK}" stroke-width="3"/>`).join("")}<circle r="6" fill="#ffd84a" stroke="${INK}" stroke-width="2.5"/></g>`,
    gleam(136, 50, 12, 5, -40),
  ].join("");

const earmuffs = (look: Look) =>
  [
    line("M72 164C62 26 338 26 328 164", "#c9d1da", 6),
    part(look, "muff-l", fluff(70, 186, 34, 11), "#ff9ccf"),
    part(look, "muff-r", fluff(330, 186, 34, 11), "#ff9ccf"),
    gleam(58, 170, 8, 5),
    gleam(318, 170, 8, 5),
  ].join("");

const tiara = (look: Look) =>
  `<g transform="translate(200 104) scale(1.2) translate(-200 -104)">${[
    part(
      look,
      "tiara",
      "M128 104Q200 88 272 104L270 92L256 72L238 86L220 62L200 32L180 62L162 86L144 72L130 92Z",
      "#dfe6ef",
    ),
    part(look, "tiara-band", "M128 104Q200 88 272 104L270 94Q200 78 130 94Z", "#b9c4d1"),
    `<circle cx="144" cy="70" r="5" fill="#fff" stroke="${INK}" stroke-width="2.5"/><circle cx="256" cy="70" r="5" fill="#fff" stroke="${INK}" stroke-width="2.5"/><circle cx="200" cy="30" r="6" fill="#fff" stroke="${INK}" stroke-width="2.5"/>`,
    `<path d="M200 82C186 72 186 58 194 56C198 55 200 58 200 60C200 58 202 55 206 56C214 58 214 72 200 82Z" fill="#ff5c8a" stroke="${INK}" stroke-width="3"/>`,
    `<circle cx="160" cy="88" r="4.5" fill="#3aa0ff" stroke="${INK}" stroke-width="2"/><circle cx="240" cy="88" r="4.5" fill="#3aa0ff" stroke="${INK}" stroke-width="2"/>`,
    gleam(194, 62, 2.5, 2),
  ].join("")}</g>`;

const unicornHorn = (look: Look) =>
  [
    part(look, "mane-1", "M184 104C164 72 122 70 100 94C126 88 152 96 170 112Z", "#ff9ccf"),
    part(look, "mane-2", "M186 108C170 86 140 84 124 104C144 100 162 106 174 116Z", "#b48cff"),
    part(look, "mane-3", "M216 104C232 80 264 78 286 96C264 94 244 100 228 114Z", "#7fd8f0"),
    part(
      look,
      "horn",
      "M176 106C182 70 196 30 216 0C214 40 220 76 226 106Q200 114 176 106Z",
      "#ffe08a",
      `<path d="M178 94Q202 100 224 86M182 72Q204 76 222 62M188 50Q206 52 219 40M197 28Q209 28 216 18" stroke="${tint("#ffe08a", -0.4)}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    ),
    `<g fill="#fff">${["M140 30l3 8 8 3-8 3-3 8-3-8-8-3 8-3Z", "M262 20l3 8 8 3-8 3-3 8-3-8-8-3 8-3Z", "M252 60l2 6 6 2-6 2-2 6-2-6-6-2 6-2Z"].map((d) => `<path d="${d}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`).join("")}</g>`,
    gleam(192, 56, 3, 12, 15),
  ].join("");

const lightbulb = (look: Look) => {
  const rays = [-60, -30, 0, 30, 60]
    .map((deg) => {
      const a = ((deg - 90) * Math.PI) / 180;
      const p = (r: number) => `${round(200 + r * Math.cos(a))} ${round(22 + r * Math.sin(a))}`;
      return line(`M${p(58)}L${p(78)}`, "#ffe45c", 5);
    })
    .join("");
  return `<g transform="translate(200 100) scale(0.88) translate(-200 -100)">${[
    `<circle cx="200" cy="22" r="66" fill="#fff6b0" opacity="0.55"/>`,
    rays,
    part(
      look,
      "bulb",
      "M180 70C180 56 156 46 156 22C156 -2 176 -16 200 -16C224 -16 244 -2 244 22C244 46 220 56 220 70Z",
      "#ffe45c",
      `<path d="M188 68V46L182 32M212 68V46L218 32M182 32Q190 24 196 34Q200 24 204 34Q210 24 218 32" stroke="#c98a1a" stroke-width="3" fill="none" stroke-linecap="round"/>`,
    ),
    part(
      look,
      "bulb-base",
      "M180 100V70H220V100Q200 106 180 100Z",
      "#b8c2cc",
      `<path d="M180 78L220 82M180 88L220 92" stroke="${INK}" stroke-width="3"/>`,
    ),
    gleam(174, 10, 5, 12, 20),
  ].join("")}</g>`;
};

const raincloud = (look: Look) => {
  const drop = (x: number, y: number) =>
    `<path d="M${x} ${y - 12}C${x + 4} ${y - 4} ${x + 7} ${y} ${x + 7} ${y + 4}A7 7 0 0 1 ${x - 7} ${y + 4}C${x - 7} ${y} ${x - 4} ${y - 4} ${x} ${y - 12}Z" fill="#5bb4ff" ${OUTLINE.replace(`stroke-width="${LINE}"`, 'stroke-width="3"')}/>`;
  return [
    drop(146, 82),
    drop(186, 100),
    drop(232, 86),
    drop(268, 70),
    part(
      look,
      "cloud",
      "M116 62C94 62 90 30 114 26C116 2 150 -6 166 10C178 -12 224 -12 236 8C254 -4 288 6 284 30C306 32 306 62 284 62Z",
      "#a9b8cc",
    ),
    `<path d="M170 38q6 6 12 0M218 38q6 6 12 0" stroke="${INK}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`,
    `<ellipse cx="160" cy="48" rx="8" ry="4" fill="#ff7f86" opacity="0.5"/><ellipse cx="240" cy="48" rx="8" ry="4" fill="#ff7f86" opacity="0.5"/>`,
    gleam(140, 22, 10, 5, -30),
  ].join("");
};

const graduationCap = (look: Look) =>
  [
    part(
      look,
      "grad-skull",
      "M96 122C96 60 146 46 200 46C254 46 304 60 304 122Q200 100 96 122Z",
      "#2b2b35",
      "",
      "#1b1b22",
    ),
    `<path d="M24 52L200 96L376 52V62L200 106L24 62Z" fill="#1b1b22" ${OUTLINE}/>`,
    part(look, "grad-board", "M24 52L200 8L376 52L200 96Z", "#3a3a48", "", "#2b2b35"),
    `<ellipse cx="200" cy="52" rx="10" ry="6" fill="#f5c33b" ${OUTLINE.replace(`stroke-width="${LINE}"`, 'stroke-width="3"')}/>`,
    line("M206 54L334 64V112", "#f5c33b", 4),
    part(look, "tassel", "M324 108H344L350 152H318Z", "#f5c33b"),
    `<path d="M120 36L200 18" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity="0.4"/>`,
  ].join("");

/** The share of each of the 37 rarer hats: they split what None, Leaf Sprig and Beanie leave. */
const RARE = 0.48 / 37;

export const HEADWEAR: readonly TraitValue[] = [
  { name: "None", share: 0.3, draw: () => "" },
  { name: "Leaf Sprig", share: 0.12, draw: leafSprig },
  { name: "Beanie", share: 0.1, draw: beanie },
  { name: "Explorer Hat", share: RARE, draw: explorerHat },
  { name: "Nightcap", share: RARE, draw: nightcap },
  { name: "Crown", share: RARE, draw: crown },
  { name: "Halo", share: RARE, draw: halo },
  { name: "Flower Crown", share: RARE, draw: flowerCrown },
  { name: "Propeller Cap", share: RARE, draw: propellerCap },
  { name: "Cowboy Hat", share: RARE, draw: cowboyHat },
  { name: "Top Hat", share: RARE, draw: topHat },
  { name: "Bowler", share: RARE, draw: bowler },
  { name: "Beret", share: RARE, draw: beret },
  { name: "Bucket Hat", share: RARE, draw: bucketHat },
  { name: "Baseball Cap", share: RARE, draw: baseballCap },
  { name: "Backwards Cap", share: RARE, draw: backwardsCap },
  { name: "Headphones", share: RARE, draw: headphones },
  { name: "Antenna Headband", share: RARE, draw: antennaHeadband },
  { name: "Party Hat", share: RARE, draw: partyHat },
  { name: "Chef Hat", share: RARE, draw: chefHat },
  { name: "Pirate Hat", share: RARE, draw: pirateHat },
  { name: "Wizard Hat", share: RARE, draw: wizardHat },
  { name: "Knight Helmet", share: RARE, draw: knightHelmet },
  { name: "Space Helmet", share: RARE, draw: spaceHelmet },
  { name: "Miner Lamp", share: RARE, draw: minerLamp },
  { name: "Hard Hat", share: RARE, draw: hardHat },
  { name: "Bandana", share: RARE, draw: bandana },
  { name: "Sweatband", share: RARE, draw: sweatband },
  { name: "Mohawk", share: RARE, draw: mohawk },
  { name: "Bird's Nest", share: RARE, draw: birdsNest },
  { name: "Snail Friend", share: RARE, draw: snailFriend },
  { name: "Mushroom Cap", share: RARE, draw: mushroomCap },
  { name: "Cactus Hat", share: RARE, draw: cactusHat },
  { name: "Straw Hat", share: RARE, draw: strawHat },
  { name: "Earmuffs", share: RARE, draw: earmuffs },
  { name: "Tiara", share: RARE, draw: tiara },
  { name: "Unicorn Horn", share: RARE, draw: unicornHorn },
  { name: "Lightbulb", share: RARE, draw: lightbulb },
  { name: "Little Raincloud", share: RARE, draw: raincloud },
  { name: "Graduation Cap", share: RARE, draw: graduationCap },
];
