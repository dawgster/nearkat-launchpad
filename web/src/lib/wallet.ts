import type { Near } from "near-kit";
import { returnValue } from "./contract.ts";

/**
 * A token's own wallet: the account `<token_id>.<collection>`, which the
 * collection creates and alone can send from, within the rules the token's
 * owner sets. See `contract/src/wallet.rs` and `token-wallet/`.
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
  /** The wallet's account. */
  account_id: string;
  /** Whether the account exists yet. */
  open: boolean;
  daily_allowance: string;
  max_payment: string;
  spent_today: string;
  payments: number;
  last_payment: WalletPayment | null;
}

export interface TokenWallet {
  view: WalletView;
  /** The wallet's account id. */
  address: string;
  /** yoctoNEAR; null while it isn't open. */
  balance: bigint | null;
}

/**
 * The least that opening a wallet takes: its record on the collection and the
 * new account's storage. Whatever is attached beyond the record becomes the
 * wallet's first balance.
 */
export const WALLET_OPEN_MINIMUM = 2n * 10n ** 22n;

const yocto = (amount: bigint) => `${amount} yocto` as const;

/** Reads token wallets with `reader`, and acts on them with the connected wallet. */
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
    const balance = view.open ? await this.#balance(view.account_id) : null;
    return { view, address: view.account_id, balance };
  }

  /** Creates the token's wallet account, with `deposit` (less its record's storage) in it. */
  async open(signer: Near, tokenId: string, deposit: bigint): Promise<void> {
    if (deposit < WALLET_OPEN_MINIMUM) {
      throw new Error("Opening a wallet takes at least 0.02 NEAR.");
    }
    const outcome = await signer.call(
      this.#contractId,
      "open_wallet",
      { token_id: tokenId },
      { gas: "100 Tgas", attachedDeposit: yocto(deposit), waitUntil: "FINAL" },
    );
    if (returnValue<boolean>(outcome) !== true) {
      throw new Error("The wallet's account couldn't be created. Your NEAR was returned.");
    }
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
      { gas: "30 Tgas", attachedDeposit: yocto(1n) },
    );
  }

  /** Sends from the token's wallet, as its owner. Returns the transaction's hash. */
  async send(signer: Near, tokenId: string, receiverId: string, amount: bigint): Promise<string> {
    const outcome = await signer.call(
      this.#contractId,
      "wallet_send",
      { token_id: tokenId, receiver_id: receiverId, amount: amount.toString(), memo: "" },
      { gas: "60 Tgas", attachedDeposit: yocto(1n), waitUntil: "FINAL" },
    );
    if (returnValue<boolean>(outcome) !== true) {
      throw new Error(
        `The transfer to ${receiverId} didn't go through, so nothing left the wallet. Check the account exists.`,
      );
    }
    return outcome.transaction?.hash ?? "";
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
