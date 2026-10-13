import { type FormEvent, useEffect, useState } from "react";
import { formatNear } from "../lib/format.ts";
import { describeProblem } from "../lib/problems.ts";

const MAX_CHARS = 4000;

export interface PersonalityEditorProps {
  personality: string;
  /** What the keeper charges per save, in yoctoNEAR. */
  savePrice: bigint;
  save: (prompt: string) => Promise<void>;
}

export function PersonalityEditor({ personality, savePrice, save }: PersonalityEditorProps) {
  const [draft, setDraft] = useState(personality);
  const [saved, setSaved] = useState(personality);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  // The stored personality can change underneath (a reload after a memory
  // save). Follow it, unless the owner is in the middle of editing.
  useEffect(() => {
    setSaved((before) => {
      setDraft((current) => (current === before ? personality : current));
      return personality;
    });
  }, [personality]);
  const changed = draft !== saved;
  const valid = draft.trim().length > 0 && draft.length <= MAX_CHARS;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState("saving");
    setProblem(null);
    try {
      await save(draft);
      setSaved(draft);
      setState("saved");
    } catch (error) {
      setProblem(describeProblem(error));
      setState("idle");
    }
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="personality" className="block text-lg font-bold">
        Personality
      </label>
      <p id="personality-hint" className="mt-1 text-sm text-mist">
        Describe who this kat is. It reads this before every reply.
      </p>
      <textarea
        id="personality"
        className="field mt-3 min-h-[11rem] resize-y leading-relaxed"
        aria-describedby="personality-hint personality-count"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setState("idle");
        }}
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span
          id="personality-count"
          className={`text-sm ${draft.length > MAX_CHARS ? "text-alarm" : "text-mist"}`}
        >
          {draft.length.toLocaleString("en-US")} of 4,000 characters
        </span>
        <button
          type="submit"
          className="button button-lamp"
          disabled={!changed || !valid || state === "saving"}
        >
          {state === "saving" ? "Saving…" : "Save personality"}
        </button>
      </div>
      <p className="mt-2 text-sm text-mist" aria-live="polite">
        {state === "saved" && !changed
          ? "Personality saved."
          : `Saving costs ${formatNear(savePrice)} NEAR from the kat's balance.`}
      </p>
      {problem && (
        <p role="alert" className="mt-2 text-sm text-alarm">
          {problem}
        </p>
      )}
    </form>
  );
}
