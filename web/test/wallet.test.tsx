import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Near } from "near-kit";
import { describe, expect, test, vi } from "vitest";
import type { WalletBackend } from "../src/wallet/backend.ts";
import { useWallet, WalletProvider } from "../src/wallet/WalletProvider.tsx";

function fakeBackend(restored: string | null = null) {
  let listener: (account: string | null) => void = () => {};
  const backend: WalletBackend = {
    restore: vi.fn(async () => restored),
    connect: vi.fn(async () => "alice.near"),
    disconnect: vi.fn(async () => {}),
    near: () => ({}) as Near,
    signMessage: vi.fn(),
    onAccountChange: (callback) => {
      listener = callback;
      return () => {
        listener = () => {};
      };
    },
  };
  return { backend, walletSwitchesTo: (account: string | null) => listener(account) };
}

function Probe() {
  const wallet = useWallet();
  return (
    <>
      <p>
        {wallet.status} {wallet.accountId ?? "nobody"} {wallet.near ? "can sign" : "cannot sign"}
      </p>
      <button type="button" onClick={() => wallet.connect()}>
        connect
      </button>
      <button type="button" onClick={() => wallet.disconnect().catch(() => {})}>
        disconnect
      </button>
    </>
  );
}

const show = (backend: WalletBackend) =>
  render(
    <WalletProvider backend={backend}>
      <Probe />
    </WalletProvider>,
  );

describe("WalletProvider", () => {
  test("starts disconnected when no wallet was connected before", async () => {
    show(fakeBackend().backend);
    expect(screen.getByText(/restoring/)).toBeTruthy();
    expect(await screen.findByText("disconnected nobody cannot sign")).toBeTruthy();
  });

  test("restores an existing connection", async () => {
    show(fakeBackend("alice.near").backend);
    expect(await screen.findByText("connected alice.near can sign")).toBeTruthy();
  });

  test("connects and disconnects", async () => {
    show(fakeBackend().backend);
    await userEvent.click(screen.getByText("connect"));
    expect(await screen.findByText("connected alice.near can sign")).toBeTruthy();
    await userEvent.click(screen.getByText("disconnect"));
    expect(await screen.findByText("disconnected nobody cannot sign")).toBeTruthy();
  });

  test("follows the wallet when it switches account by itself", async () => {
    const { backend, walletSwitchesTo } = fakeBackend("alice.near");
    show(backend);
    await screen.findByText("connected alice.near can sign");
    sessionStorage.setItem("nearkat.session.alice.near", "{}");
    walletSwitchesTo("bob.near");
    expect(await screen.findByText("connected bob.near can sign")).toBeTruthy();
    // The first account's session must not outlive it.
    expect(sessionStorage.getItem("nearkat.session.alice.near")).toBeNull();
  });

  test("follows the wallet when it signs out by itself", async () => {
    const { backend, walletSwitchesTo } = fakeBackend("alice.near");
    show(backend);
    await screen.findByText("connected alice.near can sign");
    walletSwitchesTo(null);
    expect(await screen.findByText("disconnected nobody cannot sign")).toBeTruthy();
  });

  test("disconnects, and forgets the session, even when the wallet fails to", async () => {
    const { backend } = fakeBackend("alice.near");
    vi.mocked(backend.disconnect).mockRejectedValue(new Error("No accounts found"));
    show(backend);
    await screen.findByText("connected alice.near can sign");
    sessionStorage.setItem("nearkat.session.alice.near", "{}");
    sessionStorage.setItem("nearkat.proof.alice.near.1", "{}");
    await userEvent.click(screen.getByText("disconnect"));
    await waitFor(() => expect(screen.getByText("disconnected nobody cannot sign")).toBeTruthy());
    expect(sessionStorage.getItem("nearkat.session.alice.near")).toBeNull();
    expect(sessionStorage.getItem("nearkat.proof.alice.near.1")).toBeNull();
  });
});
