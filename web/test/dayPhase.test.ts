import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  DAY_PHASE_GREETINGS,
  DAY_PHASES,
  dayPhaseAt,
  useDayGreetings,
} from "../src/lib/dayPhase.ts";

const at = (hour: number) => new Date(2026, 10, 7, hour, 30);

describe("dayPhaseAt", () => {
  it("reads four moods from the local clock", () => {
    expect([4, 5, 7, 8, 16, 17, 19, 20, 23, 0].map((hour) => dayPhaseAt(at(hour)))).toEqual([
      "night",
      "dawn",
      "dawn",
      "day",
      "day",
      "dusk",
      "dusk",
      "night",
      "night",
      "night",
    ]);
  });
});

describe("useDayGreetings", () => {
  it("picks one greeting for every mood, and keeps it across renders", () => {
    const { result, rerender } = renderHook(() => useDayGreetings());
    const first = result.current;
    for (const phase of DAY_PHASES) {
      expect(DAY_PHASE_GREETINGS[phase]).toContain(first[phase]);
    }
    rerender();
    expect(result.current).toBe(first);
  });
});
