// Adapted from T3 Code (https://github.com/pingdotgg/t3code, MIT).
const RELOADED_KEY = "toolspell:chunk-load-reloaded";

// The hashed URL of the chunk this module lands in stands in for a build id.
const CURRENT_BUILD = import.meta.url;

/**
 * A deploy removes the old build's lazy chunks, so an open tab fails to load the next route.
 * One reload per build fetches the new index. The mark survives reloads: a chunk that fails on
 * every visit must not loop. Without storage there is no guard, so no reload.
 */
export function reloadOnceForChunkLoadError(
  storage: () => Storage = () => window.sessionStorage,
  reload: () => void = () => window.location.reload(),
  build: string = CURRENT_BUILD,
): boolean {
  let reloaded: boolean;
  try {
    reloaded = storage().getItem(RELOADED_KEY) === build;
    if (!reloaded) storage().setItem(RELOADED_KEY, build);
  } catch {
    return false;
  }
  if (reloaded) return false;
  reload();
  return true;
}

// Browsers cache a failed dynamic import per document, so only a reload can retry it.
const CHUNK_LOAD_ERROR_PREFIXES = [
  "Failed to fetch dynamically imported module", // Chromium
  "error loading dynamically imported module", // Firefox
  "Importing a module script failed", // Safari
];

export function isChunkLoadError(error: unknown): boolean {
  return (
    error instanceof Error &&
    CHUNK_LOAD_ERROR_PREFIXES.some((prefix) => error.message.startsWith(prefix))
  );
}
