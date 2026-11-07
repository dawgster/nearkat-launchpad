import { useId } from "react";
import { katForToken } from "../../../art/kat/collection.ts";
import { renderKat } from "../../../art/kat/render.ts";
import type { Stage } from "../lib/art.ts";

/**
 * A kat's portrait: its six traits, fixed at mint, framed by its growth
 * stage. Drawn by the art module the keeper also serves to wallets and
 * marketplaces, so it looks the same everywhere.
 */
export function KatPortrait({
  tokenId,
  stage = 0,
  size = 96,
  label,
  decorative = false,
}: {
  tokenId: string;
  stage?: Stage;
  size?: number;
  /** Accessible name. Defaults to a description of the kat. */
  label?: string;
  decorative?: boolean;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const svg = renderKat(katForToken(tokenId), stage, {
    id,
    size,
    title: decorative ? null : label,
  });
  // The markup is built from fixed shapes; any text in it (the title) is escaped.
  return (
    <span
      className="inline-flex shrink-0 overflow-hidden rounded-[18%]"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: generated art, see above.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
