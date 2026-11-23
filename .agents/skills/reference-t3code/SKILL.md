---
name: reference-t3code
description: Learn from T3 Code, the battle-proven app Toolspell grew from, before designing something it has likely solved. Use for the Electron desktop shell and server supervision, platform quirks (macOS, Windows, Linux), pairing and auth, connections and reconnects, CI and release tooling, packaging, and agent tooling.
---

# Reference: T3 Code

T3 Code is a reference, not a template. Read how it solved a problem, then decide for Toolspell.

## Get the source

- Fetch it into the gitignored `.reference-apps/t3code` with `vp run sync:repos --app t3code`. A
  worktree copies the main checkout's copy when it is at the same commit; otherwise this downloads
  a sparse checkout of the pinned commit.
- Or read it on GitHub at the pinned commit: `https://github.com/pingdotgg/t3code/tree/<commit>`,
  with the commit from the `t3code` entry in `scripts/sync-repos.ts`.
- To move to a newer T3 Code, re-pin that commit in `scripts/sync-repos.ts`.

## How to use it

1. Start at its `docs/internals` and the files they link, not at a code search.
2. Adopt its approach when it fits Toolspell's size. Otherwise pick a simpler or better one and say
   why.
3. Never copy its feature scope or names, such as `t3` or `T3CODE_*`.
4. Credit every adapted file in its header: `Adapted from T3 Code (MIT).`
