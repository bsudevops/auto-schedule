/** The BSU Scheduler mark: a calendar with a check, on a sky-blue tile. Same artwork as src/app/icon.svg. */
/** `inverse` draws a white tile with blue artwork, for use on blue backgrounds. */
export function BrandLogo({ size = 34, className, inverse = false }: { size?: number; className?: string; inverse?: boolean }) {
  const ink = inverse ? "#145FCC" : "#fff";
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false" style={{ flex: "none", display: "block" }}>
      <defs>
        <linearGradient id="bsu-logo-g" x1="8" y1="4" x2="56" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5AAEFF" />
          <stop offset="1" stopColor="#145FCC" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={inverse ? "#fff" : "url(#bsu-logo-g)"} />
      <path d="M15 24a6 6 0 0 1 6-6h22a6 6 0 0 1 6 6v4H15z" fill={ink} fillOpacity={inverse ? ".18" : ".35"} />
      <rect x="15" y="18" width="34" height="31" rx="6" fill="none" stroke={ink} strokeWidth="4" />
      <path d="M24 13v8M40 13v8" stroke={ink} strokeWidth="4" strokeLinecap="round" />
      <path d="M23.5 37.5l5.5 5 11.5-11" fill="none" stroke={ink} strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
