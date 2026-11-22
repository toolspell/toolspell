import { expect, it } from "vite-plus/test";

import { formatRelativeTime } from "./relativeTime.ts";

const NOW = Date.UTC(2026, 10, 22, 12);
const MINUTE = 60_000;

it.each([
  [NOW - 59_999, "just now"],
  [NOW + 30_000, "just now"],
  [NOW - MINUTE, "1 minute ago"],
  [NOW - 59 * MINUTE, "59 minutes ago"],
  [NOW - 60 * MINUTE, "1 hour ago"],
  [NOW - 24 * 60 * MINUTE, "yesterday"],
  [NOW - 9 * 24 * 60 * MINUTE, "last week"],
  [NOW + 10 * MINUTE, "in 10 minutes"],
])("formats %d as %s", (timestamp, label) => {
  expect(formatRelativeTime(timestamp, NOW)).toBe(label);
});
