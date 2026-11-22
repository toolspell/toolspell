import { Link, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { CircleAlertIcon, CompassIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { errorMessage } from "~/client";
import { isChunkLoadError } from "~/lib/chunkReloadGuard";

const reload = () => window.location.reload();

/** A route that threw. The app shell stays, so the user can also navigate away. */
export function RouteError({ error }: ErrorComponentProps) {
  const router = useRouter();
  // A failed chunk import is cached for the document; only a reload retries it.
  const retry = isChunkLoadError(error) ? reload : () => void router.invalidate();
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CircleAlertIcon />
        </EmptyMedia>
        <EmptyTitle>Something went wrong</EmptyTitle>
        <EmptyDescription>{errorMessage(error)}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex gap-2">
          <Button onClick={retry}>Try again</Button>
          <Button variant="outline" onClick={reload}>
            Reload
          </Button>
        </div>
      </EmptyContent>
    </Empty>
  );
}

export function RouteNotFound() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CompassIcon />
        </EmptyMedia>
        <EmptyTitle>Page not found</EmptyTitle>
        <EmptyDescription>This link does not point to a page in ToolSpell.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button render={<Link to="/" />}>Go to workspaces</Button>
      </EmptyContent>
    </Empty>
  );
}
