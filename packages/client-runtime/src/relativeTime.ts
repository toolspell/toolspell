const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const UNITS = [
  ["year", 365 * DAY],
  ["month", 30 * DAY],
  ["week", 7 * DAY],
  ["day", DAY],
  ["hour", HOUR],
  ["minute", MINUTE],
] as const;

// The copy around these labels is English; a browser-locale phrase would mix languages.
const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "just now", "5 minutes ago", "yesterday", "in 2 hours". Changes at most once a minute. */
export function formatRelativeTime(timestampMs: number, nowMs: number): string {
  const elapsed = nowMs - timestampMs;
  for (const [unit, size] of UNITS) {
    if (Math.abs(elapsed) >= size) return format.format(-Math.trunc(elapsed / size), unit);
  }
  return "just now";
}
