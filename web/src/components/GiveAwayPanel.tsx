import { type FormEvent, useState } from "react";
import { describeProblem } from "../lib/problems.ts";

export interface GiveAwayPanelProps {
  katName: string;
  give: (receiverId: string) => Promise<void>;
}

/** NEAR account ids: 2 to 64 characters of lowercase letters, digits and . _ - separators. */
const ACCOUNT_ID = /^(?=.{2,64}$)[a-z0-9]+([._-][a-z0-9]+)*$/;

export function GiveAwayPanel({ katName, give }: GiveAwayPanelProps) {
  const [receiver, setReceiver] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const valid = ACCOUNT_ID.test(receiver.trim());

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) {
      return;
    }
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await give(receiver.trim());
    } catch (error) {
      setProblem(describeProblem(error));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h3 className="text-lg font-bold">Give away</h3>
      <p className="mt-1 text-sm text-mist">
        {katName} keeps its personality, memories and balance. You lose access.
      </p>
      <label htmlFor="receiver" className="sr-only">
        Account to give {katName} to
      </label>
      <input
        id="receiver"
        className="field mt-3 font-mono text-sm"
        placeholder="friend.near"
        autoComplete="off"
        spellCheck={false}
        value={receiver}
        onChange={(event) => {
          setReceiver(event.target.value);
          setConfirming(false);
        }}
      />
      {confirming ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="submit"
            className="button"
            style={{
              ["--button-bg" as string]: "var(--color-clay)",
              ["--button-ink" as string]: "var(--color-cream)",
            }}
            disabled={busy}
          >
            {busy ? "Giving…" : `Yes, give ${katName} to ${receiver.trim()}`}
          </button>
          <button
            type="button"
            className="button button-quiet"
            onClick={() => setConfirming(false)}
            disabled={busy}
          >
            Keep it
          </button>
        </div>
      ) : (
        <button type="submit" className="button button-quiet mt-3" disabled={!valid}>
          Give {katName} away
        </button>
      )}
      {problem && (
        <p role="alert" className="mt-2 text-sm text-alarm">
          {problem}
        </p>
      )}
    </form>
  );
}
