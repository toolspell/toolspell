# Contributing

<!-- Adapted from T3 Code's CONTRIBUTING.md (MIT). -->

Toolspell has very little review capacity. Reviewing a PR usually takes more effort than writing
one, so these rules keep review possible. The most useful contributions are bug reports with a
good repro and focused fixes for bugs you hit yourself.

## Before you write code

- **Bugs** go in [issues](https://github.com/toolspell/toolspell/issues/new/choose), one problem
  per issue.
- **Ideas and features** go in issues too, as a feature request. Wait for a maintainer to agree
  before you open a PR.
- **Security vulnerabilities** never go in public issues or PRs. Follow
  [SECURITY.md](SECURITY.md#report-a-vulnerability).

The cheapest help is closing things: link the original of a duplicate, say when a bug no longer
happens on `main`, and link what superseded a dead PR. A test report on an existing PR beats a
second PR for the same bug.

An issue labeled `needs-more-info` waits on the reporter. A reply removes the label; without one,
the issue closes after 7 days.

## Rules for a PR

These rules apply to every PR from someone without write access, drafts included. A PR that
follows them can still be closed. We do not owe a review or a merge.

<a id="scope"></a>

### Fix a bug, or build what was agreed

A PR fixes a bug, or does what a maintainer agreed to in an issue; link that issue. A crash, a
regression, and a real performance problem are bugs. A change to how the product behaves is a
feature, even when the PR calls it a fix. A small fix for an obvious bug needs no issue.

Not accepted without that agreement: new features, UI overhauls, architecture changes, new
dependencies, and refactors or cleanups on their own. [Vouched contributors](#vouched) can open a
small, focused feature without one.

<a id="one-problem"></a>

### One problem per PR

Fix one problem. Include every change that fix needs across contracts, server, clients, tests, and
docs. Cleanup, refactors, and a second fix go in their own PRs.

<a id="verification"></a>

### Show that it works

Say how you found the bug (or what your change does), how you checked it, and what you saw. "Tests
pass" is not evidence. A logic or protocol bug comes with a test that fails before the fix.

UI changes need before and after screenshots, and a short video when the change is about motion or
timing. Upload them to the PR. Do not commit them.

If a coding agent did the work, say which model and harness at the end of the PR. The rules in
[AGENTS.md](AGENTS.md) apply to its changes too.

<a id="open-pr-limit"></a>

### 3 open PRs per person

You can have 3 open PRs. A fourth is closed when you open it. Get one merged or closed, then open
it again.

<a id="conflict-window"></a>

### Keep your PR mergeable

A PR that conflicts with its base branch gets a `needs-rebase` label and a comment. If it still
conflicts after 7 days with no activity, it is closed.

<a id="vouched"></a>

## Vouched contributors

[.github/VOUCHED.td](.github/VOUCHED.td) lists contributors a maintainer trusts. They are exempt
from the open PR limit and the conflict window, and can open small, focused features without an
agreed issue. Everything else here still applies. Maintainers add people after they have landed
good work; there is no application.

<a id="bans"></a>

## Bans

- If we decide that you spam us with automation, you will be banned.
- If you make reviewing and maintaining harder, you will be banned. Examples are repeated pings, a
  fight over a closure, and a second account to get around a limit.

A banned account is denounced in [.github/VOUCHED.td](.github/VOUCHED.td). Any issue or PR it opens
is closed when it is opened.

<a id="closure-and-reconsideration"></a>

## When your PR is closed

A PR that breaks a rule gets a notice that names the rule and says how to fix it, and a
`triage:closing` label. It closes 72 hours later. A reply or a push in that time sends it back for
another look.

After it is closed, fix the problem and comment on the PR, or open a focused replacement PR that
links the old one.

## Setup

1. Follow the [first checkout](docs/operations/development.md#first-checkout) steps: `vp i`, then
   `vp run dev`.
2. Before you push, run `vp run check:changed`. Maintainers run the full suites before merging.
3. Use a conventional commit title in plain language, such as
   `fix(web): job list no longer flickers on reconnect`, and fill in the PR template.

The [architecture overview](docs/internals/overview.md) explains how Toolspell works, and
[testing](docs/internals/testing.md) says what a good test covers.

## License

By submitting a contribution you agree it is licensed under the MIT License (see
[LICENSE](LICENSE)). There is no CLA and no sign-off.
