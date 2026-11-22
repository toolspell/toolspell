import { secondTick } from "@toolspell/client-runtime/clock";
import { formatRelativeTime } from "@toolspell/client-runtime/relative-time";
import { useSyncExternalStore } from "react";

/** "5 minutes ago", kept current by the shared clock. Re-renders only when the label changes. */
export function useRelativeTime(timestampMs: number): string {
  const read = () => formatRelativeTime(timestampMs, secondTick.getSnapshot());
  return useSyncExternalStore(secondTick.subscribe, read);
}
