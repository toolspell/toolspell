// Adapted from T3 Code's .coderabbit.config.ts (MIT).
import { defineConfig, type CodeRabbitContext } from "@coderabbitai/config";

const UNGATED_AUTHORS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const isGated = ({ pr }: CodeRabbitContext) => !UNGATED_AUTHORS.has(pr?.authorAssociation ?? "");

const AUTH_PATHS = ["apps/server/src/auth/**", "packages/contracts/src/{auth,rpc}.ts"];
const AUTH_DOCS = ["SECURITY.md", "docs/internals/environment-auth.md"];

export default defineConfig((ctx) => ({
  reviews: {
    high_level_summary: false,
    review_status: false,
    request_changes_workflow: false,
    allow_author_approval: !isGated(ctx),
    auto_review: {
      enabled: true,
    },
    pre_merge_checks: {
      // The factory overload of defineConfig widens this literal to string otherwise.
      docstrings: { mode: "off" as const },
      override_requested_reviewers_only: isGated(ctx),
    },
    path_filters: ["!.repos/**", "!.toolspell/**"],
    path_instructions: [
      {
        path: "{apps,packages}/**/*.ts",
        instructions: "Hold changed code to the rules in docs/internals/effect-services.md.",
      },
      {
        path: "apps/web/src/**/*.{tsx,css}",
        instructions: "Hold changed code to the rules in docs/internals/web-ui.md.",
      },
      {
        path: "**/*.test.*",
        instructions:
          "Hold changed tests to the rules in docs/internals/testing.md. Request tests only as those rules allow.",
      },
      ...AUTH_PATHS.map((path) => ({
        path,
        instructions: `Hold changes to the trust model in ${AUTH_DOCS.join(" and ")}.`,
      })),
      {
        path: "apps/server/src/runners/**",
        instructions: "Hold changed code to the rules in docs/internals/runners.md.",
      },
      {
        path: "packages/contracts/src/**",
        instructions:
          "Hold changed contracts to the constraints in docs/internals/overview.md, especially wire compatibility and replayable events.",
      },
      {
        path: "packages/client-runtime/**",
        instructions: "Hold changed code to the rules in docs/internals/connection-runtime.md.",
      },
    ],
  },
  knowledge_base: {
    code_guidelines: {
      filePatterns: [
        { files: "docs/internals/effect-services.md", applyTo: "{apps,packages}/**/*.ts" },
        { files: "docs/internals/web-ui.md", applyTo: "apps/web/src/**/*.{tsx,css}" },
        // Source changes too, so a request for tests follows the same rules.
        { files: "docs/internals/testing.md", applyTo: "**/*.{ts,tsx}" },
        ...AUTH_DOCS.flatMap((files) => AUTH_PATHS.map((applyTo) => ({ files, applyTo }))),
        { files: "docs/internals/runners.md", applyTo: "apps/server/src/runners/**" },
        { files: "docs/internals/overview.md", applyTo: "packages/contracts/src/**" },
        { files: "docs/internals/connection-runtime.md", applyTo: "packages/client-runtime/**" },
      ],
    },
  },
}));
