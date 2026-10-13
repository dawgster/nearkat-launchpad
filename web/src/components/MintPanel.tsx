import { type FormEvent, useState } from "react";
import { MINT_STORAGE_ALLOWANCE } from "../lib/contract.ts";
import { formatNear, parseNear } from "../lib/format.ts";
import { describeProblem } from "../lib/problems.ts";

/** What one chat message costs, for the "about N messages" hint. */
const CHAT_PRICE = 2n * 10n ** 21n;

export interface MintPanelProps {
  mintPrice: bigint;
  /** Null while no wallet is connected. */
  onMint: ((startingBalance: bigint) => Promise<void>) | null;
  onConnect: () => void;
}

export function MintPanel({ mintPrice, onMint, onConnect }: MintPanelProps) {
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const startingBalance = parseNear(amount);
  const total =
    startingBalance === null ? null : mintPrice + MINT_STORAGE_ALLOWANCE + startingBalance;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!onMint || startingBalance === null) {
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await onMint(startingBalance);
    } catch (error) {
      setProblem(describeProblem(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border border-cream/15 bg-dusk/80 p-6 backdrop-blur"
    >
      <h2 className="text-2xl">Mint a kat</h2>
      <dl className="mt-5 space-y-3 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-mist">Mint price</dt>
          <dd>{formatNear(mintPrice)} NEAR</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt>
            <label htmlFor="starting-balance" className="text-mist">
              Starting balance
            </label>
          </dt>
          <dd className="flex items-center gap-2">
            <input
              id="starting-balance"
              className="field w-24 text-right"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              aria-describedby="starting-balance-hint"
              aria-invalid={startingBalance === null}
            />
            NEAR
          </dd>
        </div>
      </dl>
      <p id="starting-balance-hint" className="mt-2 text-sm text-mist">
        {startingBalance === null
          ? "Enter an amount in NEAR, like 1 or 0.5."
          : `Pays for about ${startingBalance / CHAT_PRICE} messages. It stays with the kat, even if you give it away.`}
      </p>
      <div className="mt-5 flex items-baseline justify-between border-t border-cream/15 pt-4">
        <span className="text-mist">You pay</span>
        <span className="text-xl font-bold">
          {total === null ? "…" : `${formatNear(total)} NEAR`}
        </span>
      </div>
      {onMint ? (
        <button type="submit" className="button mt-5 w-full" disabled={busy || total === null}>
          {busy ? "Minting…" : "Mint a kat"}
        </button>
      ) : (
        <button type="button" className="button mt-5 w-full" onClick={onConnect}>
          Connect wallet to mint
        </button>
      )}
      {problem && (
        <p role="alert" className="mt-3 text-sm text-alarm">
          {problem}
        </p>
      )}
    </form>
  );
}
