import { hkdfSync } from "node:crypto";
import { bls12_381 as bls } from "@noble/curves/bls12-381.js";
import { sha3_256 } from "@noble/hashes/sha3.js";
import { base58 } from "@scure/base";

/**
 * Context keys from NEAR's MPC network (confidential key derivation, CKD).
 *
 * The keeper makes a throwaway BLS12-381 key pair and asks the collection
 * contract for its context key. The contract forwards the request to the MPC
 * network, which derives a key bound to the collection's account and returns
 * it ElGamal-encrypted to the throwaway key. The keeper decrypts it, checks
 * it is the network's BLS signature on the collection's app id, and derives
 * every token's key from it. Formats follow the near/mpc repository.
 */

/** Where a collection's context keys come from, as its contract publishes it. */
export interface KeySource {
  mpc_contract_id: string;
  domain_id: number;
}

/** The derivation path the collection contract requests. Must match the contract. */
export const CONTEXT_KEY_PATH = "nearkat/contexts/v1";
const NEAR_CKD_DOMAIN = "NEAR BLS12381G1_XMD:SHA-256_SSWU_RO_";
const APP_ID_DERIVATION_PREFIX = "near-mpc v0.1.0 app_id derivation:";

const G1 = bls.G1.Point;
const G2 = bls.G2.Point;

function decode(prefix: "bls12381g1:" | "bls12381g2:", text: string): Uint8Array {
  if (!text.startsWith(prefix)) {
    throw new Error(`Expected a ${prefix} key, got ${text.slice(0, 16)}…`);
  }
  return base58.decode(text.slice(prefix.length));
}

/** The app id the MPC network derives for a caller and path. */
export function appId(callerAccountId: string, path: string): Uint8Array {
  return sha3_256(
    new TextEncoder().encode(`${APP_ID_DERIVATION_PREFIX}${callerAccountId},${path}`),
  );
}

/** A throwaway key pair for one request. The secret never leaves the keeper. */
export function newAppKey(): { secret: bigint; publicKey: string } {
  const secret = bls.fields.Fr.fromBytes(bls.utils.randomSecretKey());
  const point = G1.BASE.multiply(secret);
  return { secret, publicKey: `bls12381g1:${base58.encode(point.toBytes(true))}` };
}

/**
 * Decrypts the MPC network's response and checks it: the result must be the
 * network's BLS signature on the app id, `e(K, G2) = e(H(pk ‖ app_id), pk)`.
 * Returns the derived key, 48 bytes, compressed.
 */
export function openResponse(
  response: { big_y: string; big_c: string },
  secret: bigint,
  mpcPublicKey: string,
  app: Uint8Array,
): Uint8Array {
  const y = G1.fromBytes(decode("bls12381g1:", response.big_y));
  const c = G1.fromBytes(decode("bls12381g1:", response.big_c));
  const derived = c.subtract(y.multiply(secret));
  const pkBytes = decode("bls12381g2:", mpcPublicKey);
  const pk = G2.fromBytes(pkBytes);
  const hashed = bls.G1.hashToCurve(new Uint8Array([...pkBytes, ...app]), {
    DST: NEAR_CKD_DOMAIN,
  }) as unknown as InstanceType<typeof G1>;
  const valid =
    !derived.is0() && bls.fields.Fp12.eql(bls.pairing(derived, G2.BASE), bls.pairing(hashed, pk));
  if (!valid) {
    throw new Error("The MPC network's answer is not a valid key for this collection");
  }
  return derived.toBytes(true);
}

/** The 32-byte root every token key of a collection is derived from. */
export function contextRoot(derivedKey: Uint8Array): Buffer {
  return Buffer.from(hkdfSync("sha256", derivedKey, "nearkat-ckd-v1", "nearkat/contexts", 32));
}

export interface CkdChain {
  /** Asks the collection contract to fetch its context key, encrypted to `appPublicKey`. */
  requestContextKey(appPublicKey: string): Promise<{ big_y: string; big_c: string }>;
  /** The MPC network's public key for a CKD domain, `bls12381g2:<base58>`. */
  mpcPublicKey(source: KeySource): Promise<string>;
}

/** Fetches, decrypts and checks a collection's context root. */
export async function fetchContextRoot(
  collectionId: string,
  source: KeySource,
  chain: CkdChain,
): Promise<Buffer> {
  const key = newAppKey();
  const [response, mpcPublicKey] = await Promise.all([
    chain.requestContextKey(key.publicKey),
    chain.mpcPublicKey(source),
  ]);
  const derived = openResponse(
    response,
    key.secret,
    mpcPublicKey,
    appId(collectionId, CONTEXT_KEY_PATH),
  );
  return contextRoot(derived);
}
