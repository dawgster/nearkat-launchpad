// Stands in for assemble.py: the head as JSON on stdin, the model written to --out.
import { writeFileSync } from "node:fs";
import { text } from "node:stream/consumers";

const args = process.argv.slice(2);
const arg = (name) => args[args.indexOf(name) + 1];
const head = JSON.parse(await text(process.stdin));
if (process.env.FAKE_ASSEMBLE_MODE === "fail") {
  process.stderr.write(`error: ValueError: bad head ${head.weight}\n`);
  process.exit(1);
}
if (process.env.FAKE_ASSEMBLE_MODE !== "no-file") {
  writeFileSync(arg("--out"), `model rebuilt from ${head.weight} on ${head.backbone_sha256}`);
}
process.stdout.write(`${JSON.stringify({ stage: "done", classes: 2 })}\n`);
