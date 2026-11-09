import { type FormEvent, useState } from "react";
import type { SampleTerms } from "../lib/contract.ts";
import { parseNear } from "../lib/format.ts";
import { describeProblem } from "../lib/problems.ts";
import { Icon } from "./Icon.tsx";

export interface ListSamplesPanelProps {
  /** Samples the holder owns that can be listed now. */
  available: string[];
  /** `[app_id, label]` of the registered training apps. */
  apps: Array<[string, string]>;
  list: (tokenIds: string[], terms: SampleTerms) => Promise<number>;
}

const LENGTHS: Array<[string, number | null]> = [
  ["A day", 86_400],
  ["A week", 7 * 86_400],
  ["30 days", 30 * 86_400],
  ["Until used", null],
];

/** List some of your samples for rent to named training apps. */
export function ListSamplesPanel({ available, apps, list }: ListSamplesPanelProps) {
  const [count, setCount] = useState(String(available.length));
  const [fee, setFee] = useState("0.01");
  const [length, setLength] = useState("604800");
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const n = Number(count);
    const price = parseNear(fee);
    setOutcome(null);
    if (!Number.isInteger(n) || n < 1 || n > available.length) {
      return setOutcome({ ok: false, text: `Choose between 1 and ${available.length} samples.` });
    }
    if (price === null) {
      return setOutcome({ ok: false, text: "The fee is an amount in NEAR, like 0.01." });
    }
    if (chosen.length < 1 || chosen.length > 8) {
      return setOutcome({ ok: false, text: "Pick 1 to 8 training apps." });
    }
    setBusy(true);
    try {
      const listed = await list(available.slice(0, n), {
        durationS: length === "none" ? null : Number(length),
        fee: price,
        apps: chosen,
      });
      setOutcome({ ok: true, text: `Listed ${listed} ${listed === 1 ? "sample" : "samples"}.` });
    } catch (error) {
      setOutcome({ ok: false, text: describeProblem(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="list-samples" className="card">
      <h2 id="list-samples" className="card-title flex items-center gap-2">
        <Icon name="clock" size={18} className="text-mist" />
        List your samples
      </h2>
      {available.length === 0 ? (
        <p className="mt-3 text-sm text-mist">You have no samples free to list.</p>
      ) : (
        <form className="mt-3 space-y-3" onSubmit={(event) => void submit(event)}>
          <p className="text-sm leading-relaxed text-mist">
            Each listed sample can be rented once, for one training run, by an app you name. You
            keep it, and it is paid for in full when rented.
          </p>
          <div className="grid grid-cols-3 gap-2">
            <label className="text-sm">
              <span className="mb-1 block text-xs text-mist">Samples ({available.length})</span>
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
