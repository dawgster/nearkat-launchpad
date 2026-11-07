/**
 * A contact sheet for reviewing kat art: every value of one layer on a
 * default kat, or every growth stage, rendered to an HTML page and a PNG.
 *
 *   node art/scripts/sheet.ts <sky|fur|eyes|paws|outfit|headwear|stages|mix> <out.png>
 *
 * The PNG needs Playwright, which the web app already has installed.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type KatLook, LAYERS, renderKat, type Stage } from "../kat/render.ts";

const DEFAULT: KatLook = {
  sky: "Day",
  fur: "Sand",
  eyes: "Round",
  paws: "Empty Paws",
  outfit: "Bare",
  headwear: "None",
};

const [what = "stages", out = "sheet.png"] = process.argv.slice(2);
const cells: Array<{ caption: string; svg: string }> = [];
let index = 0;
const add = (caption: string, kat: KatLook, stage: Stage = 2) =>
  cells.push({ caption, svg: renderKat(kat, stage, { id: `c${index++}`, title: null }) });

if (what === "stages") {
  for (const stage of [0, 1, 2, 3] as const) {
    add(["Hatchling", "Pup", "Sentry", "Elder"][stage] as string, DEFAULT, stage);
  }
} else if (what === "mix") {
  // Each value of every layer, rotated through, so layers are seen together.
  const keys = Object.keys(LAYERS) as Array<keyof KatLook>;
  const longest = Math.max(...keys.map((key) => LAYERS[key].length));
  for (let i = 0; i < Math.min(longest, 24); i++) {
    const kat = Object.fromEntries(
      keys.map((key) => {
        const values = LAYERS[key];
        return [key, values[(i * 7 + keys.indexOf(key) * 3) % values.length]?.name];
      }),
    ) as unknown as KatLook;
    add(Object.values(kat).join(" · "), kat, (i % 4) as Stage);
  }
} else if (what in LAYERS) {
  const key = what as keyof KatLook;
  for (const value of LAYERS[key]) {
    add(`${value.name} (${(value.share * 100).toFixed(2)}%)`, { ...DEFAULT, [key]: value.name });
  }
} else {
  throw new Error(`Unknown sheet "${what}"`);
}

const html = `<!doctype html><html><body style="margin:0;background:#1d1d1d;display:grid;grid-template-columns:repeat(6,220px);gap:8px;padding:8px;font:11px system-ui;color:#eee">${cells
  .map(
    (cell) =>
      `<figure style="margin:0"><div style="width:220px;height:220px">${cell.svg}</div><figcaption>${cell.caption}</figcaption></figure>`,
  )
  .join("")}</body></html>`;
const htmlPath = resolve(out.replace(/\.png$/, ".html"));
writeFileSync(htmlPath, html);

const playwright = await import(
  resolve(import.meta.dirname, "../../web/node_modules/playwright/index.mjs")
);
const browser = await playwright.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1380, height: 400 } });
await page.goto(`file://${htmlPath}`);
await page.screenshot({ path: resolve(out), fullPage: true });
await browser.close();
console.log(`${cells.length} cells -> ${resolve(out)}`);
