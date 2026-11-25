// Adapted from T3 Code's .coderabbit.config.ts (MIT).
import { defineConfig, type CodeRabbitContext } from "@coderabbitai/config";

const UNGATED_AUTHORS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const isGated = ({ pr }: CodeRabbitContext) => !UNGATED_AUTHORS.has(pr?.authorAssociation ?? "");

const AUTH_PATHS = ["apps/server/src/auth/**", "packages/contracts/src/{auth,rpc}.ts"];
const AUTH_DOCS = ["SECURITY.md", "docs/internals/environment-auth.md"];

// A summary of SECURITY.md; change both together.
const SECURITY_RISK = `Rate security risk by the trust model in SECURITY.md. A change is risky when it could let a finding cross one of its boundaries:
1. An unauthenticated request reaches more than the web client's static files, /health, the session check, and pairing.
2. A session calls an RPC its scopes do not allow, ends another session without admin, or a device grants more than it holds.
3. A pairing token works twice, after expiry, or is recoverable from stored data.
4. A session keeps working after revocation, including an open socket.
5. A credential leaks into logs, URLs sent to the server, process listings, or child environments.
6. Rendered content runs script in the app's origin or reaches the desktop preload bridge.
7. The desktop window navigates to or loads an origin other than its server.
8. A page from another origin, including another port on the same host, opens the socket or pairs.
Intended, not a risk: the server's OS user owns the server and toolspell pair needs no credential; binding beyond loopback with --host is the user's choice; sessions last 400 days and revocation ends them; runners run with the server user's privileges.`;

const MERGE_RISK = `Rate merge risk higher when a change touches the constraints in docs/internals/overview.md:
- A stored event, outbox effect, or projection record gains a required field, or changes without a migration that rewrites its rows; an event type is repurposed instead of added.
- Clients and servers update independently: a response a deployed client cannot decode, or a breaking protocol change without a PROTOCOL_VERSION bump.
- External I/O inside a command decision or the event sink's database transaction, or an effect handler that is not idempotent.`;

export default defineConfig((ctx) => ({
  reviews: {
    high_level_summary: false,
    review_status: false,
    request_changes_workflow: false,
    allow_author_approval: !isGated(ctx),
    security_risk_instructions: SECURITY_RISK,
    merge_risk_instructions: MERGE_RISK,
    // Labels come from .github/labels.json and the workflows; there is one maintainer.
    suggested_labels: false,
    suggested_reviewers: false,
    auto_review: {
      enabled: true,
      // The layers of a stacked PR target branches other than main.
      base_branches: [".*"],
    },
    // Reviews only: CodeRabbit offers none of the actions that write code to a branch or a PR.
    finishing_touches: {
      docstrings: { enabled: false },
      unit_tests: { enabled: false },
      simplify: { enabled: false },
      autofix: { enabled: false },
      fix_ci: { enabled: false },
      resolve_merge_conflict: { enabled: false },
    },
    pre_merge_checks: {
      // The factory overload of defineConfig widens this literal to string otherwise.
      docstrings: { mode: "off" as const },
      override_requested_reviewers_only: isGated(ctx),
    },
    path_filters: ["!.repos/**", "!.reference-apps/**", "!.toolspell/**"],
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
  // Outsiders could spend the hourly review quota and teach learnings that shape every review.
  // Revisit when the repository opens for outside contributions.
  chat: {
    allow_non_org_members: false,
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
