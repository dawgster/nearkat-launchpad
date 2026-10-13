const YOCTO_PER_NEAR = 10n ** 24n;

/** Formats yoctoNEAR as NEAR, rounded down, without trailing zeros. */
export function formatNear(yocto: string | bigint, decimals = 3): string {
  const value = BigInt(yocto);
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const unit = 10n ** BigInt(24 - decimals);
  const scaled = abs / unit;
  const whole = scaled / 10n ** BigInt(decimals);
  const fraction = (scaled % 10n ** BigInt(decimals))
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** Parses a NEAR amount typed by a person. Returns null if it is not a valid amount. */
export function parseNear(text: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{1,24}))?$/.exec(text.trim());
  if (!match) {
    return null;
  }
  const [, whole = "0", fraction = ""] = match;
  return BigInt(whole) * YOCTO_PER_NEAR + BigInt(fraction.padEnd(24, "0"));
}

/** Shortens a long account id or hash for display, keeping both ends. */
export function shorten(text: string, keep = 8): string {
  return text.length <= keep * 2 + 1 ? text : `${text.slice(0, keep)}…${text.slice(-keep)}`;
}
