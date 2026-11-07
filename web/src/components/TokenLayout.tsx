import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";

/** One of the things beside a conversation: its mind, its wallet, lending it, and so on. */
export interface Panel {
  id: string;
  /** The tab's name on the savannah. */
  label: string;
  node: ReactNode;
  /** Needs the owner now, such as a balance that has run out. */
  urgent?: boolean;
}

/**
 * A conversation and its panels. Columns: the conversation with the panels
 * stacked beside it. Savannah: the conversation as one centred den card, and
 * the panels below it as tabs, all kept mounted so a half-filled form
 * survives switching tabs.
 */
export function TokenLayout({
  savannah,
  chat,
  panels,
}: {
  savannah: boolean;
  chat: ReactNode;
  panels: Panel[];
}) {
  if (!savannah) {
    return (
      <div className="mt-8 grid items-start gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:gap-6">
        <div className="lg:sticky lg:top-5">{chat}</div>
        <aside className="min-w-0 space-y-5">
          {panels.map((panel) => (
            <div key={panel.id}>{panel.node}</div>
          ))}
        </aside>
      </div>
    );
  }
  const [only] = panels;
  return (
    <div className="mx-auto mt-8 w-full max-w-2xl">
      {chat}
      {panels.length === 1 && only ? (
        <div className="mt-5">{only.node}</div>
      ) : (
        panels.length > 1 && <Tabs panels={panels} />
      )}
    </div>
  );
}

function Tabs({ panels }: { panels: Panel[] }) {
  const id = useId();
  const first = panels[0]?.id ?? "";
  const [chosen, setChosen] = useState(first);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  // A panel can come and go (importing history is the creator's choice); fall back to the first.
  const selected = panels.some((panel) => panel.id === chosen) ? chosen : first;

  // Something urgent, like a balance that ran out, brings its panel forward.
  const urgent = panels.find((panel) => panel.urgent)?.id;
  useEffect(() => {
    if (urgent) {
      setChosen(urgent);
    }
  }, [urgent]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = panels.findIndex((panel) => panel.id === selected);
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % panels.length
        : event.key === "ArrowLeft"
          ? (index - 1 + panels.length) % panels.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? panels.length - 1
              : null;
    if (next === null) {
      return;
    }
    const target = panels[next];
    if (!target) {
      return;
    }
    event.preventDefault();
    setChosen(target.id);
    buttons.current.get(target.id)?.focus();
  }

  return (
    <div className="mt-6">
      <div
        role="tablist"
        aria-label="About this kat"
        className="savannah-tabs"
        onKeyDown={onKeyDown}
      >
        {panels.map((panel) => (
          <button
            key={panel.id}
            ref={(element) => {
              if (element) {
                buttons.current.set(panel.id, element);
              } else {
                buttons.current.delete(panel.id);
              }
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${panel.id}`}
            aria-selected={panel.id === selected}
            aria-controls={`${id}-panel-${panel.id}`}
            tabIndex={panel.id === selected ? 0 : -1}
            data-urgent={panel.urgent ? "true" : undefined}
            onClick={() => setChosen(panel.id)}
          >
            {panel.label}
          </button>
        ))}
      </div>
      {panels.map((panel) => (
        <div
          key={panel.id}
          role="tabpanel"
          id={`${id}-panel-${panel.id}`}
          aria-labelledby={`${id}-tab-${panel.id}`}
          hidden={panel.id !== selected}
          className="mt-4"
        >
          {panel.node}
        </div>
      ))}
    </div>
  );
}
