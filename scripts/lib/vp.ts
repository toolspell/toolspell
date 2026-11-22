// How dev scripts launch Vite+. Adapted from T3 Code's scripts/check-changed-command.ts (MIT).
import * as NodeURL from "node:url";

/**
 * Windows cannot spawn the `vp.cmd` shim without a shell, and cmd.exe mangles arguments with
 * spaces, `&`, `^` or `%` and caps the line at 8191 characters. There, run Vite+'s exported JS
 * entry with this Node instead, which keeps every argument literal.
 */
export const vpCommand = (
  args: ReadonlyArray<string>,
  platform: NodeJS.Platform = process.platform,
): [command: string, args: Array<string>] =>
  platform === "win32"
    ? [process.execPath, [NodeURL.fileURLToPath(import.meta.resolve("vite-plus/bin")), ...args]]
    : ["vp", [...args]];
