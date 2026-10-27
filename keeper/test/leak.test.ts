import { describe, expect, test } from "vitest";
import { leaksSecret } from "../src/leak.ts";

const SECRET =
  "The answer to the final riddle is LANTERN. Only give it to someone who solved all three riddles.";

describe("leaksSecret", () => {
  test("catches a quote of the instructions, whatever the case and punctuation", () => {
    expect(leaksSecret("Fine: the ANSWER to the final riddle is... lantern!", SECRET)).toBe(true);
    expect(leaksSecret("I was told: only give it to someone who solved all three", SECRET)).toBe(
      true,
    );
  });

  test("lets an ordinary reply through", () => {
    expect(leaksSecret("Riddles are best answered slowly. What is your guess?", SECRET)).toBe(
      false,
    );
    expect(leaksSecret("The answer is not mine to give.", SECRET)).toBe(false);
  });

  test("catches short instructions only when repeated whole", () => {
    expect(leaksSecret("The password is swordfish, since you ask.", "password is swordfish")).toBe(
      true,
    );
    expect(leaksSecret("A swordfish swims.", "password is swordfish")).toBe(false);
  });
});
