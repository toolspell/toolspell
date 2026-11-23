// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - plain Node script CI runs against the built client.
// Adapted from T3 Code (https://github.com/pingdotgg/t3code, MIT).
// Boots the built web client in headless Chromium with no server behind it. It passes when the
// app renders its "cannot reach the server" state, and fails on the boot error, an uncaught
// exception, or a page that never leaves the static boot shell.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { chromium } from "playwright";

const distDir = NodeURL.fileURLToPath(new URL("../dist/", import.meta.url));
const origin = "http://toolspell-boot.test";
const timeoutMs = 15_000;

if (!NodeFS.existsSync(NodePath.join(distDir, "index.html"))) {
  console.error(`No web build at ${distDir}. Run \`vp run build\` first.`);
  process.exit(1);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const uncaught: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => uncaught.push(error.stack ?? error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  // Serve dist with an SPA fallback. There is no server, so its endpoints fail fast.
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith("/api/") || url.pathname === "/ws" || url.pathname === "/health") {
      return route.fulfill({ status: 503 });
    }
    const file = NodePath.join(distDir, decodeURIComponent(url.pathname));
    const isAsset =
      file.startsWith(distDir) && NodeFS.statSync(file, { throwIfNoEntry: false })?.isFile();
    return route.fulfill({ path: isAsset ? file : NodePath.join(distDir, "index.html") });
  });

  await page.goto(`${origin}/`);
  const booted = page.getByRole("heading", { name: "Cannot reach the Toolspell server" });
  const failed = page.locator("#boot-error-reload");
  const waitError = await booted
    .or(failed)
    .first()
    .waitFor({ timeout: timeoutMs })
    .then(
      () => null,
      (error: Error) => error.message,
    );

  if (waitError !== null || (await failed.count()) > 0 || uncaught.length > 0) {
    console.error("The built web client failed to boot.");
    if (waitError !== null) console.error(waitError);
    for (const error of [...uncaught, ...consoleErrors]) console.error(error);
    process.exitCode = 1;
  } else {
    console.log("The built web client booted and rendered its no-server state.");
  }
} finally {
  await browser.close();
}
