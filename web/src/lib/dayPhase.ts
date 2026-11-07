import { useEffect, useState } from "react";

/** The savannah's four moods, from local wall time. */
export type DayPhase = "dawn" | "day" | "dusk" | "night";

export const DAY_PHASES: readonly DayPhase[] = ["dawn", "day", "dusk", "night"];

/** Four fixed moods by the clock, deliberately not solar time or location. */
export function dayPhaseAt(date = new Date()): DayPhase {
  const hour = date.getHours();
  if (hour >= 5 && hour < 8) {
    return "dawn";
  }
  if (hour >= 8 && hour < 17) {
    return "day";
  }
  if (hour >= 17 && hour < 20) {
    return "dusk";
  }
  return "night";
}

/** What the small line above a savannah page calls each mood. */
export const DAY_PHASE_TITLES: Record<DayPhase, string> = {
  dawn: "First light",
  day: "The sunny side",
  dusk: "Golden goodbyes",
  night: "The night shift",
};

/** The swap den's greetings: one headline and a note for each mood. */
export const DAY_PHASE_GREETINGS: Record<DayPhase, readonly { hello: string; note: string }[]> = {
  dawn: [
    { hello: "GM, fren.", note: "New day. Fresh blocks. Same diamond paws." },
    { hello: "GM, early kat.", note: "First out of the burrow. First to say gm." },
    { hello: "Wake up, degen.", note: "Coffee before candles. Even kats have standards." },
    { hello: "Fresh block, fren.", note: "Sun’s syncing. The mob is coming online." },
    { hello: "GM, sleepy paws.", note: "Bedhead? Yes. Seed phrase? Still a secret." },
  ],
  day: [
    { hello: "Hey, cool kat.", note: "Shades on. Bags packed. Paws onchain." },
    { hello: "Touch grass, anon.", note: "We brought the grass. You brought the bags." },
    { hello: "Gm again, fren.", note: "It’s always gm somewhere in the mempool." },
    { hello: "Hey, chain hopper.", note: "Different chain. Same suspiciously stylish kat." },
    { hello: "Stay pawsitive.", note: "A little DeFi. A little vitamin D. A lot of kat." },
    { hello: "GM, barbell kat.", note: "NEAR on one side. NEARKAT on the other." },
  ],
  dusk: [
    { hello: "Golden hour, anon.", note: "Proof of sunset. Verified by the whole mob." },
    { hello: "Evening, degen.", note: "The sun’s logging off. The chain missed the memo." },
    { hello: "Gm or gn, fren?", note: "Time is a construct. This sunset is pretty real." },
    { hello: "Still here, kat?", note: "Charts closed. Sunset open. Stay for the colors." },
    { hello: "Hey, golden paws.", note: "Orange sky. Gold chain. Immaculate kat energy." },
  ],
  night: [
    { hello: "GN? Nice try.", note: "Sleep schedule: rugged. Burrow: cozy." },
    { hello: "Hey, moon kat.", note: "Moonlight. Diamond paws. Excellent company." },
    { hello: "Still up, degen?", note: "Nocturnal by nature. Onchain by choice." },
    { hello: "One more trade?", note: "Even the fireflies are running light clients." },
    { hello: "Psst. Wen sleep?", note: "The candles can wait. Look at those stars." },
  ],
};

/** One greeting per mood, picked once a visit so it holds still while the clock moves. */
export function useDayGreetings(): Record<DayPhase, { hello: string; note: string }> {
  const [greetings] = useState(() => {
    const pick = (phase: DayPhase) => {
      const options = DAY_PHASE_GREETINGS[phase];
      return options[Math.floor(Math.random() * options.length)] ?? { hello: "", note: "" };
    };
    return { dawn: pick("dawn"), day: pick("day"), dusk: pick("dusk"), night: pick("night") };
  });
  return greetings;
}

const EDITING =
  "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='combobox'], [role='dialog']";

/**
 * The current mood, kept in step with the clock. N and M step through the
 * moods to preview them (outside text fields), and Escape goes back to the clock.
 */
export function useDayPhase(): DayPhase {
  const [phase, setPhase] = useState(() => dayPhaseAt());
  const [preview, setPreview] = useState<DayPhase | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      clearTimeout(timer);
      setPhase(dayPhaseAt());
      // Re-read the clock on the minute, so time-zone and clock changes show up too.
      if (!document.hidden) {
        timer = setTimeout(sync, 60_000 - (Date.now() % 60_000));
      }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target;
      if (target instanceof Element && target.closest(EDITING)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "escape") {
        setPreview(null);
      } else if (key === "n" || key === "m") {
        event.preventDefault();
        setPreview((current) => {
          const index = DAY_PHASES.indexOf(current ?? dayPhaseAt());
          const step = key === "m" ? 1 : -1;
          return DAY_PHASES[(index + step + DAY_PHASES.length) % DAY_PHASES.length] ?? null;
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return preview ?? phase;
}
