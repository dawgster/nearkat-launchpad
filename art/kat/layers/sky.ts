/**
 * Sky: the background, after Black Dragon's flames: one flat colour and a big
 * two-tone savannah pattern in lighter and darker shades of it. No outlines on
 * the backdrop; small objects in it (moons, lanterns) get the kat's outline.
 */
import { INK, OUTLINE, type TraitValue, tint } from "../canvas.ts";

const fill = (color: string) => `<rect width="400" height="400" fill="${color}"/>`;
const round = (n: number) => Math.round(n * 10) / 10;

/** Sun rays: `n` alternate wedges fanning out from a point, long enough to reach every corner. */
const rays = (cx: number, cy: number, color: string, n = 16, turn = 0) => {
  const step = (Math.PI * 2) / n;
  const point = (a: number) => `${round(cx + Math.cos(a) * 700)} ${round(cy + Math.sin(a) * 700)}`;
  const wedges = Array.from({ length: n / 2 }, (_, i) => {
    const a = turn + i * 2 * step;
    return `M${cx} ${cy}L${point(a)}L${point(a + step)}Z`;
  });
  return `<path d="${wedges.join("")}" fill="${color}"/>`;
};

/** A row of grass blades along the bottom edge, of varied heights. */
const grass = (color: string, height = 70, base = 400) => {
  const blades = Array.from({ length: 20 }, (_, i) => {
    const x = i * 20;
    const h = height * (0.55 + (((i * 7) % 5) / 4) * 0.45);
    const lean = i % 2 ? 6 : -6;
    return `M${x - 4} ${base}Q${x + 6} ${base - h * 0.5} ${x + 10 + lean} ${base - h}Q${x + 12} ${base - h * 0.4} ${x + 24} ${base}Z`;
  });
  return `<path d="${blades.join("")}" fill="${color}"/>`;
};

/** An acacia: a forked trunk under a flat umbrella crown, standing at (x, y). */
const acacia = (x: number, y: number, s: number, color: string, flip = false) =>
  `<g transform="translate(${x} ${y}) scale(${flip ? -s : s} ${s})" fill="${color}"><path d="M-5 0L-3 -38L-24 -58L-19 -61L-1 -46L13 -66L18 -63L5 -42L5 0Z"/><ellipse cx="-2" cy="-66" rx="50" ry="11"/><ellipse cx="-16" cy="-73" rx="28" ry="9"/><ellipse cx="16" cy="-72" rx="22" ry="8"/></g>`;

/** Rolling dunes or hills: a wavy band from `y` to the bottom. */
const hills = (y: number, color: string, amp = 18) =>
  `<path d="M0 ${y}Q50 ${y - amp} 100 ${y}T200 ${y}T300 ${y}T400 ${y}V400H0Z" fill="${color}"/>`;

/** Four-point sparkles at the given [x, y, r] spots. */
const sparkles = (color: string, at: readonly (readonly number[])[]) =>
  `<path d="${at
    .map(([x = 0, y = 0, r = 6]) => {
      const k = r * 0.22;
      return `M${x} ${y - r}Q${x + k} ${y - k} ${x + r} ${y}Q${x + k} ${y + k} ${x} ${y + r}Q${x - k} ${y + k} ${x - r} ${y}Q${x - k} ${y - k} ${x} ${y - r}Z`;
    })
    .join("")}" fill="${color}"/>`;

/** Round dots at the given [x, y, r] spots. */
const dots = (color: string, at: readonly (readonly number[])[]) =>
  at.map(([x, y, r = 3]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`).join("");

/** A sun disc: flat, one lighter ring, no outline (it is part of the sky). */
const sun = (x: number, y: number, r: number, color: string) =>
  `<circle cx="${x}" cy="${y}" r="${r + r * 0.3}" fill="${tint(color, 0.45)}" opacity="0.55"/><circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`;

/** A moon: an outlined object with craters, one cel shadow and a highlight. */
const moon = (x: number, y: number, r: number, color: string) =>
  `<g transform="translate(${x} ${y})"><circle r="${r}" fill="${color}" ${OUTLINE}/><path d="M${r * 0.35} ${-r * 0.92}A${r} ${r} 0 0 1 ${r * 0.35} ${r * 0.92}A${r * 1.1} ${r * 1.1} 0 0 0 ${r * 0.35} ${-r * 0.92}Z" fill="${tint(color, -0.18)}"/><g fill="${tint(color, -0.15)}"><circle cx="${-r * 0.3}" cy="${r * 0.25}" r="${r * 0.18}"/><circle cx="${r * 0.15}" cy="${-r * 0.35}" r="${r * 0.12}"/><circle cx="${-r * 0.05}" cy="${r * 0.6}" r="${r * 0.09}"/></g><circle cx="${-r * 0.45}" cy="${-r * 0.45}" r="${r * 0.13}" fill="#fff" opacity="0.8"/><circle r="${r}" fill="none" ${OUTLINE}/></g>`;

/** A crescent moon, outlined. */
const crescent = (x: number, y: number, r: number, color: string) =>
  `<path d="M${x} ${y - r}A${r} ${r} 0 1 0 ${x + r * 0.9} ${y + r * 0.45}A${r * 0.8} ${r * 0.8} 0 0 1 ${x} ${y - r}Z" fill="${color}" ${OUTLINE}/><circle cx="${x - r * 0.55}" cy="${y - r * 0.1}" r="${r * 0.12}" fill="#fff"/>`;

/** A flat puffy cloud, centred at (x, y). */
const cloud = (x: number, y: number, s: number, color: string) =>
  `<g transform="translate(${x} ${y}) scale(${s})" fill="${color}"><circle cx="-34" cy="4" r="22"/><circle cx="0" cy="-10" r="32"/><circle cx="36" cy="2" r="24"/><rect x="-56" y="4" width="116" height="22" rx="11"/></g>`;

/** A heavy bank of cloud across the top, its lower edge scalloped at height y. */
const cloudBank = (y: number, color: string) =>
  `<g fill="${color}"><rect width="400" height="${y}"/>${[0, 56, 112, 170, 230, 288, 344, 400]
    .map((x, i) => `<circle cx="${x}" cy="${y - (i % 2) * 12}" r="${34 + (i % 3) * 8}"/>`)
    .join("")}</g>`;

/** A lightning bolt, outlined. */
const bolt = (x: number, y: number, s: number) =>
  `<path transform="translate(${x} ${y}) scale(${s})" d="M0 0L-18 46H-4L-14 86L22 30H6L16 0Z" fill="#ffe14a" ${OUTLINE}/>`;

/** Horizontal wind or heat streaks: wavy strokes at the given [x, y, length]. */
const streaks = (color: string, width: number, at: readonly (readonly number[])[]) =>
  `<path d="${at
    .map(([x = 0, y = 0, l = 80]) => `M${x} ${y}q${l / 4} -12 ${l / 2} 0t${l / 2} 0`)
    .join("")}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`;

/** A paper lantern, outlined, with a glow behind it. */
const lantern = (x: number, y: number, s: number) =>
  `<g transform="translate(${x} ${y}) scale(${s})"><circle r="30" fill="#ffb347" opacity="0.3"/><rect x="-8" y="-24" width="16" height="6" rx="2" fill="${INK}"/><path d="M-16 -18Q-22 0 -16 18H16Q22 0 16 -18Z" fill="#ff5a36" ${OUTLINE}/><path d="M6 -18Q12 0 6 18H16Q22 0 16 -18Z" fill="#d13a22"/><path d="M-16 -18Q-22 0 -16 18H16Q22 0 16 -18Z" fill="none" ${OUTLINE}/><path d="M-10 -10Q-12 -2 -10 4" stroke="#ffd9a0" stroke-width="4" stroke-linecap="round" fill="none"/><rect x="-8" y="18" width="16" height="6" rx="2" fill="${INK}"/></g>`;

/** Scattered night-sky stars, kept round the edges where the kat leaves room. */
const STARS = [
  [30, 40, 7],
  [96, 24, 5],
  [60, 110, 4],
  [24, 190, 6],
  [44, 262, 4],
  [350, 36, 6],
  [300, 22, 4],
  [372, 120, 7],
  [340, 200, 4],
  [378, 274, 5],
  [150, 30, 4],
  [250, 18, 5],
  [20, 330, 4],
  [384, 340, 4],
] as const;

const DOTS = [
  [70, 60, 2],
  [130, 50, 2],
  [16, 100, 2],
  [80, 160, 2],
  [36, 230, 2],
  [270, 46, 2],
  [330, 80, 2],
  [390, 170, 2],
  [356, 248, 2],
  [200, 30, 2],
  [16, 290, 2],
  [60, 320, 2],
  [344, 312, 2],
  [390, 380, 2],
] as const;

const night = (bg: string, grassColor: string) =>
  fill(bg) + dots(tint(bg, 0.5), DOTS) + grass(grassColor, 60);

/** Midnight Sun's path: the sun skimming round the horizon, drawn as a row of time-lapse suns. */
const SUN_PATH = [20, 68, 118, 168, 232, 282, 332, 380].map((x) => [
  x,
  120 - Math.sin((x / 400) * Math.PI) * 80,
]);

export const SKIES: readonly TraitValue[] = [
  {
    name: "Day",
    share: 0.22,
    draw: () =>
      fill("#6cc4ee") +
      rays(200, 150, "#8fd6f6", 18) +
      hills(330, "#4fa8d6", 16) +
      acacia(44, 318, 1, "#3d8fc0") +
      acacia(356, 312, 0.85, "#3d8fc0", true) +
      grass("#2f7aa8", 60),
  },
  {
    name: "Dusk",
    share: 0.14,
    draw: () =>
      fill("#f2803a") +
      sun(200, 330, 150, "#ffb04f") +
      rays(200, 330, "#ff9a4a", 20, 0.08) +
      sun(200, 330, 110, "#ffc861") +
      acacia(48, 330, 1.2, "#7a2b1e") +
      acacia(354, 320, 1, "#7a2b1e", true) +
      grass("#5a1c14", 70),
  },
  {
    name: "Night",
    share: 0.14,
    draw: () =>
      night("#1c2650", "#0e1430") + sparkles("#e8ecff", STARS) + crescent(64, 70, 34, "#ffe9a3"),
  },
  {
    name: "Dawn",
    share: 0.1,
    draw: () =>
      fill("#f6b0c0") +
      `<g fill="#fac8d2"><rect y="40" width="400" height="34"/><rect y="110" width="400" height="26"/><rect y="168" width="400" height="18"/><rect y="212" width="400" height="10"/></g>` +
      sun(52, 300, 46, "#ffe08a") +
      hills(300, "#e78ca4", 22) +
      hills(345, "#cf6f8b", 16) +
      grass("#b25576", 50),
  },
  {
    name: "Aurora",
    share: 0.02,
    draw: () =>
      fill("#0f2f45") +
      `<path d="M-10 150C60 60 120 170 200 90S330 120 410 40V-10H-10Z" fill="#1f9e86"/><path d="M-10 90C70 20 130 110 210 40S330 70 410 0V-10H-10Z" fill="#58e0a8"/><path d="M-10 230C70 170 110 240 200 180S320 210 410 140V120C320 190 280 160 200 150S80 190 -10 200Z" fill="#7d5ccf" opacity="0.8"/>` +
      dots("#bfeee0", DOTS) +
      grass("#08192a", 60),
  },
  {
    name: "Blood Moon",
    share: 0.02,
    draw: () =>
      fill("#4a0d12") +
      rays(320, 80, "#5a1218", 14) +
      moon(320, 80, 58, "#d8342c") +
      acacia(46, 330, 1.2, "#250507") +
      grass("#250507", 70),
  },
  {
    name: "Eclipse",
    share: 0.02,
    draw: () =>
      fill("#211631") +
      rays(84, 84, "#2d1f42", 24) +
      `<circle cx="84" cy="84" r="74" fill="#ffd36b" opacity="0.25"/><circle cx="84" cy="84" r="60" fill="#ffd36b"/><circle cx="84" cy="84" r="50" fill="#fff6d8"/><circle cx="84" cy="84" r="46" fill="#0d0814" ${OUTLINE}/>` +
      dots("#8a76b0", DOTS.slice(5)) +
      grass("#120b1d", 60),
  },
  {
    name: "Meteor Shower",
    share: 0.02,
    draw: () =>
      fill("#2a2266") +
      `<g stroke-linecap="round">${[
        [40, 20, 150],
        [150, -20, 110],
        [300, 0, 130],
        [380, 60, 120],
        [10, 140, 90],
        [360, 170, 90],
        [250, -10, 70],
      ]
        .map(
          ([x = 0, y = 0, l = 100]) =>
            `<path d="M${x} ${y}l${-l * 0.7} ${l * 0.7}" stroke="#6a5fd0" stroke-width="12"/><path d="M${x - l * 0.45} ${y + l * 0.45}l${-l * 0.25} ${l * 0.25}" stroke="#fff3c4" stroke-width="8"/>`,
        )
        .join("")}</g>` +
      dots("#a99ff0", DOTS) +
      grass("#17123d", 60),
  },
  {
    name: "Rainbow",
    share: 0.02,
    draw: () =>
      fill("#8fd9f2") +
      ["#ff5d5d", "#ff9f43", "#ffe066", "#6bd96b", "#4fa8ff", "#9b6bff"]
        .map(
          (c, i) =>
            `<path d="M${-10 + i * 22} 330A${210 - i * 22} ${210 - i * 22} 0 0 1 ${410 - i * 22} 330" fill="none" stroke="${c}" stroke-width="23"/>`,
        )
        .join("") +
      cloud(30, 320, 1, "#ffffff") +
      cloud(370, 320, 1, "#ffffff") +
      grass("#4fb36a", 50),
  },
  {
    name: "Sandstorm",
    share: 0.02,
    draw: () =>
      fill("#d39a55") +
      streaks("#e8bb7c", 16, [
        [-30, 40, 200],
        [220, 70, 220],
        [-60, 130, 160],
        [300, 160, 140],
        [-40, 220, 140],
        [320, 240, 120],
        [140, 20, 140],
      ]) +
      streaks("#b77c3c", 10, [
        [40, 90, 120],
        [260, 120, 160],
        [-20, 280, 120],
        [330, 300, 100],
        [100, 50, 80],
      ]) +
      hills(340, "#b77c3c", 20) +
      dots("#f5d7a3", [
        [30, 180, 4],
        [370, 90, 3],
        [60, 60, 3],
        [340, 210, 4],
      ]),
  },
  {
    name: "Thunderstorm",
    share: 0.02,
    draw: () =>
      fill("#3a4560") +
      cloudBank(76, "#56648a") +
      cloudBank(40, "#262d42") +
      bolt(40, 96, 1.2) +
      bolt(356, 104, 1) +
      `<path d="${[20, 60, 100, 300, 340, 380, 30, 370].map((x, i) => `M${x} ${200 + (i % 3) * 30}l-10 26`).join("")}" stroke="#6a7898" stroke-width="5" stroke-linecap="round"/>` +
      grass("#1e2436", 60),
  },
  {
    name: "Supermoon",
    share: 0.02,
    draw: () =>
      fill("#1d2a62") +
      `<circle cx="200" cy="190" r="196" fill="#2b3b80"/>` +
      moon(200, 175, 170, "#f4e4b0") +
      dots("#a7b5f0", DOTS) +
      grass("#0d1438", 60),
  },
  {
    name: "Starfield",
    share: 0.02,
    draw: () =>
      fill("#0b0b1c") +
      dots("#ffffff", DOTS) +
      dots("#7d7dc8", [
        [110, 80, 3],
        [40, 150, 3],
        [370, 60, 3],
        [320, 140, 3],
        [20, 60, 2],
        [230, 50, 3],
        [60, 210, 3],
        [380, 230, 3],
        [30, 380, 3],
        [360, 360, 3],
      ]) +
      sparkles("#ffffff", STARS) +
      sparkles("#ffe27a", [
        [110, 80, 12],
        [320, 140, 10],
        [40, 360, 9],
        [362, 362, 10],
      ]),
  },
  {
    name: "Nebula",
    share: 0.02,
    draw: () =>
      fill("#341a58") +
      `<path d="M-20 60C40 0 120 40 160 10S260 -20 300 40S420 60 420 120V-20H-20Z" fill="#7a2f8f"/><path d="M-20 320C30 250 80 300 70 220S0 140 -20 160Z" fill="#c2449a"/><path d="M420 340C360 290 330 340 340 250S410 180 420 190Z" fill="#3f6fd0"/><path d="M-20 20C40 -10 90 30 140 0H-20Z" fill="#e070b8"/>` +
      sparkles("#ffe6ff", STARS) +
      dots("#d6b8ff", DOTS),
  },
  {
    name: "Comet",
    share: 0.02,
    draw: () =>
      fill("#16345a") +
      `<path d="M420 -40L40 66L58 98Z" fill="#2c5a8a"/><path d="M420 -20L52 76L58 90Z" fill="#7fc6e8"/><circle cx="50" cy="84" r="28" fill="#bfeaff" opacity="0.6"/><circle cx="50" cy="84" r="16" fill="#ffffff" ${OUTLINE}/>` +
      dots("#8fb8e0", DOTS) +
      grass("#0a1d36", 60),
  },
  {
    name: "Monsoon",
    share: 0.02,
    draw: () =>
      fill("#4d7b86") +
      cloudBank(50, "#3a5f69") +
      `<path d="${Array.from({ length: 40 }, (_, i) => `M${(i * 97 + 31) % 420} ${70 + ((i * 61 + i * i * 7) % 270)}l-12 44`).join("")}" stroke="#a6d4dc" stroke-width="6" stroke-linecap="round"/>` +
      `<rect y="350" width="400" height="50" fill="#3a5f69"/><g fill="none" stroke="#a6d4dc" stroke-width="4"><ellipse cx="40" cy="372" rx="26" ry="7"/><ellipse cx="360" cy="380" rx="24" ry="6"/></g>`,
  },
  {
    name: "Fireflies",
    share: 0.02,
    draw: () =>
      fill("#143a2c") +
      acacia(40, 340, 1.4, "#0d2a1f") +
      acacia(362, 330, 1.2, "#0d2a1f", true) +
      grass("#0a2118", 90) +
      [
        [40, 60],
        [110, 30],
        [26, 160],
        [60, 240],
        [350, 70],
        [300, 30],
        [376, 180],
        [340, 260],
        [30, 330],
        [370, 360],
        [200, 30],
      ]
        .map(
          ([x, y]) =>
            `<circle cx="${x}" cy="${y}" r="13" fill="#d9ff6b" opacity="0.25"/><circle cx="${x}" cy="${y}" r="5" fill="#f4ffb0"/>`,
        )
        .join(""),
  },
  {
    name: "Lantern Night",
    share: 0.02,
    draw: () =>
      fill("#2b1840") +
      dots("#7b5fa6", DOTS) +
      hills(350, "#1a0e28", 14) +
      lantern(52, 70, 1.1) +
      lantern(350, 60, 0.9) +
      lantern(110, 20, 0.6) +
      lantern(36, 210, 0.8) +
      lantern(366, 200, 1) +
      lantern(290, 18, 0.55),
  },
  {
    name: "Heat Haze",
    share: 0.02,
    draw: () =>
      fill("#f7c43c") +
      sun(200, 120, 160, "#ffd95e") +
      sun(200, 120, 100, "#ffe98a") +
      streaks("#f19d2a", 10, [
        [-20, 250, 120],
        [300, 240, 130],
        [-40, 290, 140],
        [290, 285, 140],
        [-10, 330, 100],
        [320, 330, 100],
      ]) +
      hills(355, "#e0832a", 10) +
      acacia(46, 360, 0.8, "#c8661f"),
  },
  {
    name: "Snowfall",
    share: 0.02,
    draw: () =>
      fill("#9fbfe6") +
      cloudBank(36, "#b9d2ee") +
      dots(
        "#ffffff",
        Array.from({ length: 90 }, (_, i) => [
          (i * 89 + 17) % 400,
          30 + ((i * 47 + i * i * 13) % 320),
          4 + (i % 3) * 2,
        ]),
      ) +
      hills(340, "#eef6ff", 16) +
      `<path d="M0 380Q100 360 200 380T400 376V400H0Z" fill="#d2e3f6"/>`,
  },
  {
    name: "Twin Suns",
    share: 0.02,
    draw: () =>
      fill("#f6a868") +
      rays(70, 70, "#f9bb84", 14) +
      sun(70, 70, 46, "#fff0a8") +
      sun(340, 130, 28, "#ffdd75") +
      hills(330, "#e08a52", 18) +
      acacia(354, 334, 0.9, "#b9643a", true) +
      grass("#b9643a", 50),
  },
  {
    name: "Green Flash",
    share: 0.02,
    draw: () =>
      fill("#ff7a59") +
      `<g fill="#ff9670"><rect y="60" width="400" height="40"/><rect y="140" width="400" height="26"/><rect y="200" width="400" height="14"/></g>` +
      `<path d="M300 280A52 52 0 0 1 404 280Z" fill="#ffd35e"/><path d="M322 254A52 52 0 0 1 382 254Z" fill="#4dff8a"/><circle cx="352" cy="226" r="9" fill="#4dff8a"/>` +
      `<rect y="280" width="400" height="120" fill="#13495a"/><g fill="#2a7a86"><rect x="16" y="296" width="70" height="8" rx="4"/><rect x="320" y="294" width="76" height="8" rx="4"/><rect x="30" y="330" width="50" height="8" rx="4"/><rect x="336" y="324" width="48" height="8" rx="4"/></g>`,
  },
  {
    name: "Desert Mirage",
    share: 0.02,
    draw: () =>
      fill("#f4caa0") +
      `<rect y="260" width="400" height="140" fill="#a8d8e6"/>` +
      acacia(50, 260, 1, "#c98a5a") +
      acacia(352, 260, 0.8, "#c98a5a", true) +
      // The mirage: the same trees, upside down in the shimmering "water".
      `<g transform="translate(0 520) scale(1 -1)" fill-opacity="0.5">${acacia(50, 260, 1, "#5d97ae")}${acacia(352, 260, 0.8, "#5d97ae", true)}</g>` +
      streaks("#e1f3f8", 5, [
        [0, 300, 90],
        [310, 296, 90],
        [20, 336, 70],
        [320, 340, 70],
      ]) +
      hills(360, "#e4ae76", 14),
  },
  {
    name: "Midnight Sun",
    share: 0.02,
    draw: () =>
      fill("#3a3f8f") +
      `<path d="M-20 300Q200 -20 420 300" fill="none" stroke="#4c52a8" stroke-width="40"/>` +
      SUN_PATH.map(([x = 0, y = 0], i) => sun(x, y, i === 7 ? 18 : 10 + i, "#ffcf5a")).join("") +
      hills(330, "#2a2e6e", 14) +
      grass("#1d2050", 50),
  },
];
