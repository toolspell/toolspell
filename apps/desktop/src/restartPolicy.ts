// When to restart the server and reload a crashed window, and when to stop and ask.
// Adapted from T3 Code's apps/desktop/src/backend/DesktopBackendManager.ts and
// apps/desktop/src/window/DesktopWindow.ts (MIT).
import { SERVER_EXIT_CODE_HOME_IN_USE } from "@toolspell/contracts/desktop";

const FIRST_RESTART_DELAY_MS = 500;
const MAX_RESTART_DELAY_MS = 10_000;
/** A run that answered this long was healthy, so its exit starts a new streak. */
const HEALTHY_RUN_MS = 60_000;
const FAILURES_PER_PROMPT = 3;

const RENDERER_RELOADS = 3;
const RENDERER_RELOAD_WINDOW_MS = 60_000;

export interface ServerExit {
  readonly code: number | null;
  /** How long the run was ready before it exited; undefined when it never signalled ready. */
  readonly answeredForMs: number | undefined;
}

export type RestartDecision =
  | { readonly kind: "home-in-use" }
  | {
      readonly kind: "restart";
      /** Consecutive failures, this one included. */
      readonly failures: number;
      readonly delayMs: number;
      /** Ask the user before this restart, so a broken server does not retry unseen. */
      readonly askFirst: boolean;
    };

export const decideRestart = (failures: number, exit: ServerExit): RestartDecision => {
  if (exit.code === SERVER_EXIT_CODE_HOME_IN_USE) return { kind: "home-in-use" };
  const healthy = exit.answeredForMs !== undefined && exit.answeredForMs >= HEALTHY_RUN_MS;
  const streak = healthy ? 1 : failures + 1;
  return {
    kind: "restart",
    failures: streak,
    delayMs: Math.min(FIRST_RESTART_DELAY_MS * 2 ** (streak - 1), MAX_RESTART_DELAY_MS),
    askFirst: streak % FAILURES_PER_PROMPT === 0,
  };
};

/** Records a renderer reload at `now` if the budget for the last minute allows one. */
export const takeRendererReload = (reloads: ReadonlyArray<number>, now: number) => {
  const recent = reloads.filter((time) => now - time < RENDERER_RELOAD_WINDOW_MS);
  const allowed = recent.length < RENDERER_RELOADS;
  return { allowed, reloads: allowed ? [...recent, now] : recent };
};
