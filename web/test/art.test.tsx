import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { katSvg, sigilSvg } from "../../art/svg.ts";
import { Growth } from "../src/components/Growth.tsx";
import { KatPortrait } from "../src/components/KatPortrait.tsx";
import { TokenSigil } from "../src/components/TokenSigil.tsx";
import { katTraits, savesToNextStage, seededRandom, sigilTraits, stageOf } from "../src/lib/art.ts";

describe("seeded art", () => {
  test("draws the same token the same way every time", () => {
    expect(katTraits("nearkat.testnet/7")).toEqual(katTraits("nearkat.testnet/7"));
    expect(sigilTraits("tutor.launch.testnet/7")).toEqual(sigilTraits("tutor.launch.testnet/7"));
  });

  test("draws different tokens differently", () => {
    const looks = new Set(
      Array.from({ length: 20 }, (_, i) => {
        const t = katTraits(`nearkat.testnet/${i}`);
        return `${t.fur.name}/${t.sky.name}/${t.accessory}/${t.eyes}`;
      }),
    );
    expect(looks.size).toBeGreaterThan(15);
  });

  test("keeps a token's look apart from the same number in another collection", () => {
    expect(katTraits("a.testnet/1")).not.toEqual(katTraits("b.testnet/1"));
  });

  test("produces numbers in [0, 1)", () => {
    const random = seededRandom("x");
    for (let i = 0; i < 1000; i++) {
      const n = random();
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });
});

describe("growth", () => {
  test("moves through the stages as conversations are saved", () => {
    expect([0, 1, 2, 3, 4, 7, 8, 30].map(stageOf)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  test("counts the saves left until the next stage", () => {
    expect(savesToNextStage(1)).toBe(1);
    expect(savesToNextStage(2)).toBe(2);
    expect(savesToNextStage(5)).toBe(3);
    expect(savesToNextStage(8)).toBeNull();
  });

  test("says how grown a token is and what comes next", () => {
    render(<Growth contextVersion={3} />);
    const growth = screen.getByRole("region", { name: "Growth" });
    expect(growth.textContent).toContain("Pup");
    expect(growth.textContent).toContain("2 conversations saved");
    expect(growth.textContent).toContain("1 more saved conversation until it becomes a Sentry");
  });
});

describe("portraits", () => {
  test("describes a kat for screen readers, accessory included once it is grown", () => {
    render(<KatPortrait seed="nearkat.testnet/1" stage={2} />);
    const name = screen.getByRole("img").textContent ?? "";
    expect(name).toMatch(/^Sentry: .+ fur under a .+ sky, wearing a .+$/);
  });

  test("leaves decorative art out of the accessibility tree", () => {
    const { container } = render(<TokenSigil seed="x/1" decorative />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("shared SVG", () => {
  test("escapes the title, so a collection name can't inject markup", () => {
    const svg = katSvg("x/1", 0, { title: '<script>alert("hi")</script>' });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&#60;script&#62;");
  });

  test("hides decorative art and sizes on request", () => {
    const svg = sigilSvg("x/1", 3, { title: null, size: 64 });
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain('width="64"');
    expect(svg).not.toContain("<title>");
  });

  test("is standalone SVG that a marketplace can load as an image", () => {
    expect(katSvg("x/1", 2)).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  });
});
