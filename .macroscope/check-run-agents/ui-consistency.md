---
title: UI Consistency
model: gpt-6-1-sol
reasoning: low
input: incremental
tools:
  - browse_code
  - modify_pr
include:
  - "apps/web/src/**/*.tsx"
  - "apps/web/src/**/*.css"
exclude:
  - "apps/web/src/**/*.test.tsx"
requires:
  - Check
maxBudgetPerRun: 2
maxBudgetPerPR: 10
conclusion: neutral
---

<!-- Adapted from T3 Code's .macroscope/check-run-agents/ui-consistency.md (MIT). -->

# UI consistency review

This is a styling and motion guard for `apps/web`, not a general review. The rules are in `docs/internals/web-ui.md` under `## Primitives`, `## Styles`, `## Motion`, and `## In review`; read those sections first and hold the changed lines to them. Files in `apps/web/src/components/ui` are the primitives themselves; the primitives rule does not apply to them.

Do not build the project, inspect emitted CSS, trace selector consumers across the codebase, or ask for screenshots. If the diff does not make a violation obvious, there is no finding.

Post each finding as a brief inline comment on the relevant line: name the rule, name the primitive or location the code should use instead, and stop.

When there are no findings, make the entire final response exactly `All clear` on one line with nothing else.
