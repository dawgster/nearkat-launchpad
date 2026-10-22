import { useId } from "react";
import { sigilSvg } from "../../../art/svg.ts";
import type { Stage } from "../lib/art.ts";

/**
 * Art for a token of a launched collection: an abstract sigil whose shape
 * comes from `seed` and which gains rings and light as the token grows.
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
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const svg = sigilSvg(seed, stage, { size, idPrefix: id, title: decorative ? null : label });
  // biome-ignore lint/security/noDangerouslySetInnerHtml: generated art; any text in it is escaped.
  return <span className="inline-flex shrink-0" dangerouslySetInnerHTML={{ __html: svg }} />;
}
