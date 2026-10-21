import { useId } from "react";
import { PLAIN_STAGE_NAMES, type Stage, sigilTraits } from "../lib/art.ts";

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
export function TokenSigil({
  seed,
  stage = 0,
  size = 96,
  label,
  decorative = false,
}: {
  seed: string;
  stage?: Stage;
  size?: number;
  label?: string;
  decorative?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const t = sigilTraits(seed);
  const main = `hsl(${t.hue} 80% 62%)`;
  const deep = `hsl(${t.hue} 55% 14%)`;
  const accent = `hsl(${(t.hue + 150) % 360} 85% 66%)`;
  const rings = Math.min(t.rings, stage + 1);
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: the title is added below unless the art is hidden as decorative.
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className="shrink-0"
      {...(decorative ? { "aria-hidden": true } : { role: "img" })}
    >
      {!decorative && <title>{label ?? `${PLAIN_STAGE_NAMES[stage]} sigil`}</title>}
      <defs>
        <radialGradient id={`${id}bg`} cx="0.5" cy="0.45" r="0.7">
          <stop offset="0" stopColor={`hsl(${t.hue} 50% 24%)`} />
          <stop offset="1" stopColor={deep} />
        </radialGradient>
        <radialGradient id={`${id}core`}>
          <stop offset="0" stopColor={accent} stopOpacity={0.25 + stage * 0.2} />
          <stop offset="1" stopColor={accent} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="60" r="60" fill={`url(#${id}bg)`} />
      <circle cx="60" cy="60" r="44" fill={`url(#${id}core)`} />
      {Array.from({ length: rings }, (_, i) => (
        <circle
          // biome-ignore lint/suspicious/noArrayIndexKey: rings are positional.
          key={i}
          cx="60"
          cy="60"
          r={50 - i * 6}
          fill="none"
          stroke={main}
          strokeOpacity={0.55 - i * 0.12}
          strokeWidth="1.2"
          strokeDasharray={i % 2 ? "3 4" : undefined}
        />
      ))}
      <polygon
        points={polygon(t.points, 30, t.turn)}
        fill="none"
        stroke={main}
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      {stage >= 2 && (
        <polygon
          points={polygon(t.points, 30, t.turn + 180 / t.points)}
          fill="none"
          stroke={accent}
          strokeWidth="1.4"
          strokeLinejoin="round"
          opacity="0.8"
        />
      )}
      {t.inner === "circle" && <circle cx="60" cy="60" r="9" fill={main} />}
      {t.inner === "diamond" && <path d="M60 49l11 11-11 11-11-11Z" fill={main} />}
      {t.inner === "eye" && (
        <>
          <path d="M44 60q16-14 32 0-16 14-32 0Z" fill={main} />
          <circle cx="60" cy="60" r="4.5" fill={deep} />
        </>
      )}
      {stage === 3 && <circle cx="60" cy="60" r="56" fill="none" stroke={accent} strokeWidth="2" />}
    </svg>
  );
}
