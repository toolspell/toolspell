import { useSyncExternalStore } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import {
  completeConfirmClose,
  readConfirmDialog,
  respondToConfirm,
  subscribeConfirmDialog,
} from "~/confirmDialog";

/** Renders `confirm()` questions. Mounted once, in the root route; renders nothing while idle. */
export function ConfirmDialogHost() {
  const { open, options } = useSyncExternalStore(subscribeConfirmDialog, readConfirmDialog);
  if (options === null) return null;
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) respondToConfirm(false);
      }}
      onOpenChangeComplete={(next) => {
        if (!next) completeConfirmClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{options.title}</AlertDialogTitle>
          {options.description && (
            <AlertDialogDescription>{options.description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={options.destructive ? "destructive" : "default"}
            onClick={() => respondToConfirm(true)}
          >
            {options.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
