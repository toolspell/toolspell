// Adapted from T3 Code's apps/desktop/src/window/DesktopWindow.ts (MIT).
import * as NodePath from "node:path";

import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  Menu,
  nativeTheme,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";

import { parseExternalUrl } from "./ipc.ts";
import { takeRendererReload } from "./restartPolicy.ts";

/** --background and --muted-foreground in apps/web/src/styles.css, as hex. */
const COLORS = {
  light: { background: "#ffffff", text: "#737373" },
  dark: { background: "#0a0a0a", text: "#a1a1a1" },
};
const ERR_ABORTED = -3;
const RENDERER_RELOAD_DELAY_MS = 500;
const RECOVERABLE_RENDERER_EXITS = new Set(["crashed", "oom", "killed", "abnormal-exit"]);

export const windowBackground = () =>
  COLORS[nativeTheme.shouldUseDarkColors ? "dark" : "light"].background;

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** A self-contained page in the web app's colours; Electron maps nativeTheme to the media query. */
const localPage = (body: string) => {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Toolspell</title><style>
html,body{margin:0;height:100%;background:${COLORS.light.background};color:${COLORS.light.text}}
@media (prefers-color-scheme:dark){html,body{background:${COLORS.dark.background};color:${COLORS.dark.text}}}
body{box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;font:14px system-ui,sans-serif;text-align:center;-webkit-user-select:none;user-select:none}
a{color:inherit;border:1px solid currentColor;border-radius:6px;padding:6px 14px;text-decoration:none}
</style></head><body>${body}</body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
};

const STARTUP_PAGE = localPage("Starting Toolspell…");

const isLocalPage = (url: string) => url.startsWith("data:");

// did-fail-load already reports a failed load, so its rejected promise adds nothing.
const ignoreLoadFailure = () => {};

const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return "about:blank";
  }
};

export const showStartupPage = (window: BrowserWindow) => {
  if (window.webContents.getURL() !== STARTUP_PAGE) {
    window.loadURL(STARTUP_PAGE).catch(ignoreLoadFailure);
  }
};

/** Its link only has to navigate: the window intercepts it and loads the app again. */
export const showRetryPage = (window: BrowserWindow, reason: string, origin: string) => {
  const page = localPage(
    `<div>Toolspell could not load.</div><div>${escapeHtml(reason)}</div><a href="${escapeHtml(origin)}/">Try again</a>`,
  );
  window.loadURL(page).catch(ignoreLoadFailure);
};

const contextMenu = (contents: WebContents, params: ContextMenuParams) => {
  const items: Array<MenuItemConstructorOptions> = [];
  if (params.misspelledWord) {
    for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
      items.push({ label: suggestion, click: () => contents.replaceMisspelling(suggestion) });
    }
    if (params.dictionarySuggestions.length === 0) {
      items.push({ label: "No Suggestions", enabled: false });
    }
    items.push({ type: "separator" });
  }
  if (parseExternalUrl(params.linkURL) !== undefined) {
    items.push(
      { label: "Copy Link Address", click: () => clipboard.writeText(params.linkURL) },
      { type: "separator" },
    );
  }
  if (params.isEditable) {
    items.push(
      { role: "cut", enabled: params.editFlags.canCut },
      { role: "copy", enabled: params.editFlags.canCopy },
      { role: "paste", enabled: params.editFlags.canPaste },
      { type: "separator" },
      { role: "selectAll", enabled: params.editFlags.canSelectAll },
    );
  } else if (params.selectionText.trim() !== "") {
    items.push({ role: "copy" });
  }
  while (items.at(-1)?.type === "separator") items.pop();
  return items;
};

export interface MainWindowOptions {
  /** Never shown, and nothing native pops up; agents drive and capture it over CDP. */
  readonly background: boolean;
  readonly note: (message: string) => void;
  /** Loads the app, or the startup page while the server is not ready. */
  readonly loadApp: () => void;
  readonly isAppUrl: (url: string) => boolean;
  readonly openExternal: (url: string) => void;
  readonly icon: string | undefined;
}

export const createMainWindow = ({
  background,
  note,
  loadApp,
  isAppUrl,
  openExternal,
  icon,
}: MainWindowOptions) => {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "Toolspell",
    ...(icon === undefined ? {} : { icon }),
    show: false,
    backgroundColor: windowBackground(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: NodePath.join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      additionalArguments: [`--toolspell-version=${app.getVersion()}`],
      // A hidden window keeps rendering, so screenshots and timers work in the background.
      backgroundThrottling: !background,
    },
  });
  const contents = window.webContents;

  let shown = false;
  const reveal = () => {
    if (shown || window.isDestroyed()) return;
    shown = true;
    window.show();
  };
  if (!background) {
    window.once("ready-to-show", reveal);
    // Some Linux window managers never send ready-to-show.
    if (process.platform === "linux") contents.once("did-finish-load", reveal);
  }

  // Links leave the app for the system browser; the window only shows Toolspell.
  contents.setWindowOpenHandler(({ url }) => {
    const external = parseExternalUrl(url);
    if (external !== undefined) openExternal(external);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (isLocalPage(contents.getURL())) {
      event.preventDefault();
      loadApp();
      return;
    }
    if (isAppUrl(url)) return;
    // Local docs and dev pages open in the window instead of the system browser.
    if (new URL(url).hostname === "localhost") return;
    event.preventDefault();
    const external = parseExternalUrl(url);
    if (external !== undefined) openExternal(external);
  });

  // A redirect is a navigation will-navigate never sees; it must not leave the app's origin either.
  contents.on("will-redirect", (details) => {
    if (isAppUrl(details.url)) return;
    details.preventDefault();
    note(`Blocked a redirect to ${originOf(details.url)}.`);
    if (details.isMainFrame)
      showRetryPage(window, "It redirected to another origin.", originOf(details.url));
  });

  contents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    // A load another load replaced reports ERR_ABORTED; that is not a failure.
    if (!isMainFrame || code === ERR_ABORTED || isLocalPage(url)) return;
    showRetryPage(window, `${description} (${code})`, originOf(url));
  });

  let rendererReloads: ReadonlyArray<number> = [];
  contents.on("render-process-gone", (_event, details) => {
    if (details.reason === "clean-exit" || window.isDestroyed()) return;
    const budget = takeRendererReload(rendererReloads, Date.now());
    rendererReloads = budget.reloads;
    if (budget.allowed && RECOVERABLE_RENDERER_EXITS.has(details.reason)) {
      setTimeout(() => {
        if (!window.isDestroyed()) loadApp();
      }, RENDERER_RELOAD_DELAY_MS);
      return;
    }
    const detail = `Its renderer process ended (${details.reason}, exit code ${details.exitCode}).`;
    if (background) return note(`Toolspell's window stopped working. ${detail}`);
    void dialog
      .showMessageBox(window, {
        type: "error",
        message: "Toolspell's window stopped working.",
        detail,
        buttons: ["Reload", "Quit"],
        defaultId: 0,
        cancelId: 0,
      })
      .then(({ response }) => (response === 0 ? loadApp() : app.quit()));
  });

  contents.on("context-menu", (_event, params) => {
    const items = contextMenu(contents, params);
    if (items.length > 0 && !background) Menu.buildFromTemplate(items).popup({ window });
  });

  showStartupPage(window);
  return window;
};
