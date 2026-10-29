import { type FormEvent, useState } from "react";
import { formatNear, parseNear } from "../lib/format.ts";
import { describeProblem } from "../lib/problems.ts";
import { Icon } from "./Icon.tsx";

export interface FundPanelProps {
  balance: bigint;
  /** Draws attention to the panel after the kat ran out of NEAR. */
  urgent: boolean;
  fund: (amount: bigint) => Promise<void>;
  /** What one token is called, as in "It stays with the kat". */
  noun?: string;
}

export function FundPanel({ balance, urgent, fund, noun = "kat" }: FundPanelProps) {
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const parsed = parseNear(amount);
  const valid = parsed !== null && parsed > 0n;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) {
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await fund(parsed);
    } catch (error) {
      setProblem(describeProblem(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={`card ${urgent ? "card-lit ring-2 ring-lamp" : ""}`}>
      <h2 className="card-title flex items-center gap-2">
        <Icon name="coin" size={18} className="text-mist" />
        Balance
      </h2>
      <p className="mt-2 flex items-baseline gap-1.5">
        <span className="font-display text-3xl tracking-tight">{formatNear(balance)}</span>
        <span className="text-sm text-mist">NEAR</span>
      </p>
      <p className="mt-1 text-sm text-mist">
        Pays for messages and memory. It stays with the {noun} and can't be withdrawn.
      </p>
      <div className="mt-4 flex items-center gap-2">
        <label htmlFor="fund-amount" className="sr-only">
          NEAR to add
        </label>
        <input
          id="fund-amount"
          className="field w-28 text-right"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          aria-invalid={!valid}
        />
        <button type="submit" className="button button-quiet" disabled={busy || !valid}>
          {busy ? "Adding…" : "Add NEAR"}
        </button>
      </div>
      {!valid && amount.trim() !== "" && (
        <p className="mt-2 text-sm text-mist">Enter an amount in NEAR, like 1 or 0.5.</p>
      )}
      {problem && (
        <p role="alert" className="mt-2 text-sm text-alarm">
          {problem}
        </p>
      )}
    </form>
  );
}
