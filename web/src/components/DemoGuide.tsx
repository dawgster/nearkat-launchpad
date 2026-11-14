import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";

/**
 * A walkthrough for presenting the app: a bar at the foot of the page with
 * the next thing to show, a line to say, and a button that goes there. It
 * appears only when the address carries `?demo=<dataset collection>`, and then
 * stays through navigation and reloads until it is closed.
 */
interface Step {
  title: string;
  /** What to do on screen. */
  show: string;
  /** A line to say while doing it. */
  say: string;
  /** Where "Next" goes when this step starts; none means stay on the page. */
  to?: string;
}

const KEY = "demo-guide";

export function demoSteps(collection: string): Step[] {
  const page = `/c/${collection}`;
  return [
    {
      title: "A kat",
      show: "Open one of your kats under “Yours”.",
      say: "This is a nearkat: an NFT with a mind of its own.",
      to: "/",
    },
    {
      title: "Talk to it",
      show: "Send it a message. Point at its balance, its Character and its Memory.",
      say: "It pays for its own conversations, and what it learns is encrypted. Give it away and its memories go with it.",
    },
    {
      title: "The launchpad",
      show: "Pick the Tutor template and scroll through the form. Don't launch.",
      say: "Kats are one collection. Anyone can launch their own kind: a prompt, a price, who may open its mind.",
      to: "/launch",
    },
    {
      title: "A dataset instead",
      show: "Click Dataset and drop the folder of pictures. Don't launch.",
      say: "A token doesn't have to be a character. Here each one is a labelled picture. This is the last time anyone sees them.",
    },
    {
      title: "The dataset collection",
      show: "Show the figures, “How it works” and “Who can open the samples”.",
      say: "This one is already launched. Every picture is sealed under its own key from NEAR's MPC network. No picture anywhere.",
      to: page,
    },
    {
      title: "One sample",
      show: "Show the sample: no picture, its rental, its training runs.",
      say: "Even its owner can't see it. But it can earn: it's listed for rent to a training app.",
      to: `${page}/kat/1`,
    },
    {
      title: "Rent",
      show: "In “Rent samples” enter 150 and rent. Then open the transaction.",
      say: "I rent 150 samples in one go, and the holders are paid directly.",
      to: page,
    },
    {
      title: "Train",
      show: "Press “Train on … rented samples” and let the steps run.",
      say: "The training app gets the keys from the contract, trains, and records the run on-chain. Each rental is used up by that one run.",
    },
    {
      title: "The result",
      show: "Show the accuracy and the on-chain record. Drop a photo in the try box.",
      say: "That is its accuracy on pictures it never trained on, and I never saw a training image.",
    },
    {
      title: "The model is a token",
      show: "Under “Model token”, open the token's page and press “Open the model”.",
      say: "The model is an NFT too. Its weights are sealed, and the app opens them only for the token's owner.",
    },
    {
      title: "Give it away",
      show: "Give the token to another account. Do this last: it can't be undone.",
      say: "Sell it or give it away, and the model goes with the token.",
    },
    {
      title: "Close",
      show: "End on the collection page.",
      say: "Live on NEAR testnet. The contract already verifies TEE attestations; running these services inside one is the next step.",
      to: page,
    },
  ];
}

interface Saved {
  collection: string;
  step: number;
  small: boolean;
}

function load(search: string): Saved | null {
  const asked = new URLSearchParams(search).get("demo");
  if (asked && /^[a-z0-9._-]{2,64}$/.test(asked)) {
    return { collection: asked, step: 0, small: false };
  }
  try {
    const raw = sessionStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<Saved>) : null;
    if (saved && typeof saved.collection === "string" && typeof saved.step === "number") {
      return { collection: saved.collection, step: saved.step, small: saved.small === true };
    }
  } catch {
    // No storage, or something else's value: no guide.
  }
  return null;
}

export function DemoGuide() {
  const location = useLocation();
  const navigate = useNavigate();
  // Read once: the address only switches the guide on.
  const [guide, setGuide] = useState<Saved | null>(() => load(location.search));

  useEffect(() => {
    try {
      if (guide) {
        sessionStorage.setItem(KEY, JSON.stringify(guide));
      } else {
        sessionStorage.removeItem(KEY);
      }
    } catch {
      // Without storage the guide lasts until the page is reloaded.
    }
  }, [guide]);

  if (!guide) {
    return null;
  }
  const steps = demoSteps(guide.collection);
  const index = Math.min(Math.max(guide.step, 0), steps.length - 1);
  const step = steps[index] as Step;
  const go = (to: number) => {
    const next = steps[to];
    if (!next) {
      return;
    }
    setGuide({ ...guide, step: to });
    if (next.to) {
      navigate(next.to);
    }
  };
  const last = index === steps.length - 1;

  return (
    <aside
      aria-label="Demo guide"
      className="fixed inset-x-0 bottom-3 z-50 mx-auto w-[min(46rem,calc(100vw-1.5rem))] rounded-2xl border border-glow/30 bg-[#06141a]/95 px-4 py-3 shadow-[0_10px_40px_rgba(0,0,0,0.6)] backdrop-blur"
    >
      <div className="flex items-center gap-3">
        <span className="shrink-0 rounded-full bg-glow/10 px-2.5 py-1 font-mono text-xs text-glow ring-1 ring-glow/25">
          {index + 1} / {steps.length}
        </span>
        <p className="min-w-0 flex-1 truncate font-bold">{step.title}</p>
        <button
          type="button"
          className="text-sm text-mist underline"
          onClick={() => setGuide({ ...guide, small: !guide.small })}
        >
          {guide.small ? "Show notes" : "Hide notes"}
        </button>
        <button
          type="button"
          className="button button-quiet !px-3 !py-1.5 text-sm"
          onClick={() => go(index - 1)}
          disabled={index === 0}
        >
          Back
        </button>
        {last ? (
          <button
            type="button"
            className="button !px-4 !py-1.5 text-sm"
            onClick={() => setGuide(null)}
          >
            Done
          </button>
        ) : (
          <button
            type="button"
            className="button !px-4 !py-1.5 text-sm"
            onClick={() => go(index + 1)}
          >
            Next: {(steps[index + 1] as Step).title}
          </button>
        )}
        <button
          type="button"
          className="text-mist"
          aria-label="Close the demo guide"
          onClick={() => setGuide(null)}
        >
          ✕
        </button>
      </div>
      {!guide.small && (
        <div className="mt-2 space-y-1 text-sm leading-relaxed">
          <p>
            <span className="text-mist">Show: </span>
            {step.show}
          </p>
          <p className="text-mist">
            <span>Say: </span>
            <span className="italic">“{step.say}”</span>
          </p>
        </div>
      )}
    </aside>
  );
}
