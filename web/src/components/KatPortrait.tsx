import { useId } from "react";
import { katSvg } from "../../../art/svg.ts";
import type { Stage } from "../lib/art.ts";

/**
 * A kat's portrait. Its look comes from `seed`; how far it has climbed out
 * of its burrow, and what it wears, from its growth stage. Drawn by the art
 * module the keeper also serves to marketplaces.
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
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const svg = katSvg(seed, stage, {
    size,
    idPrefix: id,
    title: decorative ? null : label,
  });
  // The markup is built from fixed shapes and seeded numbers; any text in it is escaped.
  // biome-ignore lint/security/noDangerouslySetInnerHtml: generated art, see above.
  return <span className="inline-flex shrink-0" dangerouslySetInnerHTML={{ __html: svg }} />;
}
