import type { Job, Workspace } from "./domain.ts";
import type { DomainEvent, EventEnvelope } from "./events.ts";

// One pure reducer per record type. The server projects events into SQLite with
// them and clients apply streamed events with them, so the two cannot drift.

export const isWorkspaceEvent = (event: DomainEvent) =>
  event.type === "workspace.created" || event.type === "workspace.renamed";

export const applyWorkspaceEvent = (
  current: Workspace | undefined,
  { event, occurredAt }: EventEnvelope,
): Workspace | undefined => {
  switch (event.type) {
    case "workspace.created":
      return {
        id: event.workspaceId,
        name: event.name,
        createdAt: occurredAt,
        updatedAt: occurredAt,
      };
    case "workspace.renamed":
      return current && { ...current, name: event.name, updatedAt: occurredAt };
    default:
      return current;
  }
};

export const applyJobEvent = (
  current: Job | undefined,
  { event, occurredAt }: EventEnvelope,
): Job | undefined => {
  if (event.type === "job.queued") {
    return {
      id: event.jobId,
      workspaceId: event.workspaceId,
      input: event.input,
      status: "queued",
      progress: 0,
      message: null,
      output: null,
      error: null,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };
  }
  if (current === undefined) return undefined;
  const touched = { ...current, updatedAt: occurredAt };
  switch (event.type) {
    case "job.started":
      return { ...touched, status: "running" };
    case "job.progressed":
      return { ...touched, progress: event.progress, message: event.message };
    case "job.succeeded":
      return { ...touched, status: "succeeded", progress: 100, output: event.output };
    case "job.failed":
      return { ...touched, status: "failed", error: event.error };
    case "job.cancelled":
      return { ...touched, status: "cancelled" };
    default:
      return current;
  }
};
