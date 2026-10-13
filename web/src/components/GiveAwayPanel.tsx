import { type FormEvent, useState } from "react";
import { describeProblem } from "../lib/problems.ts";

export interface GiveAwayPanelProps {
  katName: string;
  /** The current owner, who cannot give the kat to themselves. */
  ownerId: string;
  network: "mainnet" | "testnet" | "sandbox";
  /** Whether an account exists on-chain. A transfer to one that does not cannot be undone. */
  accountExists: (accountId: string) => Promise<boolean>;
  give: (receiverId: string) => Promise<void>;
}

/** NEAR account ids: 2 to 64 characters of lowercase letters, digits and . _ - separators. */
const ACCOUNT_ID = /^(?=.{2,64}$)[a-z0-9]+([._-][a-z0-9]+)*$/;
/** Addresses derived from a key. They exist only once something has been sent to them. */
const IMPLICIT = /^([0-9a-f]{64}|0x[0-9a-f]{40})$/;

/** Why this receiver cannot be used, or null if it can be looked up. */
function objection(receiver: string, ownerId: string, network: GiveAwayPanelProps["network"]) {
  if (!ACCOUNT_ID.test(receiver)) {
    return "That isn't a valid NEAR account name. Names are lowercase, like friend.near.";
  }
  if (receiver === ownerId) {
    return "That's your own account.";
  }
  if (network === "mainnet" && receiver.endsWith(".testnet")) {
    return "That's a testnet account, and this kat lives on mainnet.";
  }
  if (network === "testnet" && receiver.endsWith(".near")) {
    return "That's a mainnet account, and this kat lives on testnet.";
  }
  return null;
}

export function GiveAwayPanel({
  katName,
  ownerId,
  network,
  accountExists,
  give,
}: GiveAwayPanelProps) {
  const [text, setText] = useState("");
  const [step, setStep] = useState<"enter" | "checking" | "confirm" | "giving">("enter");
  const [unused, setUnused] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const receiver = text.trim();
  const blocked = receiver ? objection(receiver, ownerId, network) : null;
  const usable = receiver !== "" && blocked === null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!usable) {
      return;
    }
    setProblem(null);
    if (step === "enter") {
      setStep("checking");
      let exists: boolean;
      try {
        exists = await accountExists(receiver);
      } catch {
        setProblem("Couldn't check that account. Try again.");
        setStep("enter");
        return;
      }
      if (!exists && !IMPLICIT.test(receiver)) {
        setProblem(`${receiver} doesn't exist on NEAR. Check the spelling.`);
        setStep("enter");
        return;
      }
      setUnused(!exists);
      setStep("confirm");
      return;
    }
    setStep("giving");
    try {
      await give(receiver);
    } catch (error) {
      setProblem(describeProblem(error));
      setStep("enter");
    }
  }

  return (
    <form onSubmit={submit}>
      <h2 className="font-sans text-lg font-bold">Give away</h2>
      <p className="mt-1 text-sm text-mist">
        {katName} keeps its personality, memories and balance. You lose access.
      </p>
      <label htmlFor="receiver" className="sr-only">
        Account to give {katName} to
      </label>
      <input
        id="receiver"
        className="field mt-3 font-mono text-sm"
        placeholder={network === "testnet" ? "friend.testnet" : "friend.near"}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        value={text}
        aria-invalid={blocked !== null}
        aria-describedby="receiver-hint"
        onChange={(event) => {
          setText(event.target.value);
          setStep("enter");
          setProblem(null);
        }}
      />
      <p id="receiver-hint" className="mt-2 text-sm text-mist">
        {blocked}
      </p>
      {step === "confirm" || step === "giving" ? (
        <div className="mt-1">
          {unused && (
            <p className="mb-3 text-sm text-lamp">
              This address hasn't been used yet. Check every character: a kat sent to a wrong
              address can't be recovered.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className="button button-clay text-left"
              disabled={step === "giving"}
            >
              <span className="break-all">
                {step === "giving" ? "Giving…" : `Yes, give ${katName} to ${receiver}`}
              </span>
            </button>
            <button
              type="button"
              className="button button-quiet"
              onClick={() => setStep("enter")}
              disabled={step === "giving"}
            >
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <button
          type="submit"
          className="button button-quiet mt-1"
          disabled={!usable || step === "checking"}
        >
          {step === "checking" ? "Checking the account…" : `Give ${katName} away`}
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
