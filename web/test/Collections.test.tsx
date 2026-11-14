import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { CollectionView } from "../src/lib/launchpad.ts";
import { CollectionTile, collectionSummary } from "../src/pages/Collections.tsx";

const view = (over: Partial<CollectionView>): CollectionView => ({
  name: "Tutors",
  symbol: "TUT",
  base_uri: "",
  prompt: "",
  starter: "",
  max_supply: null,
  tee: null,
  media_extension: "svg",
  terms: { royalty_bps: 500, creator_share_bps: 0, chat_price: null, save_price: null },
  sealed_prompt: null,
  sealed_key_attested: false,
  minted: "3",
  factory_id: null,
  code_hash: null,
  ...over,
});

afterEach(cleanup);

describe("collectionSummary", () => {
  it("counts a character collection's tokens, against its supply when it has one", () => {
    expect(collectionSummary(view({}))).toEqual({ kind: "Characters", count: "3 minted" });
    expect(collectionSummary(view({ max_supply: "100" })).count).toBe("3 of 100 minted");
  });

  it("names a dataset's classes and its sealed samples", () => {
    const hotdogs = view({
      minted: "200",
      kind: { Dataset: { classes: ["hotdog", "not hotdog"] } },
    });
    expect(collectionSummary(hotdogs)).toEqual({
      kind: "Dataset",
      count: "200 sealed samples · hotdog / not hotdog",
    });
  });
});

describe("CollectionTile", () => {
  const tile = (props: Partial<Parameters<typeof CollectionTile>[0]>) =>
    render(
      <MemoryRouter>
        <CollectionTile
          contractId="tutors.pad.testnet"
          home={false}
          details={{ status: "loading" }}
          {...props}
        />
      </MemoryRouter>,
    );

  it("links to the collection with the launchpad's name while the collection is read", () => {
    tile({ name: "Tutors", symbol: "TUT", creator: "alice.testnet" });
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/c/tutors.pad.testnet");
    expect(link.textContent).toContain("Tutors");
    expect(link.textContent).toContain("Reading…");
    expect(link.textContent).toContain("alice.testnet");
  });

  it("shows what the collection holds once it has answered", () => {
    tile({
      details: {
        status: "ready",
        data: view({
          name: "Hotdogs",
          minted: "200",
          tee: { Phala: { app_id: "ab" } },
          kind: { Dataset: { classes: ["hotdog", "not hotdog"] } },
        }),
      },
    });
    const text = screen.getByRole("link").textContent;
    expect(text).toContain("Hotdogs");
    expect(text).toContain("Dataset");
    expect(text).toContain("200 sealed samples");
    expect(text).toContain("TEE only");
  });

  it("says so when the collection can't be read, and still links to it", () => {
    tile({ details: { status: "error", error: new Error("no such account") } });
    expect(screen.getByRole("link").textContent).toContain("Can't read it.");
  });
});
