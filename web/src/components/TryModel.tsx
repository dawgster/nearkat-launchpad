import { type DragEvent, useEffect, useRef, useState } from "react";
import { type Classifier, heldoutAccuracy, loadModel, type Picture } from "../lib/model.ts";
import { describeProblem } from "../lib/problems.ts";
import { Icon } from "./Icon.tsx";

export interface TryModelProps {
  bytes: Uint8Array;
  /** The model's hash as the contract recorded it. Other bytes are refused. */
  sha256: string;
  classes: string[];
  load?: (bytes: Uint8Array, sha256: string) => Promise<Classifier>;
  heldout?: (classifier: Classifier, classes: string[]) => Promise<number>;
  decode?: (file: File) => Promise<Picture>;
}

const percent = (share: number) => `${Math.round(share * 100)}%`;
const shown = (label: string) => label.replaceAll("_", " ");

/**
 * Runs a trained model in this browser: its accuracy on the public held-out
 * set, measured again here, and a classifier for a photo of your own.
 */
export function TryModel({
  bytes,
  sha256,
  classes,
  load = loadModel,
  heldout = heldoutAccuracy,
  decode = (file) => createImageBitmap(file),
}: TryModelProps) {
  const [classifier, setClassifier] = useState<Classifier | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [accuracy, setAccuracy] = useState<
    { status: "pending" } | { status: "ready"; value: number } | { status: "error"; text: string }
  >({ status: "pending" });
  const [photo, setPhoto] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<
    | { status: "pending" }
    | { status: "ready"; label: string; confidence: number }
    | { status: "error"; text: string }
    | null
  >(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const classKey = classes.join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the classes by value; loaders are fixed for a model's life.
  useEffect(() => {
    let current = true;
    setClassifier(null);
    setProblem(null);
    setAccuracy({ status: "pending" });
    load(bytes, sha256).then(
      (loaded) => {
        if (!current) {
          return;
        }
        setClassifier(loaded);
        heldout(loaded, classes).then(
          (value) => current && setAccuracy({ status: "ready", value }),
          (error: unknown) =>
            current && setAccuracy({ status: "error", text: describeProblem(error) }),
        );
      },
      (error: unknown) => current && setProblem(describeProblem(error)),
    );
    return () => {
      current = false;
    };
  }, [bytes, sha256, classKey]);

  // The preview's object URL is released when it is replaced or the panel goes.
  useEffect(() => () => void (photo && URL.revokeObjectURL(photo)), [photo]);

  async function tryPhoto(file: File | undefined) {
    if (!file || !classifier) {
      return;
    }
    setPhoto(URL.createObjectURL(file));
    setVerdict({ status: "pending" });
    try {
      const image = await decode(file);
      try {
        const result = await classifier.classify(image, classes);
        setVerdict({ status: "ready", ...result });
      } finally {
        if ("close" in image) {
          image.close();
        }
      }
    } catch (error) {
      setVerdict({ status: "error", text: describeProblem(error) });
    }
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    void tryPhoto(event.dataTransfer.files[0]);
  }

  if (problem) {
    return (
      <p
        role="alert"
        className="rounded-xl border border-alarm/30 bg-alarm/10 px-3 py-2 text-sm text-alarm"
      >
        {problem}
      </p>
    );
  }
  if (!classifier) {
    return (
      <p className="text-sm text-mist" role="status">
        Opening the model in this browser…
      </p>
    );
  }
  return (
    <section aria-labelledby="try-model" className="space-y-4">
      <h3 id="try-model" className="eyebrow">
        Try it
      </h3>
      <p className="text-sm" role="status">
        {accuracy.status === "ready"
          ? `Held-out accuracy in your browser: ${percent(accuracy.value)}`
          : accuracy.status === "error"
            ? accuracy.text
            : "Scoring the model on the public held-out set in your browser…"}
      </p>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label="Choose a photo"
        onChange={(event) => {
          void tryPhoto(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the button inside does the same for keyboards. */}
      <div
        className={`flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-6 text-center transition-colors ${
          dragging ? "border-glow bg-glow/10" : "border-cream/25 bg-black/20"
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
      >
        <span className="font-bold text-cream">Drop a photo here</span>
        <span className="text-sm text-mist">It stays in this browser.</span>
        <button
          type="button"
          className="button button-quiet"
          onClick={() => input.current?.click()}
        >
          Choose a photo
        </button>
      </div>
      {photo && (
        <div className="flex items-center gap-4">
          <img
            src={photo}
            alt="What you dropped"
            className="size-24 shrink-0 rounded-lg object-cover ring-1 ring-cream/10"
          />
          <p className="text-sm" role="status" aria-label="Verdict">
            {verdict?.status === "ready" ? (
              <>
                <span className="flex items-center gap-2 font-display text-2xl">
                  <Icon name="sparkle" size={18} className="text-glow" />
                  {shown(verdict.label)}
                </span>
                <span className="text-mist">{percent(verdict.confidence)} sure</span>
              </>
            ) : verdict?.status === "error" ? (
              <span className="text-alarm">{verdict.text}</span>
            ) : (
              "Looking…"
            )}
          </p>
        </div>
      )}
    </section>
  );
}
