import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { CommandId, isJobSettled, JobId, WorkspaceId, type Job } from "@toolspell/contracts";
import { createFileRoute } from "@tanstack/react-router";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";

import { InlineForm } from "~/components/InlineForm";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { FieldError } from "~/components/ui/field";
import { Progress } from "~/components/ui/progress";
import { atoms, errorMessage, newId } from "~/client";

export const Route = createFileRoute("/workspaces/$workspaceId")({ component: WorkspacePage });

const STATUS_VARIANT = {
  queued: "secondary",
  running: "default",
  succeeded: "outline",
  failed: "destructive",
  cancelled: "ghost",
} as const satisfies Record<Job["status"], string>;

function JobRow({ job }: { readonly job: Job }) {
  const dispatch = useAtomSet(atoms.dispatchAtom, { mode: "promise" });
  const [error, setError] = useState<string | null>(null);
  const cancel = () =>
    dispatch({ type: "job.cancel", commandId: CommandId.make(newId()), jobId: job.id }).catch(
      (cause: unknown) => setError(errorMessage(cause)),
    );
  const problem = job.error ?? error;

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center gap-3">
        <Badge variant={STATUS_VARIANT[job.status]}>{job.status}</Badge>
        <span className="min-w-0 flex-1 truncate text-sm">{job.input}</span>
        {!isJobSettled(job.status) && (
          <Button variant="destructive" size="sm" onClick={cancel}>
            Cancel
          </Button>
        )}
      </div>
      {job.status === "running" && <Progress value={job.progress} />}
      {job.status === "running" && job.message && (
        <p className="text-xs text-muted-foreground">{job.message}</p>
      )}
      {job.output && <p className="text-sm">{job.output}</p>}
      {problem && <FieldError>{problem}</FieldError>}
    </li>
  );
}

function WorkspacePage() {
  const workspaceId = WorkspaceId.make(Route.useParams().workspaceId);
  const workspaces = AsyncResult.value(useAtomValue(atoms.workspacesAtom));
  const view = AsyncResult.value(useAtomValue(atoms.jobsAtom(workspaceId)));
  const dispatch = useAtomSet(atoms.dispatchAtom, { mode: "promise" });
  const workspace = Option.flatMapNullishOr(workspaces, ({ workspaces: all }) =>
    all.find((entry) => entry.id === workspaceId),
  );

  const start = (input: string) =>
    dispatch({
      type: "job.start",
      commandId: CommandId.make(newId()),
      jobId: JobId.make(newId()),
      workspaceId,
      input,
    });

  const rename = (name: string) =>
    dispatch({
      type: "workspace.rename",
      commandId: CommandId.make(newId()),
      workspaceId,
      name,
    });

  if (Option.isSome(workspaces) && Option.isNone(workspace)) {
    return <p className="text-sm text-muted-foreground">This workspace does not exist.</p>;
  }

  const jobs = Option.map(view, ({ jobs: all }) => all.toReversed());
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">
        {Option.match(workspace, { onNone: () => "…", onSome: ({ name }) => name })}
      </h1>
      <InlineForm
        label="Job input"
        placeholder='Describe a job (include "fail" to see a failure)'
        submitLabel="Start job"
        onSubmit={start}
      />
      {Option.isNone(jobs) ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : jobs.value.length === 0 ? (
        <p className="text-sm text-muted-foreground">No jobs yet.</p>
      ) : (
        <Card>
          <ul className="divide-y">
            {jobs.value.map((job) => (
              <JobRow key={job.id} job={job} />
            ))}
          </ul>
        </Card>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">Rename workspace</summary>
        <div className="pt-2">
          <InlineForm
            label="New name"
            placeholder="New name"
            submitLabel="Rename"
            onSubmit={rename}
          />
        </div>
      </details>
    </section>
  );
}
