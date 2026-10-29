import { type FormEvent, useState } from "react";
import { formatNear, parseNear, shorten } from "../lib/format.ts";
import { describeProblem } from "../lib/problems.ts";
import type { TokenWallet } from "../lib/wallet.ts";
import { Icon } from "./Icon.tsx";

export interface WalletPanelProps {
  noun: string;
  wallet: TokenWallet;
  /** Creates the wallet's account, with `amount` going in (less its record's storage). */
  open: (amount: bigint) => Promise<void>;
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
export function WalletPanel({ noun, wallet, open, fund, setRules, send }: WalletPanelProps) {
  const { busy, outcome, run } = useAction();
  const [openAmount, setOpenAmount] = useState("0.1");
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

  const spent = BigInt(wallet.view.spent_today);
  const spentShare = allowance === 0n ? 0 : Number((spent * 1000n) / allowance) / 10;

  const result = outcome && (
    <p
      role={outcome.ok ? "status" : "alert"}
      className={`mt-4 flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${
        outcome.ok
          ? "border-glow/30 bg-glow/10 text-glow"
          : "border-alarm/30 bg-alarm/10 text-alarm"
      }`}
    >
      <Icon name={outcome.ok ? "check" : "alert"} size={16} className="mt-0.5 shrink-0" />
      <span className="min-w-0 break-words">{outcome.text}</span>
    </p>
  );

  const heading = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id="wallet" className="card-title flex items-center gap-2">
        <Icon name="wallet" size={18} className="text-[var(--accent)]" />
        Its wallet
      </h2>
      {wallet.view.open && (
        <span className="chip max-w-full font-mono text-xs" title={wallet.address}>
          <span className="truncate">{shorten(wallet.address, 10)}</span>
        </span>
      )}
    </div>
  );

  if (!wallet.view.open) {
    return (
      <section aria-labelledby="wallet" className="card">
        {heading}
        <p className="mt-3 text-sm leading-relaxed text-mist">
          This {noun} can have its own NEAR account,{" "}
          <span className="break-all font-mono text-cream">{wallet.address}</span>, that only the
          collection can send from, under your rules. It isn't open yet. Opening it takes at least
          0.02 NEAR; the rest goes in.
        </p>
        <form
          className="mt-4 flex items-center gap-2"
          onSubmit={submit("open", async () => {
            const amount = parseNear(openAmount);
            if (!amount) {
              throw new Error("Enter an amount in NEAR, like 0.1.");
            }
            await open(amount);
            return "Its wallet is open.";
          })}
        >
          <label className="relative">
            <span className="sr-only">NEAR to open its wallet with</span>
            <input
              className="field w-28 pr-12 text-right"
              inputMode="decimal"
              value={openAmount}
              onChange={(event) => setOpenAmount(event.target.value)}
              aria-label="NEAR to open its wallet with"
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-mist">
              NEAR
            </span>
          </label>
          <button type="submit" className="button flex-1" disabled={busy !== null}>
            <Icon name="plus" size={16} />
            {busy === "open" ? "Opening…" : "Open its wallet"}
          </button>
        </form>
        {result}
      </section>
    );
  }

  return (
    <section aria-labelledby="wallet" className="card card-lit">
      {heading}
      <p className="mt-3 flex items-baseline gap-1.5">
        <span className="font-display text-3xl tracking-tight">
          {wallet.balance === null ? "Empty" : formatNear(wallet.balance)}
        </span>
        {wallet.balance !== null && <span className="text-sm text-mist">{" NEAR"}</span>}
      </p>
      <p className="mt-1 text-sm leading-relaxed text-mist">
        This {noun} has its own NEAR account. No one holds a key to it: only the collection's
        contract can send from it, under your rules. It goes with the {noun} the moment you sell or
        give it away.
      </p>

      <div className="mt-4 rounded-xl bg-black/25 p-3.5 ring-1 ring-cream/8">
        {allowance > 0n && (
          <div className="mb-2.5">
            <div className="mb-1.5 flex justify-between text-xs text-mist">
              <span>Spent by the {noun} today</span>
              <span className="font-mono">
                {formatNear(spent, 6)} / {formatNear(allowance, 6)}
              </span>
            </div>
            <div className="meter" aria-hidden="true">
              <span style={{ width: `${Math.min(spentShare, 100)}%` }} />
            </div>
          </div>
        )}
        <p className="text-sm text-cream" data-testid="wallet-rules">
          {allowance === 0n
            ? `The ${noun} can't spend from it on its own.`
            : `The ${noun} may send up to ${formatNear(wallet.view.max_payment, 6)} NEAR at a time and ${formatNear(allowance, 6)} NEAR a day (${formatNear(wallet.view.spent_today, 6)} sent today).`}
        </p>
        {last && (
          <p className="mt-2 text-xs leading-relaxed text-mist">
            Last payment: {formatNear(last.amount, 6)} NEAR to{" "}
            <span className="break-all font-mono text-cream">{last.receiver_id}</span>, by{" "}
            {last.by_mind ? `the ${noun}` : "its owner"}
            {last.memo ? ` (${last.memo})` : ""}.
          </p>
        )}
      </div>

      <form
        className="mt-5 flex items-center gap-2"
        onSubmit={submit("fund", async () => {
          const amount = parseNear(fundAmount);
          if (!amount) {
            throw new Error("Enter an amount in NEAR, like 1 or 0.5.");
          }
          await fund(amount);
          return `Added ${formatNear(amount, 6)} NEAR.`;
        })}
      >
        <label className="relative">
          <span className="sr-only">NEAR to put in its wallet</span>
          <input
            className="field w-28 pr-12 text-right"
            inputMode="decimal"
            value={fundAmount}
            onChange={(event) => setFundAmount(event.target.value)}
            aria-label="NEAR to put in its wallet"
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-mist">
            NEAR
          </span>
        </label>
        <button type="submit" className="button button-quiet flex-1" disabled={busy !== null}>
          <Icon name="plus" size={16} />
          {busy === "fund" ? "Sending…" : "Put NEAR in"}
        </button>
      </form>

      <div className="divider my-5" />

      <form
        className="space-y-3"
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
        <p className="eyebrow">What it may spend on its own</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-mist">A day</span>
            <input
              className="field text-right"
              inputMode="decimal"
              value={daily}
              onChange={(event) => setDaily(event.target.value)}
              aria-label="NEAR it may send a day"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-mist">At a time</span>
            <input
              className="field text-right"
              inputMode="decimal"
              value={max}
              onChange={(event) => setMax(event.target.value)}
              aria-label="NEAR it may send at a time"
            />
          </label>
        </div>
        <button type="submit" className="button button-quiet w-full" disabled={busy !== null}>
          {busy === "rules" ? "Saving…" : "Save rules"}
        </button>
        <p className="text-xs text-mist">
          In conversation, it decides for itself whether to pay. A new owner starts with zero.
        </p>
      </form>

      <div className="divider my-5" />

      <form
        className="space-y-3"
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
        <p className="eyebrow">Send from it yourself</p>
        <div className="grid grid-cols-[1fr_6.5rem] gap-2">
          <label className="min-w-0 text-sm">
            <span className="mb-1 block text-xs text-mist">To</span>
            <input
              className="field font-mono text-sm"
              placeholder="friend.near"
              autoCapitalize="none"
              spellCheck={false}
              value={receiver}
              onChange={(event) => setReceiver(event.target.value)}
              aria-label="Account to send to from its wallet"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-mist">NEAR</span>
            <input
              className="field text-right"
              inputMode="decimal"
              value={sendAmount}
              onChange={(event) => setSendAmount(event.target.value)}
              aria-label="NEAR to send from its wallet"
            />
          </label>
        </div>
        <button type="submit" className="button button-quiet w-full" disabled={busy !== null}>
          <Icon name="send" size={16} />
          {busy === "send" ? "Sending…" : "Send from wallet"}
        </button>
      </form>

      {result}
    </section>
  );
}
