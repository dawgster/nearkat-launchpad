import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { type ChatReply, KeeperError } from "../lib/keeper.ts";
import { describeProblem } from "../lib/problems.ts";

interface Line {
  from: "you" | "kat";
  text: string;
}

export interface ChatProps {
  katName: string;
  send: (message: string) => Promise<ChatReply>;
  /** Called after each reply, with the kat's new balance and the proof for that reply. */
  onReply: (reply: ChatReply) => void;
  /** Called when the kat has run out of NEAR. */
  onOutOfBalance: () => void;
}

const MAX_CHARS = 4000;

export function Chat({ katName, send, onReply, onOutOfBalance }: ChatProps) {
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever the conversation grows.
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [lines.length, thinking]);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const message = draft.trim();
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
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <section aria-label={`Conversation with ${katName}`} className="flex min-h-[28rem] flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto pr-1" aria-live="polite">
        {lines.length === 0 && !thinking && (
          <p className="max-w-prose text-mist">
            Say something to {katName}. Each message costs 0.002 NEAR from its balance.
          </p>
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
          className="field min-h-[3rem] flex-1 resize-y"
          rows={2}
          maxLength={MAX_CHARS}
          placeholder={`Message ${katName}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={thinking}
        />
        <button type="submit" className="button button-lamp" disabled={thinking || !draft.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
