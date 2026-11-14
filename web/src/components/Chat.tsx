import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { formatNear } from "../lib/format.ts";
import {
  type ChatReply,
  KeeperError,
  type MemoryProgress,
  type PaymentOutcome,
} from "../lib/keeper.ts";
import { describeProblem } from "../lib/problems.ts";
import { Icon } from "./Icon.tsx";

interface Line {
  from: "you" | "kat";
  text: string;
  withheld?: boolean;
  payment?: PaymentOutcome;
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
  /** A small picture of the token, shown beside its replies. */
  avatar?: ReactNode;
  /** Reads how far the conversation is from being saved, when the page opens. */
  loadMemory?: () => Promise<MemoryProgress | null>;
}

/** How many more of the owner's messages until the conversation is saved. */
export function messagesUntilSave(memory: MemoryProgress): number {
  return Math.max(1, Math.ceil((memory.saves_at - memory.unsaved) / 2));
}

const MAX_CHARS = 4000;

export function Chat({
  katName,
  chatPrice,
  send,
  onReply,
  onOutOfBalance,
  starters = [],
  avatar,
  loadMemory,
}: ChatProps) {
  const [memory, setMemory] = useState<(MemoryProgress & { saved?: boolean }) | null>(null);
  // Asked once, when the page opens; after that each reply says where it stands.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new loader each render is the same question.
  useEffect(() => {
    let current = true;
    loadMemory?.().then(
      (progress) => {
        if (current && progress) {
          setMemory((known) => known ?? progress);
        }
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, []);
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
      setLines((current) => [
        ...current,
        {
          from: "kat",
          text: reply.reply,
          withheld: reply.withheld === true,
          payment: reply.payment,
        },
      ]);
      if (reply.memory) {
        setMemory(reply.memory);
      }
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
    <section
      aria-label={`Conversation with ${katName}`}
      className="card flex h-[min(78dvh,46rem)] min-h-[28rem] flex-col !p-0"
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--card-line)] px-4 py-3 sm:px-5">
        <p className="card-title">Conversation</p>
        <span className="flex flex-wrap items-center justify-end gap-2">
          {memory && (
            <span
              className={`chip ${memory.saved ? "chip-accent" : "text-mist"}`}
              role="status"
              aria-label="Memory"
            >
              {memory.saved
                ? "Saved to memory"
                : messagesUntilSave(memory) === 1
                  ? "Your next message saves to memory"
                  : `Saves to memory in ${messagesUntilSave(memory)} messages`}
            </span>
          )}
          <span className="chip text-mist">{formatNear(chatPrice, 6)} NEAR a message</span>
        </span>
      </div>
      <div
        className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-5 sm:px-5"
        aria-live="polite"
      >
        {lines.length === 0 && !thinking && (
          <div className="flex h-full flex-col items-center justify-center px-2 text-center">
            {avatar && <div className="mb-4 opacity-90">{avatar}</div>}
            <p className="max-w-sm text-mist">
              Say something to {katName}. Each message costs {formatNear(chatPrice, 6)} NEAR from
              its balance.
            </p>
            {starters.length > 0 && (
              <ul className="mt-5 flex flex-wrap justify-center gap-2" aria-label="Ways to start">
                {starters.map((starter) => (
                  <li key={starter}>
                    <button
                      type="button"
                      className="rounded-full border border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--accent)_6%,transparent)] px-3.5 py-1.5 text-sm text-cream transition-colors hover:border-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]"
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
        {lines.map((line, index) =>
          line.from === "you" ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines are only ever appended.
            <div key={index} className="rise flex justify-end pl-10 sm:pl-20">
              <div className="min-w-0">
                <p className="sr-only">You</p>
                <p className="whitespace-pre-wrap rounded-2xl rounded-br-md bg-[color-mix(in_srgb,var(--accent)_16%,#00000040)] px-4 py-2.5 leading-relaxed text-cream ring-1 ring-[color-mix(in_srgb,var(--accent)_25%,transparent)]">
                  {line.text}
                </p>
              </div>
            </div>
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines are only ever appended.
            <div key={index} className="rise flex items-end gap-2.5 pr-8 sm:pr-16">
              <div className="mb-0.5 hidden size-8 shrink-0 overflow-hidden rounded-full sm:block">
                {avatar}
              </div>
              <div className="min-w-0">
                <p className="mb-1 text-xs text-mist">{katName}</p>
                <p className="whitespace-pre-wrap rounded-2xl rounded-bl-md bg-black/35 px-4 py-2.5 leading-relaxed text-cream ring-1 ring-cream/8">
                  {line.text}
                </p>
                {line.payment && <Receipt payment={line.payment} />}
                {line.withheld && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-mist">
                    <Icon name="lock" size={13} />
                    The keeper held back a reply that quoted this collection's secret instructions.
                  </p>
                )}
              </div>
            </div>
          ),
        )}
        {thinking && (
          <div className="flex items-center gap-2.5 text-sm text-[var(--accent)]">
            <span className="dots flex gap-1" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            {katName} is thinking…
          </div>
        )}
        <div ref={end} />
      </div>
      <div className="border-t border-[var(--card-line)] p-3 sm:p-4">
        {problem && (
          <p role="alert" className="mb-3 flex items-start gap-2 text-sm text-alarm">
            <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
            {problem}
          </p>
        )}
        <form onSubmit={submit} className="flex items-end gap-2">
          <label htmlFor="chat-message" className="sr-only">
            Message to {katName}
          </label>
          <textarea
            id="chat-message"
            ref={box}
            className="field max-h-40 min-h-[2.875rem] flex-1 resize-none"
            rows={1}
            maxLength={MAX_CHARS}
            placeholder={`Message ${katName}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            // Read-only, not disabled, while waiting: a disabled field loses keyboard focus.
            readOnly={thinking}
          />
          <button
            type="submit"
            className="button button-lamp h-[2.875rem]"
            disabled={thinking || !draft.trim()}
          >
            Send
            <Icon name="send" size={16} />
          </button>
        </form>
      </div>
    </section>
  );
}

/** What became of a payment the mind made, drawn as a small receipt. */
function Receipt({ payment }: { payment: PaymentOutcome }) {
  const amount = formatNear(payment.amount, 6);
  const look =
    payment.status === "sent"
      ? { icon: "check" as const, tone: "border-glow/40 bg-glow/10 text-glow" }
      : payment.status === "pending"
        ? { icon: "clock" as const, tone: "border-lamp/40 bg-lamp/10 text-lamp" }
        : { icon: "x" as const, tone: "border-cream/15 bg-cream/5 text-mist" };
  return (
    <p
      className={`mt-2 flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${look.tone}`}
      role="status"
    >
      <Icon name={look.icon} size={16} className="mt-0.5 shrink-0" />
      <span>
        {payment.status === "sent"
          ? `Paid ${amount} NEAR to ${payment.receiver_id} from its wallet${payment.memo ? ` (${payment.memo})` : ""}.`
          : payment.status === "pending"
            ? `A payment of ${amount} NEAR to ${payment.receiver_id} was asked for and may still go through.`
            : `Tried to pay ${amount} NEAR to ${payment.receiver_id}: ${payment.reason}.`}
      </span>
    </p>
  );
}
