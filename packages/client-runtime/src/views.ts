import {
  applyJobEvent,
  applyWorkspaceEvent,
  type EventEnvelope,
  type EventSequence,
  type Job,
  type JobsStreamItem,
  type Workspace,
  type WorkspaceId,
  type WorkspacesStreamItem,
} from "@toolspell/contracts";

// Client-side state for one subscription. `sequence` is the resume cursor: after a
// reconnect the stream continues from it instead of reloading everything.

export interface WorkspacesView {
  readonly sequence: EventSequence | undefined;
  readonly workspaces: ReadonlyArray<Workspace>;
}

export interface JobsView {
  readonly sequence: EventSequence | undefined;
  readonly workspaceId: WorkspaceId;
  readonly jobs: ReadonlyArray<Job>;
}

export const emptyWorkspacesView: WorkspacesView = {
  sequence: undefined,
  workspaces: [],
};

export const emptyJobsView = (workspaceId: WorkspaceId): JobsView => ({
  sequence: undefined,
  workspaceId,
  jobs: [],
});

/**
 * Applies events newer than the cursor; replayed duplicates after a reconnect are skipped.
 * Returns undefined when no item changed, so the caller keeps its view (and its cursor:
 * replaying a no-op is a no-op). Untouched items keep their identity.
 */
const applyEvents = <Item extends { readonly id: string }>(
  items: ReadonlyArray<Item>,
  sequence: EventSequence | undefined,
  events: ReadonlyArray<EventEnvelope>,
  apply: (current: Item | undefined, envelope: EventEnvelope) => Item | undefined,
  idOf: (envelope: EventEnvelope) => string | undefined,
) => {
  let byId: Map<string, Item> | undefined;
  let changed = false;
  let cursor = sequence;
  for (const envelope of events) {
    if (cursor !== undefined && envelope.sequence <= cursor) continue;
    cursor = envelope.sequence;
    const id = idOf(envelope);
    if (id === undefined) continue;
    byId ??= new Map(items.map((item) => [item.id, item]));
    const current = byId.get(id);
    const next = apply(current, envelope);
    if (next === current) continue;
    changed = true;
    if (next === undefined) byId.delete(id);
    else byId.set(id, next);
  }
  return byId && changed ? { items: [...byId.values()], sequence: cursor } : undefined;
};

export const applyWorkspacesItem = (
  view: WorkspacesView,
  item: WorkspacesStreamItem,
): WorkspacesView => {
  if (item.type === "snapshot") {
    return { sequence: item.sequence, workspaces: item.workspaces };
  }
  const next = applyEvents(
    view.workspaces,
    view.sequence,
    item.events,
    applyWorkspaceEvent,
    ({ event }) => event.workspaceId,
  );
  return next ? { ...view, workspaces: next.items, sequence: next.sequence } : view;
};

export const applyJobsItem = (view: JobsView, item: JobsStreamItem): JobsView => {
  if (item.type === "snapshot") {
    return { ...view, sequence: item.sequence, jobs: item.jobs };
  }
  const next = applyEvents(view.jobs, view.sequence, item.events, applyJobEvent, ({ event }) =>
    "jobId" in event ? event.jobId : undefined,
  );
  return next ? { ...view, jobs: next.items, sequence: next.sequence } : view;
};
