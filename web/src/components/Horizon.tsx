/**
 * The surface at night: the savanna horizon, an acacia, and one kat standing
 * sentry on its mound. Decorative, so it is hidden from assistive technology.
 */
export function Horizon() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[46vh] min-h-64 w-full"
      viewBox="0 0 1440 360"
      preserveAspectRatio="xMidYMax slice"
    >
      <defs>
        <linearGradient id="afterglow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#19f6a1" stopOpacity="0" />
          <stop offset="0.72" stopColor="#19f6a1" stopOpacity="0.16" />
          <stop offset="1" stopColor="#19f6a1" stopOpacity="0.3" />
        </linearGradient>
        <radialGradient id="halo" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#19f6a1" stopOpacity="0.5" />
          <stop offset="1" stopColor="#19f6a1" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="1440" height="300" fill="url(#afterglow)" />
      <ellipse cx="1068" cy="150" rx="150" ry="120" fill="url(#halo)" />
      <g fill="#01060a">
        {/* acacia */}
        <path d="M150 214c34-30 62-40 118-40s92 12 122 40c-40-10-76-13-120-13s-80 3-120 13Z" />
        <path d="M262 198l-7 96h17l-5-96Z" />
        <path d="M264 232c18-10 34-22 46-34l5 4c-12 16-28 30-49 42Z" />
        {/* ground */}
        <path d="M0 292c180-14 330-6 520-10s330 10 520 2 250-12 400-4v80H0Z" />
        {/* mound */}
        <path d="M940 290c26-52 62-112 128-112s104 60 132 112Z" />
        {/* the sentry */}
        <path d="M1049 180c-6-24-2-48 7-64 3-6 19-6 22 0 9 16 13 40 7 64Z" />
        <circle cx="1067" cy="104" r="14" />
        <ellipse cx="1055" cy="108" rx="8" ry="5.5" />
        <circle cx="1060" cy="93" r="4" />
        <circle cx="1075" cy="93" r="4" />
      </g>
      <path
        d="M1080 174c22 6 32-8 24-22"
        fill="none"
        stroke="#01060a"
        strokeWidth="7"
        strokeLinecap="round"
      />
      {/* the one lit thing on the page: its eye catching the light */}
      <circle cx="1061" cy="103" r="2.2" fill="#19f6a1" />
    </svg>
  );
}
