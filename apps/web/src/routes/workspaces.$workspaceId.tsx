import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { CommandId, isJobSettled, JobId, WorkspaceId, type Job } from "@toolspell/contracts";
import { createFileRoute, Link } from "@tanstack/react-router";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { memo } from "react";

import { InlineForm } from "~/components/InlineForm";
import { ListSkeleton } from "~/components/ListSkeleton";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { FieldError } from "~/components/ui/field";
import { Progress } from "~/components/ui/progress";
import { Spinner } from "~/components/ui/spinner";
import { atoms, newId } from "~/client";
import { useAction } from "~/hooks/useAction";

export const Route = createFileRoute("/workspaces/$workspaceId")({ component: WorkspacePage });

const STATUS_VARIANT = {
  queued: "secondary",
  running: "info",
  succeeded: "success",
  failed: "destructive",
  cancelled: "ghost",
} as const satisfies Record<Job["status"], string>;

// Every event builds a new jobs array, so the compiler cannot reuse the row elements. The views
// keep an unchanged job's object, and this boundary skips the rows whose job is the same.
const JobRow = memo(function JobRow({ job }: { readonly job: Job }) {
  const dispatch = useAtomSet(atoms.dispatchAtom, { mode: "promise" });
  const cancel = useAction(
    () => dispatch({ type: "job.cancel", commandId: CommandId.make(newId()), jobId: job.id }),
    "Could not cancel the job",
  );

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center gap-3">
        <Badge variant={STATUS_VARIANT[job.status]}>{job.status}</Badge>
        <span className="min-w-0 flex-1 truncate text-sm">{job.input}</span>
        {!isJobSettled(job.status) && (
          <Button
            variant="destructive"
            size="sm"
            disabled={cancel.pending}
            onClick={() => cancel.run()}
          >
            {cancel.slow && <Spinner data-icon="inline-start" />}
            Cancel
          </Button>
        )}
      </div>
      {job.status === "running" && <Progress value={job.progress} />}
      {job.status === "running" && job.message && (
        <p className="text-xs text-muted-foreground">{job.message}</p>
      )}
      {job.output && <p className="text-sm">{job.output}</p>}
      {job.error && <FieldError>{job.error}</FieldError>}
    </li>
  );
});

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
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>This workspace does not exist</EmptyTitle>
          <EmptyDescription>It may have been removed, or the link is wrong.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button render={<Link to="/" />}>Go to workspaces</Button>
        </EmptyContent>
      </Empty>
    );
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
        <ListSkeleton />
      ) : jobs.value.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No jobs yet</EmptyTitle>
            <EmptyDescription>Describe a job above to start one.</EmptyDescription>
          </EmptyHeader>
        </Empty>
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
