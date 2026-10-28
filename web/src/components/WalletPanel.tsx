import { type FormEvent, useState } from "react";
import { formatNear, parseNear, shorten } from "../lib/format.ts";
import { describeProblem } from "../lib/problems.ts";
import type { TokenWallet } from "../lib/wallet.ts";

export interface WalletPanelProps {
  noun: string;
  wallet: TokenWallet;
  /** Sends NEAR from the owner's own account into the token's wallet. */
  fund: (amount: bigint) => Promise<void>;
  setRules: (dailyAllowance: bigint, maxPayment: bigint) => Promise<void>;
  /** Sends from the token's wallet, as its owner. Resolves to the transaction hash. */
  send: (receiverId: string, amount: bigint) => Promise<string>;
}

/** Runs one action at a time, and says how it went. */
function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (name: string, action: () => Promise<string>) => {
    setBusy(name);
    setOutcome(null);
    try {
      setOutcome({ ok: true, text: await action() });
    } catch (error) {
      setOutcome({ ok: false, text: describeProblem(error) });
    } finally {
      setBusy(null);
    }
  };
  return { busy, outcome, run };
}

/** A token's own wallet: what is in it, what its mind may spend, and the owner's controls. */
export function WalletPanel({ noun, wallet, fund, setRules, send }: WalletPanelProps) {
  const { busy, outcome, run } = useAction();
  const [fundAmount, setFundAmount] = useState("1");
  const [daily, setDaily] = useState(formatNear(wallet.view.daily_allowance, 6));
  const [max, setMax] = useState(formatNear(wallet.view.max_payment, 6));
  const [receiver, setReceiver] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const allowance = BigInt(wallet.view.daily_allowance);
  const last = wallet.view.last_payment;

  const submit = (name: string, action: () => Promise<string>) => (event: FormEvent) => {
    event.preventDefault();
    void run(name, action);
  };

  return (
    <section aria-labelledby="wallet">
      <h2 id="wallet" className="font-sans text-lg font-bold">
        Its wallet
      </h2>
      <p className="mt-1">
        <span className="text-2xl font-bold">
          {wallet.balance === null ? "Empty" : formatNear(wallet.balance)}
        </span>
        {wallet.balance !== null && " NEAR"}
      </p>
      <p className="mt-1 text-sm leading-relaxed text-mist">
        This {noun} has its own NEAR account,{" "}
        <span className="font-mono text-cream" title={wallet.address}>
          {shorten(wallet.address, 6)}
        </span>
        . Its key is held by NEAR's MPC network and signs only through the collection's contract,
        under your rules. It goes with the {noun} if you give it away.
      </p>
      <p className="mt-2 text-sm text-mist" data-testid="wallet-rules">
        {allowance === 0n
          ? `The ${noun} can't spend from it on its own.`
          : `The ${noun} may send up to ${formatNear(wallet.view.max_payment, 6)} NEAR at a time and ${formatNear(allowance, 6)} NEAR a day (${formatNear(wallet.view.spent_today, 6)} sent today).`}
      </p>
      {last && (
        <p className="mt-1 text-sm text-mist">
          Last payment: {formatNear(last.amount, 6)} NEAR to{" "}
          <span className="font-mono">{last.receiver_id}</span>, by{" "}
          {last.by_mind ? `the ${noun}` : "its owner"}
          {last.memo ? ` (${last.memo})` : ""}.
        </p>
      )}

      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        onSubmit={submit("fund", async () => {
          const amount = parseNear(fundAmount);
          if (!amount) {
            throw new Error("Enter an amount in NEAR, like 1 or 0.5.");
          }
          await fund(amount);
          return `Added ${formatNear(amount, 6)} NEAR.`;
        })}
      >
        <label className="text-sm">
          <span className="sr-only">NEAR to put in its wallet</span>
          <input
            className="field w-24 text-right"
            inputMode="decimal"
            value={fundAmount}
            onChange={(event) => setFundAmount(event.target.value)}
            aria-label="NEAR to put in its wallet"
          />
        </label>
        <button type="submit" className="button button-quiet" disabled={busy !== null}>
          {busy === "fund" ? "Sending…" : "Put NEAR in"}
        </button>
      </form>

      <form
        className="mt-4 space-y-2"
        onSubmit={submit("rules", async () => {
          const dailyAmount = parseNear(daily);
          const maxAmount = parseNear(max);
          if (dailyAmount === null || maxAmount === null || maxAmount > dailyAmount) {
            throw new Error(
              "Enter NEAR amounts, with the largest payment no more than the daily limit.",
            );
          }
          await setRules(dailyAmount, maxAmount);
          return dailyAmount === 0n
            ? `The ${noun} can no longer spend on its own.`
            : `The ${noun} may now send up to ${formatNear(maxAmount, 6)} NEAR at a time.`;
        })}
      >
        <p className="text-sm font-bold">What it may spend on its own</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="block text-mist">A day</span>
            <input
              className="field w-24 text-right"
              inputMode="decimal"
              value={daily}
              onChange={(event) => setDaily(event.target.value)}
              aria-label="NEAR it may send a day"
            />
          </label>
          <label className="text-sm">
            <span className="block text-mist">At a time</span>
            <input
              className="field w-24 text-right"
              inputMode="decimal"
              value={max}
              onChange={(event) => setMax(event.target.value)}
              aria-label="NEAR it may send at a time"
            />
          </label>
          <button type="submit" className="button button-quiet" disabled={busy !== null}>
            {busy === "rules" ? "Saving…" : "Save rules"}
          </button>
        </div>
        <p className="text-xs text-mist">
          In conversation, it decides for itself whether to pay. A new owner starts with zero.
        </p>
      </form>

      <form
        className="mt-4 flex flex-wrap items-end gap-2"
        onSubmit={submit("send", async () => {
          const amount = parseNear(sendAmount);
          const to = receiver.trim();
          if (!amount || !to) {
            throw new Error("Enter who to send to and how much.");
          }
          const hash = await send(to, amount);
          return `Sent ${formatNear(amount, 6)} NEAR to ${to} (transaction ${shorten(hash, 6)}).`;
        })}
      >
        <label className="text-sm">
          <span className="block text-mist">Send from it, to</span>
          <input
            className="field w-48 font-mono"
            value={receiver}
            onChange={(event) => setReceiver(event.target.value)}
            aria-label="Account to send to from its wallet"
          />
        </label>
        <label className="text-sm">
          <span className="block text-mist">NEAR</span>
          <input
            className="field w-20 text-right"
            inputMode="decimal"
            value={sendAmount}
            onChange={(event) => setSendAmount(event.target.value)}
            aria-label="NEAR to send from its wallet"
          />
        </label>
        <button type="submit" className="button button-quiet" disabled={busy !== null}>
          {busy === "send" ? "Signing…" : "Send from wallet"}
        </button>
      </form>

      {outcome && (
        <p
          role={outcome.ok ? "status" : "alert"}
          className={`mt-2 text-sm ${outcome.ok ? "text-glow" : "text-alarm"}`}
        >
          {outcome.text}
        </p>
      )}
    </section>
  );
}
