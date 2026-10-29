/** Line icons, drawn on a 24px grid. Decorative unless given a label. */
const PATHS = {
  send: "M5 12h14M13 6l6 6-6 6",
  shield: "M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3Z M9 12l2 2 4-4",
  wallet:
    "M4 7a2 2 0 0 1 2-2h11a1 1 0 0 1 1 1v2 M4 7v10a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H6a2 2 0 0 1-2-2Z M16 13.5h.01",
  coin: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4 M12 7.5v1.5 M12 15.5V17",
  download: "M12 4v11 M7 10l5 5 5-5 M5 20h14",
  gift: "M4 11h16v9H4z M3 7h18v4H3z M12 7v13 M12 7c-1.5-3-5-3-5-1s3 1 5 1Zm0 0c1.5-3 5-3 5-1s-3 1-5 1Z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6L6 18",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 7v5l3 2",
  lock: "M6 11h12v10H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  sparkle:
    "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z",
  stack:
    "M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3Z M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6",
  arrowLeft: "M19 12H5M11 6l-6 6 6 6",
  plus: "M12 5v14M5 12h14",
  alert: "M12 3l9.5 17H2.5L12 3Z M12 10v4 M12 17h.01",
  minus: "M5 12h14",
  key: "M8 20a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z M11.2 12.3L20 3.5 M16.5 7l3 3 M14 9.5l2 2",
  rocket:
    "M12 2.5c3 2.2 4.5 5.8 4.5 9.5l-1.5 4h-6L7.5 12c0-3.7 1.5-7.3 4.5-9.5Z M12 10h.01 M9 16l-2.5 2.5V14 M15 16l2.5 2.5V14 M10.5 20h3",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 18,
  className,
  label,
}: {
  name: IconName;
  size?: number;
  className?: string;
  label?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
