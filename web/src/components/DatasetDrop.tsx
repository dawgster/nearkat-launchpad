import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  classesFromFolders,
  classify,
  type DroppedSample,
  filesFromEntries,
  prepare as prepareInBrowser,
  TooLarge,
  toClassName,
} from "../lib/samples.ts";
import { Icon } from "./Icon.tsx";

/** One picture, shrunk and ready to seal. */
export interface PreparedSample {
  path: string;
  label: string;
  jpeg: Uint8Array;
  /** An object URL of the shrunk picture, revoked when the drop zone goes away. */
  thumb: string;
}

/** What a launch gets: the classes, and the samples in token order (token `i + 1` is `samples[i]`). */
export interface Dataset {
  classes: string[];
  samples: PreparedSample[];
}

export interface DatasetDropProps {
  /** Told the dataset once every picture is ready, and null while there is none. */
  onChange: (dataset: Dataset | null) => void;
  disabled?: boolean;
  /** Shrinks one picture. Replaced in tests, where there is no canvas. */
  prepare?: (sample: DroppedSample) => Promise<{ label: string; jpeg: Uint8Array; thumb: string }>;
}

type Prepared = { jpeg: Uint8Array; thumb: string } | { failed: "too large" | "can't be read" };

/** Thumbnails shown at once; a large dataset shows a count for the rest. */
const SHOWN = 120;

const parseClasses = (text: string) => [
  ...new Set(
    text
      .split(",")
      .map((name) => toClassName(name.trim()))
      .filter(Boolean),
  ),
];

/** Where a creator drops a folder of pictures, sorted into classes by their folders. */
export function DatasetDrop({
  onChange,
  disabled = false,
  prepare = prepareInBrowser,
}: DatasetDropProps) {
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Array<{ path: string; file: File }>>([]);
  const [classesText, setClassesText] = useState("");
  const [prepared, setPrepared] = useState<ReadonlyMap<string, Prepared>>(new Map());
  const [dragging, setDragging] = useState(false);
  /** Every thumbnail made, so all are revoked, even those of an earlier drop. */
  const thumbs = useRef(new Set<string>());

  useEffect(() => {
    // Not a React prop: set here so the picker picks folders.
    folderInput.current?.setAttribute("webkitdirectory", "");
  }, []);
  useEffect(() => {
    const made = thumbs.current;
    return () => {
      for (const url of made) {
        URL.revokeObjectURL(url);
      }
      made.clear();
    };
  }, []);

  const classes = useMemo(() => parseClasses(classesText), [classesText]);
  const classified = useMemo(() => classify(files, classes), [files, classes]);

  // Shrinks pictures one at a time, so a large folder doesn't hold every original at once.
  useEffect(() => {
    let current = true;
    const todo = classified.samples.filter((sample) => !prepared.has(sample.path));
    const next = todo[0];
    if (next) {
      prepare(next).then(
        ({ jpeg, thumb }) => {
          thumbs.current.add(thumb);
          if (current) {
            setPrepared((map) => new Map(map).set(next.path, { jpeg, thumb }));
          }
        },
        (error: unknown) => {
          if (current) {
            const failed = error instanceof TooLarge ? "too large" : "can't be read";
            setPrepared((map) => new Map(map).set(next.path, { failed }));
          }
        },
      );
    }
    return () => {
      current = false;
    };
  }, [classified, prepared, prepare]);

  const waiting = classified.samples.filter((sample) => !prepared.has(sample.path)).length;
  const dataset = useMemo<Dataset | null>(() => {
    if (waiting > 0 || classified.samples.length === 0) {
      return null;
    }
    const samples: PreparedSample[] = [];
    for (const { path, label } of classified.samples) {
      const done = prepared.get(path);
      if (done && "jpeg" in done) {
        samples.push({ path, label, jpeg: done.jpeg, thumb: done.thumb });
      }
    }
    return { classes, samples };
  }, [waiting, classified, prepared, classes]);
  useEffect(() => onChange(dataset), [dataset, onChange]);

  const skipped = [
    ...classified.skipped,
    ...classified.samples.flatMap(({ path }) => {
      const done = prepared.get(path);
      return done && "failed" in done ? [{ path, reason: done.failed }] : [];
    }),
  ];
  const counts = classes.map(
    (name) => [name, dataset?.samples.filter((s) => s.label === name).length ?? 0] as const,
  );

  function take(dropped: Array<{ path: string; file: File }>) {
    for (const url of thumbs.current) {
      URL.revokeObjectURL(url);
    }
    thumbs.current.clear();
    setPrepared(new Map());
    setFiles(dropped);
    setClassesText(classesFromFolders(dropped.map((f) => f.path)).join(", "));
  }

  async function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    // Entries must be taken before the first await, while the drop is still current.
    const entries = Array.from(event.dataTransfer.items)
      .map((item) => item.webkitGetAsEntry?.())
      .filter((entry): entry is FileSystemEntry => !!entry);
    take(
      entries.length > 0
        ? await filesFromEntries(entries)
        : Array.from(event.dataTransfer.files, (file) => ({ path: file.name, file })),
    );
  }

  const picked = (list: FileList | null) =>
    take(Array.from(list ?? [], (file) => ({ path: file.webkitRelativePath || file.name, file })));

  return (
    <div className="space-y-5">
      <input
        ref={folderInput}
        type="file"
        multiple
        className="sr-only"
        aria-label="Choose a folder"
        disabled={disabled}
        onChange={(event) => {
          picked(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={filesInput}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label="Choose pictures"
        disabled={disabled}
        onChange={(event) => {
          picked(event.target.files);
          event.target.value = "";
        }}
      />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the buttons inside do the same for keyboards. */}
      <div
        className={`flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-7 text-center transition-colors ${
          dragging ? "border-glow bg-glow/10" : "border-cream/25 bg-black/20"
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => void drop(event)}
      >
        <span className="font-bold text-cream">Drop a folder of pictures here</span>
        <span className="max-w-md text-sm text-mist">
          One folder per class, like <span className="font-mono">hotdog/</span> and{" "}
          <span className="font-mono">not_hotdog/</span>. JPEG, PNG or WebP. Each picture is shrunk
          and sealed in this browser; the originals never leave it.
        </span>
        <span className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            className="button button-quiet"
            disabled={disabled}
            onClick={() => folderInput.current?.click()}
          >
            Choose a folder
          </button>
          <button
            type="button"
            className="button button-quiet"
            disabled={disabled}
            onClick={() => filesInput.current?.click()}
          >
            Choose pictures
          </button>
        </span>
      </div>

      {files.length > 0 && (
        <>
          <div>
            <label htmlFor="classes" className="label">
              Classes
            </label>
            <p id="classes-hint" className="hint mt-1">
              The folder names found, separated by commas. A picture belongs to the nearest folder
              named after a class. Fixed at launch.
            </p>
            <input
              id="classes"
              className="field mt-2 font-mono"
              value={classesText}
              aria-describedby="classes-hint"
              disabled={disabled}
              onChange={(event) => setClassesText(event.target.value)}
            />
          </div>

          {waiting > 0 && (
            <p className="text-sm text-mist" role="status">
              Shrinking pictures… {classified.samples.length - waiting} of{" "}
              {classified.samples.length}
            </p>
          )}

          <ul aria-label="Samples per class" className="flex flex-wrap gap-2">
            {counts.map(([name, count]) => (
              <li key={name} className={`chip ${count === 0 ? "text-alarm" : ""}`}>
                <span className="font-mono">{name}</span>
                <span className="font-bold">{count}</span>
              </li>
            ))}
          </ul>

          {dataset && dataset.samples.length > 0 && (
            <div>
              <ul className="grid max-h-80 grid-cols-[repeat(auto-fill,minmax(4rem,1fr))] gap-2 overflow-y-auto pr-1">
                {dataset.samples.slice(0, SHOWN).map((sample, i) => (
                  <li key={sample.path} className="relative">
                    <img
                      src={sample.thumb}
                      alt={`Token ${i + 1}, ${sample.label}`}
                      className="aspect-square w-full rounded-lg object-cover ring-1 ring-cream/10"
                    />
                  </li>
                ))}
              </ul>
              {dataset.samples.length > SHOWN && (
                <p className="mt-2 text-xs text-mist">And {dataset.samples.length - SHOWN} more.</p>
              )}
            </div>
          )}

          {skipped.length > 0 && (
            <div>
              <p className="eyebrow flex items-center gap-2">
                <Icon name="alert" size={14} />
                Left out
              </p>
              <ul aria-label="Skipped" className="mt-2 max-h-40 space-y-1 overflow-y-auto text-sm">
                {skipped.map(({ path, reason }) => (
                  <li key={path} className="text-mist">
                    <span className="break-all font-mono text-cream/90">{path}</span>: {reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
