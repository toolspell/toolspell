import { defineConfig } from "vite-plus";

const TEST_EXCLUDE = [
  "**/.toolspell/**",
  "**/.t3/**",
  "**/node_modules/**",
  "**/dist/**",
  "**/dist-electron/**",
  "**/.{idea,git,cache,output,temp}/**",
];

const GENERATED = ["**/routeTree.gen.ts"];

export default defineConfig({
  run: {
    cache: true,
  },
  test: {
    environment: "node",
    exclude: TEST_EXCLUDE,
    allowOnly: !process.env.CI,
    // Flaky tests are fixed, not retried.
    retry: 0,
  },
  staged: {
    // In order, so lint reads the formatted file.
    "*": ["vp fmt --no-error-on-unmatched-pattern", "vp lint --no-error-on-unmatched-pattern"],
  },
  fmt: {
    ignorePatterns: [
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
    ignorePatterns: ["dist", "dist-electron", "node_modules", "pnpm-lock.yaml", ...GENERATED],
    plugins: ["eslint", "oxc", "react", "unicorn", "typescript"],
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      "./oxlint-plugin-toolspell/index.ts",
    ],
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
      "react-in-jsx-scope": "off",
      "react-hooks/exhaustive-deps": "off",
      "react/jsx-no-constructed-context-values": "off",
      "eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "eslint/no-new": "error",
      "eslint/no-shadow": "off",
      "eslint/no-await-in-loop": "off",
      "eslint/no-underscore-dangle": "off",
      "unicorn/consistent-function-scoping": "off",
      "unicorn/no-array-sort": "off",
      "typescript/no-extraneous-class": "error",
      "toolspell/namespace-node-imports": "error",
      "toolspell/no-polling-loop-in-tests": "error",
      "toolspell/no-real-time-wait-in-tests": "error",
      "toolspell/no-test-timeout-or-unreasoned-skip": "error",
      "toolspell/no-wall-clock-in-tests": "error",
      "toolspell/prefer-effect-fn": "error",
      "toolspell/require-suppression-reason": "error",
    },
    overrides: [
      {
        files: ["**/*.{test,testkit}.{ts,tsx}", "**/{test,testkit,testing,fixtures}/**"],
        rules: { "toolspell/prefer-effect-fn": "off" },
      },
      {
        files: ["apps/web/src/**", "apps/desktop/src/**"],
        rules: { "toolspell/no-unreasoned-state-sync": "error" },
      },
      {
        // Lint rules and dev scripts are plain Node programs, not Effect services.
        files: ["oxlint-plugin-toolspell/**", "scripts/**"],
        rules: { "toolspell/prefer-effect-fn": "off" },
      },
    ],
  },
});
