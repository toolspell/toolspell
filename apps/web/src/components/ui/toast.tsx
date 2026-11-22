import { Toast } from "@base-ui/react/toast";
import { CircleAlertIcon, CircleCheckIcon, XIcon } from "lucide-react";

import { Button } from "~/components/ui/button";

/** Raise a toast from anywhere: `toastManager.add({ type: "error", title, description })`. */
const toastManager = Toast.createToastManager();

const ICONS: Partial<Record<string, typeof CircleAlertIcon>> = {
  error: CircleAlertIcon,
  success: CircleCheckIcon,
};

/** The one toast host, mounted in the root route. */
function Toaster() {
  return (
    <Toast.Provider toastManager={toastManager}>
      <Toasts />
    </Toast.Provider>
  );
}

// No portal while there is nothing to show; a closing toast stays in the list until it is gone.
function Toasts() {
  const { toasts } = Toast.useToastManager();
  if (toasts.length === 0) return null;
  return (
    <Toast.Portal>
      <Toast.Viewport
        data-slot="toast-viewport"
        className="fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col-reverse gap-2"
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} />
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}

function ToastItem({ toast }: { readonly toast: Toast.Root.ToastObject }) {
  const Icon = toast.type === undefined ? undefined : ICONS[toast.type];
  return (
    <Toast.Root
      toast={toast}
      data-slot="toast"
      className="flex translate-x-(--toast-swipe-movement-x) items-start gap-2 rounded-lg bg-popover p-3 text-xs/relaxed text-popover-foreground shadow-lg ring-1 ring-foreground/10 transition-[opacity,translate] duration-200 data-ending-style:opacity-0 data-starting-style:translate-y-2 data-starting-style:opacity-0 data-swiping:transition-none data-[type=error]:[&>svg]:text-destructive [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0"
    >
      {Icon && <Icon aria-hidden />}
      <Toast.Content className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Toast.Title className="font-medium" />
        <Toast.Description className="break-words text-muted-foreground" />
      </Toast.Content>
      <Toast.Close aria-label="Dismiss" render={<Button variant="ghost" size="icon-xs" />}>
        <XIcon />
      </Toast.Close>
    </Toast.Root>
  );
}

export { Toaster, toastManager };
