import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { CommandId, WorkspaceId } from "@toolspell/contracts";
import { createFileRoute, Link } from "@tanstack/react-router";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";

import { InlineForm } from "~/components/InlineForm";
import { Card } from "~/components/ui/card";
import { atoms, newId } from "~/client";

export const Route = createFileRoute("/")({ component: WorkspacesPage });

function WorkspacesPage() {
  const view = AsyncResult.value(useAtomValue(atoms.workspacesAtom));
  const dispatch = useAtomSet(atoms.dispatchAtom, { mode: "promise" });
  const navigate = Route.useNavigate();

  const create = async (name: string) => {
    const workspaceId = WorkspaceId.make(newId());
    await dispatch({
      type: "workspace.create",
      commandId: CommandId.make(newId()),
      workspaceId,
      name,
    });
    await navigate({ to: "/workspaces/$workspaceId", params: { workspaceId } });
  };

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Workspaces</h1>
      <InlineForm
        label="Workspace name"
        placeholder="New workspace name"
        submitLabel="Create"
        onSubmit={create}
      />
      {Option.isNone(view) ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : view.value.workspaces.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No workspaces yet. Create one to start a job.
        </p>
      ) : (
        <Card>
          <ul className="divide-y">
            {view.value.workspaces.map((workspace) => (
              <li key={workspace.id}>
                <Link
                  to="/workspaces/$workspaceId"
                  params={{ workspaceId: workspace.id }}
                  className="block px-4 py-2 text-sm hover:bg-muted"
                >
                  {workspace.name}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
