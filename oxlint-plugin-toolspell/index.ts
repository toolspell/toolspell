// Rules adapted from T3 Code (https://github.com/pingdotgg/t3code, MIT).
import { definePlugin } from "@oxlint/plugins";

import namespaceNodeImports from "./rules/namespace-node-imports.ts";
import noPollingLoopInTests from "./rules/no-polling-loop-in-tests.ts";
import noRealTimeWaitInTests from "./rules/no-real-time-wait-in-tests.ts";
import noTestTimeoutOrUnreasonedSkip from "./rules/no-test-timeout-or-unreasoned-skip.ts";
import noUnreasonedStateSync from "./rules/no-unreasoned-state-sync.ts";
import noWallClockInTests from "./rules/no-wall-clock-in-tests.ts";
import preferEffectFn from "./rules/prefer-effect-fn.ts";
import requireSuppressionReason from "./rules/require-suppression-reason.ts";

export default definePlugin({
  meta: {
    name: "toolspell",
  },
  rules: {
    "namespace-node-imports": namespaceNodeImports,
    "no-polling-loop-in-tests": noPollingLoopInTests,
    "no-real-time-wait-in-tests": noRealTimeWaitInTests,
    "no-test-timeout-or-unreasoned-skip": noTestTimeoutOrUnreasonedSkip,
    "no-unreasoned-state-sync": noUnreasonedStateSync,
    "no-wall-clock-in-tests": noWallClockInTests,
    "prefer-effect-fn": preferEffectFn,
    "require-suppression-reason": requireSuppressionReason,
  },
});
