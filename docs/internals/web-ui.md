# Web UI

## Primitives

Controls come from [`components/ui`](../../apps/web/src/components/ui): shadcn components on Base
UI. Add one with the shadcn CLI from `apps/web` (`npx shadcn@latest add <name>`); the generated file
is ours to edit afterwards. Each export owns its look. Pick a `variant` or `size`; do not restyle one
with `className`. If none fits and the look is a generic concept, add a variant to the component.
A look that belongs to one feature stays in that feature's component. Layout classes (width, flex,
margin, position) belong on the parent. The shadcn lint rules (`no-restyle`, `no-raw-colors`,
`no-arbitrary-values`, `require-static-classes`, `no-unknown-classes`) enforce this outside
`components/ui`.

Don't style a raw `<button>` or `<input>` to look like a control a primitive provides. Raw elements
are right when the element isn't that control.

## Styles

Style with Tailwind classes and the theme tokens (`bg-muted`, `text-muted-foreground`,
`text-destructive`) in the component that renders the element. Global CSS in
[`styles.css`](../../apps/web/src/styles.css) is only for what classes can't express: theme
variables, generated markup, and browser or Electron integration. No `style={{ ... }}` for static
values a class covers; values computed at runtime are fine.

## State

Views read atoms from [`client-runtime`](../../packages/client-runtime/src/atoms.ts) with
`useAtomValue` and call mutations with `useAtomSet(atom, { mode: "promise" })`. A refreshing atom
keeps its last value, so a reconnect does not flash a loading state. Local, ephemeral UI state
stays in `useState`.

## React Compiler

The compiler memoizes a component or hook only when it can prove the code follows React's rules.
Anything it can't prove makes it skip the whole function without a build error.

Every file under `apps/web/src` must compile. Lint makes those rules errors there, and
`toolspell/no-manual-memo` rejects `useMemo` and `useCallback`, which the compiler makes redundant.
A `use*` helper that calls no hook is compiled as a plain function and caches nothing;
`toolspell/no-hookless-use-function` rejects it. Lint misses some bailouts, notably `try` with
`finally` and `throw` inside `try`, so
[`reactCompilerCoverage.test.ts`](../../apps/web/src/reactCompilerCoverage.test.ts) compiles every
file and fails on any skip. Async handlers rarely need `finally`: settle the promise into a value
with `.then(onSuccess, onFailure)` and continue after the `await`.

## Effects

React effects are for synchronizing with something outside React. Derive in render and act in
handlers instead of syncing state. Work that must happen before the first render, such as
exchanging a pairing token, runs in [`main.tsx`](../../apps/web/src/main.tsx), not in an effect.
