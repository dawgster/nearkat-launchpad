import { readdirSync } from "node:fs";
import { join } from "node:path";

/** How many held-out images `<dir>/<class>/*.jpg` holds; 0 if there is no such directory. */
export function countHeldout(dir: string): number {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .reduce(
        (total, entry) =>
          total +
          readdirSync(join(dir, entry.name)).filter((name) => /\.jpe?g$/i.test(name)).length,
        0,
      );
  } catch {
    return 0;
  }
}
