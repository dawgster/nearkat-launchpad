// Spreads a launched dataset collection's samples across holder accounts and
// lists every one for rent to a training app, so a renter pays several holders.
//
//   node scripts/demo-hotdog.ts --collection <id> --creator <acct> \
//     --holders h1,h2,h3 --fee 0.01 --duration 86400 --app <app_id> \
//     [--network testnet|sandbox] [--rpc <url>] [--keys <file.json>]
//
// Credentials: on testnet, ~/.near-credentials/testnet/<account>.json
// ({"private_key": "ed25519:..."}). With --keys, a JSON map of account id to
// secret key is used first, which is how a sandbox's accounts are supplied:
//   { "creator.test.near": "ed25519:...", "holder1.test.near": "ed25519:..." }
//
// Safe to run again: a token already on a holder stays there, and a token
// already offered to the app (or rented out) is left alone.
//
// near-kit comes from keeper/node_modules, so no install is needed here.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

const here = dirname(new URL(import.meta.url).pathname);
const keeperRequire = createRequire(resolve(here, "../keeper/package.json"));
const { Near } = (await import(pathToFileURL(keeperRequire.resolve("near-kit")).href)) as typeof import("near-kit");

const PAGE = 50; // tokens per view page, and per lend_many call
const TRANSFERS_PER_TX = 10;

const { values } = parseArgs({
  options: {
    collection: { type: "string" },
    creator: { type: "string" },
    holders: { type: "string" },
    fee: { type: "string", default: "0.01" },
    duration: { type: "string", default: "86400" },
    app: { type: "string" },
    network: { type: "string", default: "testnet" },
    rpc: { type: "string" },
    keys: { type: "string" },
  },
});
const need = (name: "collection" | "creator" | "holders" | "app"): string => {
  const value = values[name];
  if (!value) {
    console.error(`Missing --${name}. See the usage at the top of ${new URL(import.meta.url).pathname}`);
    process.exit(2);
  }
  return value;
};
const collection = need("collection");
const creator = need("creator");
const app = need("app");
const holders = need("holders").split(",").map((h) => h.trim()).filter(Boolean);
if (holders.length === 0 || new Set(holders).size !== holders.length || holders.includes(creator)) {
  console.error("--holders is a list of distinct accounts, none of them the creator");
  process.exit(2);
}
const duration = Number(values.duration);
if (!Number.isInteger(duration) || duration <= 0) {
  console.error("--duration is a whole number of seconds");
  process.exit(2);
}
const feeNear = values.fee as string;
if (!/^\d+(\.\d{1,24})?$/.test(feeNear)) {
  console.error("--fee is an amount of NEAR, such as 0.01");
  process.exit(2);
}
const [whole, frac = ""] = feeNear.split(".");
const feeYocto = BigInt(whole + frac.padEnd(24, "0"));

const network = values.network as string;
if (network !== "testnet" && network !== "sandbox") {
  console.error("--network is testnet or sandbox");
  process.exit(2);
}
if (network === "sandbox" && !values.rpc) {
  console.error("--network sandbox needs --rpc <url>");
  process.exit(2);
}

const keyFile: Record<string, string> = values.keys
  ? JSON.parse(readFileSync(values.keys, "utf8"))
  : {};
function secretKeyOf(account: string): string {
  if (keyFile[account]) {
    return keyFile[account];
  }
  const path = join(homedir(), ".near-credentials", network === "sandbox" ? "localnet" : network, `${account}.json`);
  try {
    return JSON.parse(readFileSync(path, "utf8")).private_key;
  } catch {
    throw new Error(`No key for ${account}: add it to --keys, or put it at ${path}`);
  }
}
const clients = new Map<string, InstanceType<typeof Near>>();
function as(account: string) {
  let near = clients.get(account);
  if (!near) {
    near = new Near({
      network: values.rpc ? { rpcUrl: values.rpc, networkId: network === "sandbox" ? "localnet" : network } : (network as "testnet"),
      privateKey: secretKeyOf(account) as `ed25519:${string}`,
      defaultSignerId: account,
    });
    clients.set(account, near);
  }
  return near;
}

interface Token {
  token_id: string;
}
interface Loan {
  status: "offered" | "active" | "over";
  fee: string;
}
interface Training {
  apps: string[];
}

async function tokensOf(account: string): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const page = await as(creator).view<Token[]>(collection, "nft_tokens_for_owner", {
      account_id: account,
      from_index: String(from),
      limit: PAGE,
    });
    ids.push(...page.map((t) => t.token_id));
    if (page.length < PAGE) {
      return ids;
    }
  }
}
const chunked = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
const byNumber = (a: string, b: string) => (Number(a) - Number(b)) || a.localeCompare(b);

/** Rented out for a fee: it can't change hands until the loan ends. */
async function isRented(tokenId: string): Promise<boolean> {
  const loan = await as(creator).view<Loan | null>(collection, "get_loan", { token_id: tokenId });
  return loan?.status === "active" && loan.fee !== "0";
}
/** Already on offer to this app, or in use: nothing to do. */
async function alreadyListed(tokenId: string): Promise<boolean> {
  const near = as(creator);
  const loan = await near.view<Loan | null>(collection, "get_loan", { token_id: tokenId });
  if (!loan || loan.status === "over") {
    return false;
  }
  if (loan.status === "active") {
    return true;
  }
  const training = await near.view<Training | null>(collection, "get_loan_training", { token_id: tokenId });
  return loan.fee === feeYocto.toString() && !!training?.apps.includes(app);
}

// 1. Deal the creator's tokens out. Every token has a place by its position in
//    the sorted list of tokens the creator and holders own, so a rerun deals
//    the same way and moves only what is still with the creator.
const held = new Map<string, string[]>();
for (const account of [creator, ...holders]) {
  held.set(account, await tokensOf(account));
}
const all = [...held.values()].flat().sort(byNumber);
const target = new Map(all.map((id, i) => [id, holders[i % holders.length] as string]));
const moved = new Map<string, string[]>(holders.map((h) => [h, []]));
const stuck: string[] = [];
const toMove: Array<[string, string]> = [];
for (const id of held.get(creator) as string[]) {
  if (await isRented(id)) {
    stuck.push(id);
  } else {
    toMove.push([id, target.get(id) as string]);
  }
}
for (const chunk of chunked(toMove, TRANSFERS_PER_TX)) {
  const tx = as(creator).transaction(creator);
  for (const [id, receiver] of chunk) {
    tx.functionCall(collection, "nft_transfer", { receiver_id: receiver, token_id: id }, { gas: "25 Tgas", attachedDeposit: "1 yocto" });
  }
  await tx.send({ waitUntil: "FINAL" });
  for (const [id, receiver] of chunk) {
    moved.get(receiver)?.push(id);
  }
}

// 2. Each holder lists what it holds, in chunks of 50.
const STORAGE_PER_LOAN = 10n ** 22n; // what the web app attaches; the rest comes back
const summary: Array<{ holder: string; held: number; received: number; offered: number; skipped: number }> = [];
for (const holder of holders) {
  const mine = (await tokensOf(holder)).sort(byNumber);
  const todo: string[] = [];
  for (const id of mine) {
    if (!(await alreadyListed(id))) {
      todo.push(id);
    }
  }
  let offered = 0;
  for (const chunk of chunked(todo, PAGE)) {
    await as(holder).call(
      collection,
      "lend_many",
      { token_ids: chunk, duration_s: String(duration), fee: feeYocto.toString(), apps: [app] },
      { gas: "300 Tgas", attachedDeposit: `${STORAGE_PER_LOAN * BigInt(chunk.length)} yocto`, waitUntil: "FINAL" },
    );
    offered += chunk.length;
  }
  summary.push({ holder, held: mine.length, received: moved.get(holder)?.length ?? 0, offered, skipped: mine.length - todo.length });
}

// 3. Check and report.
let offeredTotal = 0;
let tokenTotal = 0;
console.log(`Collection ${collection}: ${all.length} samples, fee ${feeNear} NEAR, ${duration}s, app ${app}`);
for (const row of summary) {
  const ids = await tokensOf(row.holder);
  let listed = 0;
  for (const id of ids) {
    const loan = await as(creator).view<Loan | null>(collection, "get_loan", { token_id: id });
    const training = await as(creator).view<Training | null>(collection, "get_loan_training", { token_id: id });
    if ((loan?.status === "offered" || loan?.status === "active") && training?.apps.includes(app)) {
      listed++;
    }
  }
  offeredTotal += listed;
  tokenTotal += ids.length;
  console.log(`  ${row.holder}: holds ${ids.length} (received ${row.received}), newly offered ${row.offered}, already offered ${row.skipped}, on offer to ${app}: ${listed}`);
}
if (stuck.length > 0) {
  console.log(`  Left with ${creator}, rented out: ${stuck.join(", ")}`);
}
console.log(`Total: ${offeredTotal} of ${all.length} samples on offer (${tokenTotal} held by holders)`);
if (offeredTotal !== all.length) {
  process.exitCode = 1;
}
