import { stageOf } from "../lib/art.ts";
import { KatPortrait } from "./KatPortrait.tsx";
import { TokenSigil } from "./TokenSigil.tsx";

/**
 * A token's picture: a kat for the home collection, a sigil for collections
 * launched on the launchpad, which can hold any kind of prompt.
 */
export function TokenArt({
  contractId,
  tokenId,
  contextVersion,
  style,
  size,
  label,
  decorative,
}: {
  contractId: string;
  tokenId: string;
  /** From the contract. Unknown means the token is drawn as newly minted. */
  contextVersion?: number;
  style: "kat" | "sigil";
  size?: number;
  label?: string;
  decorative?: boolean;
}) {
  const common = { stage: stageOf(contextVersion ?? 1), size, label, decorative };
  return style === "kat" ? (
    <KatPortrait tokenId={tokenId} {...common} />
  ) : (
    <TokenSigil seed={`${contractId}/${tokenId}`} {...common} />
  );
}
