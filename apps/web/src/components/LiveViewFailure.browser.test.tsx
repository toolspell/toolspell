import { AuthorizationError } from "@toolspell/contracts";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import * as Cause from "effect/Cause";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { expect, it, vi } from "vite-plus/test";

import { createAppRouter } from "~/router";
import { workspacesAtom } from "../../test/fakeClient";
import { act, render } from "../../test/render";

vi.mock(import("~/client"), async (original) => {
  const real = await original();
  return { ...real, atoms: { ...real.atoms, ...(await import("../../test/fakeClient")).atoms } };
});

it("shows why a list that never loaded failed, not a skeleton", async () => {
  const router = createAppRouter(createMemoryHistory({ initialEntries: ["/"] }));
  await act(() => router.load());
  // The app brings its own router; the helper's test router would replace the route tree.
  await using screen = await render(<RouterProvider router={router} />, { router: false });
  const denied = new AuthorizationError({
    message: "This device may not read.",
    requiredScope: "read",
  });
  await act(() => screen.registry.set(workspacesAtom, AsyncResult.failure(Cause.fail(denied))));

  await expect
    .element(screen.getByRole("alert").getByText("This device may not read."))
    .toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  expect(screen.getByRole("status", { name: "Loading" }).query()).toBeNull();
});
