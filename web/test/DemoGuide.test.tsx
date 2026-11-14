import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { DemoGuideBar, demoSteps } from "../src/components/DemoGuide.tsx";

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

const HOME = "kats.testnet";
const at = (entry: string, auto: string | null = null) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <DemoGuideBar auto={auto} home={HOME} />
      <Where />
    </MemoryRouter>,
  );
const next = (title: string) =>
  userEvent.click(screen.getByRole("button", { name: `Next: ${title}` }));
const where = () => screen.getByTestId("where").textContent;

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
});

describe("DemoGuide", () => {
  it("is absent unless the address asks for it", () => {
    at("/");
    expect(screen.queryByLabelText("Demo guide")).toBeNull();
  });

  it("starts on the kat collection and goes where each step starts", async () => {
    at("/launch?demo=hotdogs.pad.testnet");
    const steps = demoSteps("hotdogs.pad.testnet", HOME);
    expect(screen.getByLabelText("Demo guide").textContent).toContain(`1 / ${steps.length}`);
    expect(where()).toBe(`/c/${HOME}`);
    await next("Mint a kat");
    expect(where()).toBe("/");
    await next("Tell it a secret");
    await next("Give the kat away");
    await next("It remembers");
    expect(where()).toBe("/");
    await next("The launchpad");
    expect(where()).toBe("/launch");
    await next("A dataset instead");
    await next("The dataset collection");
    expect(where()).toBe("/c/hotdogs.pad.testnet");
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Demo guide").textContent).toContain("A dataset instead");
  });

  it("stays through a reload where it was, and goes when closed", async () => {
    at("/?demo=hotdogs.pad.testnet");
    await next("Mint a kat");
    cleanup();
    at("/kat/2");
    expect(screen.getByLabelText("Demo guide").textContent).toContain("Mint a kat");
    expect(where()).toBe("/kat/2");
    await userEvent.click(screen.getByRole("button", { name: "Close the demo guide" }));
    expect(screen.queryByLabelText("Demo guide")).toBeNull();
    cleanup();
    at("/kat/2");
    expect(screen.queryByLabelText("Demo guide")).toBeNull();
  });

  it("appears for a guided account on the first page, and stays closed for the visit once closed", async () => {
    at("/launch", "hotdogs.pad.testnet");
    expect((await screen.findByLabelText("Demo guide")).textContent).toContain("1 / ");
    expect(where()).toBe(`/c/${HOME}`);
    await userEvent.click(screen.getByRole("button", { name: "Close the demo guide" }));
    expect(screen.queryByLabelText("Demo guide")).toBeNull();
    cleanup();
    at("/", "hotdogs.pad.testnet");
    expect(screen.queryByLabelText("Demo guide")).toBeNull();
    // A new visit: it is back.
    cleanup();
    sessionStorage.clear();
    at("/", "hotdogs.pad.testnet");
    expect(await screen.findByLabelText("Demo guide")).toBeTruthy();
  });

  it("ignores an address that isn't an account name", () => {
    at("/?demo=<script>");
    expect(screen.queryByLabelText("Demo guide")).toBeNull();
  });
});
