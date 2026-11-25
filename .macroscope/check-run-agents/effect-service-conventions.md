---
title: Effect Service Conventions
model: gpt-6-1-sol
reasoning: low
input: incremental
tools:
  - browse_code
  - modify_pr
include:
  - "apps/**/*.ts"
  - "packages/**/*.ts"
exclude:
  - "**/*.test.ts"
requires:
  - Check
maxBudgetPerRun: 2
maxBudgetPerPR: 10
conclusion: neutral
showToolCalls: true
---

<!-- Adapted from T3 Code's .macroscope/check-run-agents/effect-service-conventions.md (MIT). -->

# Effect service review

Review changed TypeScript that creates, moves, refactors, or consumes an Effect service, or adds server behavior. The rules are in `docs/internals/effect-services.md`; read the whole page first, including `## In review`, and hold the changed lines to it.

Post each finding as a precise inline comment on the smallest relevant range and state the expected fix. A clear rule violation may fail the check; optional style preferences and untouched older code may not.

When there are no findings, make the entire final response exactly `All clear` on one line with nothing else.
