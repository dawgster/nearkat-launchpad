import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateKey, Near, type PrivateKey } from "near-kit";
import { Sandbox } from "near-kit/sandbox";

const KEEPER_DIR = resolve(process.env.KEEPER_DIR ?? "../keeper");
const WASM = resolve(process.env.CONTRACT_WASM ?? "../contract/target/near/nearkat_nft.wasm");
const KEEPER_PORT = 8788;
const MODEL_PORT = 8789;
export const ALICE_URL = "http://localhost:3000";
export const BOB_URL = "http://localhost:3001";

const children: ChildProcess[] = [];

function start(command: string, args: string[], cwd: string, env: Record<string, string>) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: "pipe" });
  child.stderr?.on("data", (chunk) => process.env.E2E_DEBUG && process.stderr.write(chunk));
  children.push(child);
  return child;
}

async function waitFor(url: string): Promise<Response> {
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      return await fetch(url);
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`${url} did not come up`);
}

/** Stands in for NEAR AI Cloud: echoes the user's message, and has no signatures. */
function startFakeModel() {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      if (request.url?.startsWith("/chat/completions")) {
        const { messages } = JSON.parse(body) as {
          messages: Array<{ role: string; content: string }>;
        };
        const system = messages[0]?.content ?? "";
        const last = messages.at(-1)?.content ?? "";
        const mood = system.includes("grumpy") ? "Hmph." : "Meow!";
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            id: `chat-${Date.now()}`,
            choices: [{ message: { role: "assistant", content: `${mood} You said: ${last}` } }],
          }),
        );
      } else {
        response.statusCode = 404;
        response.end();
      }
    });
  });
  server.listen(MODEL_PORT);
  return server;
}

/** A server left over from an earlier run would answer in place of the one we start. */
async function requireFree(url: string): Promise<void> {
  const taken = await fetch(url).then(
    () => true,
    () => false,
  );
  if (taken) {
    throw new Error(`${url} is already in use. Stop whatever is running there and try again.`);
  }
}

export default async function globalSetup() {
  if (!existsSync(WASM)) {
    throw new Error(`Build the contract first: ${WASM} is missing`);
  }
  for (const url of [ALICE_URL, BOB_URL, `http://127.0.0.1:${KEEPER_PORT}/attestation`]) {
    await requireFree(url);
  }
  const sandbox = await Sandbox.start();
  const root = sandbox.rootAccount.id;
  const rootNear = new Near({ network: sandbox });
  const stamp = Date.now();
  const names = {
    contract: `nearkat-${stamp}.${root}`,
    keeper: `keeper-${stamp}.${root}`,
    alice: `alice-${stamp}.${root}`,
    bob: `bob-${stamp}.${root}`,
  };
  const model = startFakeModel();

  // The keeper derives its own key, so it starts first and tells us which key to register.
  const data = mkdtempSync(join(tmpdir(), "nearkat-e2e-"));
  start("node", ["src/main.ts"], KEEPER_DIR, {
    NEAR_NETWORK: "sandbox",
    NEAR_RPC_URL: sandbox.rpcUrl,
    CONTRACT_ID: names.contract,
    KEEPER_ACCOUNT_ID: names.keeper,
    KEEPER_ROOT_SECRET: "07".repeat(32),
    NEAR_AI_API_KEY: "unused",
    NEAR_AI_BASE_URL: `http://127.0.0.1:${MODEL_PORT}`,
    STORE_DIR: join(data, "contexts"),
    METER_JOURNAL: join(data, "meter.json"),
    PORT: String(KEEPER_PORT),
    WEB_ORIGIN: `${ALICE_URL},${BOB_URL}`,
  });
  const attestation = await (await waitFor(`http://127.0.0.1:${KEEPER_PORT}/attestation`)).json();

  const account = async (id: string, publicKey: string) => {
    await rootNear
      .transaction(root)
      .createAccount(id)
      .transfer(id, "50 NEAR")
      .addKey(publicKey, { type: "fullAccess" })
      .send();
  };
  const owner = generateKey();
  const alice = generateKey();
  const bob = generateKey();
  await account(names.keeper, attestation.keeper_public_key as string);
  await account(names.alice, alice.publicKey.toString());
  await account(names.bob, bob.publicKey.toString());
  await account(names.contract, owner.publicKey.toString());
  await new Near({
    network: sandbox,
    privateKey: owner.secretKey as PrivateKey,
    defaultSignerId: names.contract,
  })
    .transaction(names.contract)
    .deployContract(names.contract, readFileSync(WASM))
    .functionCall(names.contract, "new", {
      admin_id: root,
      keeper_id: names.keeper,
      treasury_id: root,
      mint_price: (10n ** 24n).toString(),
      collection: { name: "Nearkat", symbol: "KAT", base_uri: "" },
    })
    .send();

  // One web server per person: the dev wallet's key is fixed when the server starts.
  const web = (port: number, id: string, key: string) =>
    // Started with node directly, not through npx, so stopping it stops the server itself.
    start(
      "node",
      ["node_modules/vite/bin/vite.js", "--port", String(port), "--strictPort"],
      process.cwd(),
      {
        VITE_NEAR_NETWORK: "sandbox",
        VITE_NEAR_RPC_URL: sandbox.rpcUrl,
        VITE_CONTRACT_ID: names.contract,
        VITE_KEEPER_URL: `http://127.0.0.1:${KEEPER_PORT}`,
        VITE_DEV_WALLET_ID: id,
        VITE_DEV_WALLET_KEY: key,
      },
    );
  web(3000, names.alice, alice.secretKey);
  web(3001, names.bob, bob.secretKey);
  await waitFor(ALICE_URL);
  await waitFor(BOB_URL);
  process.env.E2E_BOB_ID = names.bob;

  return async () => {
    for (const child of children) {
      child.kill("SIGTERM");
    }
    model.close();
    await sandbox.stop();
  };
}
