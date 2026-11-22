/**
 * What the Electron preload exposes as `window.toolspellDesktop`. Keep it small:
 * anything the server can do belongs in the RPC contract, so remote clients get it too.
 */
export interface DesktopBridge {
  readonly platform: "darwin" | "win32" | "linux";
  readonly appVersion: string;
  /** Opens an http(s) URL in the system browser. */
  readonly openExternal: (url: string) => Promise<void>;
}

export const DESKTOP_BRIDGE_KEY = "toolspellDesktop";

/** Kept here, free of Effect imports, so the Electron bundles stay small. */
export const AUTH_SESSION_PATH = "/api/auth/session";
