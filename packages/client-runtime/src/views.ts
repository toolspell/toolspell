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

/** Applies events newer than the cursor. Replayed duplicates after a reconnect are skipped. */
const applyEvents = <Item extends { readonly id: string }>(
  items: ReadonlyArray<Item>,
  sequence: EventSequence | undefined,
  events: ReadonlyArray<EventEnvelope>,
  apply: (current: Item | undefined, envelope: EventEnvelope) => Item | undefined,
  idOf: (envelope: EventEnvelope) => string | undefined,
) => {
  const byId = new Map(items.map((item) => [item.id, item]));
  let cursor = sequence;
  for (const envelope of events) {
    if (cursor !== undefined && envelope.sequence <= cursor) continue;
    cursor = envelope.sequence;
    const id = idOf(envelope);
    if (id === undefined) continue;
    const next = apply(byId.get(id), envelope);
    if (next === undefined) byId.delete(id);
    else byId.set(id, next);
  }
  return { items: [...byId.values()], sequence: cursor };
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
  return { ...view, workspaces: next.items, sequence: next.sequence };
};

export const applyJobsItem = (view: JobsView, item: JobsStreamItem): JobsView => {
  if (item.type === "snapshot") {
    return { ...view, sequence: item.sequence, jobs: item.jobs };
  }
  const next = applyEvents(view.jobs, view.sequence, item.events, applyJobEvent, ({ event }) =>
    "jobId" in event ? event.jobId : undefined,
  );
  return { ...view, jobs: next.items, sequence: next.sequence };
};
