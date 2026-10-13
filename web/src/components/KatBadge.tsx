const RIMS = ["var(--color-glow)", "var(--color-lamp)", "var(--color-clay)", "var(--color-cream)"];

/**
 * Stands in for a kat's portrait until the artwork exists: the mouth of its
 * burrow, with its number, rimmed in one of four colours chosen by its id.
 */
export function KatBadge({ tokenId, size = 72 }: { tokenId: string; size?: number }) {
  const rim = RIMS[Number(tokenId) % RIMS.length] ?? RIMS[0];
  return (
    <span
      role="img"
      aria-label={`Nearkat ${tokenId}`}
      className="inline-grid shrink-0 place-items-center rounded-full font-display text-cream"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.34,
        background:
          "radial-gradient(circle at 50% 62%, #000 38%, var(--color-soil) 39%, var(--color-root) 100%)",
        boxShadow: `0 0 0 2px ${rim}, 0 0 ${size * 0.3}px -4px ${rim}`,
      }}
    >
      {tokenId}
    </span>
  );
}
