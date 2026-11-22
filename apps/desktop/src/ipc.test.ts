import { assert, describe, it } from "@effect/vitest";

import { isTrustedSender, parseExternalUrl } from "./ipc.ts";

describe("isTrustedSender", () => {
  const webContents = {};
  const appFrame = { url: "http://127.0.0.1:3884/workspaces" };
  const localPage = { url: "data:text/html,Starting" };
  const trust = (mainFrame: object | undefined) =>
    mainFrame && { webContents, mainFrame, origin: "http://127.0.0.1:3884" };

  it("accepts the app in the main window's top frame", () => {
    assert.isTrue(isTrustedSender({ sender: webContents, senderFrame: appFrame }, trust(appFrame)));
  });

  it.each([
    { name: "a subframe", sender: webContents, senderFrame: { ...appFrame }, mainFrame: appFrame },
    { name: "another window", sender: {}, senderFrame: appFrame, mainFrame: appFrame },
    { name: "a destroyed frame", sender: webContents, senderFrame: null, mainFrame: appFrame },
    { name: "a local page", sender: webContents, senderFrame: localPage, mainFrame: localPage },
    { name: "any frame before the window exists", sender: webContents, senderFrame: appFrame },
  ])("rejects $name", ({ sender, senderFrame, mainFrame }) => {
    assert.isFalse(isTrustedSender({ sender, senderFrame }, trust(mainFrame)));
  });
});

describe("parseExternalUrl", () => {
  it.each([
    ["https://example.com/a b", "https://example.com/a%20b"],
    ["http://localhost:3000", "http://localhost:3000/"],
    ["file:///etc/passwd", undefined],
    ["javascript:alert(1)", undefined],
    ["vscode://file/x", undefined],
    ["not a url", undefined],
    [42, undefined],
    [`https://example.com/${"a".repeat(9_000)}`, undefined],
  ])("parses %j", (raw, expected) => {
    assert.strictEqual(parseExternalUrl(raw), expected);
  });
});
