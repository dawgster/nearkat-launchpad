import type { Stage } from "../lib/art.ts";
import type { LoanTraining, LoanView, RunView } from "../lib/contract.ts";
import { formatNear, shorten } from "../lib/format.ts";
import { TokenSigil } from "./TokenSigil.tsx";

/** An app: its own label, which anyone could have chosen to look like another's, then its id. */
function App({ id, labels }: { id: string; labels: Record<string, string> }) {
  const label = labels[id];
  return (
    <span className="break-all">
      {label ? `${label} ` : ""}
      <span className="font-mono text-xs text-mist">({id})</span>
    </span>
  );
}

/**
 * A dataset sample's page: who owns it, whether it is on offer, and the
 * training runs that have used it. Never its picture: nobody can see that.
 */
export function SamplePanel({
  name,
  seed,
  owner,
  loan,
  training,
  runs,
  runCount,
  labels,
}: {
  name: string;
  seed: string;
  owner: string;
  loan: LoanView | null;
  training: LoanTraining | null;
  runs: RunView[];
  /** How many runs the contract counts; may exceed what was read. */
  runCount: number;
  labels: Record<string, string>;
}) {
  const stage = Math.min(3, runCount) as Stage;
  const current = loan && loan.status !== "over" ? loan : null;
  // A rental is for one training use: once spent, the contract reads it as over.
  const status = !current
    ? training?.spent
      ? "Used; the rental is over"
      : "Not listed"
    : current.status === "offered"
      ? "On offer"
      : "Rented";
  return (
    <div className="mt-8 space-y-5">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-7">
        <TokenSigil seed={seed} stage={stage} size={128} decorative />
        <div className="min-w-0">
          <h1 className="text-4xl sm:text-6xl">{name}</h1>
          <p className="mt-3 text-sm text-mist">
            Owned by{" "}
            <span className="font-mono text-cream" title={owner}>
              {shorten(owner, 12)}
            </span>
          </p>
          <p className="mt-2 text-sm text-mist">Nobody can see this image, its owner included.</p>
        </div>
      </header>
      <section className="card" aria-labelledby="rental">
        <h2 id="rental" className="card-title">
          Rental
        </h2>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-sm">
          <dt className="text-mist">Status</dt>
          <dd data-testid="sample-status">{status}</dd>
          {current && (
            <>
              <dt className="text-mist">Fee per rental</dt>
              <dd>{formatNear(current.fee)} NEAR</dd>
            </>
          )}
          {training && training.apps.length > 0 && (
            <>
              <dt className="text-mist">Offered to</dt>
              <dd>
                <ul className="space-y-1">
                  {training.apps.map((id) => (
                    <li key={id}>
                      <App id={id} labels={labels} />
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          )}
          {current?.status === "active" && current.borrower_id && (
            <>
              <dt className="text-mist">Rented by</dt>
              <dd className="break-all font-mono">{current.borrower_id}</dd>
            </>
          )}
          <dt className="text-mist">Earned</dt>
          <dd>
            {current
              ? `fee per rental: ${formatNear(current.fee)} NEAR · rented for ${runCount} ${runCount === 1 ? "run" : "runs"}`
              : `rented for ${runCount} ${runCount === 1 ? "run" : "runs"}`}
          </dd>
        </dl>
      </section>
      <section className="card" aria-labelledby="runs">
        <h2 id="runs" className="card-title">
          Training runs
        </h2>
        {runs.length === 0 ? (
          <p className="mt-3 text-sm text-mist">No training run has used this sample yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {runs.map((run) => (
              <li key={run.run_id} className="rounded-xl bg-black/25 p-3.5 text-sm">
                <p className="font-mono text-xs text-mist">{run.run_id}</p>
                <p className="mt-1">
                  <App id={run.app_id} labels={labels} />, accuracy{" "}
                  {(run.accuracy_bps / 100).toFixed(2)}%
                </p>
                <p className="mt-1 text-xs text-mist">
                  model <span className="font-mono">{shorten(run.model_sha256, 8)}</span>, rented by{" "}
                  <span className="font-mono">{run.renter_id}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
