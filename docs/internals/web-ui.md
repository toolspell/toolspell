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

## Themes

Themes are registered in [`theme.ts`](../../apps/web/src/theme.ts) with an id, label,
appearance, and chrome color, and a new one shows up in Settings without touching components.
Their tokens live in `styles.css`: light's in `:root`, dark's in `.dark`, and any other theme's in
a `:root[data-theme="<id>"]` block that overrides its appearance's base. A new token goes in both
`:root` and `.dark`, as the status tokens (`success`, `warning`, `info`, `destructive`) do.
Components use tokens and the `dark:` variant only, never a theme id.

The inline script in [`index.html`](../../apps/web/index.html) applies the stored theme before the
first paint. It keeps its own copy of each theme's appearance and chrome color, and
[`theme.test.ts`](../../apps/web/src/theme.test.ts) fails when that copy and the registry disagree.
The server's Content-Security-Policy allows inline scripts only by the hash of what `index.html`
ships, and it hashes only `<script>` tags without attributes, so an inline script there must have
none.

The theme preference is a device preference: per browser, not per server. Device preferences are
entries in [`preferences.ts`](../../packages/client-runtime/src/preferences.ts), each its own
storage key with a schema and a default, so a value that no longer decodes resets only itself.
Read them through their atoms, never from `localStorage` directly.

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
