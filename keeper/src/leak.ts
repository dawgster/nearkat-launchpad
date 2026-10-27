/**
 * Whether a reply gives away a collection's secret instructions. The model is
 * told never to reveal them, but can be talked into it; this catches the
 * common case of quoting them. It looks for any run of six words from the
 * instructions, ignoring case and punctuation, or the whole of instructions
 * shorter than that. Paraphrase gets through: this narrows the leak, it
 * doesn't close it.
 */
const RUN = 6;

const words = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

export function leaksSecret(reply: string, secret: string): boolean {
  const secretWords = words(secret);
  if (secretWords.length === 0) {
    return false;
  }
  const said = ` ${words(reply).join(" ")} `;
  if (secretWords.length <= RUN) {
    return said.includes(` ${secretWords.join(" ")} `);
  }
  for (let i = 0; i + RUN <= secretWords.length; i++) {
    if (said.includes(` ${secretWords.slice(i, i + RUN).join(" ")} `)) {
      return true;
    }
  }
  return false;
}
