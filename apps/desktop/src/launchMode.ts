// Whether the desktop app may come to the foreground. An agent's launch runs in the background, so
// the app never takes focus or covers windows on the machine it shares with a person.
export type LaunchMode = "background" | "foreground";

/** Carries a launcher's resolved mode, such as the dev supervisor's, to Electron. */
export const LAUNCH_MODE_ENV = "TOOLSPELL_DESKTOP_MODE";

/**
 * Set in agent shells, which may still have a terminal on stdin (Codex runs commands in a PTY).
 * T3 Code sets T3CODE_THREAD_ID for every provider and for its own terminal panel; Codex sets
 * CODEX_THREAD_ID, and CODEX_SANDBOX when sandboxed; OpenCode sets AI_AGENT.
 */
const AGENT_MARKERS = [
  "AI_AGENT",
  "CLAUDECODE",
  "CODEX_THREAD_ID",
  "CODEX_SANDBOX",
  "T3CODE_THREAD_ID",
];

export interface LaunchModeInput {
  readonly argv: ReadonlyArray<string>;
  readonly env: NodeJS.ProcessEnv;
  /** A person launched it: a terminal on stdin, or the OS opening a packaged app. */
  readonly interactive: boolean;
}

export const resolveLaunchMode = ({
  argv,
  env,
  interactive,
}: LaunchModeInput): { readonly mode: LaunchMode; readonly reason: string } => {
  const flag = argv.findLast((arg) => arg === "--background" || arg === "--foreground");
  if (flag !== undefined) {
    return { mode: flag === "--background" ? "background" : "foreground", reason: flag };
  }
  const value = env[LAUNCH_MODE_ENV]?.trim();
  if (value === "background" || value === "foreground") {
    return { mode: value, reason: `${LAUNCH_MODE_ENV}=${value}` };
  }
  // A typo must not bring the app forward, and a throw here would open Electron's error dialog.
  if (value) return { mode: "background", reason: `unknown ${LAUNCH_MODE_ENV}=${value}` };
  const agent = AGENT_MARKERS.find((name) => env[name]?.trim());
  if (agent !== undefined) return { mode: "background", reason: `${agent} is set` };
  return interactive
    ? { mode: "foreground", reason: "a person launched it" }
    : { mode: "background", reason: "no terminal on stdin" };
};
