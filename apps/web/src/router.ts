import { createRouter, type RouterHistory } from "@tanstack/react-router";

import { RouteError, RouteNotFound } from "./components/RouteFallbacks.tsx";
import { routeTree } from "./routeTree.gen.ts";

/** The app's router; tests pass a memory history. */
export const createAppRouter = (history?: RouterHistory) =>
  createRouter({
    routeTree,
    ...(history ? { history } : {}),
    defaultPreload: "intent",
    // Defaults rather than root-route options, so a failing page renders inside the shell.
    defaultErrorComponent: RouteError,
    defaultNotFoundComponent: RouteNotFound,
  });

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
