// The helpers in .github/scripts run inside actions/github-script, where a mistake closes the
// wrong PR or labels the wrong author. Their decisions are tested here, without GitHub.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { readLabels } from "../.github/scripts/labels.cjs";
import {
  CLOSING_LABEL,
  KEEP_OPEN_LABEL,
  REBASE_LABEL,
  decide,
  otherOpenPullRequests,
} from "../.github/scripts/pr-limits.cjs";
import {
  SIZES,
  countTestDelta,
  effectiveLines,
  render,
  sizeLabel,
  sumNumstat,
} from "../.github/scripts/pr-size.cjs";
import { titleProblem } from "../.github/scripts/pr-title.cjs";
import {
  LABELS,
  closesOnOpen,
  labelFor,
  parseVouchList,
  trustOf,
} from "../.github/scripts/vouch.cjs";

const root = NodePath.dirname(import.meta.dirname);
const read = (file: string) => NodeFS.readFileSync(NodePath.join(root, file), "utf8");
const context = { repo: { owner: "toolspell", repo: "toolspell" } };

describe("labels.json", () => {
  it("defines every label the scripts, templates, workflows and docs name, once each", () => {
    const labels = readLabels() as ReadonlyArray<{
      name: string;
      color: string;
      description: string;
    }>;
    const defined = labels.map((label) => label.name);
    expect(new Set(defined).size).toBe(defined.length);
    for (const label of labels) {
      expect(label.color).toMatch(/^[0-9a-f]{6}$/);
      // GitHub rejects longer descriptions.
      expect(label.description.length).toBeLessThanOrEqual(100);
    }

    const templates = NodeFS.readdirSync(NodePath.join(root, ".github/ISSUE_TEMPLATE"))
      .filter((file) => file !== "config.yml")
      .flatMap((file) => {
        const block = /^labels:\n((?:\s+- .+\n)+)/m.exec(read(`.github/ISSUE_TEMPLATE/${file}`));
        return [...(block?.[1] ?? "").matchAll(/- (.+)/g)].map((match) => match[1]!.trim());
      });
    const stale = /only-issue-labels: (.+)/.exec(
      read(".github/workflows/stale-needs-more-info.yml"),
    );
    const docs = ["CONTRIBUTING.md", ".agents/skills/contribution-triage/SKILL.md"].flatMap(
      (file) =>
        [...read(file).matchAll(/`((?:vouch|triage|size):[\w-]+|needs-[\w-]+)`/g)].map(
          (m) => m[1]!,
        ),
    );
    const applied = [
      ...Object.values(LABELS),
      CLOSING_LABEL,
      KEEP_OPEN_LABEL,
      REBASE_LABEL,
      ...SIZES.map((size) => size.label),
      ...templates,
      stale?.[1],
      ...docs,
    ];
    expect(templates).toContain("needs-triage");
    expect(applied.filter((name) => !defined.includes(name!))).toEqual([]);
  });
});

describe("vouch", () => {
  it("parses vouched and denounced logins case-insensitively and skips comments", () => {
    const list = parseVouchList(
      "# header\n\ngithub:Alice\n-github:Mallory Filed 200 automated issues\n  github:bob-2  \n",
    );
    expect([...list.vouched]).toEqual(["alice", "bob-2"]);
    expect([...list.denounced]).toEqual(["mallory"]);
    expect(parseVouchList("# no entries yet\n").vouched.size).toBe(0);
  });

  it.each(["alice", "gitlab:alice", "github:-alice", "github:"])(
    "fails closed on the malformed line %j",
    (line) => {
      expect(() => parseVouchList(`github:bob\n${line}\n`)).toThrow(/malformed/);
    },
  );

  it("refuses a login listed both ways", () => {
    expect(() => parseVouchList("github:alice\n-github:ALICE spam\n")).toThrow(/both/);
  });

  const github = (permission: string | number) => ({
    rest: {
      repos: {
        getCollaboratorPermissionLevel: async () => {
          if (typeof permission === "number")
            throw Object.assign(new Error("http"), { status: permission });
          return { data: { permission } };
        },
      },
    },
  });
  const list = parseVouchList("github:vouched\n-github:denounced spam\n");

  it.each([
    { login: "dependabot[bot]", type: "Bot", permission: "none", trust: "bot" },
    { login: "denounced", type: "User", permission: "write", trust: "collaborator" },
    { login: "someone", type: "User", permission: "maintain", trust: "collaborator" },
    { login: "someone", type: "User", permission: "admin", trust: "collaborator" },
    { login: "Denounced", type: "User", permission: "read", trust: "denounced" },
    { login: "vouched", type: "User", permission: "triage", trust: "vouched" },
    { login: "someone", type: "User", permission: "read", trust: "unvouched" },
    { login: "ghost", type: "User", permission: 404, trust: "unvouched" },
  ])(
    "reads $login with $permission access as $trust",
    async ({ login, type, permission, trust }) => {
      const user = { login, type };
      expect(await trustOf({ github: github(permission), context, list, user })).toBe(trust);
    },
  );

  it("stops instead of guessing when the permission lookup fails", async () => {
    const user = { login: "someone", type: "User" };
    await expect(trustOf({ github: github(502), context, list, user })).rejects.toThrow();
  });

  it("labels every PR but only trusted or denounced issue authors", () => {
    expect(labelFor("unvouched", true)).toBe("vouch:unvouched");
    expect(labelFor("unvouched", false)).toBeUndefined();
    expect(labelFor("collaborator", false)).toBe("vouch:trusted");
    expect(labelFor("bot", true)).toBe("vouch:trusted");
    expect(labelFor("denounced", false)).toBe("vouch:denounced");
  });

  it("closes only what was just opened, or reopened by its author", () => {
    const item = { user: { login: "Mallory" } };
    const event = (eventName: string, action: string, sender = "mallory") => ({
      ...context,
      eventName,
      payload: { action, sender: { login: sender } },
    });
    expect(closesOnOpen(event("issues", "opened"), item)).toBe(true);
    expect(closesOnOpen(event("pull_request_target", "reopened"), item)).toBe(true);
    expect(closesOnOpen(event("issues", "reopened", "maintainer"), item)).toBe(false);
    expect(closesOnOpen(event("pull_request_target", "synchronize"), item)).toBe(false);
    expect(closesOnOpen(event("push", "opened"), item)).toBe(false);
  });
});

describe("pr-limits", () => {
  const now = Date.parse("2026-11-22T12:00:00Z");
  const hoursAgo = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
  const pr = (options: {
    labels: ReadonlyArray<string>;
    mergeable?: string;
    updated: number;
    labeled?: number;
  }) => ({
    mergeable: options.mergeable ?? "MERGEABLE",
    updatedAt: hoursAgo(options.updated),
    labels: { nodes: options.labels.map((name) => ({ name })) },
    timelineItems: {
      nodes:
        options.labeled === undefined
          ? []
          : [{ createdAt: hoursAgo(options.labeled), label: { name: CLOSING_LABEL } }],
    },
  });
  const unvouched = LABELS.unvouched;

  it.each([
    {
      name: "keep-open wins",
      pr: pr({ labels: [KEEP_OPEN_LABEL, CLOSING_LABEL], updated: 100 }),
      action: "skip",
    },
    {
      name: "notice without a label event",
      pr: pr({ labels: [CLOSING_LABEL], updated: 100 }),
      action: "unknown-notice",
    },
    {
      name: "activity after the notice",
      pr: pr({ labels: [CLOSING_LABEL], updated: 10, labeled: 80 }),
      action: "clear-notice",
    },
    {
      name: "notice younger than 72 hours",
      pr: pr({ labels: [CLOSING_LABEL], updated: 71, labeled: 71 }),
      action: "skip",
    },
    {
      name: "notice 72 hours old",
      pr: pr({ labels: [CLOSING_LABEL], updated: 72, labeled: 72 }),
      action: "close-notice",
    },
    {
      name: "unvouched conflict",
      pr: pr({ labels: [unvouched], mergeable: "CONFLICTING", updated: 1 }),
      action: "request-rebase",
    },
    {
      name: "trusted conflict",
      pr: pr({ labels: [LABELS.trusted], mergeable: "CONFLICTING", updated: 1 }),
      action: "skip",
    },
    {
      name: "rebased",
      pr: pr({ labels: [unvouched, REBASE_LABEL], updated: 1 }),
      action: "clear-rebase",
    },
    {
      name: "vouched since the request",
      pr: pr({ labels: [REBASE_LABEL], mergeable: "CONFLICTING", updated: 200 }),
      action: "clear-rebase",
    },
    {
      name: "idle 7 days in conflict",
      pr: pr({ labels: [unvouched, REBASE_LABEL], mergeable: "CONFLICTING", updated: 168 }),
      action: "close-conflict",
    },
    {
      name: "idle 6 days in conflict",
      pr: pr({ labels: [unvouched, REBASE_LABEL], mergeable: "CONFLICTING", updated: 144 }),
      action: "skip",
    },
    {
      name: "mergeability unknown",
      pr: pr({ labels: [unvouched, REBASE_LABEL], mergeable: "UNKNOWN", updated: 200 }),
      action: "skip",
    },
  ])("$name: $action", ({ pr, action }) => {
    expect(decide(pr, now)).toBe(action);
  });

  it("counts only older PRs against a new one, and every other PR against a reopened one", () => {
    expect(otherOpenPullRequests([3, 5, 7, 9], { number: 7 }, false)).toEqual([3, 5]);
    expect(otherOpenPullRequests([3, 5, 7, 9], { number: 7 }, true)).toEqual([3, 5, 9]);
  });
});

describe("pr-size", () => {
  it.each([
    [0, "size:XS"],
    [9, "size:XS"],
    [10, "size:S"],
    [99, "size:M"],
    [100, "size:L"],
    [999, "size:XL"],
    [1000, "size:XXL"],
  ])("labels %i effective lines %s", (lines, label) => {
    expect(sizeLabel(lines)).toBe(label);
  });

  it("sums numstat with binary files as zero, and sizes test-only PRs by their tests", () => {
    expect(sumNumstat("3\t2\ta.ts\n-\t-\tlogo.png\n10\t0\tb.ts\n")).toBe(15);
    expect(effectiveLines(120, 20)).toBe(20);
    expect(effectiveLines(120, 0)).toBe(120);
  });

  const diff = `diff --git a/apps/web/src/Panel.browser.test.tsx b/apps/web/src/Panel.browser.test.tsx
new file mode 100644
--- /dev/null
+++ b/apps/web/src/Panel.browser.test.tsx
@@ -0,0 +1,4 @@
+it("opens", async () => {});
+  it.each<{ n: number }>([{ n: 1 }])("renders $n", async () => {});
+// it("is a comment, still counted only when it starts the line")
diff --git a/apps/server/src/thing.test.ts b/apps/server/src/thing.test.ts
--- a/apps/server/src/thing.test.ts
+++ b/apps/server/src/thing.test.ts
@@ -3,2 +3,1 @@
-it.effect("old", () => {});
-test("older", () => {});
+  it.effect("new", () => {});
diff --git a/packages/contracts/src/gone.test.ts b/packages/contracts/src/gone.test.ts
deleted file mode 100644
--- a/packages/contracts/src/gone.test.ts
+++ /dev/null
@@ -1,1 +0,0 @@
-it("goes", () => {});
diff --git a/apps/web/src/Menu.test.tsx b/apps/web/src/Menu.browser.test.tsx
similarity index 100%
rename from apps/web/src/Menu.test.tsx
rename to apps/web/src/Menu.browser.test.tsx
diff --git a/apps/web/src/Old.browser.test.tsx b/apps/web/src/New.browser.test.tsx
similarity index 100%
rename from apps/web/src/Old.browser.test.tsx
rename to apps/web/src/New.browser.test.tsx
diff --git a/apps/web/src/Panel.tsx b/apps/web/src/Panel.tsx
--- a/apps/web/src/Panel.tsx
+++ b/apps/web/src/Panel.tsx
@@ -1 +1 @@
+it("is not a test file", () => {});
`;

  it("counts test cases by kind, including deleted files, and finds new or renamed browser files", () => {
    expect(countTestDelta(diff)).toEqual({
      kinds: { browser: 2, server: -1, unit: -1 },
      net: 0,
      newBrowserFiles: [
        "apps/web/src/Panel.browser.test.tsx",
        "apps/web/src/Menu.browser.test.tsx",
      ],
    });
  });

  it("comments only on growth worth a reviewer's attention", () => {
    const quiet = { kinds: { browser: 0, server: 3, unit: 5 }, net: 8, newBrowserFiles: [] };
    expect(render(quiet, "toolspell/toolspell")).toBeNull();
    const growth = { kinds: { browser: 4, server: 10, unit: 12 }, net: 26, newBrowserFiles: [] };
    expect(render(growth, "toolspell/toolspell")).toMatch(
      /\*\*\+26 test cases\*\* \(browser \+4, unit \+12, server \+10\)/,
    );
    expect(render(countTestDelta(diff), "toolspell/toolspell")).toMatch(
      /New browser test files: `apps\/web\/src\/Panel\.browser\.test\.tsx`/,
    );
  });
});

describe("pr-title", () => {
  it.each([
    ["fix: crash on reconnect", true],
    ["feat(web): job list", true],
    ["chore(web,desktop): trim comments", true],
    ["feat(server)!: drop the v1 API", true],
    ["chore(deps): bump vite from 8.0.1 to 8.0.2", true],
    ["Fix: crash on reconnect", false],
    ["fix crash on reconnect", false],
    ["fix:crash on reconnect", false],
    ["fix(): crash on reconnect", false],
    ["fix(web, desktop): crash", false],
    ["wip(web): crash", false],
    ["Bump vite from 8.0.1 to 8.0.2", false],
    ['Revert "fix: crash on reconnect"', false],
  ])("%s passes: %s", (title, passes) => {
    expect(titleProblem(title) === undefined).toBe(passes);
  });
});
