import { PLAIN_STAGE_NAMES, STAGE_NAMES, savesToNextStage, stageOf } from "../lib/art.ts";

/**
 * How grown-up a token is. Growth is read from the contract: every saved
 * conversation bumps the context version, so anyone can see it, while what
 * was said stays private.
 */
export function Growth({
  contextVersion,
  plain = false,
}: {
  contextVersion: number;
  /** Neutral stage names, for collections that aren't kats. */
  plain?: boolean;
}) {
  const names = plain ? PLAIN_STAGE_NAMES : STAGE_NAMES;
  const stage = stageOf(contextVersion);
  const left = savesToNextStage(contextVersion);
  const saved = Math.max(contextVersion - 1, 0);
  return (
    <section className="text-sm" aria-label="Growth">
      <p>
        <span className="font-bold text-lamp">{names[stage]}</span>
        <span className="text-mist">
          {" · "}
          {saved === 0
            ? "no conversations saved yet"
            : `${saved} conversation${saved === 1 ? "" : "s"} saved`}
        </span>
      </p>
      <ol className="mt-2 flex gap-1.5" aria-hidden="true">
        {names.map((name, index) => (
          <li
            key={name}
            className={`h-1.5 w-10 rounded-full ${index <= stage ? "bg-lamp" : "bg-cream/15"}`}
          />
        ))}
      </ol>
      {left !== null && (
        <p className="mt-2 text-mist">
          {left} more saved conversation{left === 1 ? "" : "s"} until{" "}
          {plain ? `the ${names[stage + 1]} stage` : `it becomes a ${names[stage + 1]}`}.
        </p>
      )}
    </section>
  );
}
