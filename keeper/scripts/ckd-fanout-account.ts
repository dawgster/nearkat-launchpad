import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { Near, generateKey } from "near-kit";

// Throwaway helper for the fan-out probe: "create" deploys, "delete" removes the account.
// Usage: node scripts/ckd-fanout-account.ts create <wasm> | delete
const PARENT = "pals-c0b7a5.testnet";
const SUB = `fanout.${PARENT}`;
const dir = `${homedir()}/.near-credentials/testnet`;
const parent = JSON.parse(readFileSync(`${dir}/${PARENT}.json`, "utf8"));

if (process.argv[2] === "create") {
  const key = generateKey();
  const near = new Near({ network: "testnet", privateKey: parent.private_key, defaultSignerId: PARENT });
  const wasm = readFileSync(process.argv[3]);
  await near
    .transaction(PARENT)
    .createAccount(SUB)
    .transfer(SUB, "3 NEAR")
    .addKey(key.publicKey.toString(), { type: "fullAccess" })
    .send({ waitUntil: "FINAL" });
  writeFileSync(
    `${dir}/${SUB}.json`,
    JSON.stringify({ account_id: SUB, public_key: key.publicKey.toString(), private_key: key.secretKey }),
    { mode: 0o600 },
  );
  const sub = new Near({ network: "testnet", privateKey: key.secretKey, defaultSignerId: SUB });
  await sub.transaction(SUB).deployContract(SUB, wasm).send({ waitUntil: "FINAL" });
  console.log("deployed", SUB);
} else {
  const c = JSON.parse(readFileSync(`${dir}/${SUB}.json`, "utf8"));
  const sub = new Near({ network: "testnet", privateKey: c.private_key, defaultSignerId: SUB });
  await sub.transaction(SUB).deleteAccount({ beneficiary: PARENT }).send({ waitUntil: "FINAL" });
  console.log("deleted", SUB);
}
