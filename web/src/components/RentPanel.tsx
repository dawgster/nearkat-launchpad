import { type FormEvent, useMemo, useState } from "react";
import { type Offer, pickRentable, SAMPLE_SCAN_LIMIT } from "../lib/contract.ts";
import { formatNear } from "../lib/format.ts";
import { describeProblem } from "../lib/problems.ts";
import { MIN_TRAIN_SAMPLES } from "../lib/trainer.ts";
import { Icon } from "./Icon.tsx";

export interface RentPanelProps {
  offers: Offer[];
  /** App labels by app id. They are the apps' own words, so the id is always shown too. */
  labels: Record<string, string>;
  /** The account renting. Its own samples are not offered to it. */
  renter?: string;
  /** Rents these samples for the app, attaching each one's fee; resolves to how many were rented. */
  borrow: (tokenIds: string[], appId: string) => Promise<number>;
}

/** Rent some samples for a training app, spreading them across as many holders as possible. */
export function RentPanel({ offers: all, renter, labels, borrow }: RentPanelProps) {
  const offers = useMemo(() => all.filter((offer) => offer.lender !== renter), [all, renter]);
  const apps = useMemo(() => [...new Set(offers.flatMap((offer) => offer.apps))].sort(), [offers]);
  const [chosen, setApp] = useState("");
  const appId = apps.includes(chosen) ? chosen : (apps[0] ?? "");
  const [count, setCount] = useState(String(MIN_TRAIN_SAMPLES));
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);

  const onOffer = offers.filter((offer) => offer.apps.includes(appId));
  const wanted = Number(count);
  const valid = Number.isInteger(wanted) && wanted >= 1;
  const picked = valid ? pickRentable(offers, appId, wanted, renter) : [];
  const byId = new Map(offers.map((offer) => [offer.tokenId, offer]));
  const total = picked.reduce((sum, id) => sum + (byId.get(id)?.fee ?? 0n), 0n);
  const sum = onOffer.reduce((acc, offer) => acc + offer.fee, 0n);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (picked.length === 0) {
      return;
    }
    setBusy(true);
    setOutcome(null);
    try {
      const rented = await borrow(picked, appId);
      const holders = new Set(picked.map((id) => byId.get(id)?.lender)).size;
      setOutcome({
        ok: true,
        text: `Rented ${rented} ${rented === 1 ? "sample" : "samples"} for ${appId}, paid ${holders} ${holders === 1 ? "holder" : "holders"}. Only ${appId} can open them.`,
      });
    } catch (error) {
      setOutcome({ ok: false, text: describeProblem(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="rent" className="card">
      <h2 id="rent" className="card-title flex items-center gap-2">
        <Icon name="clock" size={18} className="text-mist" />
        Rent samples
      </h2>
      {apps.length === 0 ? (
        <p className="mt-3 text-sm text-mist">No samples are on offer right now.</p>
      ) : (
        <form className="mt-3 space-y-3" onSubmit={(event) => void submit(event)}>
          <p className="text-sm leading-relaxed text-mist">
            Each sample can be used for one training run by the app you name. You never see the
            pictures; the app opens them inside its own enclave.
          </p>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-mist">Training app</span>
            <select
              className="field"
              value={appId}
              onChange={(event) => setApp(event.target.value)}
              aria-label="Training app"
            >
              {apps.map((id) => (
                <option key={id} value={id}>
                  {labels[id] ? `${labels[id]} (${id})` : id}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-mist">
            {onOffer.length} on offer for {appId}, {formatNear(sum)} NEAR in all. Looks through the
            first {SAMPLE_SCAN_LIMIT} samples of the collection.
          </p>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-mist">How many</span>
            <input
              className="field text-right"
              inputMode="numeric"
              value={count}
              onChange={(event) => setCount(event.target.value)}
              aria-label="How many samples"
            />
          </label>
          <button
            type="submit"
            className="button button-quiet w-full"
            disabled={busy || picked.length === 0}
          >
            {busy
              ? "Renting…"
              : picked.length === 0
                ? "Rent"
                : `Rent ${picked.length} ${picked.length === 1 ? "sample" : "samples"} for ${formatNear(total)} NEAR`}
          </button>
          {valid && picked.length < wanted && (
            <p className="text-xs text-mist">Only {picked.length} are on offer for this app.</p>
          )}
          {valid && wanted < MIN_TRAIN_SAMPLES && (
            <p className="text-xs text-mist">
              A training run needs at least {MIN_TRAIN_SAMPLES} samples rented for the same app.
            </p>
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
