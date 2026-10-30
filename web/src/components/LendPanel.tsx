import { type FormEvent, useState } from "react";
import type { LoanTerms, LoanView } from "../lib/contract.ts";
import { parseNear } from "../lib/format.ts";
import { describeTerms, loanEnd, who } from "../lib/loans.ts";
import { describeProblem } from "../lib/problems.ts";
import { Icon } from "./Icon.tsx";

export interface LendPanelProps {
  name: string;
  noun: string;
  network: string;
  /** The current loan, if any; undefined while it loads. */
  loan: LoanView | null | undefined;
  lend: (terms: LoanTerms) => Promise<void>;
  end: () => Promise<void>;
}

const LENGTHS: Array<[string, number | null]> = [
  ["An hour", 3_600],
  ["A day", 86_400],
  ["A week", 7 * 86_400],
  ["30 days", 30 * 86_400],
  ["No end", null],
];

/** Lend the token to someone, or to anyone, for a time, a number of messages, or a fee. */
export function LendPanel({ name, noun, network, loan, lend, end }: LendPanelProps) {
  const [borrower, setBorrower] = useState("");
  const [length, setLength] = useState("86400");
  const [messages, setMessages] = useState("");
  const [fee, setFee] = useState("0");
  const [seesMemory, setSeesMemory] = useState(false);
  const [learns, setLearns] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setOutcome(null);
    try {
      setOutcome({ ok: true, text: await action() });
    } catch (error) {
      setOutcome({ ok: false, text: describeProblem(error) });
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const count = messages.trim() === "" ? null : Number(messages);
      if (count !== null && (!Number.isInteger(count) || count < 1)) {
        throw new Error("Messages is a whole number, or empty for no limit.");
      }
      const price = parseNear(fee.trim() === "" ? "0" : fee);
      if (price === null) {
        throw new Error("Enter the fee in NEAR, like 1 or 0.5, or 0 for free.");
      }
      const borrowerId = borrower.trim() || null;
      await lend({
        borrowerId,
        durationSeconds: length === "none" ? null : Number(length),
        messages: count,
        seesMemory,
        learns,
        fee: price,
      });
      return borrowerId && price === 0n
        ? `Lent to ${borrowerId}. Send them this page's link.`
        : "Offered. Send this page's link to whoever you want to borrow it.";
    });
  }

  const current = loan && loan.status !== "over" ? loan : null;
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

  return (
    <section aria-labelledby="lend" className="card">
      <h2 id="lend" className="card-title flex items-center gap-2">
        <Icon name="clock" size={18} className="text-mist" />
        Lend it
      </h2>
      {current ? (
        <div className="mt-3 space-y-3">
          <p
            className="rounded-xl bg-black/25 p-3.5 text-sm text-cream ring-1 ring-cream/8"
            data-testid="loan-status"
          >
            {current.status === "offered"
              ? `Offered to ${who(current.borrower_id)}`
              : `Lent to ${who(current.borrower_id)}`}
            {current.status === "active" && loanEnd(current) ? `, until ${loanEnd(current)}` : ""}:{" "}
            <span className="text-mist">{describeTerms(current, noun)}</span>
          </p>
          {current.status === "active" && BigInt(current.fee) > 0n ? (
            <p className="text-xs text-mist">
              It's rented, so it comes back when its time is up or the borrower gives it back, and
              it can't change hands until then.
            </p>
          ) : (
            <button
              type="button"
              className="button button-quiet w-full"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await end();
                  return current.status === "offered" ? "Offer withdrawn." : `${name} is back.`;
                })
              }
            >
              {current.status === "offered" ? "Withdraw the offer" : "End the loan"}
            </button>
          )}
        </div>
      ) : (
        <form className="mt-3 space-y-3" onSubmit={submit}>
          <p className="text-sm leading-relaxed text-mist">
            Let someone talk to {name} for a while. It stays yours: they can't read its mind, use
            its wallet or sell it.
          </p>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-mist">To (empty: anyone who takes it)</span>
            <input
              className="field font-mono text-sm"
              placeholder={network === "testnet" ? "friend.testnet" : "friend.near"}
              autoCapitalize="none"
              spellCheck={false}
              value={borrower}
              onChange={(event) => setBorrower(event.target.value)}
              aria-label="Account to lend it to"
            />
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="text-sm">
              <span className="mb-1 block text-xs text-mist">For</span>
              <select
                className="field"
                value={length}
                onChange={(event) => setLength(event.target.value)}
                aria-label="How long to lend it for"
              >
                {LENGTHS.map(([label, seconds]) => (
                  <option key={label} value={seconds === null ? "none" : String(seconds)}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-mist">Messages</span>
              <input
                className="field text-right"
                inputMode="numeric"
                placeholder="Any"
                value={messages}
                onChange={(event) => setMessages(event.target.value)}
                aria-label="Messages they may send"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-mist">Fee (NEAR)</span>
              <input
                className="field text-right"
                inputMode="decimal"
                value={fee}
                onChange={(event) => setFee(event.target.value)}
                aria-label="Fee in NEAR"
              />
            </label>
          </div>
          <label className="option !py-2.5 text-sm">
            <input
              type="checkbox"
              checked={seesMemory}
              onChange={(event) => setSeesMemory(event.target.checked)}
            />
            <span>
              It can draw on its memory
              <span className="block text-xs text-mist">
                Off: it talks from its character only, so nothing it remembers about you comes up.
              </span>
            </span>
          </label>
          <label className="option !py-2.5 text-sm">
            <input
              type="checkbox"
              checked={learns}
              onChange={(event) => setLearns(event.target.checked)}
            />
            <span>
              It learns from them
              <span className="block text-xs text-mist">
                Off: it comes back exactly as it left. Their messages are paid from its balance.
              </span>
            </span>
          </label>
          <button type="submit" className="button button-quiet w-full" disabled={busy}>
            {busy
              ? "Lending…"
              : fee.trim() !== "" && fee.trim() !== "0"
                ? "Offer it for rent"
                : "Lend it"}
          </button>
        </form>
      )}
      {result}
    </section>
  );
}
