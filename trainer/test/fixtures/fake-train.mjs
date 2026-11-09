// Stands in for train.py: same arguments, same stdin and stdout.
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const arg = (name) => args[args.indexOf(name) + 1];
const mode = process.env.FAKE_TRAIN_MODE ?? "ok";
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);

const rows = [];
for await (const line of createInterface({ input: process.stdin })) {
  if (line.trim()) {
    rows.push(JSON.parse(line));
  }
}
if (mode === "fail") {
  process.stderr.write(`error: ValueError: cannot read ${rows[0]?.jpeg}\n`);
  process.exit(1);
}
emit({ stage: "loaded", count: rows.length });
console.log("some library chatter");
emit({ stage: "epoch", epoch: 1, epochs: 1, loss: 0.25 });
const summary = rows.map((r) => `${r.label}:${Buffer.from(r.jpeg, "base64").toString()}`);
writeFileSync(arg("--out"), `model for ${arg("--classes")} from ${arg("--heldout")}: ${summary}`);
if (mode !== "no-done") {
  emit({ stage: "done", accuracy: 0.5, heldout: 4, seconds: 0.1 });
}
