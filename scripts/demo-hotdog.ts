// Spreads a launched dataset collection's samples across holder accounts and
// lists every one for rent to a training app, so a renter pays several holders.
//
//   node scripts/demo-hotdog.ts --collection <id> --creator <acct> \
//     --holders h1,h2,h3 --fee 0.01 --duration 86400 --app <app_id> \
//     [--network testnet|sandbox] [--rpc <url>] [--keys <file.json>]
//
// Stage fallback, renting from the command line instead of the web page:
//   node scripts/demo-hotdog.ts --collection <id> --renter <acct> --rent 150 \
//     --app <app_id> [--network ...] [--rpc ...] [--keys ...]
// It rents the N cheapest offered samples for the app, spread across lenders,
// in borrow_many calls of at most 40, each attaching exactly its fees.
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
// borrow_many logs one event per sample, and a log line may not pass 16384 bytes:
// 50 samples came to 16503 in a sandbox run and failed, so rent in smaller calls.
const RENT_CHUNK = 40;

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
    rent: { type: "string" },
    renter: { type: "string" },
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
const renting = values.rent !== undefined;
const creator = renting ? (values.renter ?? need("creator")) : need("creator");
const app = need("app");
const holders = renting ? [] : need("holders").split(",").map((h) => h.trim()).filter(Boolean);
if (!renting && (holders.length === 0 || new Set(holders).size !== holders.length || holders.includes(creator))) {
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
  // The contract panics on a from_index past the end, so ask for the count first.
  const total = Number(await as(creator).view<string>(collection, "nft_supply_for_owner", { account_id: account }));
  for (let from = 0; from < total; from += PAGE) {
    const page = await as(creator).view<Token[]>(collection, "nft_tokens_for_owner", {
      account_id: account,
      from_index: String(from),
      limit: PAGE,
    });
    ids.push(...page.map((t) => t.token_id));
  }
  return ids;
}
const chunked = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
const byNumber = (a: string, b: string) => (Number(a) - Number(b)) || a.localeCompare(b);

/** With GAS_REPORT=1, prints the Tgas a call burnt in all its receipts. */
function report(label: string, outcome: unknown, n: number) {
  if (!process.env.GAS_REPORT) {
    return;
  }
  const o = outcome as { transaction_outcome?: { outcome: { gas_burnt: number } }; receipts_outcome?: Array<{ outcome: { gas_burnt: number } }> };
  const burnt = [o.transaction_outcome, ...(o.receipts_outcome ?? [])].reduce((s, r) => s + BigInt(r?.outcome.gas_burnt ?? 0), 0n);
  console.log(`  [gas] ${label} of ${n}: ${Number(burnt) / 1e12} Tgas burnt`);
}

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
  // An offer on other terms is replaced by lend_many, which the owner may do.
  return loan.fee === feeYocto.toString() && !!training?.apps.includes(app);
}

// Rent mode: take N offered samples for the app, then stop.
if (renting) {
  const wanted = Number(values.rent);
  if (!Number.isInteger(wanted) || wanted <= 0) {
    console.error("--rent is a whole number of samples");
    process.exit(2);
  }
  const near = as(creator);
  const offers: Array<{ id: string; lender: string; fee: bigint }> = [];
  const supply = Number(await near.view<string>(collection, "nft_total_supply", {}));
  for (let from = 0; from < supply; from += PAGE) {
    const page = await near.view<Token[]>(collection, "nft_tokens", { from_index: String(from), limit: PAGE });
    const found = await Promise.all(
      page.map(async ({ token_id: id }) => {
        const [loan, training] = await Promise.all([
          near.view<(Loan & { lender_id: string }) | null>(collection, "get_loan", { token_id: id }),
          near.view<Training | null>(collection, "get_loan_training", { token_id: id }),
        ]);
        return loan?.status === "offered" && loan.lender_id !== creator && training?.apps.includes(app)
          ? { id, lender: loan.lender_id, fee: BigInt(loan.fee) }
          : null;
      }),
    );
    offers.push(...found.filter((o) => o !== null));
  }
  // Cheapest first; among equals, take one from each lender in turn.
  const queues = new Map<string, typeof offers>();
  for (const o of offers.sort((a, b) => (a.fee < b.fee ? -1 : a.fee > b.fee ? 1 : byNumber(a.id, b.id)))) {
    queues.set(o.lender, [...(queues.get(o.lender) ?? []), o]);
  }
  const picked: typeof offers = [];
  while (picked.length < wanted && [...queues.values()].some((q) => q.length > 0)) {
    for (const q of queues.values()) {
      const next = q.shift();
      if (next && picked.length < wanted) {
        picked.push(next);
      }
    }
  }
  if (picked.length < wanted) {
    console.log(`Only ${picked.length} samples are on offer for ${app}; renting those.`);
  }
  const paid = new Map<string, bigint>();
  let rented = 0;
  for (const chunk of chunked(picked, RENT_CHUNK)) {
    const fees = chunk.reduce((sum, o) => sum + o.fee, 0n);
    await near.call(
      collection,
      "borrow_many",
      { token_ids: chunk.map((o) => o.id), app_id: app },
      { gas: "300 Tgas", attachedDeposit: `${fees} yocto`, waitUntil: "FINAL" },
    );
    rented += chunk.length;
    for (const o of chunk) {
      paid.set(o.lender, (paid.get(o.lender) ?? 0n) + o.fee);
    }
  }
  console.log(`${creator} rented ${rented} samples for ${app}`);
  for (const [lender, yocto] of paid) {
    console.log(`  paid ${lender}: ${Number(yocto) / 1e24} NEAR`);
  }
  process.exit(rented === wanted ? 0 : 1);
}

process.on("uncaughtException", (error) => {
  console.error(`${error}\nNothing is lost: run the same command again to carry on.`);
  process.exit(1);
});

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
  report("transfer batch", await tx.send({ waitUntil: "FINAL" }), chunk.length);
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
    const outcome = await as(holder).call(
      collection,
      "lend_many",
      { token_ids: chunk, duration_s: String(duration), fee: feeYocto.toString(), apps: [app] },
      { gas: "300 Tgas", attachedDeposit: `${STORAGE_PER_LOAN * BigInt(chunk.length)} yocto`, waitUntil: "FINAL" },
    );
    report("lend_many chunk", outcome, chunk.length);
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
  const checks = await Promise.all(
    ids.map(async (id) => {
      const [loan, training] = await Promise.all([
        as(creator).view<Loan | null>(collection, "get_loan", { token_id: id }),
        as(creator).view<Training | null>(collection, "get_loan_training", { token_id: id }),
      ]);
      return (loan?.status === "offered" || loan?.status === "active") && !!training?.apps.includes(app);
    }),
  );
  const listed = checks.filter(Boolean).length;
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
