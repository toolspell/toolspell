import { assert, describe } from "@effect/vitest";

import { createOxlintRuleHarness } from "../test/utils.ts";

const rule = createOxlintRuleHarness("toolspell/no-low-value-comments");

describe("toolspell/no-low-value-comments", () => {
  rule.valid(
    "allows a comment that says why",
    `
      // SQLite holds the write lock for the whole transaction, so batch the inserts.
      export const batchSize = 500;
    `,
  );

  rule.valid(
    "allows lint and type-checker directives",
    `
      // oxlint-disable-next-line no-console -- this script reports to the terminal
      console.log("done");
      // @ts-expect-error the fixture passes a string on purpose
      const count: number = "text";
    `,
  );

  rule.valid(
    "allows a long license header",
    `
      /*!
       * Copyright (c) Example Authors.
       * Permission is hereby granted, free of charge, to any person obtaining a copy
       * of this software, to deal in the Software without restriction,
       * subject to the following conditions.
       * The above copyright notice shall be included in all copies.
       */
      export const value = 1;
    `,
  );

  rule.valid(
    "allows tracked markers and external issue references",
    `
      // TODO(#1234): drop the fallback once every client sends a cursor.
      export const fallback = true;
      // quarantine: #1234 flakes on Windows until the pty fix lands
      export const quarantined = true;
      // Works around Effect-TS/effect#5678 in Stream.decodeText.
      export const decoded = true;
      // Accepts the \`#123\` fragment form.
      export const fragment = true;
    `,
  );

  rule.valid(
    "allows JSDoc tags that describe something",
    `
      /**
       * @param limit capped at 100 by the server
       * @public
       */
      export const page = (limit: number) => limit;
    `,
  );

  rule.valid(
    "does not join a trailing comment to the block below it",
    `
      export const limit = 100; // the server caps pages here
      // A page past the cap returns the last full page, so clients that
      // ask for more never see an error. The cursor still points at the
      // first row the page left out, which keeps resume exact even when
      // rows arrive between requests.
      export const cursor = 0;
    `,
  );

  rule.invalid(
    "reports a section divider",
    `
      // ---------- helpers ----------
      export const helper = 1;
    `,
    (output) => assert.match(output, /Drop the section divider/),
  );

  rule.invalid(
    "reports a test step label",
    `
      // Arrange
      const input = 1;
    `,
    (output) => assert.match(output, /Drop the test step label/),
  );

  rule.invalid(
    "reports a task marker without a link",
    `
      // TODO: handle the empty case
      export const value = 1;
    `,
    (output) => assert.match(output, /Link the issue that tracks this/),
  );

  rule.invalid(
    "reports a bare issue number",
    `
      // Keeps the cursor stable after #1234.
      export const value = 1;
    `,
    (output) => assert.match(output, /Drop the PR or issue number/),
  );

  rule.invalid(
    "reports a JSDoc type in TypeScript",
    `
      /** @param {number} limit the page size */
      export const page = (limit: number) => limit;
    `,
    (output) => assert.match(output, /Drop the JSDoc type/),
  );

  rule.invalid(
    "reports an empty JSDoc tag",
    `
      /**
       * Pages through the jobs.
       * @param limit
       */
      export const page = (limit: number) => limit;
    `,
    (output) => assert.match(output, /Drop the JSDoc tag that has no description/),
  );

  rule.invalid(
    "reports commented-out code",
    `
      // const legacy = loadLegacy();
      export const value = 1;
    `,
    (output) => assert.match(output, /Delete commented-out code/),
  );

  rule.invalid(
    "reports a comment that repeats the next name",
    `
      // Creates the job runner.
      export const createJobRunner = () => 1;
    `,
    (output) => assert.match(output, /it only repeats the name below it/),
  );

  rule.invalid(
    "reports a comment block longer than four lines",
    `
      // The runner retries a failed job.
      // It waits a second before the first retry.
      // It doubles the wait after each failure.
      // It gives up after five attempts.
      // It records each attempt as an event.
      export const retries = 5;
    `,
    (output) => assert.match(output, /Cut this to 4 lines or fewer/),
  );
});
