import { cn } from "cn";
import { LoaderCircleIcon } from "lucide-react";

/** For short pending work only; a status that can last stays static. Sized by its parent. */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <LoaderCircleIcon
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      // oxlint-disable-next-line toolspell/no-costly-motion -- the one spinner, mounted only while work is pending
      className={cn("animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
