import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Near } from "near-kit";
import { appId, newAppKey, openResponse } from "../src/ckd.ts";

// Throwaway spike: fan-out of N request_app_private_key promises from one contract call.
// Usage: node scripts/ckd-fanout.ts [N,N,...=2,5,10] [rounds=2]
const PARENT = "pals-c0b7a5.testnet";
const PROBE = `fanout.${PARENT}`;
const MPC = "v1.signer-prod.testnet";
const DOMAIN = 2;
const sizes = (process.argv[2] ?? "2,5,10").split(",").map(Number);
const rounds = Number(process.argv[3] ?? 2);
const creds = JSON.parse(readFileSync(`${homedir()}/.near-credentials/testnet/${PARENT}.json`, "utf8"));
const near = new Near({ network: "testnet", privateKey: creds.private_key, defaultSignerId: PARENT });
const mpcKey = await near.view<string>(MPC, "public_key", { domain_id: DOMAIN });

for (const n of sizes) {
  for (let round = 1; round <= rounds; round++) {
    const items = Array.from({ length: n }, (_, i) => ({
      path: `probe/${n}/${i}-${Date.now()}`,
      key: newAppKey(),
    }));
    const started = Date.now();
    try {
      const outcome = (await near
        .transaction(PARENT)
        .functionCall(
          PROBE,
          "fan_out",
          {
            paths: items.map((i) => i.path),
            app_public_keys: items.map((i) => i.key.publicKey),
            domain_id: DOMAIN,
            mpc: MPC,
          },
          { gas: "300 Tgas", attachedDeposit: "0 NEAR" },
        )
        .send({ waitUntil: "FINAL" })) as any;
      const ms = Date.now() - started;
      const outs = [outcome.transaction_outcome, ...(outcome.receipts_outcome ?? [])];
      const burnt = outs.reduce((s: bigint, o: any) => s + BigInt(o.outcome.gas_burnt), 0n);
      // The final value is the callback's return: an array of n optional responses.
      let results: any[] = [];
      const sv = outcome.status?.SuccessValue;
      if (sv) try { results = JSON.parse(Buffer.from(sv, "base64").toString("utf8")); } catch {}
      let ok = 0;
      results.forEach((r, i) => {
        if (!r?.big_y) return;
        try { openResponse(r, items[i].key.secret, mpcKey, appId(PROBE, items[i].path)); ok++; } catch {}
      });
      const nonNull = results.filter((r) => r).length;
      console.log(JSON.stringify({ n, round, ms, gasBurntTgas: Number(burnt) / 1e12, received: nonNull, of: n, decrypted: ok, hash: outcome.transaction.hash, status: sv ? "SuccessValue" : outcome.status }));
    } catch (e) {
      console.log(JSON.stringify({ n, round, ms: Date.now() - started, error: String(e instanceof Error ? e.message : e).slice(0, 600) }));
    }
  }
}
