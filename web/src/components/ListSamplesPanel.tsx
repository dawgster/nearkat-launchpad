import { type FormEvent, useEffect, useState } from "react";
import type { SampleTerms } from "../lib/contract.ts";
import { parseNear } from "../lib/format.ts";
import { describeProblem } from "../lib/problems.ts";
import { Icon } from "./Icon.tsx";

export interface ListSamplesPanelProps {
  /** Samples the holder owns that are not on offer or rented now. */
  available: string[];
  /** The holder's samples already on offer: listing them again replaces their terms. */
  offered?: string[];
  /** `[app_id, label]` of the registered training apps. */
  apps: Array<[string, string]>;
  list: (tokenIds: string[], terms: SampleTerms) => Promise<number>;
  /** Withdraws offers; returns how many. Without it there is no withdraw button. */
  withdraw?: (tokenIds: string[]) => Promise<number>;
}

const LENGTHS: Array<[string, number | null]> = [
  ["A day", 86_400],
  ["A week", 7 * 86_400],
  ["30 days", 30 * 86_400],
  ["Until used", null],
];

const samples = (n: number) => `${n} ${n === 1 ? "sample" : "samples"}`;

/**
 * List some of your samples for rent to named training apps. New samples by
 * default; samples already on offer only when asked, to change their terms.
 */
export function ListSamplesPanel({
  available,
  offered = [],
  apps,
  list,
  withdraw,
}: ListSamplesPanelProps) {
  const [count, setCount] = useState(String(available.length));
  const [relist, setRelist] = useState(false);
  const [fee, setFee] = useState("0.01");
  const [length, setLength] = useState("604800");
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);
  // Fewer samples are free once some are listed.
  useEffect(() => setCount(String(available.length)), [available.length]);
  // With nothing on offer there is nothing to change.
  useEffect(() => {
    if (offered.length === 0) {
      setRelist(false);
    }
  }, [offered.length]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const n = count.trim() === "" && relist ? 0 : Number(count);
    const price = parseNear(fee);
    setOutcome(null);
    const least = relist ? 0 : 1;
    if (!Number.isInteger(n) || n < least || n > available.length) {
      return setOutcome({
        ok: false,
        text:
          available.length === 0
            ? "You have no new samples to list. Tick the box to change the terms of those on offer."
            : `Choose between ${least} and ${available.length} samples.`,
      });
    }
    if (price === null) {
      return setOutcome({ ok: false, text: "The fee is an amount in NEAR, like 0.01." });
    }
    if (chosen.length < 1 || chosen.length > 8) {
      return setOutcome({ ok: false, text: "Pick 1 to 8 training apps." });
    }
    setBusy(true);
    try {
      const listed = await list([...available.slice(0, n), ...(relist ? offered : [])], {
        durationS: length === "none" ? null : Number(length),
        fee: price,
        apps: chosen,
      });
      setOutcome({ ok: true, text: `Listed ${samples(listed)}.` });
    } catch (error) {
      setOutcome({ ok: false, text: describeProblem(error) });
    } finally {
      setBusy(false);
    }
  }

  async function withdrawAll() {
    if (!withdraw) {
      return;
    }
    setOutcome(null);
    setBusy(true);
    try {
      const withdrawn = await withdraw(offered);
      setOutcome({ ok: true, text: `Withdrew the offers on ${samples(withdrawn)}.` });
    } catch (error) {
      setOutcome({ ok: false, text: describeProblem(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="list-samples" className="card">
      <h2 id="list-samples" className="card-title flex items-center gap-2">
        <Icon name="gift" size={18} className="text-mist" />
        List your samples
      </h2>
      {available.length === 0 && offered.length === 0 ? (
        <p className="mt-3 text-sm text-mist">You have no samples free to list.</p>
      ) : (
        <form className="mt-3 space-y-3" onSubmit={(event) => void submit(event)}>
          <p className="text-sm leading-relaxed text-mist">
            Each listed sample can be rented once, for one training run, by an app you name. You
            keep it, and it is paid for in full when rented.
          </p>
          <div className="grid grid-cols-3 gap-2">
            <label className="text-sm">
              <span className="mb-1 block text-xs text-mist">
                {offered.length > 0 ? "New samples" : "Samples"} ({available.length})
              </span>
              <input
                className="field text-right"
                inputMode="numeric"
                value={count}
                onChange={(event) => setCount(event.target.value)}
                aria-label="How many to list"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-mist">Fee each (NEAR)</span>
              <input
                className="field text-right"
                inputMode="decimal"
                value={fee}
                onChange={(event) => setFee(event.target.value)}
                aria-label="Fee per sample in NEAR"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-mist">Offer lasts</span>
              <select
                className="field"
                value={length}
                onChange={(event) => setLength(event.target.value)}
                aria-label="How long a rental lasts"
              >
                {LENGTHS.map(([label, seconds]) => (
                  <option key={label} value={seconds === null ? "none" : String(seconds)}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {offered.length > 0 && (
            <label className="option !py-2.5 text-sm">
              <input
                type="checkbox"
                checked={relist}
                onChange={(event) => setRelist(event.target.checked)}
              />
              <span>
                Also change the terms of {offered.length === 1 ? "the" : `the ${offered.length}`}{" "}
                {offered.length === 1 ? "sample" : "samples"} you already have on offer
              </span>
            </label>
          )}
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs text-mist">Training apps allowed</legend>
            {apps.map(([id, label]) => (
              <label key={id} className="option !py-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={chosen.includes(id)}
                  onChange={(event) =>
                    setChosen((now) =>
                      event.target.checked ? [...now, id] : now.filter((app) => app !== id),
                    )
                  }
                />
                <span className="min-w-0 break-words">
                  {label || "(no label)"}
                  <span className="block font-mono text-xs text-mist">{id}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <button type="submit" className="button button-quiet w-full" disabled={busy}>
            {busy ? "Listing…" : "List for rent"}
          </button>
          {withdraw && offered.length > 0 && (
            <button
              type="button"
              className="button button-quiet w-full"
              disabled={busy}
              onClick={() => void withdrawAll()}
            >
              Withdraw {offered.length === 1 ? "your offer" : `your ${offered.length} offers`}
            </button>
          )}
        </form>
      )}
      {outcome && (
        <p
          role={outcome.ok ? "status" : "alert"}
          className={`mt-4 rounded-xl border px-3 py-2 text-sm ${
            outcome.ok
              ? "border-glow/30 bg-glow/10 text-glow"
              : "border-alarm/30 bg-alarm/10 text-alarm"
          }`}
        >
          {outcome.text}
        </p>
      )}
    </section>
  );
}

/** In place of the panel when the holder's samples can't be read. */
export function ListSamplesUnavailable({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <section aria-labelledby="list-samples" className="card">
      <h2 id="list-samples" className="card-title flex items-center gap-2">
        <Icon name="gift" size={18} className="text-mist" />
        List your samples
      </h2>
      <p role="alert" className="mt-2 text-sm text-alarm">
        Can't read your samples right now. {describeProblem(error)}
      </p>
      <button type="button" className="button button-quiet mt-3" onClick={onRetry}>
        Retry
      </button>
    </section>
  );
}
