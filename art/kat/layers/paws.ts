/**
 * Paws: what the raised paw holds. Each item is drawn between the raised arm
 * and the paw's fingers, with its grip under the fingers at PAW, so the
 * fingers drawn after it close round it. Items lean up and to the right,
 * clear of the eyes and the nose.
 */
import { INK, type Look, NEAR_MARK, OUTLINE, PAW, type TraitValue } from "../canvas.ts";

/** Outline for small details. */
const THIN = `stroke="${INK}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"`;

/** Tilts an item about the paw; positive leans it to the right. */
const lean = (degrees: number, svg: string) =>
  `<g transform="rotate(${degrees} ${PAW.x} ${PAW.y})">${svg}</g>`;

/** A white highlight. */
const gleam = (x: number, y: number, rx: number, ry: number, turn = 0) =>
  `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" transform="rotate(${turn} ${x} ${y})" fill="#fff" opacity="0.85"/>`;

/**
 * A filled, outlined shape with its insides (cel shadow, pattern) clipped to it.
 * `shape` is one bare SVG element, such as `<circle cx="1" cy="2" r="3"/>`.
 */
function solid(
  look: Look,
  key: string,
  shape: string,
  fill: string,
  inside: string,
  line = OUTLINE,
): string {
  const id = `${look.id}paws-${key}`;
  const paint = (attributes: string) => shape.replace("/>", ` ${attributes}/>`);
  return `<clipPath id="${id}">${shape}</clipPath>${paint(`fill="${fill}"`)}<g clip-path="url(#${id})">${inside}</g>${paint(`fill="none" ${line}`)}`;
}

/** The usual cel shadow: everything in shade except the same shape nudged up and left. */
const crescent = (shape: string, fill: string, shade: string, dx = -6, dy = -6) =>
  `<rect x="0" y="0" width="400" height="400" fill="${shade}"/><g transform="translate(${dx} ${dy})">${shape.replace("/>", ` fill="${fill}"/>`)}</g>`;

/** A shaded, outlined shape in one go. */
const blob = (
  look: Look,
  key: string,
  shape: string,
  fill: string,
  shade: string,
  extra = "",
  line = OUTLINE,
) => solid(look, key, shape, fill, crescent(shape, fill, shade) + extra, line);

/** A thick outlined line: a stick, a handle, a string of tail. */
const rod = (d: string, color: string, width: number, ink = width + 7) =>
  `<path d="${d}" stroke="${INK}" stroke-width="${ink}" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" stroke="${color}" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;

const WOOD = "#c98b4e";
const GOLD = "#ffcc3a";
const GOLD_SHADE = "#e09a1c";

function beetle(look: Look): string {
  const body = `<ellipse cx="306" cy="252" rx="28" ry="34"/>`;
  return lean(
    14,
    [
      `<path d="M284 236l-16-8M280 254l-18 0M284 272l-14 12M328 236l16-8M332 254l18 0M328 272l14 12" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round"/>`,
      `<path d="M300 210q-6-18-18-20M312 210q6-18 18-20" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
      `<ellipse cx="306" cy="216" rx="16" ry="12" fill="#3a2f4a" ${OUTLINE}/>`,
      blob(
        look,
        "beetle",
        body,
        "#2fbf86",
        "#1c8a5e",
        `<path d="M306 218V290" stroke="${INK}" stroke-width="4"/><circle cx="292" cy="262" r="5" fill="#1c8a5e"/><circle cx="320" cy="270" r="4" fill="#14684a"/>`,
      ),
      gleam(292, 236, 5, 10, 20),
      `<circle cx="300" cy="214" r="2.5" fill="#fff"/><circle cx="312" cy="214" r="2.5" fill="#fff"/>`,
    ].join(""),
  );
}

function nearCoin(look: Look): string {
  const face = `<circle cx="308" cy="248" r="32"/>`;
  return [
    `<ellipse cx="314" cy="250" rx="42" ry="44" fill="${GOLD_SHADE}" ${OUTLINE}/>`,
    `<circle cx="310" cy="248" r="42" fill="${GOLD}" ${OUTLINE}/>`,
    solid(
      look,
      "coin",
      face,
      "#ffd95e",
      `<circle cx="314" cy="254" r="32" fill="${GOLD}"/>`,
      `stroke="#c9840f" stroke-width="3.5"`,
    ),
    `<path d="${NEAR_MARK}" transform="translate(287 225) scale(2.75)" fill="#5a3606"/>`,
    `<path d="M278 230a38 38 0 0 1 22-18" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.85"/>`,
  ].join("");
}

function coffeeMug(look: Look): string {
  const mug = `<path d="M278 230H334V292Q334 306 320 306H292Q278 306 278 292Z"/>`;
  return [
    `<path d="M296 220q-8-10 0-20t0-20M314 218q-8-10 0-20t0-20" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.85"/>`,
    rod("M332 246q22 0 22 20t-22 20", "#e8524a", 8, 18),
    blob(
      look,
      "mug",
      mug,
      "#e8524a",
      "#b8352f",
      `<rect x="270" y="252" width="70" height="10" fill="#fff"/>`,
    ),
    `<ellipse cx="306" cy="232" rx="25" ry="6" fill="#5a3420" ${THIN}/>`,
    gleam(287, 270, 3.5, 10),
  ].join("");
}

function scorpion(look: Look): string {
  const tail = "M312 292C356 306 376 268 366 236C360 216 344 210 334 220";
  const claw = (x: number, y: number) =>
    `<path d="M${x - 9} ${y + 8}C${x - 15} ${y - 6} ${x - 8} ${y - 17} ${x - 1} ${y - 16}L${x} ${y - 5}L${x + 4} ${y - 16}C${x + 12} ${y - 14} ${x + 13} ${y + 2} ${x + 8} ${y + 8}Z" fill="#f07a2c" ${OUTLINE}/>`;
  return [
    rod(tail, "#f07a2c", 12, 21),
    `<path d="${tail}" stroke="#b9471a" stroke-width="13" stroke-dasharray="3 11" fill="none"/>`,
    `<path d="M336 224q-16-2-18-18q8 6 22 8Z" fill="#3a2f4a" ${THIN}/>`,
    `<path d="M296 250l-16-6M294 262l-18 0M296 274l-16 8M324 250l16-6M326 262l18 0M324 274l16 8" stroke="${INK}" stroke-width="4.5" fill="none" stroke-linecap="round"/>`,
    rod("M302 236Q290 226 292 210", "#f07a2c", 6, 13),
    rod("M318 236Q330 224 328 208", "#f07a2c", 6, 13),
    claw(292, 204),
    claw(328, 202),
    blob(
      look,
      "scorpion",
      `<ellipse cx="310" cy="264" rx="18" ry="30"/>`,
      "#f07a2c",
      "#c4521a",
      `<path d="M290 256h40M290 270h40M290 284h40" stroke="${INK}" stroke-width="3"/>`,
    ),
    `<ellipse cx="310" cy="236" rx="14" ry="10" fill="#f07a2c" ${OUTLINE}/>`,
    `<circle cx="304" cy="234" r="3" fill="${INK}"/><circle cx="316" cy="234" r="3" fill="${INK}"/>`,
    gleam(302, 254, 3, 7),
  ].join("");
}

function grubOnAStick(look: Look): string {
  const segments: Array<[number, number, number]> = [
    [294, 222, 13],
    [304, 202, 14],
    [323, 195, 14],
    [339, 205, 13],
    [345, 223, 11],
  ];
  return lean(
    6,
    [
      rod("M305 334V196", WOOD, 7, 14),
      segments
        .map(([x, y, r], i) =>
          blob(
            look,
            `grub${i}`,
            `<circle cx="${x}" cy="${y}" r="${r}"/>`,
            "#f6dfa0",
            "#dba95a",
            "",
            THIN,
          ),
        )
        .join(""),
      `<circle cx="349" cy="236" r="8" fill="#c9772f" ${THIN}/><circle cx="351" cy="235" r="2" fill="${INK}"/>`,
      gleam(299, 196, 5, 3, -30),
    ].join(""),
  );
}

function lollipop(look: Look): string {
  const candy = `<circle cx="324" cy="196" r="34"/>`;
  return [
    rod("M302 322L320 220", "#fff", 6, 13),
    blob(
      look,
      "lolly",
      candy,
      "#ff5fa2",
      "#e03c84",
      `<path d="M322 196a4 4 0 0 1 8 0a8 8 0 0 1-16 0a12 12 0 0 1 24 0a16 16 0 0 1-32 0a20 20 0 0 1 40 0a24 24 0 0 1-48 0a28 28 0 0 1 56 0" stroke="#fff" stroke-width="6.5" fill="none" stroke-linecap="round"/>`,
    ),
    gleam(306, 178, 6, 9, 40),
  ].join("");
}

function watermelonSlice(look: Look): string {
  const wedge = `<path d="M258 286L318 186L356 280Q306 320 258 286Z"/>`;
  const seeds = [
    [302, 252, 10],
    [322, 246, -10],
    [314, 222, 0],
    [334, 268, -20],
    [290, 272, 20],
    [316, 272, 0],
  ]
    .map(
      ([x, y, t]) =>
        `<ellipse cx="${x}" cy="${y}" rx="3" ry="5" transform="rotate(${t} ${x} ${y})" fill="${INK}"/>`,
    )
    .join("");
  return lean(
    10,
    solid(
      look,
      "melon",
      wedge,
      "#ff4f64",
      [
        `<path d="M318 186L356 280L340 296L318 200Z" fill="#e0384e"/>`,
        seeds,
        `<path d="M248 292Q306 326 366 280" stroke="#2f9a46" stroke-width="30" fill="none"/>`,
        `<path d="M254 278Q306 308 360 270" stroke="#e4f7b4" stroke-width="8" fill="none"/>`,
        `<path d="M300 222l10-20" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity="0.8"/>`,
      ].join(""),
    ),
  );
}

function map(look: Look): string {
  const panels: Array<[string, string]> = [
    ["M286 226L314 220V292L286 298Z", "#f6e6b4"],
    ["M314 220L342 226V298L314 292Z", "#e2c886"],
    ["M342 226L370 220V292L342 298Z", "#f6e6b4"],
  ];
  return lean(
    -4,
    [
      panels.map(([d, fill]) => `<path d="${d}" fill="${fill}" ${OUTLINE}/>`).join(""),
      solid(
        look,
        "map-island",
        `<path d="M320 244q10-12 22-4q12 2 10 14q-4 12-18 10q-14 2-14-20Z"/>`,
        "#7cc46a",
        "",
        THIN,
      ),
      `<path d="M296 284Q300 262 318 262T358 236" stroke="#d8402f" stroke-width="3.5" stroke-dasharray="5 5" fill="none" stroke-linecap="round"/>`,
      `<path d="M354 228l10 10M364 228l-10 10" stroke="#d8402f" stroke-width="4.5" stroke-linecap="round"/>`,
    ].join(""),
  );
}

function compass(look: Look): string {
  return [
    rod("M306 216a9 9 0 1 1 0.1 0", GOLD, 4, 10),
    `<rect x="299" y="210" width="14" height="10" rx="3" fill="${GOLD_SHADE}" ${THIN}/>`,
    blob(look, "compass", `<circle cx="306" cy="252" r="36"/>`, GOLD, GOLD_SHADE),
    `<circle cx="306" cy="252" r="26" fill="#fdf6e3" ${THIN}/>`,
    `<path d="M306 230v6M306 268v6M284 252h6M322 252h6" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`,
    `<path d="M306 232L313 252H299Z" fill="#e8413a" ${THIN}/>`,
    `<path d="M306 272L313 252H299Z" fill="#d9e2ea" ${THIN}/>`,
    `<circle cx="306" cy="252" r="3.5" fill="${INK}"/>`,
    gleam(290, 232, 4, 7, 40),
  ].join("");
}

function spyglass(look: Look): string {
  const tube = (key: string, x: number, w: number, h: number, fill: string, shade: string) =>
    blob(
      look,
      key,
      `<rect x="${x}" y="${-h / 2}" width="${w}" height="${h}" rx="3"/>`,
      fill,
      shade,
      `<rect x="${x}" y="${-h / 2 + 4}" width="${w}" height="3" fill="#fff" opacity="0.7"/>`,
    );
  return `<g transform="translate(${PAW.x} ${PAW.y}) rotate(-52)">${[
    tube("spy0", -30, 34, 16, "#6b3f24", "#4a2a16"),
    tube("spy1", 2, 42, 22, GOLD, GOLD_SHADE),
    tube("spy2", 42, 42, 28, GOLD, GOLD_SHADE),
    tube("spy3", 82, 36, 34, "#6b3f24", "#4a2a16"),
    tube("spy4", 116, 12, 40, GOLD, GOLD_SHADE),
  ].join("")}</g>`;
}

function lantern(look: Look): string {
  return [
    rod("M298 326L336 186Q352 172 360 192", WOOD, 6, 13),
    `<circle cx="358" cy="246" r="52" fill="#ffe680" opacity="0.35"/>`,
    `<path d="M346 214Q358 172 370 214" stroke="${INK}" stroke-width="4" fill="none"/>`,
    blob(
      look,
      "lantern",
      `<rect x="340" y="222" width="36" height="46" rx="5"/>`,
      "#ffd24a",
      "#f2a93a",
      `<path d="M358 232q10 14 0 26q-10-12 0-26Z" fill="#ff7a2a"/><path d="M358 244q4 6 0 12q-4-6 0-12Z" fill="#fff6c0"/><path d="M349 222v46M367 222v46" stroke="${INK}" stroke-width="3"/>`,
    ),
    `<path d="M342 224l6-12h20l6 12Z" fill="#3b3f4a" ${OUTLINE}/>`,
    `<rect x="336" y="266" width="44" height="10" rx="3" fill="#3b3f4a" ${OUTLINE}/>`,
  ].join("");
}

function walkieTalkie(look: Look): string {
  return lean(
    6,
    [
      `<rect x="292" y="170" width="11" height="52" rx="5.5" fill="#2c2c34" ${OUTLINE}/>`,
      `<rect x="314" y="206" width="9" height="14" rx="3" fill="#2c2c34" ${THIN}/>`,
      blob(
        look,
        "walkie",
        `<rect x="284" y="216" width="46" height="106" rx="10"/>`,
        "#f2b630",
        "#cf8a1c",
      ),
      `<rect x="293" y="228" width="28" height="18" rx="3" fill="#9fe0a8" ${THIN}/>`,
      `<path d="M296 256h22M296 264h22M296 272h22" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>`,
      gleam(298, 233, 4, 2),
    ].join(""),
  );
}

function magnifyingGlass(look: Look): string {
  return [
    rod("M294 326L320 258", "#7a3e22", 10, 18),
    `<path d="M314 266l10 4" stroke="${INK}" stroke-width="3"/>`,
    solid(
      look,
      "lens",
      `<circle cx="334" cy="222" r="30"/>`,
      "#c9ecff",
      `<circle cx="344" cy="232" r="30" fill="#9fd6f5"/><path d="M314 220a20 20 0 0 1 16-18" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round"/><circle cx="346" cy="236" r="3" fill="#fff"/>`,
    ),
    `<circle cx="334" cy="222" r="30" fill="none" stroke="${INK}" stroke-width="15"/>`,
    `<circle cx="334" cy="222" r="30" fill="none" stroke="#3b3f4a" stroke-width="6"/>`,
  ].join("");
}

function feather(look: Look): string {
  const vane = `<path d="M306 292C278 262 280 196 312 158C336 200 336 262 306 292Z"/>`;
  return lean(
    18,
    [
      blob(
        look,
        "feather",
        vane,
        "#4fb7e5",
        "#2f86b8",
        `<path d="M310 160Q300 230 306 300" stroke="#fff" stroke-width="7" fill="none"/><path d="M286 214l14 6M282 246l18 4M330 204l-16 8M332 240l-18 6" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/><path d="M296 180q12 16 6 24" fill="#e8f7ff"/>`,
      ),
      rod("M306 292L304 326", "#fff", 4, 10),
    ].join(""),
  );
}

function seashell(look: Look): string {
  const [cx, cy, r] = [306, 296, 60];
  const steps = 6;
  const angle = (i: number) => ((-150 + (120 * i) / steps) * Math.PI) / 180;
  const at = (i: number, radius: number) =>
    `${(cx + radius * Math.cos(angle(i))).toFixed(1)} ${(cy + radius * Math.sin(angle(i))).toFixed(1)}`;
  let edge = `M${cx} ${cy}L${at(0, r)}`;
  for (let i = 0; i < steps; i++) {
    edge += `Q${at(i + 0.5, r + 14)} ${at(i + 1, r)}`;
  }
  const ribs = Array.from({ length: steps - 1 }, (_, i) => `M${cx} ${cy}L${at(i + 1, r - 2)}`).join(
    "",
  );
  return [
    blob(
      look,
      "shell",
      `<path d="${edge}Z"/>`,
      "#ffb08a",
      "#f0805a",
      `<path d="${ribs}" stroke="#c9583a" stroke-width="3.5" fill="none" stroke-linecap="round"/>`,
    ),
    `<path d="M288 300l-6-12h48l-6 12Z" fill="#f0805a" ${THIN}/>`,
    gleam(278, 250, 4, 8, 50),
  ].join("");
}

function cactusPot(look: Look): string {
  return [
    rod("M297 240H286V218", "#4cb35a", 9, 17),
    rod("M318 228H330V206", "#4cb35a", 9, 17),
    blob(
      look,
      "cactus",
      `<rect x="292" y="190" width="28" height="74" rx="14"/>`,
      "#4cb35a",
      "#2f8a40",
    ),
    `<path d="M300 210l-5-2M314 222l5-2M300 238l-5-2M314 250l5-2M284 230l-5 0M332 216l5 0" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>`,
    `<g fill="#ff6fa8" ${THIN}><circle cx="306" cy="182" r="6"/><circle cx="298" cy="188" r="6"/><circle cx="314" cy="188" r="6"/></g><circle cx="306" cy="189" r="4" fill="#ffe04a"/>`,
    blob(look, "pot", `<path d="M282 266H330L322 322H290Z"/>`, "#e0703f", "#b9502a"),
    `<rect x="276" y="256" width="60" height="16" rx="4" fill="#e0703f" ${OUTLINE}/>`,
  ].join("");
}

function balloon(look: Look): string {
  return [
    `<path d="M304 300C290 262 332 236 318 206C308 186 336 178 338 164" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
    `<path d="M332 168l6-10l7 10Z" fill="#d62f42" ${THIN}/>`,
    blob(look, "balloon", `<ellipse cx="340" cy="116" rx="38" ry="44"/>`, "#ff4a5c", "#d62f42"),
    gleam(322, 96, 7, 13, 30),
  ].join("");
}

function iceCreamCone(look: Look): string {
  const scoop = (cx: number, top: number, w: number) => {
    const half = w / 2;
    const bottom = top + w * 0.72;
    const step = w / 4;
    return `<path d="M${cx - half} ${bottom}C${cx - half - 4} ${top} ${cx + half + 4} ${top} ${cx + half} ${bottom}q${-step / 2} 8 ${-step} 0q${-step / 2} 8 ${-step} 0q${-step / 2} 8 ${-step} 0q${-step / 2} 8 ${-step} 0Z"/>`;
  };
  return lean(
    10,
    [
      blob(
        look,
        "cone",
        `<path d="M282 250H330L306 334Z"/>`,
        "#e9ad5c",
        "#c98838",
        `<path d="M282 260l40 40M282 284l30 30M296 250l34 34M312 250l20 20M330 262l-48 48M330 286l-40 40M318 250l-36 36M302 250l-20 20" stroke="#a96a28" stroke-width="3"/>`,
      ),
      blob(look, "scoop1", scoop(306, 214, 58), "#9de8c4", "#5fc79c"),
      blob(look, "scoop2", scoop(306, 182, 48), "#ff9ec4", "#ec6f9f"),
      `<path d="M310 176q2-10 10-14" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
      `<circle cx="308" cy="180" r="8" fill="#e8283c" ${THIN}/>`,
      gleam(292, 196, 4, 6, 30),
    ].join(""),
  );
}

function taco(look: Look): string {
  return lean(
    16,
    [
      `<path d="M262 246q4-14 14-8q6-14 16-4q8-12 18-2q10-10 18 2q10-8 16 6q12-2 12 10Z" fill="#6cc24a" ${OUTLINE}/>`,
      `<circle cx="288" cy="236" r="7" fill="#ef3e36" ${THIN}/><circle cx="322" cy="234" r="7" fill="#ef3e36" ${THIN}/><path d="M300 238q6-10 14 0" fill="#8a4a24" ${THIN}/>`,
      blob(
        look,
        "taco",
        `<path d="M260 244A47 47 0 0 0 354 244Z"/>`,
        "#f7c548",
        "#dc9a2a",
        `<g fill="#e8a83a"><circle cx="286" cy="262" r="3"/><circle cx="312" cy="272" r="3"/><circle cx="330" cy="256" r="3"/><circle cx="300" cy="282" r="2.5"/></g>`,
      ),
      `<path d="M270 252q4 10 12 18" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.8"/>`,
    ].join(""),
  );
}

function pizzaSlice(look: Look): string {
  return lean(
    14,
    [
      blob(
        look,
        "pizza",
        `<path d="M304 314L270 204Q312 186 352 204Z"/>`,
        "#ffcf47",
        "#f0a830",
        `<g fill="#d6402e" ${THIN}><circle cx="298" cy="232" r="10"/><circle cx="326" cy="226" r="9"/><circle cx="310" cy="266" r="9"/></g>`,
      ),
      `<path d="M330 260q4 14-2 20q-6-6-2-20Z" fill="#ffcf47" ${THIN}/>`,
      rod("M266 204Q312 182 356 204", "#d98a3c", 12, 20),
      `<path d="M280 196q14-6 26-7" stroke="#fff" stroke-width="3.5" fill="none" stroke-linecap="round" opacity="0.7"/>`,
    ].join(""),
  );
}

function egg(look: Look): string {
  return [
    blob(
      look,
      "egg",
      `<path d="M306 196C330 196 342 236 340 256C338 282 322 298 306 298C290 298 274 282 272 256C270 236 282 196 306 196Z"/>`,
      "#fff3dc",
      "#ead2a8",
      `<g fill="#c99a6a"><circle cx="296" cy="220" r="3"/><circle cx="318" cy="232" r="2.5"/><circle cx="290" cy="252" r="2.5"/><circle cx="326" cy="258" r="3"/><circle cx="308" cy="246" r="2"/></g>`,
    ),
    gleam(290, 222, 5, 10, 25),
  ].join("");
}

function tinyShovel(look: Look): string {
  return lean(
    14,
    [
      rod("M305 332V244", WOOD, 9, 16),
      blob(
        look,
        "shovel",
        `<path d="M281 244V206Q281 190 305 168Q329 190 329 206V244Q305 254 281 244Z"/>`,
        "#cfd8e0",
        "#97a6b4",
        `<path d="M276 186q29 12 58 0V150H276Z" fill="#7a5233"/><path d="M305 196V240" stroke="#97a6b4" stroke-width="5" stroke-linecap="round"/>`,
      ),
      `<rect x="294" y="240" width="22" height="12" rx="3" fill="#e04a3a" ${THIN}/>`,
      gleam(296, 214, 3, 10),
    ].join(""),
  );
}

function gem(look: Look): string {
  return [
    solid(
      look,
      "gem",
      `<path d="M274 238L292 214H324L340 238L307 298Z"/>`,
      "#b066ff",
      [
        `<path d="M292 214L300 238H274ZM324 214L316 238H340Z" fill="#d6a8ff"/>`,
        `<path d="M316 238H340L307 298Z" fill="#7d3bd1"/>`,
        `<path d="M300 238L307 298L316 238Z" fill="#9a52ea"/>`,
        `<path d="M274 238H340M292 214L300 238L307 298L316 238L324 214" stroke="${INK}" stroke-width="3" fill="none" stroke-linejoin="round"/>`,
      ].join(""),
    ),
    gleam(290, 228, 3, 6, 40),
    `<path d="M350 200l3 8l8 3l-8 3l-3 8l-3-8l-8-3l8-3Z" fill="#fff" ${THIN}/>`,
  ].join("");
}

function goldenKey(look: Look): string {
  const ring = "M54 0a22 22 0 1 0 44 0a22 22 0 1 0-44 0ZM67 0a9 9 0 1 1 18 0a9 9 0 1 1-18 0Z";
  return `<g transform="translate(${PAW.x} ${PAW.y}) rotate(-60)">${[
    blob(look, "key", `<path d="M-46 -6H58V6H-24V20H-33V12H-39V20H-46Z"/>`, GOLD, GOLD_SHADE),
    `<rect x="40" y="-10" width="9" height="20" rx="3" fill="${GOLD_SHADE}" ${THIN}/>`,
    `<path d="${ring}" fill-rule="evenodd" fill="${GOLD}" ${OUTLINE}/>`,
    `<path d="M62 -10a14 14 0 0 1 12-10" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" opacity="0.85"/>`,
  ].join("")}</g>`;
}

function scroll(look: Look): string {
  const roll = (key: string, y: number) =>
    blob(
      look,
      key,
      `<rect x="276" y="${y}" width="80" height="16" rx="8"/>`,
      "#f1dca8",
      "#d6b878",
    ) +
    `<circle cx="274" cy="${y + 8}" r="6" fill="#8b5a2b" ${THIN}/><circle cx="358" cy="${y + 8}" r="6" fill="#8b5a2b" ${THIN}/>`;
  return lean(
    12,
    [
      blob(
        look,
        "paper",
        `<rect x="284" y="200" width="64" height="88"/>`,
        "#fbf0d2",
        "#ecd9a8",
        `<path d="M294 218h44M294 230h36M294 242h44M294 254h28" stroke="#8b5a2b" stroke-width="3" stroke-linecap="round"/><circle cx="330" cy="268" r="8" fill="#d0343c" ${THIN}/>`,
      ),
      roll("roll-top", 188),
      roll("roll-bottom", 284),
    ].join(""),
  );
}

function hourglass(look: Look): string {
  const glass =
    "M290 204C290 236 302 238 302 248C302 258 290 260 290 290H322C322 260 310 258 310 248C310 238 322 236 322 204Z";
  return lean(
    8,
    [
      `<rect x="282" y="202" width="7" height="90" fill="${WOOD}" ${THIN}/><rect x="323" y="202" width="7" height="90" fill="${WOOD}" ${THIN}/>`,
      solid(
        look,
        "hourglass",
        `<path d="${glass}"/>`,
        "#dff3ff",
        [
          `<path d="M290 226Q306 232 322 226L310 248H302Z" fill="#f2b84b"/>`,
          `<path d="M306 248V280" stroke="#f2b84b" stroke-width="2.5"/>`,
          `<path d="M288 292Q306 262 324 292Z" fill="#f2b84b"/>`,
          `<path d="M295 212q0 12 4 18" stroke="#fff" stroke-width="3.5" fill="none" stroke-linecap="round"/>`,
        ].join(""),
        THIN,
      ),
      `<rect x="276" y="192" width="60" height="13" rx="4" fill="${WOOD}" ${OUTLINE}/>`,
      `<rect x="276" y="288" width="60" height="13" rx="4" fill="${WOOD}" ${OUTLINE}/>`,
      `<path d="M282 197h24" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity="0.6"/>`,
    ].join(""),
  );
}

function microphone(look: Look): string {
  const head = `<circle cx="306" cy="218" r="26"/>`;
  return lean(
    10,
    [
      blob(look, "mic-handle", `<path d="M292 248H320L316 334H296Z"/>`, "#3a3f4e", "#262a35"),
      `<rect x="288" y="238" width="36" height="14" rx="4" fill="#ff5a7a" ${OUTLINE}/>`,
      blob(
        look,
        "mic",
        head,
        "#d3dae2",
        "#9aa6b4",
        `<path d="M270 200l70 70M270 220l60 60M270 240l40 40M280 190l60 60M300 190l40 40M320 190l20 20M342 200l-70 70M342 220l-60 60M342 240l-40 40M330 190l-60 60M310 190l-40 40M290 190l-20 20" stroke="${INK}" stroke-width="1.6" opacity="0.4"/>`,
      ),
      gleam(296, 206, 5, 8, 40),
    ].join(""),
  );
}

function fishingRod(look: Look): string {
  return [
    `<path d="M386 44V204" stroke="${INK}" stroke-width="2.5"/>`,
    solid(
      look,
      "bobber",
      `<circle cx="386" cy="214" r="12"/>`,
      "#fff",
      `<rect x="370" y="214" width="32" height="16" fill="#e8413a"/>`,
      THIN,
    ),
    rod("M292 332L386 44", "#2f5fd0", 5, 11),
    `<g fill="none" stroke="${INK}" stroke-width="3"><circle cx="350" cy="148" r="4"/><circle cx="370" cy="88" r="3.5"/></g>`,
    rod("M296 320L314 264", "#d9a066", 11, 18),
    `<circle cx="326" cy="270" r="12" fill="#c9d1da" ${OUTLINE}/><circle cx="326" cy="270" r="4" fill="#3b3f4a"/><path d="M326 270l12 6" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
  ].join("");
}

function bubbleWand(look: Look): string {
  const bubble = (x: number, y: number, r: number) =>
    `<circle cx="${x}" cy="${y}" r="${r}" fill="#d6f6ff" fill-opacity="0.5" ${THIN}/><path d="M${x - r * 0.6} ${y - r * 0.1}a${r * 0.6} ${r * 0.6} 0 0 1 ${r * 0.5} ${-r * 0.5}" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  return [
    rod("M300 330L322 234", "#ff7bc0", 6, 13),
    solid(
      look,
      "film",
      `<circle cx="328" cy="208" r="24"/>`,
      "#c8f0ff",
      `<path d="M308 214a22 22 0 0 0 30 14" stroke="#ffb3e0" stroke-width="5" fill="none"/><path d="M312 200a18 18 0 0 1 12-12" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/>`,
      "",
    ),
    `<circle cx="328" cy="208" r="24" fill="none" stroke="${INK}" stroke-width="13"/><circle cx="328" cy="208" r="24" fill="none" stroke="#ff7bc0" stroke-width="6"/>`,
    bubble(368, 160, 17),
    bubble(342, 126, 10),
    bubble(384, 112, 8),
    bubble(318, 150, 7),
  ].join("");
}

const each = 0.48 / 27;

export const PAWS: readonly TraitValue[] = [
  { name: "Empty Paws", share: 0.25, draw: () => "" },
  { name: "Beetle", share: 0.15, draw: beetle },
  { name: "NEAR Coin", share: 0.12, draw: nearCoin },
  { name: "Coffee Mug", share: each, draw: coffeeMug },
  { name: "Scorpion", share: each, draw: scorpion },
  { name: "Grub on a Stick", share: each, draw: grubOnAStick },
  { name: "Lollipop", share: each, draw: lollipop },
  { name: "Watermelon Slice", share: each, draw: watermelonSlice },
  { name: "Map", share: each, draw: map },
  { name: "Compass", share: each, draw: compass },
  { name: "Spyglass", share: each, draw: spyglass },
  { name: "Lantern", share: each, draw: lantern },
  { name: "Walkie-Talkie", share: each, draw: walkieTalkie },
  { name: "Magnifying Glass", share: each, draw: magnifyingGlass },
  { name: "Feather", share: each, draw: feather },
  { name: "Seashell", share: each, draw: seashell },
  { name: "Cactus Pot", share: each, draw: cactusPot },
  { name: "Balloon", share: each, draw: balloon },
  { name: "Ice Cream Cone", share: each, draw: iceCreamCone },
  { name: "Taco", share: each, draw: taco },
  { name: "Pizza Slice", share: each, draw: pizzaSlice },
  { name: "Egg", share: each, draw: egg },
  { name: "Tiny Shovel", share: each, draw: tinyShovel },
  { name: "Gem", share: each, draw: gem },
  { name: "Golden Key", share: each, draw: goldenKey },
  { name: "Scroll", share: each, draw: scroll },
  { name: "Hourglass", share: each, draw: hourglass },
  { name: "Microphone", share: each, draw: microphone },
  { name: "Fishing Rod", share: each, draw: fishingRod },
  { name: "Bubble Wand", share: each, draw: bubbleWand },
];
