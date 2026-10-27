/**
 * Whether text gives away a collection's secret instructions. The model is
 * told never to reveal them, but can be talked into it; this catches quoting
 * them. It looks for any run of six words from the instructions, ignoring
 * case and punctuation, or the whole of instructions shorter than that; and,
 * ignoring spaces and punctuation altogether, any 24 letters in a row from
 * them, which catches spelling out ("s-e-c-r-e-t"). Callers pass the recent
 * replies together, so a quote split across replies is caught too.
 * Paraphrase gets through: this narrows the leak, it doesn't close it.
 */
const RUN = 6;
const LETTERS = 24;

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
  const secretLetters = secretWords.join("");
  const saidLetters = words(reply).join("");
  if (secretLetters.length >= LETTERS) {
    for (let i = 0; i + LETTERS <= secretLetters.length; i++) {
      if (saidLetters.includes(secretLetters.slice(i, i + LETTERS))) {
        return true;
      }
    }
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
