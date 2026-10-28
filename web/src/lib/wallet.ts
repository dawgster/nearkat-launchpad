import { base58 } from "@scure/base";
import type { Near } from "near-kit";
import { returnValue } from "./contract.ts";

/**
 * A token's own wallet: a NEAR account whose key NEAR's MPC network derives
 * for the collection contract, so it signs only through the contract and
 * within the rules the token's owner sets. See `contract/src/wallet.rs`.
 */

export interface WalletPayment {
  receiver_id: string;
  /** yoctoNEAR */
  amount: string;
  by_mind: boolean;
  memo: string;
  /** Nanoseconds. */
  at: string;
}

/** What the contract's `get_wallet` returns. Amounts are yoctoNEAR strings. */
export interface WalletView {
  path: string;
  mpc_contract_id: string;
  domain_id: number;
  daily_allowance: string;
  max_payment: string;
  spent_today: string;
  payments: number;
  last_payment: WalletPayment | null;
  /** While set: transfers the owner signed could still be sent until this block, and the token can't change hands. */
  owner_signed_until?: string | null;
}

export interface TokenWallet {
  view: WalletView;
  /** The wallet's account id: the hex of its key. */
  address: string;
  publicKey: string;
  /** yoctoNEAR; null until someone funds it. */
  balance: bigint | null;
}

/** What setting a wallet's rules, or the owner's first send, costs at most for the record's storage; the rest is refunded. */
export const WALLET_RULES_DEPOSIT = 10n ** 22n;

const yocto = (amount: bigint) => `${amount} yocto` as const;

export function implicitAccount(publicKey: string): string {
  if (!publicKey.startsWith("ed25519:")) {
    throw new Error("A wallet key must be ed25519");
  }
  return Array.from(base58.decode(publicKey.slice("ed25519:".length)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Reads token wallets with `reader`, and sends from them with the connected wallet. */
export class TokenWallets {
  readonly #reader: Near;
  readonly #contractId: string;

  constructor(reader: Near, contractId: string) {
    this.#reader = reader;
    this.#contractId = contractId;
  }

  async get(tokenId: string): Promise<TokenWallet | null> {
    // The latest block, so rules or payments just made show at once.
    const view = await this.#reader.view<WalletView | null>(
      this.#contractId,
      "get_wallet",
      { token_id: tokenId },
      { finality: "optimistic" },
    );
    if (!view) {
      return null;
    }
    const publicKey = await this.#reader.view<string>(view.mpc_contract_id, "derived_public_key", {
      path: view.path,
      predecessor: this.#contractId,
      domain_id: view.domain_id,
    });
    if (typeof publicKey !== "string") {
      throw new Error("The MPC network gave no key for this wallet");
    }
    const address = implicitAccount(publicKey);
    return { view, address, publicKey, balance: await this.#balance(address) };
  }

  /** Lets the token's mind send up to `maxPayment` at a time and `dailyAllowance` a day. Owner only. */
  async setRules(
    signer: Near,
    tokenId: string,
    dailyAllowance: bigint,
    maxPayment: bigint,
  ): Promise<void> {
    await signer.call(
      this.#contractId,
      "set_wallet_policy",
      {
        token_id: tokenId,
        daily_allowance: dailyAllowance.toString(),
        max_payment: maxPayment.toString(),
      },
      { gas: "30 Tgas", attachedDeposit: yocto(WALLET_RULES_DEPOSIT) },
    );
  }

  /**
   * Sends from the token's wallet, as its owner: the contract builds the
   * transfer and has the MPC network sign it; this sends the signed
   * transaction. Returns its hash.
   */
  async send(
    signer: Near,
    tokenId: string,
    wallet: TokenWallet,
    receiverId: string,
    amount: bigint,
  ): Promise<string> {
    const [key, block] = await Promise.all([
      this.#reader.rpc.getAccessKey(wallet.address, wallet.publicKey, { finality: "optimistic" }),
      this.#reader.rpc.getBlock({ finality: "final" }),
    ]);
    const outcome = await signer.call(
      this.#contractId,
      "wallet_send",
      {
        token_id: tokenId,
        receiver_id: receiverId,
        amount: amount.toString(),
        memo: "",
        tx: {
          public_key: wallet.publicKey,
          nonce: (BigInt(key.nonce) + 1n).toString(),
          block_hash: block.header.hash,
        },
      },
      // The first send pays for the wallet's record; whatever isn't needed comes back.
      { gas: "300 Tgas", attachedDeposit: yocto(WALLET_RULES_DEPOSIT), waitUntil: "FINAL" },
    );
    const signed = returnValue<{ signed_transaction: string; hash: string } | null>(outcome);
    if (!signed) {
      throw new Error("The MPC network didn't sign the transfer. Nothing was sent.");
    }
    const bytes = Uint8Array.from(atob(signed.signed_transaction), (char) => char.charCodeAt(0));
    await this.#reader.rpc.sendTransaction(bytes, "FINAL");
    return signed.hash;
  }

  async #balance(address: string): Promise<bigint | null> {
    try {
      return BigInt(
        (await this.#reader.rpc.getAccount(address, { finality: "optimistic" })).amount,
      );
    } catch (error) {
      if (/does not exist|UNKNOWN_ACCOUNT|AccountDoesNotExist/i.test(String(error))) {
        return null;
      }
      throw error;
    }
  }
}
