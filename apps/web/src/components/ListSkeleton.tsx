import { Card } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { useDelayedStatus } from "~/hooks/useDelayedStatus";

/** Stands in for a list while it loads. Appears only when loading takes a moment. */
export function ListSkeleton() {
  const visible = useDelayedStatus(true);
  if (!visible) return null;
  return (
    <Card role="status" aria-label="Loading">
      <ul className="divide-y">
        <li className="px-4 py-2">
          <Skeleton className="h-4 w-2/3" />
        </li>
        <li className="px-4 py-2">
          <Skeleton className="h-4 w-1/2" />
        </li>
        <li className="px-4 py-2">
          <Skeleton className="h-4 w-3/5" />
        </li>
      </ul>
    </Card>
  );
}
