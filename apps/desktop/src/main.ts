import * as NodePath from "node:path";
import * as NodeTty from "node:tty";

import { AUTH_SESSION_PATH } from "@toolspell/contracts/desktop";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  net,
  session,
  shell,
  type IpcMainInvokeEvent,
} from "electron";

import { ServerSupervisor, waitForHttp } from "./backend.ts";
import { DESKTOP_IPC, isTrustedSender, parseExternalUrl, parseThemeSource } from "./ipc.ts";
import { resolveLaunchMode } from "./launchMode.ts";
import { setApplicationMenu } from "./menu.ts";
import { choosePort, LOOPBACK, readRememberedPort, rememberPort } from "./port.ts";
import { readRemembered, remember } from "./remembered.ts";
import { ServerLog } from "./serverLog.ts";
import { createMainWindow, showRetryPage, showStartupPage, windowBackground } from "./window.ts";

const isDevelopment = !app.isPackaged;
const devIconDirectory = isDevelopment
  ? NodePath.resolve(app.getAppPath(), "../../assets/dev")
  : undefined;
// A packaged app opened from Finder or the Start menu has no terminal, but a person opened it.
const launch = resolveLaunchMode({
  argv: process.argv,
  env: process.env,
  interactive: app.isPackaged || NodeTty.isatty(0),
});
const background = launch.mode === "background";
// Before Electron finishes launching: no Dock icon or menu bar, and macOS refuses to activate it.
if (background && process.platform === "darwin") app.setActivationPolicy("prohibited");

// Identity comes before the single-instance lock, which lives in userData like every profile
// file. A dev profile sits in the checkout's dev home, so checkouts run side by side.
app.setName(isDevelopment ? "ToolSpell Dev" : "ToolSpell");
const devHome = isDevelopment ? process.env.TOOLSPELL_HOME : undefined;
app.setPath(
  "userData",
  devHome
    ? NodePath.join(devHome, "desktop")
    : NodePath.join(app.getPath("appData"), app.getName()),
);
app.setAppLogsPath(devHome ? NodePath.join(app.getPath("userData"), "logs") : undefined);
app.setAboutPanelOptions({
  applicationName: app.getName(),
  applicationVersion: app.getVersion(),
  version: `Electron ${process.versions.electron}`,
});

// A closed terminal turns a write into an uncaught EPIPE error; the log file still has the line.
process.stdout.on("error", () => {});
process.stderr.on("error", () => {});

// A launcher such as the dev supervisor holds stdin open; when it dies, even by SIGKILL, the app
// quits and so stops its server.
if (process.env.TOOLSPELL_DESKTOP_EXIT_WITH_STDIN === "1") {
  delete process.env.TOOLSPELL_DESKTOP_EXIT_WITH_STDIN;
  const quit = () => app.quit();
  process.stdin.once("end", quit).once("close", quit).once("error", quit).resume();
}

let window: BrowserWindow | undefined;
let supervisor: ServerSupervisor | undefined;
let log: ServerLog | undefined;
let serverOrigin: string | undefined;
/** Where the window loads the app: the server, or Vite in development. Fixed with the port. */
let webOrigin: string | undefined;
/** The current run's one-time pairing token, while the server answers. */
let serverToken: string | undefined;
let started = false;
let quitPhase: "running" | "stopping" | "done" = "running";
let fatalShown = false;

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

const note = (message: string) => {
  const line = `[desktop] ${new Date().toISOString()} ${message}\n`;
  log?.write(line);
  if (isDevelopment) process.stdout.write(line);
};

// Electron reports an uncaught exception in a dialog; in the background the log gets it.
if (background) {
  process.on("uncaughtException", (error) => note(`Uncaught exception: ${error.stack ?? error}`));
}

const isAppUrl = (url: string) => {
  try {
    return webOrigin !== undefined && new URL(url).origin === webOrigin;
  } catch {
    return false;
  }
};

const withLogPath = (detail: string) =>
  log === undefined ? detail : `${detail}\n\nThe full log is in ${log.path}.`;

const fatal = (message: string, detail: string) => {
  if (fatalShown || quitPhase !== "running") return;
  fatalShown = true;
  note(background ? `${message}: ${detail}` : message);
  if (!background) dialog.showErrorBox(message, withLogPath(detail));
  app.quit();
};

const keepTrying = async (detail: string) => {
  if (quitPhase !== "running") return false;
  if (background) {
    note(`The server keeps stopping; trying again without asking. ${detail}`);
    return true;
  }
  const options = {
    type: "error" as const,
    message: "ToolSpell's server keeps stopping.",
    detail: withLogPath(detail),
    buttons: ["Keep Trying", "Quit"],
    defaultId: 0,
    cancelId: 1,
  };
  const { response } =
    window === undefined || window.isDestroyed()
      ? await dialog.showMessageBox(options)
      : await dialog.showMessageBox(window, options);
  if (response === 0) return true;
  app.quit();
  return false;
};

const openExternal = async (url: string) => {
  // The system browser would come to the front.
  if (background) return note(`Not opening ${url} in the background.`);
  try {
    await shell.openExternal(url);
  } catch (error) {
    note(`Could not open ${url}: ${describe(error)}`);
    throw new Error(`The system could not open ${url}.`, { cause: error });
  }
};

const openLink = (url: string) => {
  openExternal(url).catch(() => {
    if (window === undefined || window.isDestroyed()) return;
    void dialog.showMessageBox(window, {
      type: "warning",
      message: "ToolSpell could not open the link.",
      detail: url,
    });
  });
};

/** Pair only when this profile has no live session, so restarts do not pile up sessions. */
const entryPath = async (origin: string, token: string) => {
  const response = await net.fetch(`${origin}${AUTH_SESSION_PATH}`, { credentials: "include" });
  const status = (await response.json()) as { readonly authenticated?: boolean };
  return status.authenticated ? "/" : `/pair#token=${token}`;
};

const loadApp = async () => {
  const target = window;
  if (target === undefined || target.isDestroyed()) return;
  if (webOrigin === undefined || serverToken === undefined) return showStartupPage(target);
  const origin = webOrigin;
  try {
    const url = `${origin}${await entryPath(origin, serverToken)}`;
    // did-fail-load reports a failed load with the retry page.
    if (!target.isDestroyed()) await target.loadURL(url).catch(() => {});
  } catch (error) {
    if (!target.isDestroyed()) showRetryPage(target, describe(error), origin);
  }
};

/** A restarted server keeps the window: its session cookie stays valid and the client reconnects. */
const onServerReady = async (token: string) => {
  serverToken = token;
  if (webOrigin === undefined) return;
  // In development Vite serves the client and proxies to the server.
  if (webOrigin !== serverOrigin && (await waitForHttp(webOrigin)) !== "ready") {
    if (window !== undefined && !window.isDestroyed()) {
      showRetryPage(window, `${webOrigin} did not answer.`, webOrigin);
    }
    return;
  }
  if (window !== undefined && !window.isDestroyed() && !isAppUrl(window.webContents.getURL())) {
    await loadApp();
  }
};

const ensureWindow = () => {
  if (!started || quitPhase !== "running") return;
  if (window !== undefined && !window.isDestroyed()) {
    if (background) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    return;
  }
  const created = createMainWindow({
    background,
    note,
    loadApp: () => void loadApp(),
    isAppUrl,
    openExternal: openLink,
    icon:
      devIconDirectory === undefined
        ? undefined
        : NodePath.join(
            devIconDirectory,
            process.platform === "win32" ? "windows.ico" : "universal-1024.png",
          ),
  });
  window = created;
  created.on("closed", () => {
    if (window === created) window = undefined;
  });
  if (serverToken !== undefined) void loadApp();
};

const themeFile = () => NodePath.join(app.getPath("userData"), "theme.json");

const resolvePort = async () => {
  // The dev runner fixes the port, because Vite proxies to it.
  const fixed = Number(process.env.TOOLSPELL_PORT);
  if (Number.isInteger(fixed) && fixed > 0) return fixed;
  const file = NodePath.join(app.getPath("userData"), "server-port.json");
  const remembered = readRememberedPort(file);
  const port = await choosePort(remembered);
  if (port !== remembered) {
    try {
      rememberPort(file, port);
    } catch (error) {
      note(`Could not remember port ${port}: ${describe(error)}`);
    }
  }
  return port;
};

const start = async () => {
  // The app uses no browser permission yet; each one a feature needs gets allowed by name.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  setApplicationMenu();
  if (!background && devIconDirectory !== undefined && process.platform === "darwin") {
    app.dock?.setIcon(NodePath.join(devIconDirectory, "macos-1024.png"));
  }
  // The theme the web app last chose, so the window opens in it before the app loads.
  nativeTheme.themeSource = parseThemeSource(readRemembered(themeFile())) ?? "system";
  nativeTheme.on("updated", () => {
    if (window !== undefined && !window.isDestroyed())
      window.setBackgroundColor(windowBackground());
  });
  log = new ServerLog(NodePath.join(app.getPath("logs"), "server.log"));
  note(`Launch mode: ${launch.mode} (${launch.reason}).`);
  started = true;
  ensureWindow();

  const port = await resolvePort();
  if (quitPhase !== "running") return;
  serverOrigin = `http://${LOOPBACK}:${port}`;
  webOrigin = (isDevelopment && process.env.TOOLSPELL_WEB_URL) || serverOrigin;
  supervisor = new ServerSupervisor({
    port,
    log,
    echo: isDevelopment,
    note,
    onReady: (token) => void onServerReady(token),
    onExit: () => {
      serverToken = undefined;
    },
    onFatal: fatal,
    keepTrying,
  });
  supervisor.start();
};

const trustedFrame = () =>
  window === undefined || window.isDestroyed() || webOrigin === undefined
    ? undefined
    : {
        webContents: window.webContents,
        mainFrame: window.webContents.mainFrame,
        origin: webOrigin,
      };

const assertTrusted = (event: IpcMainInvokeEvent) => {
  if (!isTrustedSender(event, trustedFrame())) {
    throw new Error("Only the ToolSpell window may use the desktop bridge.");
  }
};

ipcMain.handle(DESKTOP_IPC.openExternal, async (event, raw: unknown) => {
  assertTrusted(event);
  const url = parseExternalUrl(raw);
  if (url === undefined) throw new Error("Only http and https links open in the browser.");
  await openExternal(url);
});

ipcMain.handle(DESKTOP_IPC.setTheme, (event, raw: unknown) => {
  assertTrusted(event);
  const source = parseThemeSource(raw);
  if (source === undefined) throw new Error("The theme must be system, light, or dark.");
  if (source === nativeTheme.themeSource) return;
  nativeTheme.themeSource = source;
  try {
    remember(themeFile(), source);
  } catch (error) {
    note(`Could not remember the theme: ${describe(error)}`);
  }
});

// One app instance per profile: a second would start a second server on the same data.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", ensureWindow);
  // On macOS the app and its server outlive the window; the Dock icon brings one back.
  app.on("activate", ensureWindow);
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  // Quit waits for the server to stop, so its finalizers run and the home lock is released.
  app.on("before-quit", (event) => {
    if (quitPhase === "done") return;
    event.preventDefault();
    if (quitPhase === "stopping") return;
    quitPhase = "stopping";
    // Closing the windows first makes quitting feel immediate while the server stops.
    for (const open of BrowserWindow.getAllWindows()) open.destroy();
    void Promise.resolve(supervisor?.stop())
      .catch((error: unknown) => note(`Stopping the server failed: ${describe(error)}`))
      .finally(() => {
        quitPhase = "done";
        log?.close();
        app.quit();
      });
  });

  void app
    .whenReady()
    .then(start)
    .catch((error: unknown) => fatal("ToolSpell could not start", describe(error)));
}
