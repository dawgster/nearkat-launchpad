import { type ChangeEvent, useRef, useState } from "react";
import { formatNear } from "../lib/format.ts";
import { type History, readExport, type Selection, selectForImport } from "../lib/history.ts";
import type { ImportResult } from "../lib/keeper.ts";
import { describeProblem } from "../lib/problems.ts";
import type { KeeperPrivacy } from "../lib/tdx.ts";
import { Icon } from "./Icon.tsx";

export interface ImportPanelProps {
  name: string;
  /** What one memory save costs, yoctoNEAR. A long history takes a few. */
  savePrice: bigint;
  privacy: KeeperPrivacy | null;
  /** Seals the history to the keeper's key and sends it; resolves once the token has read it. */
  send: (history: { source: string; messages: string[] }) => Promise<ImportResult>;
}

/** How the keeper cuts a history into parts, one memory save each. */
const PART_CHARS = 24_000;

const SOURCE = { chatgpt: "ChatGPT", claude: "Claude" } as const;

const month = (at: number | null) =>
  at === null
    ? null
    : new Date(at).toLocaleDateString(undefined, { month: "short", year: "numeric" });

/** Teach a token from the owner's ChatGPT or Claude history, read and trimmed in this browser. */
export function ImportPanel({ name, savePrice, privacy, send }: ImportPanelProps) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<
    | { step: "idle" }
    | { step: "reading" }
    | { step: "ready"; history: History; selection: Selection }
    | { step: "sending"; history: History; selection: Selection }
    | { step: "done"; result: ImportResult; source: string }
  >({ step: "idle" });
  const [problem, setProblem] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [understood, setUnderstood] = useState(false);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setProblem(null);
    setShowAll(false);
    setState({ step: "reading" });
    try {
      const history = await readExport(file);
      const selection = selectForImport(history);
      if (selection.messages.length === 0) {
        throw new Error("There are no messages of yours in this export to learn from.");
      }
      setState({ step: "ready", history, selection });
    } catch (error) {
      setProblem(describeProblem(error));
      setState({ step: "idle" });
    }
  }

  async function teach() {
    if (state.step !== "ready") return;
    setProblem(null);
    setState({ ...state, step: "sending" });
    try {
      const result = await send({
        source: state.history.source,
        messages: state.selection.messages,
      });
      setState({ step: "done", result, source: SOURCE[state.history.source] });
    } catch (error) {
      setProblem(describeProblem(error));
      setState({ ...state, step: "ready" });
    }
  }

  const picker = (
    <input
      ref={input}
      type="file"
      accept=".zip,.json,application/zip,application/json"
      className="sr-only"
      aria-label="ChatGPT or Claude export file"
      onChange={(event) => void choose(event)}
    />
  );

  return (
    <section aria-labelledby="import" className="card">
      <h2 id="import" className="card-title flex items-center gap-2">
        <Icon name="download" size={18} className="rotate-180 text-mist" />
        Teach it about you
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-mist">
        Give {name} your ChatGPT or Claude history, so it knows your tastes from day one. The file
        is opened here, in your browser: only your own messages are kept, emails, phone numbers and
        links are blanked out, and you see what goes before anything leaves.
      </p>
      {picker}

      {(state.step === "idle" || state.step === "reading") && (
        <button
          type="button"
          className="mt-4 flex w-full flex-col items-center gap-1 rounded-xl border border-dashed border-cream/25 bg-black/20 px-4 py-5 text-center transition-colors hover:border-[var(--accent)] hover:bg-black/30"
          onClick={() => input.current?.click()}
          disabled={state.step === "reading"}
        >
          <span className="font-bold text-cream">
            {state.step === "reading" ? "Reading your export…" : "Choose your export"}
          </span>
          <span className="text-xs text-mist">
            The .zip from ChatGPT or Claude, or the conversations.json inside it
          </span>
        </button>
      )}

      {(state.step === "ready" || state.step === "sending") && (
        <div className="mt-4 space-y-4">
          <div className="rounded-xl bg-black/25 p-3.5 text-sm ring-1 ring-cream/8">
            <p className="text-cream" data-testid="import-summary">
              {state.selection.messages.length} of your {SOURCE[state.history.source]} messages,
              from {state.history.conversations} conversation
              {state.history.conversations === 1 ? "" : "s"}
              {state.selection.earliest !== null &&
                ` (${month(state.selection.earliest)} to ${month(state.selection.latest)})`}
              .
            </p>
            <p className="mt-1 text-xs text-mist">
              {state.selection.chars.toLocaleString()} characters
              {state.selection.redactions > 0 &&
                `, ${state.selection.redactions} personal detail${state.selection.redactions === 1 ? "" : "s"} blanked out`}
              {state.selection.left > 0 &&
                `. ${state.selection.left} older or one-line messages are left out`}
              . The assistant's replies are never sent.
            </p>
          </div>
          <div>
            <p className="eyebrow">What will be sent</p>
            <ul className="mt-2 max-h-52 space-y-1.5 overflow-y-auto pr-1">
              {(showAll ? state.selection.messages : state.selection.messages.slice(0, 3)).map(
                (message) => (
                  // Messages are unique: repeats were dropped when they were picked.
                  <li
                    key={message}
                    className="line-clamp-3 rounded-lg bg-black/25 px-3 py-2 text-xs text-cream/90"
                  >
                    {message}
                  </li>
                ),
              )}
            </ul>
            {state.selection.messages.length > 3 && (
              <button
                type="button"
                className="link mt-2 text-xs"
                onClick={() => setShowAll((value) => !value)}
              >
                {showAll ? "Show fewer" : `Show all ${state.selection.messages.length}`}
              </button>
            )}
          </div>
          <Privacy privacy={privacy} />
          {privacy?.kind !== "tee" && (
            <label className="flex items-start gap-2.5 text-sm text-mist">
              <input
                type="checkbox"
                className="mt-1"
                checked={understood}
                onChange={(event) => setUnderstood(event.target.checked)}
              />
              I understand this keeper isn't sealed, so whoever runs it could read what I send.
            </label>
          )}
          <p className="text-xs text-mist">
            {name} reads it in about {Math.max(1, Math.ceil(state.selection.chars / PART_CHARS))}{" "}
            part{state.selection.chars > PART_CHARS ? "s" : ""}, each a memory save (
            {formatNear(savePrice, 6)} NEAR) from its balance. Only what it remembers is kept; your
            messages are dropped once read.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="button flex-1"
              disabled={state.step === "sending" || (privacy?.kind !== "tee" && !understood)}
              onClick={() => void teach()}
            >
              <Icon name="lock" size={16} />
              {state.step === "sending" ? `${name} is reading…` : `Seal and send to ${name}`}
            </button>
            <button
              type="button"
              className="button button-quiet"
              disabled={state.step === "sending"}
              onClick={() => {
                setState({ step: "idle" });
                setProblem(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {state.step === "done" && (
        <div className="mt-4 space-y-3">
          <p
            className="flex items-start gap-2 rounded-xl border border-glow/30 bg-glow/10 px-3 py-2 text-sm text-glow"
            role="status"
          >
            <Icon name="check" size={16} className="mt-0.5 shrink-0" />
            {name} read {state.result.imported} of your {state.source} messages and updated its
            memory.
          </p>
          <button
            type="button"
            className="button button-quiet w-full"
            onClick={() => setState({ step: "idle" })}
          >
            Teach it more
          </button>
        </div>
      )}

      {problem && (
        <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-alarm">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
          {problem}
        </p>
      )}
    </section>
  );
}

function Privacy({ privacy }: { privacy: KeeperPrivacy | null }) {
  if (privacy === null) {
    return <p className="text-xs text-mist">Checking where the keeper runs…</p>;
  }
  if (privacy.kind === "tee") {
    return (
      <p className="flex items-start gap-2 text-xs text-glow">
        <Icon name="shield" size={14} className="mt-0.5 shrink-0" />
        <span>
          Sealed to a key that exists only inside the keeper's TEE app
          {privacy.appId ? ` (Phala app ${privacy.appId})` : ""}, checked in this browser against
          its hardware quote. Not even the keeper's operator can read it.
        </span>
      </p>
    );
  }
  return (
    <p className="flex items-start gap-2 text-xs text-lamp">
      <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
      <span>
        {privacy.kind === "local"
          ? "This keeper runs in local mode, not in a sealed TEE app. Your history is still encrypted on the way, but whoever runs the keeper could read it."
          : `This browser couldn't confirm the keeper runs in a sealed TEE app: ${privacy.reason}.`}
      </span>
    </p>
  );
}
