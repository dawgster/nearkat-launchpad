import { bls12_381 as bls } from "@noble/curves/bls12-381.js";
import { base58 } from "@scure/base";
import { appId, hashAppId } from "../src/ckd.ts";

/**
 * A stand-in for NEAR's MPC network with one master secret, shared by the
 * keeper's and the trainer's fakes.
 */

const G1 = bls.G1.Point;
const encode = (point: InstanceType<typeof G1>) =>
  `bls12381g1:${base58.encode(point.toBytes(true))}`;

/** The network's public key, as the MPC contract publishes it. */
export function mpcPublicKeyOf(secret: bigint): string {
  return `bls12381g2:${base58.encode(bls.G2.Point.BASE.multiply(secret).toBytes(true))}`;
}

/** The key the network derives for `caller` and `path`, `msk·H(pk ‖ app_id)`, compressed. */
export function mpcDerivedKey(secret: bigint, caller: string, path: string): Uint8Array {
  const pk = bls.G2.Point.BASE.multiply(secret).toBytes(true);
  return hashAppId(pk, appId(caller, path)).multiply(secret).toBytes(true);
}

/** The network's answer to one request: the derived key, ElGamal-encrypted to the app key. */
export function mpcAnswer(
  secret: bigint,
  caller: string,
  path: string,
  appPublicKey: string,
): { big_y: string; big_c: string } {
  const app = G1.fromBytes(base58.decode(appPublicKey.replace(/^bls12381g1:/, "")));
  const derived = G1.fromBytes(mpcDerivedKey(secret, caller, path));
  const y = bls.fields.Fr.fromBytes(bls.utils.randomSecretKey());
  return {
    big_y: encode(G1.BASE.multiply(y)),
    big_c: encode(derived.add(app.multiply(y))),
  };
}
