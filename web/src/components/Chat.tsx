import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { formatNear } from "../lib/format.ts";
import { type ChatReply, KeeperError } from "../lib/keeper.ts";
import { describeProblem } from "../lib/problems.ts";

interface Line {
  from: "you" | "kat";
  text: string;
}

export interface ChatProps {
  katName: string;
  /** What the keeper charges per message, in yoctoNEAR. */
  chatPrice: bigint;
  send: (message: string) => Promise<ChatReply>;
  /** Called after each reply, with the kat's new balance and the proof for that reply. */
  onReply: (reply: ChatReply) => void;
  /** Called when the kat has run out of NEAR. */
  onOutOfBalance: () => void;
  /** Openers offered before the first message, so nobody faces a blank box. */
  starters?: string[];
}

const MAX_CHARS = 4000;

export function Chat({
  katName,
  chatPrice,
  send,
  onReply,
  onOutOfBalance,
  starters = [],
}: ChatProps) {
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever the conversation grows.
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [lines.length, thinking]);

  async function submit(event?: FormEvent, text?: string) {
    event?.preventDefault();
    const message = (text ?? draft).trim();
    if (!message || thinking) {
      return;
    }
    setThinking(true);
    setProblem(null);
    setLines((current) => [...current, { from: "you", text: message }]);
    setDraft("");
    try {
      const reply = await send(message);
      setLines((current) => [...current, { from: "kat", text: reply.reply }]);
      onReply(reply);
    } catch (error) {
      // The message was not answered, so it goes back into the box to resend.
      setLines((current) => current.slice(0, -1));
      setDraft(message);
      setProblem(describeProblem(error));
      if (error instanceof KeeperError && error.code === "insufficient_balance") {
        onOutOfBalance();
      }
    } finally {
      setThinking(false);
      // Back to the box, so the next message can be typed straight away.
      box.current?.focus();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter while composing (Japanese, Chinese, Korean input) picks a candidate; it must not send.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <section aria-label={`Conversation with ${katName}`} className="flex min-h-[28rem] flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto pr-1" aria-live="polite">
        {lines.length === 0 && !thinking && (
          <div>
            <p className="max-w-prose text-mist">
              Say something to {katName}. Each message costs {formatNear(chatPrice)} NEAR from its
              balance.
            </p>
            {starters.length > 0 && (
              <ul className="mt-4 flex flex-wrap gap-2" aria-label="Ways to start">
                {starters.map((starter) => (
                  <li key={starter}>
                    <button
                      type="button"
                      className="rounded-full border border-lamp/40 px-3.5 py-1.5 text-sm text-cream hover:border-lamp hover:bg-lamp/10"
                      onClick={() => void submit(undefined, starter)}
                    >
                      {starter}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {lines.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines are only ever appended.
          <div key={index} className={line.from === "you" ? "pl-10 sm:pl-24" : "pr-10 sm:pr-24"}>
            <p className="mb-1 text-sm text-mist">{line.from === "you" ? "You" : katName}</p>
            <p
              className={`whitespace-pre-wrap rounded-lg px-4 py-3 leading-relaxed ${
                line.from === "you" ? "bg-root/60" : "bg-black/35 text-cream"
              }`}
            >
              {line.text}
            </p>
          </div>
        ))}
        {thinking && <p className="text-sm text-lamp">{katName} is thinking…</p>}
        <div ref={end} />
      </div>
      {problem && (
        <p role="alert" className="mt-4 text-sm text-alarm">
          {problem}
        </p>
      )}
      <form onSubmit={submit} className="mt-4 flex items-end gap-3">
        <label htmlFor="chat-message" className="sr-only">
          Message to {katName}
        </label>
        <textarea
          id="chat-message"
          ref={box}
          className="field min-h-[3rem] flex-1 resize-y"
          rows={2}
          maxLength={MAX_CHARS}
          placeholder={`Message ${katName}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          // Read-only, not disabled, while waiting: a disabled field loses keyboard focus.
          readOnly={thinking}
        />
        <button type="submit" className="button button-lamp" disabled={thinking || !draft.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
