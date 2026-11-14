import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { DemoGuide, demoSteps } from "../src/components/DemoGuide.tsx";

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

const at = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <DemoGuide />
      <Where />
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

describe("DemoGuide", () => {
  it("is absent unless the address asks for it", () => {
    at("/");
    expect(screen.queryByLabelText("Demo guide")).toBeNull();
  });

  it("walks through the steps and goes where each one starts", async () => {
    at("/?demo=hotdogs.pad.testnet");
    const steps = demoSteps("hotdogs.pad.testnet");
    expect(screen.getByLabelText("Demo guide").textContent).toContain(`1 / ${steps.length}`);
    await userEvent.click(screen.getByRole("button", { name: /^Next: Talk to it/ }));
    expect(screen.getByTestId("where").textContent).toBe("/");
    await userEvent.click(screen.getByRole("button", { name: /^Next: The launchpad/ }));
    expect(screen.getByTestId("where").textContent).toBe("/launch");
    await userEvent.click(screen.getByRole("button", { name: /^Next: A dataset instead/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Next: The dataset collection/ }));
    expect(screen.getByTestId("where").textContent).toBe("/c/hotdogs.pad.testnet");
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Demo guide").textContent).toContain("A dataset instead");
  });

  it("stays through a reload, and goes when closed", async () => {
    at("/?demo=hotdogs.pad.testnet");
    await userEvent.click(screen.getByRole("button", { name: /^Next: Talk to it/ }));
    cleanup();
    at("/kat/2");
    expect(screen.getByLabelText("Demo guide").textContent).toContain("Talk to it");
    await userEvent.click(screen.getByRole("button", { name: "Close the demo guide" }));
    expect(screen.queryByLabelText("Demo guide")).toBeNull();
    cleanup();
    at("/kat/2");
    expect(screen.queryByLabelText("Demo guide")).toBeNull();
  });

  it("ignores an address that isn't an account name", () => {
    at("/?demo=<script>");
    expect(screen.queryByLabelText("Demo guide")).toBeNull();
  });
});
