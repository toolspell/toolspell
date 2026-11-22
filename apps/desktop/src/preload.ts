import { DESKTOP_BRIDGE_KEY, type DesktopBridge } from "@toolspell/contracts/desktop";
import { contextBridge, ipcRenderer } from "electron";

import { DESKTOP_IPC } from "./ipc.ts";

const VERSION_ARGUMENT = "--toolspell-version=";

// The sandboxed preload exposes only this bridge. Anything the server can do belongs
// in the RPC contract instead, so remote clients get it too.
const bridge: DesktopBridge = {
  platform: process.platform as DesktopBridge["platform"],
  appVersion:
    process.argv
      .find((argument) => argument.startsWith(VERSION_ARGUMENT))
      ?.slice(VERSION_ARGUMENT.length) ?? "unknown",
  openExternal: (url) => ipcRenderer.invoke(DESKTOP_IPC.openExternal, url),
  setTheme: (source) => ipcRenderer.invoke(DESKTOP_IPC.setTheme, source),
};

contextBridge.exposeInMainWorld(DESKTOP_BRIDGE_KEY, bridge);
