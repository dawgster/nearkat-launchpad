import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Near } from "near-kit";
import { appId, newAppKey, openResponse } from "../src/ckd.ts";

// Throwaway spike: times batches of CKD requests on testnet.
// Usage: node scripts/ckd-throughput.ts [batchSize=10] [parallel=1]
const ACCOUNT = "pals-c0b7a5.testnet";
const MPC = "v1.signer-prod.testnet";
const DOMAIN = 2;
const batch = Number(process.argv[2] ?? 10);
const parallel = Number(process.argv[3] ?? 1);
const creds = JSON.parse(
  readFileSync(`${homedir()}/.near-credentials/testnet/${ACCOUNT}.json`, "utf8"),
);
const near = new Near({ network: "testnet", privateKey: creds.private_key, defaultSignerId: ACCOUNT });
const mpcKey = await near.view<string>(MPC, "public_key", { domain_id: DOMAIN });

const run = async (label: string, offset: number) => {
  const items = Array.from({ length: batch }, (_, i) => ({
    path: `spike/${offset + i}-${Date.now()}`,
    key: newAppKey(),
  }));
  const tx = near.transaction(ACCOUNT);
  for (const it of items) {
    tx.functionCall(
      MPC,
      "request_app_private_key",
      {
        request: {
          derivation_path: it.path,
          app_public_key: { AppPublicKey: it.key.publicKey },
          domain_id: DOMAIN,
        },
      },
      { gas: "15 Tgas", attachedDeposit: "1 yocto" },
    );
  }
  const started = Date.now();
  try {
    const outcome = (await tx.send({ waitUntil: "FINAL" })) as any;
    const ms = Date.now() - started;
    const burnt = [outcome.transaction_outcome, ...(outcome.receipts_outcome ?? [])].reduce(
      (s: bigint, o: any) => s + BigInt(o.outcome.gas_burnt),
      0n,
    );
    // Collect every SuccessValue in the receipts; each is one MPC response.
    const responses: { big_y: string; big_c: string }[] = [];
    for (const o of outcome.receipts_outcome ?? []) {
      const v = o.outcome.status?.SuccessValue;
      if (!v) continue;
      try {
        const j = JSON.parse(Buffer.from(v, "base64").toString("utf8"));
        if (j?.big_y && j?.big_c) responses.push(j);
      } catch {}
    }
    let ok = 0;
    for (const it of items) {
      const app = appId(ACCOUNT, it.path);
      if (responses.some((r) => { try { openResponse(r, it.key.secret, mpcKey, app); return true; } catch { return false; } })) ok++;
    }
    console.log(JSON.stringify({ label, ms, gasBurntTgas: Number(burnt) / 1e12, responses: responses.length, decrypted: ok, of: batch, hash: outcome.transaction.hash, status: outcome.status }));
  } catch (e) {
    console.log(JSON.stringify({ label, ms: Date.now() - started, error: String(e instanceof Error ? e.message : e).slice(0, 600) }));
  }
};

const t0 = Date.now();
await Promise.all(Array.from({ length: parallel }, (_, p) => run(`tx${p}`, p * 1000)));
console.log(JSON.stringify({ totalMs: Date.now() - t0, batch, parallel }));
