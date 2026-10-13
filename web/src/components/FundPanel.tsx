import { type FormEvent, useState } from "react";
import { formatNear, parseNear } from "../lib/format.ts";
import { describeProblem } from "../lib/problems.ts";

export interface FundPanelProps {
  balance: bigint;
  /** Draws attention to the panel after the kat ran out of NEAR. */
  urgent: boolean;
  fund: (amount: bigint) => Promise<void>;
}

export function FundPanel({ balance, urgent, fund }: FundPanelProps) {
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
    <form
      onSubmit={submit}
      className={urgent ? "rounded-lg outline outline-2 outline-offset-8 outline-lamp" : undefined}
    >
      <h3 className="text-lg font-bold">Balance</h3>
      <p className="mt-1">
        <span className="text-2xl font-bold">{formatNear(balance)}</span> NEAR
      </p>
      <p className="mt-1 text-sm text-mist">
        Pays for messages and memory. It stays with the kat and can't be withdrawn.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <label htmlFor="fund-amount" className="sr-only">
          NEAR to add
        </label>
        <input
          id="fund-amount"
          className="field w-24 text-right"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          aria-invalid={!valid}
        />
        <button type="submit" className="button button-quiet" disabled={busy || !valid}>
          {busy ? "Adding…" : "Add NEAR"}
        </button>
      </div>
      {problem && (
        <p role="alert" className="mt-2 text-sm text-alarm">
          {problem}
        </p>
      )}
    </form>
  );
}
