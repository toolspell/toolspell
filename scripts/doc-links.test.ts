// Relative links and anchors break silently when a file moves or a heading is renamed, and the
// bot comments in .github/scripts link to CONTRIBUTING.md anchors. This checks them all.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

const root = NodePath.dirname(import.meta.dirname);
const REPO_URL = "https://github.com/toolspell/toolspell";

const files = NodeChildProcess.execFileSync(
  "git",
  // Vendored references link within their own upstream, so their links are not ours.
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: root, encoding: "utf8" },
)
  .split("\0")
  .filter(
    (file) =>
      file !== "" &&
      !/^\.(repos|reference-apps)\//.test(file) &&
      NodeFS.lstatSync(NodePath.join(root, file), { throwIfNoEntry: false })?.isFile() === true,
  );

const mdLinkPattern = /\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g;
const inlineCodePattern = /`[^`]*`/g;
const ownUrlPattern = /https:\/\/github\.com\/toolspell\/toolspell[^\s"'`)<>\]]*/g;
const schemePattern = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const headingPattern = /^ {0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/;
const htmlAnchorPattern = /<a\s+(?:id|name)="([^"]+)"/g;
const contextRepoPattern = /\$\{context\.repo\.owner\}\/\$\{context\.repo\.repo\}/g;
const guideLinkBasePattern = /function guideLink\([^`]*`([^`#]*)#\$\{anchor\}`/;
const guideLinkCallPattern = /guideLink\(context, "([^"]+)"\)/g;

// Repository pages GitHub serves that no file in the tree backs, linked on purpose.
const GITHUB_PAGES = new Set(["/issues/new/choose", "/security/advisories/new", ".git"]);

const isFence = (line: string) => /^\s*(```|~~~)/.test(line);
const read = (file: string) => NodeFS.readFileSync(NodePath.join(root, file), "utf8");

// GitHub's rule: lowercase, keep letters, digits, '-' and '_', turn each space into '-'.
const headingSlug = (heading: string) =>
  heading
    .trim()
    .toLowerCase()
    .replaceAll(" ", "-")
    .replaceAll(/[^\p{L}\p{Nd}_-]/gu, "");

const anchorCache = new Map<string, Set<string>>();
const headingAnchors = (file: string) => {
  const cached = anchorCache.get(file);
  if (cached) return cached;
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  let inFence = false;
  for (const line of read(file).split("\n")) {
    if (isFence(line)) inFence = !inFence;
    if (inFence) continue;
    // CONTRIBUTING.md pins anchors the bot comments link to, so a heading can be reworded.
    for (const [, id = ""] of line.matchAll(htmlAnchorPattern)) anchors.add(id);
    const match = headingPattern.exec(line);
    if (!match) continue;
    const slug = headingSlug(match[1] ?? "");
    const count = seen.get(slug) ?? 0;
    anchors.add(count > 0 ? `${slug}-${count}` : slug);
    seen.set(slug, count + 1);
  }
  anchorCache.set(file, anchors);
  return anchors;
};

const checkTarget = (dest: string, anchor: string): string | undefined => {
  if (dest === ".." || dest.startsWith("../")) return "points outside the repository";
  const full = NodePath.join(root, dest);
  if (!NodeFS.existsSync(full)) return "file not found";
  // A template such as `#${anchor}` names its anchor at the call site.
  if (anchor === "" || anchor.includes("${")) return undefined;
  if (NodeFS.statSync(full).isDirectory() || !dest.endsWith(".md")) {
    return "anchor on a non-markdown target";
  }
  if (!headingAnchors(dest).has(anchor)) return `no heading with anchor #${anchor} in ${dest}`;
  return undefined;
};

const checkOwnUrl = (url: string): string | undefined => {
  const [rest = "", anchor = ""] = url.slice(REPO_URL.length).split("#", 2);
  if (rest === "" || rest === "/")
    return checkTarget("README.md", anchor === "readme" ? "" : anchor);
  const file = /^\/(?:blob|tree)\/main\/(.+)$/.exec(rest)?.[1];
  if (file !== undefined) return checkTarget(NodePath.posix.normalize(file), anchor);
  return GITHUB_PAGES.has(rest) ? undefined : "unsupported GitHub URL form";
};

const checkRelative = (from: string, target: string): string | undefined => {
  const [ref = "", anchor = ""] = target.split("#", 2);
  let decoded: string;
  try {
    decoded = decodeURIComponent(ref);
  } catch {
    return "bad escape";
  }
  const dest = decoded === "" ? from : NodePath.posix.join(NodePath.posix.dirname(from), decoded);
  return checkTarget(dest, anchor);
};

const findProblems = () => {
  const problems: Array<string> = [];
  const report = (where: string, target: string, reason: string | undefined) => {
    if (reason !== undefined) problems.push(`${where}: ${target}: ${reason}`);
  };
  for (const file of files) {
    // Tests carry deliberately fake links and URLs as fixtures.
    if (/\.test\.tsx?$/.test(file)) continue;
    const text = read(file);
    if (text.includes("\0")) continue;
    const isMarkdown = file.endsWith(".md");
    const guideLinkBase = guideLinkBasePattern.exec(
      text.replaceAll(contextRepoPattern, "toolspell/toolspell"),
    )?.[1];
    let inFence = false;
    for (const [index, rawLine] of text.split("\n").entries()) {
      const where = `${file}:${index + 1}`;
      const line = rawLine.replaceAll(contextRepoPattern, "toolspell/toolspell");
      for (const [url] of line.matchAll(ownUrlPattern)) {
        const trimmed = url.replace(/[.,;:]+$/, "");
        report(where, trimmed, checkOwnUrl(trimmed));
      }
      if (guideLinkBase !== undefined) {
        for (const [, anchor] of line.matchAll(guideLinkCallPattern)) {
          const url = `${guideLinkBase}#${anchor}`;
          report(where, url, checkOwnUrl(url));
        }
      }
      if (!isMarkdown) continue;
      if (isFence(line)) inFence = !inFence;
      if (inFence) continue;
      for (const [, target = ""] of line
        .replaceAll(inlineCodePattern, "")
        .matchAll(mdLinkPattern)) {
        if (!schemePattern.test(target)) report(where, target, checkRelative(file, target));
      }
    }
  }
  return problems;
};

describe("doc links", () => {
  it("resolves every relative link, anchor and own GitHub URL", () => {
    expect(findProblems(), "Fix or remove these links").toEqual([]);
  });

  it.each([
    ["5. Run the service on port 443", "5-run-the-service-on-port-443"],
    ["Shared `dev.azure.com` hostname", "shared-devazurecom-hostname"],
    ["Request bodies, headers and output", "request-bodies-headers-and-output"],
    ["Closure and reconsideration", "closure-and-reconsideration"],
  ])("slugs %j as GitHub does", (heading, slug) => {
    expect(headingSlug(heading)).toBe(slug);
  });

  it.each([
    [REPO_URL, true],
    [`${REPO_URL}#readme`, true],
    [`${REPO_URL}.git`, true],
    [`${REPO_URL}/blob/main/SECURITY.md`, true],
    [`${REPO_URL}/blob/main/CONTRIBUTING.md#bans`, true],
    [`${REPO_URL}/blob/main/CONTRIBUTING.md#rules-for-a-pr`, true],
    [`${REPO_URL}/blob/main/CONTRIBUTING.md#no-such-heading`, false],
    [`${REPO_URL}/blob/main/no-such-file.md`, false],
    [`${REPO_URL}/tree/main/docs`, true],
    [`${REPO_URL}/issues/new/choose`, true],
    [`${REPO_URL}/security/advisories/new`, true],
    [`${REPO_URL}/issues/12345`, false],
    [`${REPO_URL}/pulls`, false],
    [`${REPO_URL}/blob/feature/SECURITY.md`, false],
  ])("checks %s (ok: %s)", (url, ok) => {
    expect(checkOwnUrl(url) === undefined).toBe(ok);
  });
});
