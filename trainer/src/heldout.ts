import { readdirSync } from "node:fs";
import { join } from "node:path";

/** Held-out images are JPEGs, `.jpg` or `.jpeg` in any case, as train.py reads them. */
const isJpeg = (name: string) => /\.jpe?g$/i.test(name);

/** How many JPEGs one class directory holds; 0 if there is no such directory. */
function countIn(dir: string): number {
  try {
    return readdirSync(dir).filter(isJpeg).length;
  } catch {
    return 0;
  }
}

/** How many held-out images `<dir>/<class>/*.jpg` holds; 0 if there is no such directory. */
export function countHeldout(dir: string): number {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .reduce((total, entry) => total + countIn(join(dir, entry.name)), 0);
  } catch {
    return 0;
  }
}

/** The first class with no held-out image, which train.py would refuse; undefined if none. */
export function classWithoutHeldout(dir: string, classes: string[]): string | undefined {
  return classes.find((cls) => countIn(join(dir, cls)) === 0);
}
