import * as NodePath from "node:path";

import { AUTH_SESSION_PATH } from "@toolspell/contracts/desktop";
import { app, BrowserWindow, dialog, ipcMain, net, shell } from "electron";

import { startBackend, waitUntilReachable, type Backend } from "./backend.ts";
import { DESKTOP_IPC } from "./ipc.ts";

let backend: Backend | undefined;
let window: BrowserWindow | undefined;
let quitting = false;

const isWebUrl = (url: string) => {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

/** Pair only when this profile has no live session, so restarts do not pile up sessions. */
const entryPath = async (origin: string, token: string) => {
  const response = await net.fetch(`${origin}${AUTH_SESSION_PATH}`, {
    credentials: "include",
  });
  const status = (await response.json()) as { readonly authenticated?: boolean };
  return status.authenticated ? "/" : `/pair#token=${token}`;
};

const createWindow = async (origin: string, token: string) => {
  window = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "ToolSpell",
    webPreferences: {
      preload: NodePath.join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      additionalArguments: [`--toolspell-version=${app.getVersion()}`],
    },
  });
  // Links leave the app for the system browser; the window only shows ToolSpell.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin === origin) return;
    event.preventDefault();
    if (isWebUrl(url)) void shell.openExternal(url);
  });
  await window.loadURL(`${origin}${await entryPath(origin, token)}`);
};

const fail = (error: unknown) => {
  dialog.showErrorBox("ToolSpell could not start", String(error));
  app.quit();
};

ipcMain.handle(DESKTOP_IPC.openExternal, (_event, url: unknown) =>
  typeof url === "string" && isWebUrl(url) ? shell.openExternal(url) : undefined,
);

// One app instance per profile: a second would start a second server on the same data.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });

  app.on("before-quit", () => {
    quitting = true;
    backend?.child.kill("SIGTERM");
  });

  app.on("window-all-closed", () => app.quit());

  void app.whenReady().then(async () => {
    try {
      backend = await startBackend();
      backend.child.on("exit", (code) => {
        if (!quitting) fail(new Error(`The server stopped unexpectedly (exit code ${code}).`));
      });
      const serverOrigin = `http://127.0.0.1:${backend.port}`;
      await waitUntilReachable(`${serverOrigin}/health`, backend.child);
      // In development Vite serves the client and proxies to the server.
      const origin = (!app.isPackaged && process.env.TOOLSPELL_WEB_URL) || serverOrigin;
      if (origin !== serverOrigin) await waitUntilReachable(origin, backend.child);
      await createWindow(origin, backend.bootstrapToken);
    } catch (error) {
      fail(error);
    }
  });
}
