/**
 * Eyes: what sits in the dark patches. Plain eyes stay inside the patches;
 * eyewear is big and bold, spanning both eyes but leaving the nose and mouth.
 */
import { EYE_L, EYE_R, INK, type Look, type TraitValue, tint } from "../canvas.ts";

type Side = -1 | 1;
interface At {
  x: number;
  y: number;
}

const WHITE = "#fffaf0";
const GOLD = "#f4c542";
const GOLD_SHADE = "#c8901f";

/** Draws something once per eye: side -1 is the kat's right (the viewer's left). */
const pair = (draw: (at: At, side: Side) => string) => draw(EYE_L, -1) + draw(EYE_R, 1);

/** The same drawing on the left and, mirrored, on the right of the face. */
const mirror = (svg: string) => `${svg}<g transform="matrix(-1 0 0 1 400 0)">${svg}</g>`;

/** A line that stays readable on dark patches: a pale under-stroke, the ink line on top. */
const inkLine = (d: string, width: number, halo: string) =>
  `<path d="${d}" fill="none" stroke="${halo}" stroke-width="${width + 5}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${INK}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;

/** A plain ink line. */
const line = (d: string, width: number) =>
  `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;

/** A ring with an ink border, for frames and rims. */
const ring = (d: string, color: string, width: number) =>
  `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${width + 5}" stroke-linejoin="round" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"/>`;

const circle = (x: number, y: number, r: number) =>
  `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

/** A four-point sparkle. */
const sparkle = (x: number, y: number, s: number, fill = "#fff") =>
  `<path d="M${x} ${y - s}Q${x} ${y} ${x + s} ${y}Q${x} ${y} ${x} ${y + s}Q${x} ${y} ${x - s} ${y}Q${x} ${y} ${x} ${y - s}Z" fill="${fill}"/>`;

/** A star's outline, `points` points round (cx, cy). */
function starPath(cx: number, cy: number, outer: number, inner: number, points = 5): string {
  const at = Array.from({ length: points * 2 }, (_, i) => {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    return `${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`;
  });
  return `M${at.join("L")}Z`;
}

/**
 * An outlined eyeball with whatever is inside it (iris, lids) clipped to it,
 * so pupils can roll to the edge and lids can droop without spilling.
 */
function eyeball(
  look: Look,
  key: string,
  { x, y }: At,
  inner: string,
  { rx = 22, ry = 26, fill = WHITE } = {},
): string {
  const id = `${look.id}eye-${key}`;
  const shape = `cx="${x}" cy="${y}" rx="${rx}" ry="${ry}"`;
  return `<clipPath id="${id}"><ellipse ${shape}/></clipPath><ellipse ${shape} fill="${fill}"/><g clip-path="url(#${id})">${inner}</g><ellipse ${shape} fill="none" stroke="${INK}" stroke-width="4"/>`;
}

/** Iris, pupil and the two catchlights, centred at (x, y). */
const iris = (x: number, y: number, color: string, size = 1) =>
  `<ellipse cx="${x}" cy="${y}" rx="${14 * size}" ry="${17 * size}" fill="${color}"/><ellipse cx="${x}" cy="${y + 2}" rx="${8 * size}" ry="${10 * size}" fill="#120b07"/><circle cx="${x - 7 * size}" cy="${y - 9 * size}" r="${5.5 * size}" fill="#fff"/><circle cx="${x + 5 * size}" cy="${y + 7 * size}" r="${2.5 * size}" fill="#fff"/>`;

const BROWN = "#3b2a1e";

/**
 * The burrow meerkat's blue-grey eye, drawn the way the reference draws eyes:
 * a glossy iris deep at the top and bright at the bottom, a big pupil, two
 * catchlights and a heavy upper lash line, turned a little towards the nose.
 */
const round = (look: Look, at: At, key: string, inward: 1 | -1) => {
  const { x, y } = at;
  const grad = `${look.id}iris-${key}`;
  const ix = x + inward * 5;
  return [
    eyeball(
      look,
      key,
      at,
      [
        `<linearGradient id="${grad}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f4a52"/><stop offset="0.55" stop-color="#4f97a2"/><stop offset="1" stop-color="#a6e4e8"/></linearGradient>`,
        `<ellipse cx="${ix}" cy="${y + 5}" rx="24" ry="33" fill="url(#${grad})"/>`,
        `<ellipse cx="${ix}" cy="${y + 5}" rx="24" ry="33" fill="none" stroke="#173a40" stroke-width="2.5"/>`,
        `<ellipse cx="${ix + inward}" cy="${y + 4}" rx="12" ry="18" fill="#0f1d20"/>`,
        // a soft bright ring at the bottom of the iris
        `<path d="M${ix - 18} ${y + 20}Q${ix} ${y + 40} ${ix + 18} ${y + 20}Q${ix} ${y + 32} ${ix - 18} ${y + 20}Z" fill="#d8fbfb" opacity="0.6"/>`,
        // the catchlights
        `<ellipse cx="${ix - inward * 9}" cy="${y - 10}" rx="9" ry="10" fill="#fff"/>`,
        `<circle cx="${ix + inward * 9}" cy="${y + 15}" r="4.5" fill="#fff"/>`,
        `<path d="M${ix + inward * 14} ${y - 14}l${inward * 4} 7" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity="0.8"/>`,
      ].join(""),
      { rx: 30, ry: 41 },
    ),
    // a bold lash line hugging the top of the eye, thick in the middle, with a
    // flick at the outer corner; a filled shape, so outline thinning leaves it bold
    `<path d="M${x - inward * 32} ${y - 2}C${x - inward * 30} ${y - 40} ${x + inward * 26} ${y - 50} ${x + inward * 33} ${y - 12}C${x + inward * 24} ${y - 38} ${x - inward * 22} ${y - 34} ${x - inward * 32} ${y - 2}Z" fill="${INK}"/>`,
    `<path d="M${x - inward * 28} ${y - 22}L${x - inward * 42} ${y - 30}L${x - inward * 32} ${y - 12}Z" fill="${INK}"/>`,
  ].join("");
};

const roundPair = (look: Look) => round(look, EYE_L, "rl", 1) + round(look, EYE_R, "rr", -1);

/** Brows that read on any patch: pale, outlined, from the outer end to the inner. */
const brow = (look: Look, d: string) =>
  `<path d="${d}" fill="${look.fur.belly}" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>`;

/** A lid of the patch's colour over everything above `edge`, with its ink rim. */
const lid = (look: Look, x: number, y: number, edge: string) =>
  `<path d="M${x - 30} ${y - 34}H${x + 30}L${edge.replace(/^M/, "")}Z" fill="${tint(look.fur.patch, 0.22)}"/>`;

// ---- the plain eyes ----

const sleepy = (look: Look) =>
  pair((at, side) => {
    const { x, y } = at;
    const edge = `M${x + 26} ${y - 1}Q${x} ${y + 12} ${x - 26} ${y - 1}`;
    return (
      eyeball(look, `s${side}`, at, iris(x + 1, y + 10, BROWN, 0.9) + lid(look, x, y, edge)) +
      line(`M${x - 22} ${y + 1}Q${x} ${y + 12} ${x + 22} ${y + 1}`, 4) +
      line(`M${x + side * 20} ${y + 4}l${side * 8} 3`, 3)
    );
  });

const bright = (look: Look) =>
  pair((at, side) => {
    const { x, y } = at;
    const inner = [
      `<ellipse cx="${x}" cy="${y + 3}" rx="19" ry="23" fill="#1f5fae"/>`,
      `<ellipse cx="${x}" cy="${y + 7}" rx="16" ry="18" fill="#3f9cf0"/>`,
      `<ellipse cx="${x}" cy="${y + 17}" rx="10" ry="6" fill="#a8e6ff"/>`,
      `<ellipse cx="${x}" cy="${y + 5}" rx="8" ry="10" fill="#0b1530"/>`,
      `<ellipse cx="${x - 8}" cy="${y - 8}" rx="8" ry="7" fill="#fff"/>`,
      `<circle cx="${x + 7}" cy="${y + 12}" r="3" fill="#fff"/>`,
      sparkle(x + 8, y - 6, 5),
    ].join("");
    return (
      eyeball(look, `b${side}`, at, inner, { rx: 25, ry: 30 }) +
      `<path d="M${x + side * 16} ${y - 24}q${side * 10} -6 ${side * 16} -14l${side * 2} 8q${side * -6} 8 ${side * -12} 12Z" fill="${INK}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`
    );
  });

// ---- glances ----

const sideEye = (look: Look) =>
  pair((at, side) => {
    const { x, y } = at;
    const edge = `M${x + 26} ${y - 8}L${x - 26} ${y - 6}`;
    return (
      eyeball(look, `se${side}`, at, iris(x + 10, y + 6, BROWN, 0.8) + lid(look, x, y, edge)) +
      line(`M${x - 22} ${y - 6}L${x + 22} ${y - 8}`, 4)
    );
  });

const crossed = (look: Look) =>
  pair((at, side) => eyeball(look, `x${side}`, at, iris(at.x - side * 11, at.y + 5, BROWN, 0.85)));

const angry = (look: Look) =>
  pair((at, side) => {
    const { x, y } = at;
    // the lid slopes down towards the nose
    const edge = `M${x + 26} ${y + (side > 0 ? -14 : 0)}L${x - 26} ${y + (side > 0 ? 0 : -14)}`;
    const browD = `M${x + side * 32} ${y - 44}L${x - side * 26} ${y - 26}L${x - side * 22} ${y - 16}L${x + side * 30} ${y - 32}Z`;
    return (
      eyeball(
        look,
        `a${side}`,
        at,
        iris(x - side * 2, y + 6, "#7a1d12", 0.75) + lid(look, x, y, edge),
      ) +
      line(`M${x + side * 22} ${y - 13}L${x - side * 22} ${y + 1}`, 4) +
      brow(look, browD)
    );
  });

const teary = (look: Look) =>
  pair((at, side) => {
    const { x, y } = at;
    const inner = [
      `<ellipse cx="${x}" cy="${y + 2}" rx="17" ry="20" fill="${BROWN}"/>`,
      `<ellipse cx="${x}" cy="${y + 4}" rx="11" ry="13" fill="#120b07"/>`,
      `<circle cx="${x - 7}" cy="${y - 8}" r="7" fill="#fff"/>`,
      `<circle cx="${x + 6}" cy="${y + 6}" r="3.5" fill="#fff"/>`,
      `<path d="M${x - 30} ${y + 16}Q${x - 12} ${y + 10} ${x} ${y + 15}Q${x + 12} ${y + 20} ${x + 30} ${y + 14}V${y + 40}H${x - 30}Z" fill="#7cd0ff" opacity="0.85"/>`,
      `<path d="M${x - 14} ${y + 18}q6 -3 12 0" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round"/>`,
    ].join("");
    const tx = x + side * 14;
    const drop = (dy: number, s: number) =>
      `<path d="M${tx} ${y + dy}q${7 * s} ${10 * s} ${7 * s} ${15 * s}a${7 * s} ${7 * s} 0 0 1 ${-14 * s} 0q0 ${-5 * s} ${7 * s} ${-15 * s}Z" fill="#7cd0ff" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><circle cx="${tx - 2 * s}" cy="${y + dy + 15 * s}" r="${2 * s}" fill="#fff"/>`;
    const browD = `M${x + side * 28} ${y - 34}L${x - side * 18} ${y - 46}L${x - side * 20} ${y - 37}L${x + side * 26} ${y - 26}Z`;
    return eyeball(look, `t${side}`, at, inner) + drop(26, 1) + drop(52, 0.7) + brow(look, browD);
  });

const wink = (look: Look) => {
  const { x, y } = EYE_R;
  return (
    round(look, EYE_L, "wl", 1) +
    inkLine(`M${x - 21} ${y + 6}Q${x} ${y - 18} ${x + 21} ${y + 6}`, 7, look.fur.belly) +
    `<path d="${starPath(x + 32, y - 30, 12, 3.5, 4)}" fill="#ffe066" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>`
  );
};

// ---- odd eyes ----

const hearts = (look: Look) =>
  pair(({ x, y }, side) => {
    const heart =
      "M0 22C-14 12-29 2-29-10C-29-22-17-29-8-26C-3-25 0-20 0-16C0-20 3-25 8-26C17-29 29-22 29-10C29 2 14 12 0 22Z";
    const id = `${look.id}heart${side}`;
    return `<g transform="translate(${x} ${y + 2})"><clipPath id="${id}"><path d="${heart}"/></clipPath><path d="${heart}" fill="#ff3d64"/><path d="M8 20C20 8 32 0 28-16L40-16V30Z" fill="#c81e48" clip-path="url(#${id})"/><path d="${heart}" fill="none" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><ellipse cx="-15" cy="-13" rx="7" ry="4.5" transform="rotate(-35 -15 -13)" fill="#fff"/><circle cx="-6" cy="-18" r="2" fill="#fff"/></g>`;
  });

const stars = (look: Look) =>
  pair(({ x, y }, side) => {
    const d = starPath(x, y + 2, 31, 13);
    const id = `${look.id}star${side}`;
    return `<clipPath id="${id}"><path d="${d}"/></clipPath><path d="${d}" fill="#ffd83b"/><path d="M${x} ${y + 2}L${x + 40} ${y - 10}V${y + 40}H${x - 30}Z" fill="#f2a20c" clip-path="url(#${id})"/><path d="${d}" fill="none" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><ellipse cx="${x - 7}" cy="${y - 6}" rx="4" ry="6" transform="rotate(30 ${x - 7} ${y - 6})" fill="#fff"/>`;
  });

const spiral = (look: Look) =>
  pair((at, side) => {
    const turns = 3.2;
    const points = Array.from({ length: 80 }, (_, i) => {
      const t = (i / 79) * turns * 2 * Math.PI;
      const r = 1 + (t / (turns * 2 * Math.PI)) * 19;
      const a = side * t;
      return `${(at.x + r * Math.cos(a)).toFixed(1)} ${(at.y + 1 + r * Math.sin(a) * 1.15).toFixed(1)}`;
    });
    return eyeball(
      look,
      `sp${side}`,
      at,
      `<path d="M${points.join("L")}" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>`,
    );
  });

const moon = (look: Look) =>
  pair((at, side) => {
    const { x, y } = at;
    const inner = [
      `<ellipse cx="${x}" cy="${y + 12}" rx="22" ry="12" fill="#2b3f86"/>`,
      `<circle cx="${x - 2}" cy="${y + 1}" r="15" fill="#ffd95a"/>`,
      `<circle cx="${x - 9}" cy="${y + 7}" r="3" fill="#e9b93a"/>`,
      `<circle cx="${x + 6}" cy="${y - 4}" r="13" fill="#17224f"/>`,
      sparkle(x + 9, y + 12, 4),
      sparkle(x + 12, y - 14, 3),
      `<circle cx="${x - 11}" cy="${y - 14}" r="1.5" fill="#fff"/>`,
    ].join("");
    return eyeball(look, `m${side}`, at, inner, { fill: "#17224f" });
  });

const mismatched = (look: Look) =>
  pair((at, side) => {
    const [deep, light] = side < 0 ? ["#1e63b8", "#4fb3ff"] : ["#a35a00", "#ffb32c"];
    const { x, y } = at;
    const inner = [
      `<ellipse cx="${x + 2}" cy="${y + 3}" rx="16" ry="19" fill="${deep}"/>`,
      `<ellipse cx="${x + 2}" cy="${y + 7}" rx="13" ry="14" fill="${light}"/>`,
      `<ellipse cx="${x + 2}" cy="${y + 5}" rx="6" ry="9" fill="#120b07"/>`,
      `<circle cx="${x - 5}" cy="${y - 7}" r="5.5" fill="#fff"/>`,
      `<circle cx="${x + 8}" cy="${y + 11}" r="2.5" fill="#fff"/>`,
    ].join("");
    return eyeball(look, `mm${side}`, at, inner);
  });

const glowing = (look: Look) => {
  const id = `${look.id}glow`;
  return (
    `<radialGradient id="${id}"><stop offset="0.35" stop-color="#7ff6ff" stop-opacity="0.8"/><stop offset="1" stop-color="#7ff6ff" stop-opacity="0"/></radialGradient>` +
    pair(({ x, y }, side) =>
      [
        `<ellipse cx="${x}" cy="${y}" rx="44" ry="48" fill="url(#${id})"/>`,
        eyeball(
          look,
          `g${side}`,
          { x, y },
          `<ellipse cx="${x}" cy="${y + 4}" rx="16" ry="19" fill="#e6feff"/><ellipse cx="${x}" cy="${y + 4}" rx="8" ry="10" fill="#fff"/>`,
          { fill: "#3fe0ff" },
        ),
        sparkle(x - 8, y - 10, 6),
      ].join(""),
    )
  );
};

const robot = (look: Look) =>
  pair(({ x, y }, side) => {
    const rivets = [45, 135, 225, 315]
      .map((deg) => {
        const a = (deg * Math.PI) / 180;
        return `<circle cx="${(x + 28 * Math.cos(a)).toFixed(1)}" cy="${(y + 28 * Math.sin(a)).toFixed(1)}" r="2.5" fill="#dfe5ec" stroke="${INK}" stroke-width="1.5"/>`;
      })
      .join("");
    const id = `${look.id}bolt${side}`;
    return [
      `<clipPath id="${id}"><circle cx="${x}" cy="${y}" r="34"/></clipPath>`,
      `<circle cx="${x}" cy="${y}" r="34" fill="#a7b1bd"/>`,
      `<path d="M${x + 34} ${y - 34}L${x - 34} ${y + 38}H${x + 40}Z" fill="#7c8794" clip-path="url(#${id})"/>`,
      `<circle cx="${x}" cy="${y}" r="34" fill="none" stroke="${INK}" stroke-width="4.5"/>`,
      rivets,
      `<circle cx="${x}" cy="${y}" r="21" fill="#141a22" stroke="${INK}" stroke-width="3"/>`,
      `<circle cx="${x}" cy="${y}" r="15" fill="none" stroke="#3a4656" stroke-width="2"/>`,
      `<circle cx="${x}" cy="${y}" r="9" fill="#ff3b3b"/>`,
      `<circle cx="${x}" cy="${y}" r="4" fill="#ffd2c8"/>`,
      `<circle cx="${x - 7}" cy="${y - 8}" r="3" fill="#fff" opacity="0.8"/>`,
    ].join("");
  });

/** A beam off the canvas from each eye, glowing round its edge, white-hot in its core. */
const lasers = (look: Look, color: string, deep: string) => {
  const id = `${look.id}laser`;
  const beam = ({ x, y }: At, side: Side) => {
    const [ex, ey] = [x + side * 260, y + 230];
    const len = Math.hypot(ex - x, ey - y);
    const [nx, ny] = [-(ey - y) / len, (ex - x) / len];
    const band = (w0: number, w1: number) =>
      `M${(x + nx * w0).toFixed(1)} ${(y + ny * w0).toFixed(1)}L${(ex + nx * w1).toFixed(1)} ${(ey + ny * w1).toFixed(1)}L${(ex - nx * w1).toFixed(1)} ${(ey - ny * w1).toFixed(1)}L${(x - nx * w0).toFixed(1)} ${(y - ny * w0).toFixed(1)}Z`;
    return `<path d="${band(10, 30)}" fill="${color}" opacity="0.3"/><path d="${band(6, 16)}" fill="${color}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><path d="${band(2, 6)}" fill="#fff"/>`;
  };
  const eye = ({ x, y }: At, side: Side) =>
    [
      `<circle cx="${x}" cy="${y}" r="40" fill="url(#${id})"/>`,
      eyeball(look, `l${side}`, { x, y }, `<circle cx="${x}" cy="${y + 2}" r="13" fill="#fff"/>`, {
        fill: color,
      }),
      `<path d="${starPath(x, y + 2, 34, 6, 4)}" fill="#fff" stroke="${deep}" stroke-width="2" stroke-linejoin="round"/>`,
      `<circle cx="${x}" cy="${y + 2}" r="8" fill="#fff"/>`,
    ].join("");
  return (
    `<radialGradient id="${id}"><stop offset="0.3" stop-color="${color}" stop-opacity="0.9"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>` +
    pair(beam) +
    pair(eye)
  );
};

// ---- eyewear ----

const ARM = (x0: number, x1: number, y: number, color: string, width = 5) =>
  ring(`M${x0} ${y}L${x1} ${y + 6}`, color, width);

/** Wayfarer lenses: a straight brow, a rounded bottom. Left lens; mirror it. */
const WAYFARER = "M100 150L194 152Q197 180 186 200Q174 215 150 215Q118 215 108 197Q99 178 100 150Z";

const shades = () =>
  mirror(
    [
      ARM(102, 70, 156, INK, 2),
      `<path d="${WAYFARER}" fill="#16121b" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`,
      `<path d="M108 158L134 158L114 192Q108 182 107 170Z" fill="#fff" opacity="0.28"/>`,
      `<path d="M142 158L152 158L130 206L122 202Z" fill="#fff" opacity="0.18"/>`,
      `<path d="M100 150L194 152L194 160L101 158Z" fill="#2c2733"/>`,
    ].join(""),
  ) + line("M190 160Q200 152 210 160", 6);

const goldShades = (look: Look) => {
  const id = `${look.id}goldlens`;
  return (
    `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a2a06"/><stop offset="0.55" stop-color="#c2650f"/><stop offset="1" stop-color="#ffcf4a"/></linearGradient>` +
    mirror(
      [
        ARM(102, 70, 156, GOLD, 3),
        `<path d="${WAYFARER}" fill="url(#${id})"/>`,
        `<path d="M112 160L136 160L116 196Q110 186 109 174Z" fill="#fff" opacity="0.45"/>`,
        sparkle(176, 168, 7),
        ring(WAYFARER, GOLD, 4),
        `<path d="M104 152L190 154" stroke="#fff6c4" stroke-width="2" stroke-linecap="round"/>`,
      ].join(""),
    ) +
    ring("M190 160Q200 152 210 160", GOLD, 4)
  );
};

const aviators = (look: Look) => {
  const id = `${look.id}avlens`;
  const lens = "M104 154Q150 144 190 156Q196 190 174 208Q152 222 126 210Q100 196 104 154Z";
  return (
    `<linearGradient id="${id}" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="#26307a"/><stop offset="0.5" stop-color="#7a4fc4"/><stop offset="1" stop-color="#ff9ad0"/></linearGradient>` +
    mirror(
      [
        ARM(104, 70, 156, "#d6dbe2", 2),
        `<path d="${lens}" fill="url(#${id})"/>`,
        `<path d="M116 160L138 158L118 196Q110 184 111 170Z" fill="#fff" opacity="0.5"/>`,
        sparkle(172, 170, 6),
        ring(lens, "#d6dbe2", 3),
      ].join(""),
    ) +
    ring("M188 160Q200 152 212 160", "#d6dbe2", 3) +
    ring("M178 150L222 150", "#d6dbe2", 3)
  );
};

const roundGlasses = (look: Look) =>
  roundPair(look) +
  mirror(
    [
      ARM(114, 70, 168, "#8a4b22", 3),
      `<circle cx="150" cy="182" r="36" fill="#cfefff" opacity="0.28"/>`,
      `<path d="M128 166Q136 156 148 154" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" opacity="0.85"/>`,
      ring(circle(150, 182, 36), "#8a4b22", 5),
      `<path d="M126 156Q140 146 156 146" stroke="#c98b54" stroke-width="2" fill="none" stroke-linecap="round"/>`,
    ].join(""),
  ) +
  ring("M186 176Q200 164 214 176", "#8a4b22", 4);

const monocle = (look: Look) => {
  const { x, y } = EYE_R;
  const links = Array.from({ length: 9 }, (_, i) => {
    const t = i / 8;
    const cx = x + 26 + 40 * t;
    const cy = y + 26 + 90 * t * t + 20 * t;
    return `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="4" ry="3" transform="rotate(${50 + 30 * t} ${cx.toFixed(1)} ${cy.toFixed(1)})" fill="none" stroke="${INK}" stroke-width="5"/><ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="4" ry="3" transform="rotate(${50 + 30 * t} ${cx.toFixed(1)} ${cy.toFixed(1)})" fill="none" stroke="${GOLD}" stroke-width="2"/>`;
  }).join("");
  return [
    round(look, EYE_L, "ml", 1),
    round(look, EYE_R, "mr", -1),
    links,
    `<circle cx="${x}" cy="${y}" r="33" fill="#d8f2ff" opacity="0.3"/>`,
    `<path d="M${x - 20} ${y - 14}Q${x - 12} ${y - 26} ${x + 2} ${y - 26}" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    ring(circle(x, y, 33), GOLD, 5),
    `<path d="M${x - 26} ${y - 14}Q${x - 16} ${y - 30} ${x} ${y - 31}" stroke="#fff6c4" stroke-width="2" fill="none" stroke-linecap="round"/>`,
    `<path d="M${x + 22} ${y + 26}a5 5 0 1 0 0.1 0" fill="${GOLD}" stroke="${INK}" stroke-width="3"/>`,
  ].join("");
};

const skiGoggles = (look: Look) => {
  const clip = `${look.id}clip-head`;
  const id = `${look.id}ski`;
  const outer =
    "M100 144Q200 126 300 144Q320 180 302 214Q262 230 228 212Q200 194 172 212Q138 230 98 214Q80 180 100 144Z";
  const inner =
    "M110 154Q200 138 290 154Q304 182 292 204Q260 216 230 202Q200 186 170 202Q140 216 108 204Q96 182 110 154Z";
  return [
    `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff3d8b"/><stop offset="0.45" stop-color="#ff8a2a"/><stop offset="1" stop-color="#ffe14d"/></linearGradient>`,
    `<g clip-path="url(#${clip})"><path d="M60 156Q200 136 340 156V186Q200 166 60 186Z" fill="#2a2f3a" stroke="${INK}" stroke-width="4"/><path d="M60 166Q200 146 340 166V176Q200 156 60 176Z" fill="#35c4b5"/></g>`,
    `<path d="${outer}" fill="#f7f4ee" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`,
    `<path d="M300 144Q320 180 302 214Q290 220 276 222Q300 186 290 150Z" fill="#cfc8bb"/>`,
    `<path d="${inner}" fill="url(#${id})" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>`,
    `<path d="M128 156L160 152L124 202Q114 200 110 192Z" fill="#fff" opacity="0.45"/>`,
    `<path d="M172 150L186 149L150 206L140 206Z" fill="#fff" opacity="0.3"/>`,
    sparkle(262, 166, 8),
  ].join("");
};

const eyePatch = (look: Look) => {
  const patch = "M116 158Q150 140 186 158Q192 194 162 214Q128 220 114 192Q110 174 116 158Z";
  return [
    round(look, EYE_R, "pr", -1),
    ring("M178 156Q240 110 306 96", "#2b2730", 5),
    ring("M118 168L68 186", "#2b2730", 5),
    `<path d="${patch}" fill="#1d1a21" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`,
    `<path d="M124 164Q150 150 178 164Q182 192 160 206Q134 210 123 190Q120 176 124 164Z" fill="none" stroke="#8d8795" stroke-width="2" stroke-dasharray="5 4"/>`,
    `<ellipse cx="136" cy="168" rx="8" ry="4" transform="rotate(-25 136 168)" fill="#fff" opacity="0.35"/>`,
  ].join("");
};

const glasses3d = (look: Look) => {
  const frame =
    "M94 146H306V214H226Q214 196 200 196Q186 196 174 214H94Z M108 158V204H186V158Z M214 158V204H292V158Z";
  return [
    roundPair(look),
    `<path d="M108 158H186V204H108Z" fill="#ff2e3e" opacity="0.72"/>`,
    `<path d="M214 158H292V204H214Z" fill="#14c8f0" opacity="0.72"/>`,
    `<path d="M112 162L132 162L112 188Z" fill="#fff" opacity="0.5"/>`,
    `<path d="M218 162L238 162L218 188Z" fill="#fff" opacity="0.5"/>`,
    ARM(94, 70, 152, "#f4f1ea", 4),
    ARM(306, 330, 152, "#f4f1ea", 4),
    `<path d="${frame}" fill="#f4f1ea" fill-rule="evenodd" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`,
    `<path d="M98 208H170" stroke="#d6cfc2" stroke-width="5"/>`,
  ].join("");
};

/** Pixel shades, one cell = 8px; X black, W a white glint. */
const pixelShades = (look: Look) => {
  const cell = 8;
  const [x0, y0] = [100, 152];
  const rows = [
    "XXXXXXXXXXXXXXXXXXXXXXXXX",
    ".XWWXXXXXXX...XWWXXXXXXX.",
    ".XXWWXXXXXX...XXWWXXXXXX.",
    ".XXXXXXXXGX...XXXXXXXXGX.",
    "..XXXXXXGG.....XXXXXXGG..",
    "...GGGGGG.......GGGGGG...",
  ];
  /** The cells whose letter is one of `kinds`. */
  const cells = (kinds: string) =>
    rows
      .flatMap((row, r) =>
        [...row].map((c, i) =>
          kinds.includes(c)
            ? `<rect x="${x0 + i * cell}" y="${y0 + r * cell}" width="${cell}" height="${cell}"/>`
            : "",
        ),
      )
      .join("");
  return [
    `<path d="M70 158H100M300 158H330" stroke="${INK}" stroke-width="8"/>`,
    // a pale rim first, so the black pixels still read on a dark coat
    `<g fill="none" stroke="${tint(look.fur.fur, 0.3)}" stroke-width="12" stroke-linejoin="round">${cells("XWG")}</g>`,
    `<g fill="${INK}" stroke="${INK}" stroke-width="5" stroke-linejoin="round">${cells("XWG")}</g>`,
    `<g fill="#0e0c12">${cells("X")}</g>`,
    `<g fill="#4a4458">${cells("G")}</g>`,
    `<g fill="#fff">${cells("W")}</g>`,
  ].join("");
};

const cyclops = (look: Look) => {
  const id = `${look.id}visor`;
  const band = "M74 152Q200 126 326 152L330 200Q200 176 70 200Z";
  const slit = "M94 160Q200 140 306 160L308 188Q200 168 92 188Z";
  return [
    `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9a8a"/><stop offset="0.45" stop-color="#ff2a3a"/><stop offset="1" stop-color="#9a0820"/></linearGradient>`,
    `<path d="${slit}" fill="none" stroke="#ff3b4a" stroke-width="22" opacity="0.35" stroke-linejoin="round"/>`,
    `<path d="${band}" fill="#8d96a3" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`,
    `<path d="M70 200Q200 176 330 200L329 190Q200 166 71 190Z" fill="#646d7a"/>`,
    `<path d="M80 154Q200 130 320 154" stroke="#d3d9e0" stroke-width="3" fill="none" stroke-linecap="round"/>`,
    `<path d="${slit}" fill="url(#${id})" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>`,
    `<path d="M104 164Q200 146 296 164" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" opacity="0.8"/>`,
    `<circle cx="82" cy="176" r="5" fill="#d3d9e0" stroke="${INK}" stroke-width="2.5"/>`,
    `<circle cx="318" cy="176" r="5" fill="#d3d9e0" stroke="${INK}" stroke-width="2.5"/>`,
  ].join("");
};

const nightVision = (look: Look) => {
  const id = `${look.id}nv`;
  const OLIVE = "#5d7034";
  const tube = ({ x, y }: At, side: Side) => {
    const clip = `${look.id}nvtube${side}`;
    return [
      `<clipPath id="${clip}"><circle cx="${x}" cy="${y}" r="34"/></clipPath>`,
      `<circle cx="${x}" cy="${y}" r="34" fill="${OLIVE}"/>`,
      `<path d="M${x + 34} ${y - 34}L${x - 30} ${y + 40}H${x + 40}Z" fill="#46562a" clip-path="url(#${clip})"/>`,
      `<circle cx="${x}" cy="${y}" r="34" fill="none" stroke="${INK}" stroke-width="5"/>`,
      `<circle cx="${x}" cy="${y}" r="24" fill="#1c2412" stroke="${INK}" stroke-width="3"/>`,
      `<circle cx="${x}" cy="${y}" r="18" fill="url(#${id})"/>`,
      `<ellipse cx="${x - 7}" cy="${y - 7}" rx="6" ry="4" transform="rotate(-40 ${x - 7} ${y - 7})" fill="#fff" opacity="0.85"/>`,
    ].join("");
  };
  return [
    `<radialGradient id="${id}" cx="0.45" cy="0.45"><stop offset="0" stop-color="#eaffc8"/><stop offset="0.45" stop-color="#5cf06a"/><stop offset="1" stop-color="#0d6a22"/></radialGradient>`,
    `<path d="M190 94H210V164H190Z" fill="${OLIVE}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`,
    `<rect x="176" y="86" width="48" height="16" rx="5" fill="#46562a" stroke="${INK}" stroke-width="4"/>`,
    `<rect x="172" y="160" width="56" height="38" rx="8" fill="${OLIVE}" stroke="${INK}" stroke-width="4.5"/>`,
    `<circle cx="200" cy="179" r="5" fill="#2a3318" stroke="${INK}" stroke-width="2"/>`,
    pair(tube),
    `<circle cx="282" cy="160" r="4" fill="#ff4040" stroke="${INK}" stroke-width="2"/>`,
  ].join("");
};

const scuba = (look: Look) => {
  const outer =
    "M112 134H288Q316 134 316 164V188Q316 216 288 216H238Q222 216 214 204Q200 192 186 204Q178 216 162 216H112Q84 216 84 188V164Q84 134 112 134Z";
  const glass =
    "M118 146H282Q304 146 304 168V186Q304 204 284 204H240Q228 204 220 194Q200 178 180 194Q172 204 160 204H116Q96 204 96 186V168Q96 146 118 146Z";
  return [
    roundPair(look),
    `<path d="M84 168L68 172M316 168L332 172" stroke="${INK}" stroke-width="10" stroke-linecap="round"/>`,
    `<path d="${outer} ${glass}" fill="#ffc928" fill-rule="evenodd" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`,
    `<path d="M316 176V188Q316 216 288 216H238Q222 216 214 204L220 196Q226 206 240 206H286Q306 206 306 186V176Z" fill="#e09b10"/>`,
    `<path d="${glass}" fill="#9fe8ff" opacity="0.3" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`,
    `<path d="M112 152L140 150L106 186Q102 166 112 152Z" fill="#fff" opacity="0.55"/>`,
    `<path d="M152 150L166 150L128 200L118 198Z" fill="#fff" opacity="0.35"/>`,
    ring("M314 196Q340 192 344 160V56", "#ff8a1f", 10),
    `<path d="M339 56V196" stroke="#ffc07a" stroke-width="3" opacity="0.8"/>`,
    `<rect x="332" y="40" width="24" height="18" rx="5" fill="#2a2f3a" stroke="${INK}" stroke-width="4"/>`,
  ].join("");
};

const operaGlasses = () => {
  const barrel = (x: number, y: number) =>
    [
      `<circle cx="${x}" cy="${y}" r="31" fill="${GOLD}" stroke="${INK}" stroke-width="5"/>`,
      `<path d="M${x + 22} ${y - 22}A31 31 0 0 1 ${x - 22} ${y + 22}" fill="none" stroke="${GOLD_SHADE}" stroke-width="5"/>`,
      `<circle cx="${x}" cy="${y}" r="24" fill="#f6e6f2" stroke="${INK}" stroke-width="3"/>`,
      `<path d="M${x - 16} ${y - 18}A24 24 0 0 1 ${x + 18} ${y - 16}" fill="none" stroke="#c9e9f0" stroke-width="4"/>`,
      `<circle cx="${x}" cy="${y}" r="16" fill="#26336a" stroke="${INK}" stroke-width="3"/>`,
      `<circle cx="${x + 3}" cy="${y + 4}" r="8" fill="#3b56a8"/>`,
      `<ellipse cx="${x - 6}" cy="${y - 6}" rx="5" ry="3.5" transform="rotate(-40 ${x - 6} ${y - 6})" fill="#fff"/>`,
    ].join("");
  return [
    ring("M266 206Q292 248 302 296", GOLD, 7),
    `<rect x="176" y="168" width="48" height="26" rx="6" fill="${GOLD}" stroke="${INK}" stroke-width="4"/>`,
    `<rect x="190" y="152" width="20" height="20" rx="4" fill="${GOLD_SHADE}" stroke="${INK}" stroke-width="3.5"/>`,
    `<path d="M195 155V169M200 155V169M205 155V169" stroke="${INK}" stroke-width="1.5"/>`,
    barrel(EYE_L.x, EYE_L.y),
    barrel(EYE_R.x, EYE_R.y),
  ].join("");
};

const PER_RARE = 0.5 / 27;

const rare = (name: string, draw: (look: Look) => string): TraitValue => ({
  name,
  share: PER_RARE,
  draw,
});

export const EYES: readonly TraitValue[] = [
  { name: "Round", share: 0.22, draw: roundPair },
  { name: "Sleepy", share: 0.15, draw: sleepy },
  { name: "Bright", share: 0.13, draw: bright },
  rare("Shades", shades),
  rare("Gold Shades", goldShades),
  rare("Laser Green", (look) => lasers(look, "#4dff6a", "#119a2a")),
  rare("Laser Gold", (look) => lasers(look, "#ffc928", "#b8780a")),
  rare("Heart Eyes", hearts),
  rare("Star Eyes", stars),
  rare("Spiral", spiral),
  rare("Side-Eye", sideEye),
  rare("Wink", wink),
  rare("Monocle", monocle),
  rare("Round Glasses", roundGlasses),
  rare("Aviators", aviators),
  rare("Ski Goggles", skiGoggles),
  rare("Eye Patch", eyePatch),
  rare("3D Glasses", glasses3d),
  rare("Pixel Shades", pixelShades),
  rare("Teary", teary),
  rare("Angry", angry),
  rare("Glowing", glowing),
  rare("Cyclops Visor", cyclops),
  rare("Robot Eyes", robot),
  rare("Crossed", crossed),
  rare("Night Vision", nightVision),
  rare("Scuba Mask", scuba),
  rare("Opera Glasses", operaGlasses),
  rare("Moon Eyes", moon),
  rare("Mismatched", mismatched),
];
