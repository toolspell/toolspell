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

This is a styling and motion guard for `apps/web`, not a general review. Review only the changed lines in the diff and answer three questions. Do not build the project, inspect emitted CSS, trace selector consumers across the codebase, or ask for screenshots. If the diff does not make a violation obvious, there is no finding. Authors read the same rules in `docs/internals/web-ui.md`.

Lint already rejects restyled primitives, raw colors, arbitrary values, non-static class strings, and unknown classes outside `components/ui` (`shadcn/no-restyle`, `no-raw-colors`, `no-arbitrary-values`, `require-static-classes`, `no-unknown-classes`). Do not report those.

## 1. Shared primitives over custom controls

Product UI must use the primitives in `apps/web/src/components/ui` (`Badge`, `Button`, `Card`, `Field`, `Input`, `Label`, `Progress`, `Separator`, and anything added there later) instead of rebuilding them. Files in `components/ui` are the primitives themselves; this section does not apply to them.

- Flag a raw `<button>`, `<input>`, `<select>`, or `<textarea>`, or a `<span>` or `<div>`, styled to look like a control or a primitive when the matching primitive exists.
- When no primitive fits a generic control, the fix is adding it to `components/ui` with the shadcn CLI, or a new `variant` or `size` on an existing one, not a hand-built copy at the call site.
- Do not flag raw elements that are intentionally not a primitive: semantic rows, tabs, resize handles, swatches, editor surfaces, or anything whose behavior or geometry is different by design.

## 2. Tailwind in the owning component, not global CSS

Styling lives as Tailwind classes and theme tokens in the component that renders the element.

- Flag new rules added to `apps/web/src/styles.css` or any other `.css` file when the same styling could be Tailwind classes on the owning component. New global CSS is acceptable only for what classes cannot express: theme variables, generated markup, and browser or Electron integration.
- Flag new `style={{ ... }}` objects or inline `<style>` blocks that carry static values a Tailwind class already covers. Dynamic values computed at runtime are fine.

## 3. What animates

Users notice dropped frames, and continuously repainting animations peg the GPU on high-refresh displays.

- Flag a new animation that repaints without end: `animate-spin`, `animate-pulse`, `animate-ping`, `animate-bounce`, or a CSS animation with `infinite` iteration.
- Flag a transition on a value that updates often, such as width, transform, or a number fed by live events. `transition-all` on a progress indicator, as in `apps/web/src/components/ui/progress.tsx`, restarts on every progress event, and when events arrive faster than the transition the bar never settles. The fix is no transition on that value.
- Do not flag one-shot transitions on interaction or presence: hover, focus, press, open, and close.

## Reporting

Report only violations introduced by changed lines. Post each as a brief inline comment on the relevant line: name the rule, name the primitive or location the code should use instead, and stop. Do not comment on class ordering, aesthetic preference, or untouched legacy code, and do not demand cleanup outside the PR's scope.

When there are no findings, make the entire final response exactly `All clear` on one line with nothing else.
