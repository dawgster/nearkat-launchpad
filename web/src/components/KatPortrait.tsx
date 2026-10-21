import { useId } from "react";
import { type Accessory, describeKat, type KatTraits, katTraits, type Stage } from "../lib/art.ts";

const INK = "#1a110b";
const HOLE_Y = 100;
/** How far down the burrow the kat sits at each stage: it climbs out as it grows. */
const SINK: Record<Stage, number> = { 0: 36, 1: 20, 2: 0, 3: 0 };

function AccessoryArt({ kind, trim }: { kind: Accessory; trim: string }) {
  switch (kind) {
    case "scarf":
      return (
        <g fill={trim}>
          <path d="M45 57q15 9 30 0v6q-15 9-30 0Z" />
          <path d="M66 62l5 14-6 1-3-13Z" />
        </g>
      );
    case "bandana":
      return <path d="M46 58q14 7 28 0l-14 15Z" fill={trim} />;
    case "flower":
      return (
        <g transform="translate(77 27)">
          {[0, 72, 144, 216, 288].map((angle) => (
            <circle
              key={angle}
              cx={Math.cos((angle * Math.PI) / 180) * 3.2}
              cy={Math.sin((angle * Math.PI) / 180) * 3.2}
              r="2.6"
              fill={trim}
            />
          ))}
          <circle r="2" fill="#f2bd35" />
        </g>
      );
    case "beanie":
      return (
        <g fill={trim}>
          <path d="M43 30q17-26 34 0Z" />
          <rect x="42" y="27" width="36" height="5" rx="2.5" />
          <rect x="42" y="27" width="36" height="5" rx="2.5" fill="#000" opacity="0.2" />
          <circle cx="60" cy="9" r="3.5" />
        </g>
      );
    case "glasses":
      return (
        <g fill="none" stroke={trim} strokeWidth="1.8">
          <circle cx="51" cy="38" r="6.5" />
          <circle cx="69" cy="38" r="6.5" />
          <path d="M57.5 37h5" />
        </g>
      );
    case "leaf":
      return (
        <g transform="translate(60 19) rotate(-25)">
          <path d="M0 0c-3-8 2-14 10-15-1 8-4 14-10 15Z" fill="#4caf6a" />
          <path d="M0 0c3-5 6-9 10-15" stroke="#2e7a45" strokeWidth="0.8" fill="none" />
        </g>
      );
    case "star":
      return (
        <path
          d="M60 70l2 4.2 4.6.6-3.4 3.2.9 4.6-4.1-2.3-4.1 2.3.9-4.6-3.4-3.2 4.6-.6Z"
          fill={trim}
        />
      );
  }
}

function Kat({ t, stage }: { t: KatTraits; stage: Stage }) {
  const { fur, shade, belly } = t.fur;
  const eyeR = t.eyes === "bright" ? 3.6 : 3;
  return (
    <g>
      {/* body, upright on its haunches */}
      <path d="M43 114c-2-24 3-46 17-53 14 7 19 29 17 53Z" fill={fur} />
      <ellipse cx="60" cy="90" rx="9.5" ry="19" fill={belly} />
      <ellipse cx="53" cy="74" rx="3.6" ry="6" fill={shade} transform="rotate(18 53 74)" />
      <ellipse cx="67" cy="74" rx="3.6" ry="6" fill={shade} transform="rotate(-18 67 74)" />
      {stage >= 2 && t.accessory === "star" && <AccessoryArt kind="star" trim={t.trim} />}
      <g transform={`rotate(${t.tilt} 60 58)`}>
        {/* ears sit behind the head */}
        <circle cx="42.5" cy="35" r="5" fill={shade} />
        <circle cx="77.5" cy="35" r="5" fill={shade} />
        <path d="M42 38c0-14 8-20 18-20s18 6 18 20c0 10-10 20-18 22-8-2-18-12-18-22Z" fill={fur} />
        <path d="M54 20c2 6 10 6 12 0" fill="none" stroke={shade} strokeWidth="2" />
        {/* the dark patches that make a meerkat look like it is wearing sunglasses */}
        <ellipse cx="51" cy="38.5" rx="6" ry="7.5" fill="#2a1a10" transform="rotate(16 51 38.5)" />
        <ellipse cx="69" cy="38.5" rx="6" ry="7.5" fill="#2a1a10" transform="rotate(-16 69 38.5)" />
        <circle cx="51" cy="38" r={eyeR} fill="#050505" />
        <circle cx="69" cy="38" r={eyeR} fill="#050505" />
        {t.eyes === "sleepy" ? (
          <>
            <path d="M47.6 37.6a3.6 3.6 0 0 1 6.8 0Z" fill="#2a1a10" />
            <path d="M65.6 37.6a3.6 3.6 0 0 1 6.8 0Z" fill="#2a1a10" />
          </>
        ) : (
          <>
            <circle cx="52.2" cy="36.8" r="1.1" fill={t.eyes === "bright" ? t.sky.glow : "#fff"} />
            <circle cx="70.2" cy="36.8" r="1.1" fill={t.eyes === "bright" ? t.sky.glow : "#fff"} />
          </>
        )}
        <ellipse cx="60" cy="50.5" rx="7" ry="6.5" fill={belly} />
        <ellipse cx="60" cy="54.5" rx="3.2" ry="2.2" fill={INK} />
        <path
          d="M58 58.4q2 1.6 4 0"
          fill="none"
          stroke={INK}
          strokeWidth="0.9"
          strokeLinecap="round"
        />
        {stage >= 2 && t.accessory !== "star" && <AccessoryArt kind={t.accessory} trim={t.trim} />}
      </g>
    </g>
  );
}

/**
 * A kat's portrait. Its look comes from `seed`; how far it has climbed out
 * of its burrow, and what it wears, from its growth stage.
 */
export function KatPortrait({
  seed,
  stage = 0,
  size = 96,
  label,
  decorative = false,
}: {
  seed: string;
  stage?: Stage;
  size?: number;
  /** Accessible name. Defaults to a description of the kat. */
  label?: string;
  decorative?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const t = katTraits(seed);
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: the title is added below unless the art is hidden as decorative.
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className="shrink-0"
      {...(decorative ? { "aria-hidden": true } : { role: "img" })}
    >
      {!decorative && <title>{label ?? describeKat(t, stage)}</title>}
      <defs>
        <linearGradient id={`${id}sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={t.sky.top} />
          <stop offset="1" stopColor={t.sky.bottom} />
        </linearGradient>
        <radialGradient id={`${id}halo`}>
          <stop offset="0" stopColor={t.sky.glow} stopOpacity={stage === 3 ? 0.55 : 0.28} />
          <stop offset="1" stopColor={t.sky.glow} stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${id}frame`}>
          <circle cx="60" cy="60" r="60" />
        </clipPath>
        {/* the kat is hidden below the lip of its burrow */}
        <clipPath id={`${id}above`}>
          <rect width="120" height={HOLE_Y + 1} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}frame)`}>
        <rect width="120" height="120" fill={`url(#${id}sky)`} />
        {t.stars.map(([x, y, r], index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list derived from the seed.
          <circle key={index} cx={x * 120} cy={y * 120} r={r * 0.7} fill="#f4ecd9" opacity="0.7" />
        ))}
        <circle cx="60" cy="58" r="44" fill={`url(#${id}halo)`} />
        {stage === 3 && (
          <circle
            cx="60"
            cy="56"
            r="40"
            fill="none"
            stroke={t.sky.glow}
            strokeOpacity="0.5"
            strokeWidth="1.2"
            strokeDasharray="2 5"
          />
        )}
        <path d="M0 120V101q60-22 120 0v19Z" fill="#4a3323" />
        <ellipse cx="60" cy={HOLE_Y} rx="27" ry="7" fill="#120a05" />
        <g clipPath={`url(#${id}above)`}>
          <g
            transform={`translate(0 ${SINK[stage]})${stage === 0 ? " translate(60 100) scale(0.86) translate(-60 -100)" : ""}`}
          >
            <Kat t={t} stage={stage} />
          </g>
        </g>
        <path d="M0 120v-12q60-10 120 0v12Z" fill="#2a1a10" />
      </g>
    </svg>
  );
}
