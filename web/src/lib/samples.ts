import { SAMPLE_INFO, sealTo } from "./sealing.ts";

/**
 * A dataset's pictures, as its creator drops them: sorted into classes by
 * their folders, shrunk and re-encoded in the browser, and sealed to the
 * keeper's key. Plain pictures never leave the browser.
 */

/** A picture and the class it belongs to. */
export interface DroppedSample {
  /** Where it was inside what was dropped, like `train/hotdog/1.jpg`. */
  path: string;
  label: string;
  file: File;
}

export type SkipReason = "not an image" | "no class folder";

/** The longest side of a prepared picture, in pixels. */
export const MAX_SIDE = 256;
/** The largest picture the keeper takes. */
export const MAX_JPEG_BYTES = 96 * 1024;
/** JPEG qualities tried in turn, until the picture fits. */
const QUALITIES = [0.85, 0.7, 0.5];

/** Datasets have 2 to 16 classes and at most 1000 samples, as the contract requires. */
export const MAX_CLASSES = 16;
export const MAX_SAMPLES = 1000;

const IMAGE_EXTENSION = /\.(jpe?g|png|webp)$/i;

/** A folder name as a class: lowercase, with `-` and spaces as `_`. */
export const toClassName = (folder: string) => folder.toLowerCase().replace(/[-\s]/g, "_");

const isImage = (path: string, file?: File) =>
  (file?.type.startsWith("image/") ?? false) || IMAGE_EXTENSION.test(path);

/** The folders a path is in, nearest first. */
const foldersOf = (path: string) => path.split("/").slice(0, -1).reverse();

/** Plain code-point order, the same in every browser and locale. */
const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Sorts dropped files into classes by the nearest folder named after one.
 * Samples come out ordered by class, then path, whatever order they were
 * dropped in: sample `i` becomes token `i + 1`.
 */
export function classify(
  files: Array<{ path: string; file: File }>,
  classes: string[],
): { samples: DroppedSample[]; skipped: Array<{ path: string; reason: SkipReason }> } {
  const samples: DroppedSample[] = [];
  const skipped: Array<{ path: string; reason: SkipReason }> = [];
  for (const { path, file } of files) {
    if (!isImage(path, file)) {
      skipped.push({ path, reason: "not an image" });
      continue;
    }
    const label = foldersOf(path)
      .map(toClassName)
      .find((folder) => classes.includes(folder));
    if (label === undefined) {
      skipped.push({ path, reason: "no class folder" });
      continue;
    }
    samples.push({ path, label, file });
  }
  samples.sort(
    (a, b) => classes.indexOf(a.label) - classes.indexOf(b.label) || byPath(a.path, b.path),
  );
  skipped.sort((a, b) => byPath(a.path, b.path));
  return { samples, skipped };
}

/** The classes a drop suggests: every folder that directly holds a picture, sorted. */
export function classesFromFolders(paths: string[]): string[] {
  const found = new Set<string>();
  for (const path of paths) {
    const folder = foldersOf(path)[0];
    if (folder !== undefined && isImage(path)) {
      found.add(toClassName(folder));
    }
  }
  return [...found].sort(byPath);
}

/** A class name the contract takes. */
export const isClassName = (name: string) => /^[a-z0-9_]{1,32}$/.test(name);

/** Why a dataset can't be launched as it is, or null. Same limits as the contract. */
export function datasetProblem(classes: string[], labels: string[]): string | null {
  if (labels.length === 0) {
    return "Drop a folder of pictures, one folder per class.";
  }
  if (classes.length < 2 || classes.length > MAX_CLASSES) {
    return `A dataset has 2 to ${MAX_CLASSES} classes.`;
  }
  const bad = classes.find((name) => !isClassName(name));
  if (bad !== undefined) {
    return `"${bad}" can't be a class: use up to 32 lowercase letters, digits and _.`;
  }
  const empty = classes.find((name) => !labels.includes(name));
  if (empty !== undefined) {
    return `There are no pictures for ${empty}.`;
  }
  if (labels.length > MAX_SAMPLES) {
    return `A dataset holds up to ${MAX_SAMPLES} pictures; this one has ${labels.length}.`;
  }
  return null;
}

/** Raised when a picture is still over the keeper's limit at the lowest quality. */
export class TooLarge extends Error {
  constructor() {
    super("The picture is too large even at low quality");
    this.name = "TooLarge";
  }
}

/** Encodes at falling qualities until the picture fits; null if it never does. */
export async function shrink(encode: (quality: number) => Promise<Blob>): Promise<Blob | null> {
  for (const quality of QUALITIES) {
    const blob = await encode(quality);
    if (blob.size <= MAX_JPEG_BYTES) {
      return blob;
    }
  }
  return null;
}

/**
 * Shrinks a picture to at most 256 pixels on its longest side and re-encodes
 * it as JPEG, which also drops its metadata (EXIF, location). `thumb` is an
 * object URL of the result; whoever shows it revokes it.
 */
export async function prepare(
  sample: DroppedSample,
): Promise<{ label: string; jpeg: Uint8Array; thumb: string }> {
  const bitmap = await createImageBitmap(sample.file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("This browser can't draw pictures off-screen");
    }
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await shrink((quality) => canvas.convertToBlob({ type: "image/jpeg", quality }));
    if (!blob) {
      throw new TooLarge();
    }
    return {
      label: sample.label,
      jpeg: new Uint8Array(await blob.arrayBuffer()),
      thumb: URL.createObjectURL(blob),
    };
  } finally {
    bitmap.close();
  }
}

function base64(bytes: Uint8Array): string {
  // In pieces: spreading a large array into one call overflows the stack.
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Seals one labelled picture to the keeper's sealing key, as the keeper opens samples. */
export function sealSample(sealKeyHex: string, label: string, jpeg: Uint8Array): Promise<string> {
  return sealTo(sealKeyHex, JSON.stringify({ label, jpeg: base64(jpeg) }), SAMPLE_INFO);
}

/** Every file under dropped files and folders, with its path inside the drop. */
export async function filesFromEntries(
  entries: FileSystemEntry[],
): Promise<Array<{ path: string; file: File }>> {
  const out: Array<{ path: string; file: File }> = [];
  const visit = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((ok, fail) =>
        (entry as FileSystemFileEntry).file(ok, fail),
      );
      out.push({ path: entry.fullPath.replace(/^\/+/, ""), file });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // A reader hands entries out in batches until it hands out none.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((ok, fail) =>
          reader.readEntries(ok, fail),
        );
        if (batch.length === 0) {
          break;
        }
        for (const child of batch) {
          await visit(child);
        }
      }
    }
  };
  for (const entry of entries) {
    await visit(entry);
  }
  return out;
}
