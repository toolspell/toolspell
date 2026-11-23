import { defineConfig } from "vite-plus";

const TEST_EXCLUDE = [
  "**/.repos/**",
  "**/.reference-apps/**",
  "**/.toolspell/**",
  "**/.t3/**",
  "**/node_modules/**",
  "**/dist/**",
  "**/dist-electron/**",
  "**/.{idea,git,cache,output,temp}/**",
];

// Directories whose tests belong to the package's own vite.config.ts.
const TEST_CONFIG_PACKAGES = ["apps/desktop", "apps/server", "apps/web"];

// `vp test run <file>` from the repo root hands each file to its package's config. Packages
// that borrow this config (`--config ../../vite.config.ts`) run from their own directory, as
// CI does, so they keep one plain project. Adapted from T3 Code (MIT).
const isRepoRootTestRun = process.cwd() === import.meta.dirname;

const GENERATED = ["**/routeTree.gen.ts"];

const RESTRICTED_UI_VARIANT_PATTERNS = [
  {
    group: ["**/components/ui/*", "**/ui/*", "./ui/*"],
    importNames: ["buttonVariants", "toggleVariants", "badgeVariants", "selectTriggerVariants"],
    message:
      "Render the components/ui component instead of borrowing its class recipe, such as render={<Button />}.",
  },
];

export default defineConfig({
  run: {
    // Scripts opt in with `vp run --cache`; cached tasks only see allow-listed env vars,
    // which would hide the dev runner's TOOLSPELL_* settings from dev servers.
    cache: { scripts: false },
  },
  test: {
    environment: "node",
    exclude: TEST_EXCLUDE,
    allowOnly: !process.env.CI,
    // Flaky tests are fixed, not retried.
    retry: 0,
    ...(isRepoRootTestRun
      ? {
          projects: [
            ...TEST_CONFIG_PACKAGES,
            {
              extends: true,
              test: {
                name: "root",
                exclude: [...TEST_EXCLUDE, ...TEST_CONFIG_PACKAGES.map((dir) => `${dir}/**`)],
              },
            },
          ],
        }
      : {}),
  },
  staged: {
    // In order, so lint reads the formatted file. Committed reference sources (`.repos`) match
    // nothing, so a dependency bump commits them without formatting or linting thousands of files.
    "{*,!(.repos)/**}": [
      "vp fmt --no-error-on-unmatched-pattern",
      "vp lint --no-error-on-unmatched-pattern",
      "node scripts/check-naming.ts",
      "node scripts/check-pinned.ts",
      "node scripts/check-secrets.ts --staged",
    ],
  },
  fmt: {
    ignorePatterns: [
      ".repos",
      ".reference-apps",
      // Macroscope requires one glob per line; Markdown formatting corrupts it.
      ".macroscope/ignore.md",
      "dist",
      "dist-electron",
      "node_modules",
      "pnpm-lock.yaml",
      "*.tsbuildinfo",
      ...GENERATED,
    ],
    sortPackageJson: {},
  },
  lint: {
    ignorePatterns: [
      ".repos",
      ".reference-apps",
      "dist",
      "dist-electron",
      "node_modules",
      "pnpm-lock.yaml",
      ...GENERATED,
    ],
    plugins: ["eslint", "oxc", "react", "unicorn", "typescript"],
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      "./oxlint-plugin-toolspell/index.ts",
      "@shadcn/lint",
    ],
    settings: {
      shadcn: { ui: "~/components/ui" },
    },
    categories: {
      correctness: "warn",
      suspicious: "warn",
      perf: "warn",
    },
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      "oxc/no-accumulating-spread": "error",
      "react/purity": "error",
      "react/refs": "error",
      "react/exhaustive-effect-dependencies": "error",
      "react/set-state-in-effect": "error",
      "react/immutability": "error",
      "react/no-array-index-key": "error",
      "react/no-unstable-nested-components": "error",
      "react/static-components": "error",
      "react/capitalized-calls": "error",
      "react-in-jsx-scope": "off",
      "react-hooks/exhaustive-deps": "off",
      "react/jsx-no-constructed-context-values": "off",
      "eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "eslint/no-empty-pattern": "error",
      "eslint/no-new": "error",
      "eslint/no-unsafe-optional-chaining": "error",
      "eslint/no-unneeded-ternary": "error",
      "eslint/no-shadow": "off",
      "eslint/no-await-in-loop": "off",
      "eslint/no-underscore-dangle": "off",
      "unicorn/consistent-function-scoping": "off",
      "unicorn/no-array-sort": "off",
      "unicorn/no-useless-spread": "error",
      "unicorn/no-useless-fallback-in-spread": "error",
      "unicorn/require-module-specifiers": "error",
      "typescript/no-extraneous-class": "error",
      "toolspell/namespace-node-imports": "error",
      "toolspell/no-inline-schema-compile": "error",
      "toolspell/no-low-value-comments": "error",
      "toolspell/no-manual-effect-runtime-in-tests": "error",
      "toolspell/no-polling-loop-in-tests": "error",
      "toolspell/no-real-time-wait-in-tests": "error",
      "toolspell/no-test-in-loop": "error",
      "toolspell/no-test-timeout-or-unreasoned-skip": "error",
      "toolspell/no-wall-clock-in-tests": "error",
      "toolspell/prefer-catch-tags": "error",
      "toolspell/prefer-effect-fn": "error",
      "toolspell/require-suppression-reason": "error",
    },
    overrides: [
      {
        files: ["**/*.{test,testkit}.{ts,tsx}", "**/{test,testkit,testing,fixtures}/**"],
        rules: { "toolspell/prefer-effect-fn": "off" },
      },
      {
        files: ["apps/web/**/*.test.{ts,tsx}"],
        rules: { "toolspell/require-disposable-render": "error" },
      },
      {
        files: ["apps/web/src/**/*.browser.test.{ts,tsx}"],
        rules: { "toolspell/no-frame-waits-in-browser-tests": "error" },
      },
      {
        files: ["apps/**/src/**", "packages/**/src/**"],
        rules: { "toolspell/no-dom-test-environment": "error" },
      },
      {
        files: ["apps/web/src/**", "apps/desktop/src/**"],
        rules: { "toolspell/no-unreasoned-state-sync": "error" },
      },
      {
        // React Compiler owns memoization; upstream rules do not ban redundant useMemo/useCallback.
        files: ["apps/web/src/**/*.{ts,tsx}"],
        rules: {
          "react/globals": "error",
          "react/hooks": "error",
          "react/memo-dependencies": "error",
          "react/preserve-manual-memoization": "error",
          "react/set-state-in-render": "error",
          "react/unsupported-syntax": "error",
          "toolspell/no-manual-memo": "error",
        },
      },
      {
        // React Compiler caches use* functions only if they call a hook.
        files: ["apps/web/src/**/*.{ts,tsx}"],
        excludeFiles: ["**/*.test.ts", "**/*.test.tsx"],
        rules: { "toolspell/no-hookless-use-function": "error" },
      },
      {
        files: ["apps/web/src/**"],
        rules: {
          "shadcn/no-unknown-classes": "error",
          "shadcn/no-raw-colors": "error",
          "toolspell/no-costly-motion": "error",
        },
      },
      {
        // components/ui exports own their look; everything else picks a variant or size.
        files: ["apps/web/src/**"],
        excludeFiles: ["apps/web/src/components/ui/**"],
        rules: {
          "shadcn/require-static-classes": "error",
          "shadcn/no-arbitrary-values": "error",
          "shadcn/no-restyle": ["error", { allow: ["layout"] }],
          "eslint/no-restricted-imports": ["error", { patterns: RESTRICTED_UI_VARIANT_PATTERNS }],
        },
      },
      {
        files: ["apps/*/src/**", "packages/*/src/**"],
        excludeFiles: ["**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}", "**/testkit.ts"],
        rules: { "toolspell/no-em-dash-copy": "error" },
      },
      {
        // Lint rules and dev scripts are plain Node programs, not Effect services.
        files: ["oxlint-plugin-toolspell/**", "scripts/**"],
        rules: { "toolspell/prefer-effect-fn": "off" },
      },
    ],
  },
});
