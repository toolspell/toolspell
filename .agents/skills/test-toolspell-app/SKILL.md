---
name: test-toolspell-app
description: Test ToolSpell's web and desktop UI through T3 Code's built-in Browser panel against isolated development state. Use for browser verification, browser pairing recovery, and test fixtures.
---

# Test ToolSpell web and desktop

Use the Browser panel of the T3 Code instance you run in. Follow the recovery steps below before
declaring it unavailable. Do not install or switch to another automation system.

## Start the app

Reuse this task's healthy dev server. Otherwise run `vp run dev` from the repository root and keep
its terminal session. It uses the checkout's ignored `.toolspell` state. Read the real ports and the
`pairingUrl:` line from its output. Never run against `~/.toolspell/userdata` and never add a
server URL to the web bundle.

Test with meaningful workspaces and jobs. Read
[references/sqlite-fixtures.md](references/sqlite-fixtures.md) only when inspecting or seeding
SQLite. Stop the test server before direct fixture writes.

## Drive jobs for free

The dev server uses the fake runner: a job reports four progress steps about 400 ms apart, then
echoes its input. An input containing `fail` fails at 60 percent. Restarting the server mid-job
shows restart recovery: start a job, then touch a file under `apps/server/src` right away (the
watcher restarts about two seconds later, and a job takes about 1.6 seconds). The job fails with
"The server stopped while this job was running."

## Use the Browser panel

Call `preview_status`. If no tab can be automated, call `preview_open` with the dev runner's web
port, including when status reports `available: false` or `tabId: null`. Status can report
unavailable simply because no tab exists yet; opening a tab needs no user action. Stop and explain
the blocker only if the tools are absent or `preview_open` fails.

Navigate to the complete pairing URL once with `preview_navigate`. The app exchanges the token
before the first render and removes it from the address bar. Then use `preview_snapshot` and the
interaction tools. If the token was used or expired (after 10 minutes), mint a fresh one:

```bash
node apps/server/src/bin.ts pair --home-dir .toolspell --web-origin http://localhost:<webPort> --admin
```

Keep using the same tab.

## Drive the desktop app

Run `vp run dev:desktop` from your own shell and keep it running. Check its output for
`[dev-electron] Launch mode: background`; if it says foreground, stop it and do not continue. In
the background the window is never shown and never takes focus, but it renders, and the app pairs
itself. Dialogs, context menus, and external links are written to the log
(`.toolspell/desktop/logs/server.log` and the terminal) instead of appearing. Never pass
`--foreground` without the maintainer's go-ahead.

Drive the window with Playwright over the Chrome DevTools Protocol on `cdpPort` from the
`[dev-runner]` line (the `CDP for agents:` line repeats it). Save a script outside the repository
and run it from `apps/web`, where Playwright is installed:

```js
// node /tmp/drive.mjs <cdpPort>, from apps/web
import { createRequire } from "node:module";
const { chromium } = createRequire(`${process.cwd()}/package.json`)("playwright");
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.argv[2]}`);
const page = browser
  .contexts()[0]
  .pages()
  .find((candidate) => candidate.url().startsWith("http"));
await page.getByRole("link", { name: "Settings" }).click();
await page.screenshot({ path: "/tmp/toolspell-settings.png" });
await browser.close(); // Disconnects; the app keeps running.
```

Do not call `page.bringToFront()` or anything else that raises a window. Save screenshots outside
the repository.

## Verify and retain

Exercise the affected flow and capture the state that proves it works. Keep the server, state, and
panel available while the user inspects or iterates. An assistant turn ending is not teardown. Stop
only processes you started, using retained terminal sessions or captured PIDs, and close tabs you
opened when you are done.

Keep pairing tokens and session cookies out of screenshots, commits, and replies.
