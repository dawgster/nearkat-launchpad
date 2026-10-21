import { type FormEvent, useState } from "react";
import { MINT_STORAGE_ALLOWANCE } from "../lib/contract.ts";
import { formatNear, parseNear } from "../lib/format.ts";
import { describeProblem } from "../lib/problems.ts";

export interface MintPanelProps {
  mintPrice: bigint;
  /** What the keeper charges per message, for the "up to N messages" hint. */
  chatPrice: bigint;
  /** Null while no wallet is connected. */
  onMint: ((startingBalance: bigint) => Promise<void>) | null;
  onConnect: () => Promise<void>;
  /** What one token is called, as in "Mint a kat". */
  noun?: string;
}

export function MintPanel({
  mintPrice,
  chatPrice,
  onMint,
  onConnect,
  noun = "kat",
}: MintPanelProps) {
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
      <h2 className="text-2xl">Mint a {noun}</h2>
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
          : `Enough for up to ${chatPrice > 0n ? startingBalance / chatPrice : 0n} messages. Long conversations also pay for memory saves. It stays with the ${noun}, even if you give it away.`}
      </p>
      <div className="mt-5 flex items-baseline justify-between border-t border-cream/15 pt-4">
        <span className="text-mist">You pay</span>
        <span className="text-xl font-bold">
          {total === null ? "…" : `${formatNear(total)} NEAR`}
        </span>
      </div>
      {onMint ? (
        <button type="submit" className="button mt-5 w-full" disabled={busy || total === null}>
          {busy ? "Minting…" : `Mint a ${noun}`}
        </button>
      ) : (
        <button
          type="button"
          className="button mt-5 w-full"
          onClick={() => {
            setProblem(null);
            onConnect().catch((error) => setProblem(describeProblem(error)));
          }}
        >
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
