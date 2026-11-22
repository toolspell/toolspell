// IPC channels and the checks every handler runs. Adapted from T3 Code's
// apps/desktop/src/ipc/DesktopIpc.ts and apps/desktop/src/electron/ElectronShell.ts (MIT).
export const DESKTOP_IPC = {
  openExternal: "toolspell:open-external",
} as const;

const MAX_URL_LENGTH = 8_192;

/** Only http(s) leaves the app: file: and custom schemes can start local programs. */
export const parseExternalUrl = (raw: unknown) => {
  if (typeof raw !== "string" || raw.length > MAX_URL_LENGTH) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
};

const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
};

export interface IpcSender {
  readonly sender: unknown;
  readonly senderFrame: { readonly url: string } | null;
}

export interface TrustedFrame {
  readonly webContents: unknown;
  readonly mainFrame: unknown;
  /** The app's origin; the window's local startup and retry pages get the preload too. */
  readonly origin: string;
}

/** ipcMain serves every frame of every window; only the main window's top frame showing the app may call. */
export const isTrustedSender = (event: IpcSender, trusted: TrustedFrame | undefined) =>
  trusted !== undefined &&
  event.sender === trusted.webContents &&
  event.senderFrame !== null &&
  event.senderFrame === trusted.mainFrame &&
  originOf(event.senderFrame.url) === trusted.origin;
