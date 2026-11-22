import { describe } from "@effect/vitest";

import { createOxlintRuleHarness } from "../test/utils.ts";

const rule = createOxlintRuleHarness("toolspell/no-costly-motion", {
  filename: "apps/web/src/components/Example.tsx",
});

describe("toolspell/no-costly-motion", () => {
  rule.valid(
    "allows named transitions, enter and exit animations, and the stepped skeleton",
    `
      const a = <div className="transition-colors hover:transition-[box-shadow,translate]" />;
      const b = "data-open:animate-in data-open:fade-in-0 animate-skeleton";
      const c = "Pulse checks run every minute";
    `,
  );

  rule.invalid("reports transition-all", `const a = <div className="transition-all" />;`);

  rule.invalid("reports a variant of it", `const a = "md:hover:transition-all!";`);

  rule.invalid("reports a looping animation", "const a = `${base} animate-pulse`;");

  rule.invalid(
    "reports an arbitrary infinite animation",
    `const a = "animate-[ping_1s_infinite]";`,
  );

  rule.invalid("reports a spin outside the Spinner", `const a = "motion-safe:animate-spin";`);
});
