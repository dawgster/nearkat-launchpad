import { type CSSProperties, memo, useEffect, useId, useRef, useState } from "react";
import type { DayPhase } from "../lib/dayPhase.ts";

/**
 * The painted savannah behind a kat's page: burrows a meerkat now and then
 * climbs out of, insects by day, fireflies and stars by night. Decoration
 * only; everything here is hidden from assistive technology.
 */

/** What the page is doing, which sends a matching sentry up. */
export type SavannahMood = "idle" | "thinking" | "paid";

export type Cameo =
  | "lookout"
  | "coin"
  | "cool"
  | "explorer"
  | "coffee"
  | "sleepy"
  | "curious"
  | "celebrate"
  | "bedtime"
  | "stargazer";
type Visit = { burrow: number; cameo: Cameo; sequence: number };

const VISIT_MS = 8400;
const CELEBRATION_MS = 5600;
const BEDTIME_MS = 12000;
const visitDuration = (cameo?: Cameo) =>
  cameo === "celebrate" ? CELEBRATION_MS : cameo === "bedtime" ? BEDTIME_MS : VISIT_MS;

const SAYINGS: Partial<Record<Cameo, string>> = {
  cool: "incog-near-to.",
  explorer: "took the scenic route.",
  coffee: "one more sip.",
  sleepy: "five more minutes.",
  curious: "listening…",
  celebrate: "paid in full!",
  bedtime: "goodnight, mob.",
};

const COMPACT = "(max-width: 760px)";

// Coordinates in the painting, including the traced inside edge of each hole's
// front lip. Picture, meerkat and clip scale together in one viewBox.
const OPENINGS = [
  {
    burrow: 0,
    x: 193,
    y: 433,
    width: 180,
    height: 245,
    clip: "M180 370H385V640Q346 665 280 666Q225 668 195 647Z",
  },
  {
    burrow: 1,
    x: 1190,
    y: 483,
    width: 210,
    height: 295,
    clip: "M1170 410H1420V735Q1350 765 1285 761Q1235 762 1195 743Z",
  },
  {
    burrow: 2,
    x: 169,
    y: 682,
    width: 150,
    height: 225,
    clip: "M160 650H325V874Q289 897 247 895Q204 896 183 880Z",
  },
];
const PHONE_OPENING = {
  burrow: 2,
  x: 348,
  y: 980,
  width: 326,
  height: 360,
  clip: "M335 910H690V1278Q625 1322 509 1320Q412 1321 368 1292Z",
};

/** NEAR's mark, as in /img/near.svg. */
function NearMark({ x, y, size, color }: { x: number; y: number; size: number; color: string }) {
  return (
    <svg aria-hidden="true" x={x} y={y} width={size} height={size} viewBox="0 0 16 16" fill={color}>
      <use href="/img/near.svg#near-mark" />
    </svg>
  );
}

/** One sentry, drawn in layers so its eyes, head and paw can move on their own. */
function Meerkat({ cameo }: { cameo: Cameo }) {
  const id = useId();
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 180 210"
      preserveAspectRatio="xMidYMax meet"
      fill="none"
      className={`burrow-kat burrow-kat--${cameo}`}
    >
      <defs>
        <linearGradient
          id={`${id}-fur`}
          x1="45"
          y1="30"
          x2="140"
          y2="180"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#f3ead8" />
          <stop offset=".5" stopColor="#d8b782" />
          <stop offset="1" stopColor="#987047" />
        </linearGradient>
        <linearGradient
          id={`${id}-belly`}
          x1="75"
          y1="100"
          x2="105"
          y2="210"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#fff3d9" />
          <stop offset="1" stopColor="#cfb083" />
        </linearGradient>
        <linearGradient
          id={`${id}-gold`}
          x1="68"
          y1="116"
          x2="111"
          y2="166"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#fff1a6" />
          <stop offset=".3" stopColor="#d99518" />
          <stop offset=".55" stopColor="#ffe88a" />
          <stop offset="1" stopColor="#bc7710" />
        </linearGradient>
      </defs>
      <path
        d="M60 145C37 161 43 193 29 206C53 212 69 186 69 177"
        fill="#987047"
        stroke="#39271d"
        strokeWidth="3"
      />
      <path
        d="M68 101C67 127 48 152 51 208H132C135 151 113 127 111 101"
        fill={`url(#${id}-fur)`}
        stroke="#39271d"
        strokeWidth="3"
      />
      <path
        d="M85 113C70 131 67 164 70 208H117C119 164 109 127 99 113"
        fill={`url(#${id}-belly)`}
      />
      <g className="burrow-kat-head">
        <ellipse cx="43" cy="66" rx="16" ry="22" fill="#ae885d" stroke="#39271d" strokeWidth="3" />
        <ellipse cx="43" cy="67" rx="9" ry="14" fill="#483328" />
        <ellipse cx="138" cy="66" rx="16" ry="22" fill="#ae885d" stroke="#39271d" strokeWidth="3" />
        <ellipse cx="138" cy="67" rx="9" ry="14" fill="#483328" />
        <path
          d="M42 64C44 36 60 27 77 25L85 12L91 23L100 17L106 27C128 29 141 48 140 71C152 92 128 116 92 117C55 117 31 96 42 64Z"
          fill={`url(#${id}-fur)`}
          stroke="#39271d"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <path
          d="M49 61C49 40 70 35 82 50M101 50C114 34 133 42 134 61"
          stroke="#f9edda"
          strokeWidth="7"
          strokeLinecap="round"
        />
        <ellipse cx="68" cy="66" rx="19" ry="24" fill="#725a46" transform="rotate(12 68 66)" />
        <ellipse cx="115" cy="66" rx="19" ry="24" fill="#725a46" transform="rotate(-12 115 66)" />
        <g className="burrow-kat-eyes">
          <ellipse cx="69" cy="64" rx="13" ry="18" fill="#fff9eb" />
          <ellipse cx="114" cy="64" rx="13" ry="18" fill="#fff9eb" />
          <g className="burrow-kat-pupils">
            <ellipse cx="72" cy="66" rx="8" ry="12" fill="#72aeb4" />
            <ellipse cx="111" cy="66" rx="8" ry="12" fill="#72aeb4" />
            <ellipse cx="73" cy="67" rx="5" ry="9" fill="#171a19" />
            <ellipse cx="110" cy="67" rx="5" ry="9" fill="#171a19" />
            <circle cx="70" cy="61" r="3" fill="white" />
            <circle cx="107" cy="61" r="3" fill="white" />
          </g>
        </g>
        <path
          d="M53 87C64 77 77 79 91 82C106 79 121 77 133 87C132 106 110 115 91 115C72 115 53 103 53 87Z"
          fill={`url(#${id}-belly)`}
        />
        <path d="M81 84Q91 77 101 84Q104 92 91 97Q79 92 81 84Z" fill="#271e18" />
        <path d="M85 85L91 83" stroke="#776354" strokeWidth="2" strokeLinecap="round" />
        <path
          className="burrow-kat-smile"
          d="M91 97V100M73 98Q90 112 112 96"
          stroke="#483328"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path
          d="M78 31L85 35M96 29L100 34"
          stroke="#ac885e"
          strokeWidth="2"
          strokeLinecap="round"
        />
        {cameo === "bedtime" && (
          <ellipse className="burrow-yawn" cx="92" cy="104" rx="8" ry="10" fill="#483328" />
        )}
        {cameo === "cool" && (
          <g stroke="#0b0806" strokeWidth="4" strokeLinejoin="round">
            <path d="M48 53H84L81 76Q67 85 53 73ZM99 53H136L131 73Q118 85 103 76Z" fill="#172a24" />
            <path d="M84 59Q92 54 99 59M43 51L50 57M135 57L141 51" />
            <path d="M59 58L70 73M108 58L119 73" stroke="#00ec97" strokeWidth="3" />
          </g>
        )}
        {cameo === "explorer" && (
          <g stroke="#674b2c" strokeWidth="2.5" strokeLinejoin="round">
            <path d="M54 35L62 7Q82 12 92 5Q113 10 123 35" fill="#c19c5c" />
            <path d="M57 25Q93 34 120 25L123 35H54Z" fill="#654c32" />
            <path d="M37 34Q88 47 140 34L143 43Q90 59 36 44Z" fill="#e6c991" />
          </g>
        )}
        {(cameo === "sleepy" || cameo === "bedtime") && (
          <g stroke="#674b45" strokeWidth="2.5" strokeLinecap="round">
            <path
              className="burrow-sleepy-eyelids"
              d="M53 64Q68 80 84 64M99 64Q115 80 130 64"
              fill="#d8b782"
            />
            <g className="burrow-sleeping-cap">
              <path d="M52 32Q94-11 132 30L145 43Q121 34 119 41Q85 23 52 43Z" fill="#9dbcb2" />
              <circle cx="145" cy="43" r="6" fill="#eee4ce" />
            </g>
          </g>
        )}
      </g>
      {cameo === "cool" && (
        <g strokeLinecap="round" strokeLinejoin="round">
          <path d="M69 117Q71 148 92 153Q113 148 114 117" stroke="#765017" strokeWidth="8" />
          <path
            d="M69 117Q71 148 92 153Q113 148 114 117"
            stroke={`url(#${id}-gold)`}
            strokeWidth="6"
          />
          <path
            d="M69 117Q71 148 92 153Q113 148 114 117"
            stroke="#fff1ac"
            strokeWidth="2"
            strokeDasharray="2 5"
          />
          <ellipse cx="92" cy="155" rx="3" ry="4" stroke="#ffe88a" strokeWidth="2" />
          <circle
            cx="92"
            cy="168"
            r="11"
            fill={`url(#${id}-gold)`}
            stroke="#885711"
            strokeWidth="2"
          />
          <circle cx="92" cy="168" r="8" stroke="#fff1ac" strokeWidth="1" />
          <NearMark x={86} y={162} size={12} color="#785018" />
        </g>
      )}
      <path
        d="M64 133Q47 152 66 176L78 169L71 148"
        fill={`url(#${id}-fur)`}
        stroke="#745238"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <g className="burrow-kat-paw">
        <path
          d="M117 133Q133 150 116 176L104 168L111 148"
          fill={`url(#${id}-fur)`}
          stroke="#745238"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M108 166L105 173M113 168L111 176M118 168L116 175"
          stroke="#39271d"
          strokeWidth="2"
          strokeLinecap="round"
        />
        {(cameo === "coin" || cameo === "celebrate") && (
          <g>
            <circle cx="115" cy="154" r="20" fill="#00b874" stroke="#063d2b" strokeWidth="3" />
            <circle cx="115" cy="151" r="18" fill="#00ec97" stroke="#a7ffcf" strokeWidth="2" />
            <NearMark x={104} y={140} size={22} color="#063d2b" />
            <path
              d="M143 128V138M138 133H148"
              stroke="#baffdc"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </g>
        )}
        {cameo === "coffee" && (
          <g>
            <path d="M130 146H139Q150 158 134 165H128" stroke="#eee0bd" strokeWidth="5" />
            <path
              d="M99 142H134L131 171Q116 179 102 171Z"
              fill="#f2e6c8"
              stroke="#705136"
              strokeWidth="2.5"
            />
            <ellipse
              cx="116"
              cy="143"
              rx="17"
              ry="4"
              fill="#624231"
              stroke="#f2e6c8"
              strokeWidth="3"
            />
            <NearMark x={109} y={153} size={13} color="#267b56" />
            <path
              className="burrow-coffee-steam"
              d="M109 134Q104 127 110 121M122 134Q117 128 123 120"
              stroke="#fff3d9"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </g>
        )}
      </g>
      {cameo === "celebrate" && (
        <g className="burrow-celebration" fill="#00ec97" stroke="#b9f6bc" strokeWidth="1.5">
          <path d="M22 91L25 80L29 90L39 94L28 98L25 108L21 98L11 94ZM143 108L147 97L151 108L161 112L150 116L147 126L143 116L133 112Z" />
          <path
            d="M17 134L24 143M152 72L161 65"
            stroke="#ffe79e"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </g>
      )}
      <path
        d="M65 169L67 176M70 168L72 175M75 167L77 173"
        stroke="#39271d"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

type Point = readonly [number, number];

/**
 * One of the burrow's sentries in a round patch of savannah, standing still:
 * the same drawing that climbs out of the burrows, for use inside a page.
 */
export function MeerkatPortrait({
  cameo,
  size = 88,
  label,
}: {
  cameo: Cameo;
  size?: number;
  label: string;
}) {
  return (
    <div
      role="img"
      aria-label={label}
      className="meerkat-portrait"
      style={{ width: size, height: size }}
    >
      <span className="meerkat-portrait-hole" />
      <div className="meerkat-portrait-kat">
        <Meerkat cameo={cameo} />
      </div>
    </div>
  );
}

const STARS: readonly Point[] = [
  [0.08, 100],
  [0.21, 230],
  [0.32, 60],
  [0.56, 105],
  [0.69, 260],
  [0.87, 70],
  [0.94, 315],
  [0.12, 360],
];
const DAY_FLIES: Record<"wide" | "phone", readonly Point[]> = {
  wide: [
    [170, 310],
    [345, 430],
    [1220, 340],
    [1380, 465],
    [240, 552],
    [1110, 610],
    [1330, 580],
    [410, 850],
    [1250, 950],
    [150, 790],
    [340, 710],
    [1410, 870],
  ],
  phone: [
    [230, 1200],
    [820, 1195],
    [320, 1390],
    [705, 1360],
    [200, 1310],
    [830, 1420],
    [405, 1135],
    [685, 1165],
  ],
};
const FIREFLIES: Record<"wide" | "phone", readonly Point[]> = {
  wide: [
    [385, 735],
    [1175, 842],
    [176, 934],
    [150, 590],
    [330, 520],
    [1170, 560],
    [1400, 690],
    [380, 915],
    [1300, 965],
    [1090, 700],
    [90, 460],
    [285, 610],
    [410, 630],
    [1060, 455],
    [1280, 510],
    [1450, 850],
    [1080, 925],
    [265, 845],
    [75, 800],
    [1350, 385],
    [200, 370],
    [1240, 710],
  ],
  phone: [
    [264, 1220],
    [773, 1290],
    [632, 1435],
    [200, 1350],
    [820, 1160],
    [410, 1150],
    [815, 1440],
    [320, 1250],
    [710, 1150],
    [580, 1220],
    [150, 1430],
    [875, 1330],
    [485, 1420],
    [345, 1465],
    [675, 1340],
    [540, 1130],
  ],
};

/** Stars, insects and fireflies, kept apart from the painting so they can move. */
const Details = memo(function Details({
  compact,
  phase,
  celebration,
}: {
  compact: boolean;
  phase: DayPhase;
  celebration: { sequence: number; x: number; y: number } | null;
}) {
  const id = useId();
  const width = compact ? 1024 : 1536;
  const height = compact ? 1536 : 1024;
  const fireflies = compact ? FIREFLIES.phone : FIREFLIES.wide;
  const nearby = celebration
    ? fireflies
        .map(([x, y], index) => ({
          x,
          y,
          index,
          distance: Math.hypot(x - celebration.x, y - celebration.y),
        }))
        .filter(({ index }) => phase === "night" || index < 3)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 3)
    : [];
  return (
    <svg
      aria-hidden="true"
      className="painted-burrows savannah-details"
      viewBox={`0 0 ${width} ${height}`}
    >
      <defs>
        <radialGradient id={`${id}-firefly`} cx="46%" cy="43%">
          <stop stopColor="#e7ffce" stopOpacity=".95" />
          <stop offset=".16" stopColor="#cfffad" stopOpacity=".7" />
          <stop offset=".42" stopColor="#98e5a7" stopOpacity=".25" />
          <stop offset=".7" stopColor="#77d5a6" stopOpacity=".06" />
          <stop offset="1" stopColor="#77d5a6" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g className="savannah-stars" fill="#e6f4eb">
        {STARS.map(([x, y], i) => (
          <circle
            key={`${x}-${y}`}
            className="savannah-star"
            cx={width * x}
            cy={y}
            r={i % 3 === 0 ? 2 : 1.3}
            style={{ animationDelay: `${i * -1.7}s` }}
          />
        ))}
      </g>
      <g className="savannah-day-flies">
        {(compact ? DAY_FLIES.phone : DAY_FLIES.wide).map(([x, y], i) => (
          <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}>
            <g
              className="savannah-day-fly"
              style={{
                animationDelay: `${-3 - i * 2.7}s`,
                animationDuration: `${10 + (i % 5) * 1.7}s`,
              }}
            >
              <circle r={compact ? 4.4 : 3.2} fill="#fff0bd" opacity=".18" />
              <circle
                r={(compact ? 2.7 : 1.8) + (i % 2) * 0.35}
                fill="#57432a"
                stroke="#ffedb3"
                strokeWidth=".7"
              />
            </g>
          </g>
        ))}
      </g>
      <g className="savannah-fireflies" fill="#d2f6a5">
        {fireflies.map(([x, y], i) => (
          <g
            key={`${x}-${y}`}
            className={i >= 3 ? "savannah-night-firefly" : undefined}
            transform={`translate(${x} ${y})`}
          >
            <g
              className="savannah-firefly"
              style={
                {
                  animationDelay: `${i * -4.1}s`,
                  animationDuration: i >= 3 ? `${13 + (i % 4) * 2.3}s` : undefined,
                  "--fly-x": `${(i % 2 ? -1 : 1) * (9 + ((i * 7) % 20))}px`,
                  "--fly-y": `${-(14 + ((i * 11) % 18))}px`,
                } as CSSProperties
              }
            >
              {phase === "night" ? (
                <ellipse
                  rx={(compact ? 15 : 12) + (i % 4) * 2}
                  ry={(compact ? 11 : 9) + (i % 3) * 2}
                  transform={`rotate(${(i * 37) % 180})`}
                  fill={`url(#${id}-firefly)`}
                />
              ) : (
                <>
                  <circle r="7" opacity=".12" />
                  <circle r="2" />
                </>
              )}
            </g>
          </g>
        ))}
        {celebration && (
          <g key={celebration.sequence}>
            {nearby.map(({ x, y, index }, i) => (
              <g
                key={index}
                className={index >= 3 ? "savannah-night-firefly" : undefined}
                transform={`translate(${x} ${y})`}
              >
                <g className="savannah-success-glow" style={{ animationDelay: `${i * 100}ms` }}>
                  {phase === "night" ? (
                    <ellipse rx="25" ry="18" fill={`url(#${id}-firefly)`} />
                  ) : (
                    <>
                      <circle r="13" opacity=".1" />
                      <circle r="7" opacity=".25" />
                      <circle r="2.8" fill="#f4ffd5" />
                    </>
                  )}
                </g>
              </g>
            ))}
          </g>
        )}
      </g>
    </svg>
  );
});

/** A shooting star, on a path picked once so re-renders never move it mid-flight. */
function ShootingStar({
  compact,
  gradient,
  arrival,
}: {
  compact: boolean;
  gradient: string;
  arrival: boolean;
}) {
  const [path] = useState(() => Math.floor(Math.random() * 4));
  const paths: readonly (readonly [number, number, number])[] = compact
    ? [
        [0.18, 480, 25],
        [0.84, 540, 155],
        [0.22, 440, 18],
        [0.79, 490, 150],
      ]
    : [
        [0.13, 150, 24],
        [0.88, 210, 156],
        [0.19, 115, 18],
        [0.82, 130, 150],
      ];
  const [x, y, angle] = paths[path] ?? [0.13, 150, 24];
  return (
    <g
      className={`savannah-shooting-star${arrival ? " savannah-shooting-star--arrival" : ""}`}
      transform={`translate(${(compact ? 1024 : 1536) * x} ${y}) rotate(${angle})`}
    >
      <g className="savannah-meteor">
        <path d="M-135 0H0" stroke={`url(#${gradient})`} strokeWidth="2" strokeLinecap="round" />
        <circle r="4.5" fill="#d5e9ff" opacity=".16" />
        <circle r="2.2" fill="#edf6ff" />
      </g>
    </g>
  );
}

const ShootingStars = memo(function ShootingStars({
  compact,
  phase,
  star,
  arrival,
}: {
  compact: boolean;
  phase: DayPhase;
  star: number | null;
  arrival: boolean;
}) {
  const id = useId();
  // One star on arriving at night, then one with each stargazer.
  const meteors =
    phase === "night" ? [...(arrival ? ["arrival"] : []), ...(star !== null ? [star] : [])] : [];
  return (
    <svg
      aria-hidden="true"
      className="savannah-sky"
      viewBox={compact ? "0 0 1024 1536" : "0 0 1536 1024"}
    >
      <defs>
        <linearGradient
          id={`${id}-meteor`}
          gradientUnits="userSpaceOnUse"
          x1="-135"
          y1="0"
          x2="0"
          y2="0"
        >
          <stop stopColor="#d5e9ff" stopOpacity="0" />
          <stop offset="1" stopColor="#eaf4ff" />
        </linearGradient>
      </defs>
      {meteors.map((meteor) => (
        <ShootingStar
          key={meteor}
          compact={compact}
          gradient={`${id}-meteor`}
          arrival={meteor === "arrival"}
        />
      ))}
    </svg>
  );
});

/** The painting, kept out of the animated layer so it is never repainted. */
const Painting = memo(function Painting({ compact, phase }: { compact: boolean; phase: DayPhase }) {
  const id = useId();
  const width = compact ? 1024 : 1536;
  const height = compact ? 1536 : 1024;
  const file = `savannah-burrows${phase === "day" ? "" : `-${phase}`}${compact ? "-mobile" : ""}-v1.webp`;
  return (
    <svg aria-hidden="true" className="painted-burrows" viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <linearGradient id={`${id}-sand`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="var(--scene-sand)" stopOpacity="0" />
          <stop offset="1" stopColor="var(--scene-sand)" />
        </linearGradient>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="var(--scene-sky)" />
          <stop offset="1" stopColor="var(--scene-sky)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <image href={`/img/${file}`} width={width} height={height} />
      {/* Feather only the edges; no hole sits under these fades. */}
      <rect width={width} height="100" fill={`url(#${id}-sky)`} />
      <rect y={height - 80} width={width} height="80" fill={`url(#${id}-sand)`} />
    </svg>
  );
});

function Burrows({
  visit,
  compact,
  phase,
}: {
  visit: Visit | null;
  compact: boolean;
  phase: DayPhase;
}) {
  const id = useId();
  const width = compact ? 1024 : 1536;
  const height = compact ? 1536 : 1024;
  const openings = compact ? [PHONE_OPENING] : OPENINGS;
  const where = visit && openings.find((opening) => opening.burrow === visit.burrow);
  const celebration =
    visit?.cameo === "celebrate" && where
      ? {
          sequence: visit.sequence,
          x: where.x + where.width / 2,
          y: where.y + where.height - 15,
        }
      : null;
  return (
    <div className={`painted-stage painted-stage--${compact ? "phone" : "wide"}`}>
      <Painting compact={compact} phase={phase} />
      <Details compact={compact} phase={phase} celebration={celebration} />
      <svg
        aria-hidden="true"
        className="painted-burrows painted-actors"
        viewBox={`0 0 ${width} ${height}`}
      >
        <defs>
          {openings.map((opening) => (
            <clipPath
              key={opening.burrow}
              id={`${id}-lip-${opening.burrow}`}
              clipPathUnits="userSpaceOnUse"
            >
              <path d={opening.clip} />
            </clipPath>
          ))}
        </defs>
        {visit && where && (
          <g clipPath={`url(#${id}-lip-${where.burrow})`}>
            <foreignObject x={where.x} y={where.y} width={where.width} height={where.height}>
              <div
                key={visit.sequence}
                className={`burrow-visitor painted-visitor${
                  visit.cameo === "bedtime" ? " burrow-visitor--bedtime" : ""
                }`}
              >
                <Meerkat cameo={visit.cameo} />
                {SAYINGS[visit.cameo] && (
                  <span className="burrow-secret">{SAYINGS[visit.cameo]}</span>
                )}
              </div>
            </foreignObject>
          </g>
        )}
        {phase === "night" && visit?.cameo === "bedtime" && where && (
          <g
            className="burrow-dreams"
            transform={`translate(${where.x + where.width / 2} ${where.y + where.height - 35})`}
          >
            {[0, 1, 2].map((i) => (
              <text
                key={i}
                className="burrow-dream"
                x={i * 12}
                y={-i * 16}
                style={{ animationDelay: `${i * 450}ms` }}
              >
                z
              </text>
            ))}
          </g>
        )}
      </svg>
    </div>
  );
}

/** The whole backdrop. Its sentries take turns, and answer to the page's mood. */
export function Savannah({ phase, mood = "idle" }: { phase: DayPhase; mood?: SavannahMood }) {
  const [visit, setVisit] = useState<Visit | null>(null);
  const [compact, setCompact] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.(COMPACT).matches === true,
  );
  const scene = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);
  const rare = useRef(0);
  const nextStarAt = useRef(0);
  const phaseRef = useRef(phase);
  const previousMood = useRef(mood);

  useEffect(() => {
    phaseRef.current = phase;
    if (phase === "night" && nextStarAt.current === 0) {
      nextStarAt.current = Date.now() + 90_000 + Math.random() * 60_000;
    }
  }, [phase]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const phone = window.matchMedia(COMPACT);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let previousBurrow = -1;
    let celebrate = mood === "paid" && previousMood.current !== "paid";
    previousMood.current = mood;

    const appear = () => {
      // A phone has one clearing below the card; wider screens take turns.
      const choices = [0, 1, 2].filter((burrow) => burrow !== previousBurrow);
      const burrow = phone.matches ? 2 : (choices[Math.floor(Math.random() * choices.length)] ?? 0);
      previousBurrow = burrow;
      const next = sequence.current++;
      let cameo: Cameo =
        next % 5 === 2 ? "coin" : next % 5 === 1 || next % 5 === 4 ? "cool" : "lookout";
      if (celebrate) {
        cameo = "celebrate";
        celebrate = false;
      } else if (mood === "thinking") {
        cameo = "curious";
      } else if (phaseRef.current === "night" && Date.now() >= nextStarAt.current) {
        cameo = "stargazer";
        nextStarAt.current = Date.now() + 90_000 + Math.random() * 60_000;
      } else if (Math.random() < 0.12) {
        const guests: Cameo[] =
          phaseRef.current === "night"
            ? ["bedtime", "coffee", "explorer"]
            : ["explorer", "coffee", "sleepy"];
        cameo = guests[rare.current++ % guests.length] ?? "explorer";
      }
      setVisit({ burrow, cameo, sequence: next });
      // The CSS and this timer share the duration, with a short margin after the retreat.
      timer = setTimeout(() => {
        setVisit(null);
        timer = setTimeout(appear, 5000 + Math.random() * 8000);
      }, visitDuration(cameo) + 200);
    };

    const sync = () => {
      clearTimeout(timer);
      setCompact(phone.matches);
      // Reduced motion or a hidden tab: one sentry, standing still.
      const resting = motion.matches || document.hidden;
      if (scene.current) {
        scene.current.dataset.resting = String(resting);
      }
      setVisit(resting ? { burrow: 2, cameo: "lookout", sequence: -1 } : null);
      if (resting) {
        celebrate = false;
      } else {
        timer = setTimeout(appear, celebrate || mood === "thinking" ? 180 : 1200);
      }
    };

    sync();
    motion.addEventListener("change", sync);
    phone.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      clearTimeout(timer);
      motion.removeEventListener("change", sync);
      phone.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [mood]);

  return (
    <div
      ref={scene}
      className="savannah-scene"
      style={{ "--burrow-visit-duration": `${visitDuration(visit?.cameo)}ms` } as CSSProperties}
      aria-hidden="true"
    >
      <ShootingStars
        compact={compact}
        phase={phase}
        arrival={visit?.sequence !== -1}
        star={visit?.cameo === "stargazer" ? visit.sequence : null}
      />
      <div className="savannah-landscape">
        <Burrows visit={visit} compact={compact} phase={phase} />
      </div>
    </div>
  );
}
