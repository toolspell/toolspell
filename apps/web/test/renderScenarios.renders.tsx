// Render scenarios. Each one mounts the real app on the workspace page with fake atoms, counts
// React commits and component renders while it drives them, asserts the render budgets that
// matter, and writes the counts for scripts/render-metrics.ts through writeRenderReport.
import { applyJobsItem, applyWorkspacesItem } from "@toolspell/client-runtime/views";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { expect, it, vi } from "vite-plus/test";
import { commands } from "vite-plus/test/browser";

import { routeTree } from "~/routeTree.gen";
import {
  initialJobs,
  initialWorkspaces,
  jobsAtom,
  JOB_COUNT,
  progressed,
  renamed,
  WORKSPACE_ID,
  workspacesAtom,
} from "./fakeClient";
import { startCounting, stopCounting } from "./renderCounter";
import { act, render } from "./render";

declare module "vite-plus/test/browser" {
  interface BrowserCommands {
    /** Defined in vite.config.ts for the renders project; a no-op outside render-metrics.ts. */
    writeRenderReport: (scenario: string, json: string) => Promise<void>;
  }
}

vi.mock(import("~/client"), async (original) => {
  const real = await original();
  return { ...real, atoms: { ...real.atoms, ...(await import("./fakeClient")).atoms } };
});

const PROGRESS_EVENTS = 30;
const RENAMES = 10;

// Routes load their components lazily; loading before the mount keeps that out of the count.
async function workspacePage() {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [`/workspaces/${WORKSPACE_ID}`] }),
  });
  await act(() => router.load());
  return <RouterProvider router={router} />;
}

async function report(scenario: string) {
  await act(() => {});
  const counts = stopCounting();
  await commands.writeRenderReport(scenario, JSON.stringify(counts));
  return counts;
}

it("mount-workspace", async () => {
  const page = await workspacePage();
  startCounting();
  // The app brings its own router; the helper's test router would replace the route tree.
  await using screen = await render(page, { router: false });
  await expect.element(screen.getByText("Job 0: index the documentation")).toBeVisible();
  expect(screen.getByRole("listitem").elements()).toHaveLength(JOB_COUNT);
  await report("mount-workspace");
});

it("stream-job-progress", async () => {
  // The app brings its own router; the helper's test router would replace the route tree.
  await using screen = await render(await workspacePage(), { router: false });
  await expect.element(screen.getByText("Job 0: index the documentation")).toBeVisible();

  startCounting();
  let view = initialJobs;
  for (let step = 1; step <= PROGRESS_EVENTS; step++) {
    const event = progressed((view.sequence ?? 0) + 1, step * 3, `Indexed page ${step}`);
    const next = applyJobsItem(view, { type: "events", events: [event] });
    await act(() => screen.registry.set(jobsAtom, AsyncResult.success(next)));
    view = next;
  }
  await expect.element(screen.getByText(`Indexed page ${PROGRESS_EVENTS}`)).toBeVisible();
  const counts = await report("stream-job-progress");
  // Only the running job's row renders, once per event; the other rows keep their render.
  expect(counts.components.JobRow).toBe(PROGRESS_EVENTS);
});

it("rename-another-workspace", async () => {
  // The app brings its own router; the helper's test router would replace the route tree.
  await using screen = await render(await workspacePage(), { router: false });
  await expect.element(screen.getByText("Job 0: index the documentation")).toBeVisible();

  startCounting();
  let view = initialWorkspaces;
  for (let step = 1; step <= RENAMES; step++) {
    const event = renamed((view.sequence ?? 0) + 1, `Other ${step}`);
    const next = applyWorkspacesItem(view, { type: "events", events: [event] });
    await act(() => screen.registry.set(workspacesAtom, AsyncResult.success(next)));
    view = next;
  }
  const counts = await report("rename-another-workspace");
  // The page reads the workspace list for its title; none of its jobs changed.
  expect(counts.components.WorkspacePage).toBe(RENAMES);
  expect(counts.components.JobRow).toBeUndefined();
});
