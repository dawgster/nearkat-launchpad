/**
 * Who the kat has become. Read-only on purpose: a kat's character grows out
 * of how it is treated, and nobody can write it, its owner included.
 */
export function CharacterPanel({ character }: { character: string }) {
  return (
    <section aria-labelledby="character">
      <h2 id="character" className="font-sans text-lg font-bold">
        Character
      </h2>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-cream">{character}</p>
      <p className="mt-3 text-sm text-mist">
        Nobody writes this, you included. It changes a little each time the kat saves what it
        learned from talking with you.
      </p>
    </section>
  );
}
