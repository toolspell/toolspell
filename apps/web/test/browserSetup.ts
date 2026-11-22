// Adapted from T3 Code (https://github.com/pingdotgg/t3code, MIT).
import { beforeEach } from "vite-plus/test";
import { commands } from "vite-plus/test/browser";

declare module "vite-plus/test/browser" {
  interface BrowserCommands {
    /** Defined in vite.config.ts. Moves Playwright's mouse off the page. */
    resetPointer: () => Promise<void>;
  }
}

// Before each test, not after: a timed-out test keeps running and can move the mouse after
// its own afterEach. Registered here rather than in render() so every mount is covered.
beforeEach(async () => {
  await commands.resetPointer();
});
