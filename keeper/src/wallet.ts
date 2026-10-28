/**
 * A token's own wallet, from the mind's side.
 *
 * Each token of a collection with wallets has a NEAR account whose key NEAR's
 * MPC network derives for the collection contract; only the contract can have
 * it sign, and it does so within the rules the token's owner set (see
 * `contract/src/wallet.rs`). Here the keeper tells the mind about its wallet
 * and, when the mind decides to pay someone, asks the contract for the signed
 * transfer and sends it.
 *
 * The mind asks to pay with one line at the end of its reply:
 * `PAY <amount> NEAR TO <account> FOR <reason>`. The line is taken out of the
 * reply its owner reads, and the outcome is reported alongside it.
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
}

export interface WalletChain {
  getWallet(tokenId: string): Promise<WalletView | null>;
  /** The wallet's key, `ed25519:<base58>`, as the MPC network derives it for the collection. */
  walletKey(view: WalletView): Promise<string>;
  /** yoctoNEAR, or null when the account doesn't exist yet (nobody has funded it). */
  accountBalance(accountId: string): Promise<bigint | null>;
  /** The wallet key's next nonce and a recent block hash, for a transaction from it. */
  walletTx(accountId: string, publicKey: string): Promise<{ nonce: string; block_hash: string }>;
  /** The contract's `wallet_send`, as the keeper. Null when the network didn't sign. */
  walletSend(
    tokenId: string,
    receiverId: string,
    amount: bigint,
    memo: string,
    tx: { public_key: string; nonce: string; block_hash: string },
  ): Promise<{ signed_transaction: string; hash: string } | null>;
  /** Sends a signed transaction and waits until it is final. */
  broadcast(signedTransactionBase64: string): Promise<void>;
}

/** A wallet as the mind is told about it. */
export interface WalletInfo {
  /** The wallet's account: the hex of its key. */
  address: string;
  publicKey: string;
  /** yoctoNEAR; null until someone funds it. */
  balance: bigint | null;
  view: WalletView;
}

export type PaymentOutcome =
  | { status: "sent"; receiver_id: string; amount: string; memo: string; hash: string }
  | { status: "refused"; receiver_id: string; amount: string; memo: string; reason: string };

export interface PaymentRequest {
  /** yoctoNEAR */
  amount: bigint;
  receiverId: string;
  memo: string;
}

const YOCTO_PER_NEAR = 10n ** 24n;
const PAY_LINE =
  /^\s*PAY\s+(\d+(?:\.\d{1,24})?)\s*NEAR\s+TO\s+([a-z0-9._-]{2,64})(?:\s+FOR\s+(.*?))?\s*$/im;

/** Parses "1.25" as yoctoNEAR, exactly. */
export function parseNear(text: string): bigint {
  const [whole = "0", fraction = ""] = text.split(".");
  return BigInt(whole) * YOCTO_PER_NEAR + BigInt(fraction.padEnd(24, "0") || "0");
}

export function formatNear(yocto: bigint): string {
  const whole = yocto / YOCTO_PER_NEAR;
  const fraction = (yocto % YOCTO_PER_NEAR).toString().padStart(24, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/** The implicit account an Ed25519 key controls: the key's 32 bytes in hex. */
export function implicitAccount(publicKey: string, decode: (b58: string) => Uint8Array): string {
  if (!publicKey.startsWith("ed25519:")) {
    throw new Error("A wallet key must be ed25519");
  }
  return Buffer.from(decode(publicKey.slice("ed25519:".length))).toString("hex");
}

/** Takes the mind's payment line, if any, out of its reply. */
export function takePayment(reply: string): { reply: string; request: PaymentRequest | null } {
  const match = PAY_LINE.exec(reply);
  if (!match) {
    return { reply, request: null };
  }
  const [line, amount = "0", receiverId = "", memo = ""] = match;
  return {
    reply: reply.replace(line, "").trim(),
    request: {
      amount: parseNear(amount),
      receiverId: receiverId.toLowerCase(),
      memo: memo.slice(0, 64),
    },
  };
}

/** What the mind is told about its wallet, in the system prompt. */
export function walletInstructions(wallet: WalletInfo): string {
  const balance =
    wallet.balance === null
      ? "empty: nobody has sent it anything yet"
      : `${formatNear(wallet.balance)} NEAR`;
  const allowance = BigInt(wallet.view.daily_allowance);
  const left = allowance - BigInt(wallet.view.spent_today);
  const lines = [
    `You have your own NEAR wallet, ${wallet.address}. Its balance is ${balance}. Anyone can send to it.`,
  ];
  if (allowance === 0n) {
    lines.push(
      "Your owner hasn't let you send from it, so if you are asked to pay, say so: only your owner can send from it.",
    );
  } else {
    lines.push(
      `Your owner lets you send at most ${formatNear(BigInt(wallet.view.max_payment))} NEAR at a time and ` +
        `${formatNear(allowance)} NEAR a day; ${formatNear(left > 0n ? left : 0n)} NEAR is left today.`,
      "Pay only when it fits who you are and what your owner wants. To pay, end your reply with one line, " +
        "exactly: PAY <amount> NEAR TO <account> FOR <short reason>. That line is taken out of your reply " +
        "and you'll be told if the payment went through. Never claim you paid without it.",
    );
  }
  return lines.join(" ");
}

/** The wallets of one collection's tokens. */
export class TokenWallets {
  readonly #chain: WalletChain;
  readonly #decode: (b58: string) => Uint8Array;
  /** A wallet's key never changes, so it is looked up once per token. */
  readonly #keys = new Map<string, Promise<string>>();

  constructor(chain: WalletChain, decodeBase58: (b58: string) => Uint8Array) {
    this.#chain = chain;
    this.#decode = decodeBase58;
  }

  async info(tokenId: string): Promise<WalletInfo | null> {
    const view = await this.#chain.getWallet(tokenId);
    if (!view) {
      return null;
    }
    const publicKey = await this.#key(tokenId, view);
    const address = implicitAccount(publicKey, this.#decode);
    return { address, publicKey, balance: await this.#chain.accountBalance(address), view };
  }

  /** Has the contract sign the payment, if the owner's rules allow it, and sends it. */
  async pay(tokenId: string, wallet: WalletInfo, request: PaymentRequest): Promise<PaymentOutcome> {
    const base = {
      receiver_id: request.receiverId,
      amount: request.amount.toString(),
      memo: request.memo,
    };
    const refused = (reason: string): PaymentOutcome => ({ status: "refused", ...base, reason });
    // Checked here too, so an obvious refusal doesn't cost a transaction.
    if (request.amount <= 0n) {
      return refused("The amount must be more than zero");
    }
    if (request.amount > BigInt(wallet.view.max_payment)) {
      return refused("That's more than the owner lets the mind send at once");
    }
    if (BigInt(wallet.view.spent_today) + request.amount > BigInt(wallet.view.daily_allowance)) {
      return refused("That's more than the owner lets the mind send today");
    }
    if (wallet.balance === null || wallet.balance < request.amount) {
      return refused("The wallet doesn't hold that much");
    }
    try {
      const tx = await this.#chain.walletTx(wallet.address, wallet.publicKey);
      const signed = await this.#chain.walletSend(
        tokenId,
        request.receiverId,
        request.amount,
        request.memo,
        {
          public_key: wallet.publicKey,
          ...tx,
        },
      );
      if (!signed) {
        return refused("The MPC network didn't sign the payment");
      }
      await this.#chain.broadcast(signed.signed_transaction);
      return { status: "sent", ...base, hash: signed.hash };
    } catch (error) {
      return refused(error instanceof Error ? error.message : String(error));
    }
  }

  #key(tokenId: string, view: WalletView): Promise<string> {
    let key = this.#keys.get(tokenId);
    if (!key) {
      key = this.#chain.walletKey(view);
      this.#keys.set(tokenId, key);
      key.catch(() => this.#keys.delete(tokenId));
    }
    return key;
  }
}
