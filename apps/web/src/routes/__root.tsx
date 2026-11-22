import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type { ReactNode } from "react";

import { ConfirmDialogHost } from "~/components/ConfirmDialogHost";
import { Button } from "~/components/ui/button";
import { Toaster } from "~/components/ui/toast";
import { atoms, pairingErrorAtom } from "~/client";
import { useDelayedStatus } from "~/hooks/useDelayedStatus";

export const Route = createRootRoute({ component: RootLayout });

function Centered({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">{children}</div>
    </div>
  );
}

// The hosts sit above every screen, so a toast or question survives a switch such as signing out.
function RootLayout() {
  return (
    <>
      <RootScreen />
      <Toaster />
      <ConfirmDialogHost />
    </>
  );
}

function RootScreen() {
  const access = useAtomValue(atoms.accessAtom);
  const retry = useAtomRefresh(atoms.accessAtom);
  const pairError = useAtomValue(pairingErrorAtom);
  // A refresh keeps showing the last answer, so reconnects do not flash this screen.
  const current = AsyncResult.value(access);

  if (Option.isNone(current)) {
    if (AsyncResult.isFailure(access)) {
      return (
        <Centered>
          <h1 className="text-lg font-semibold">Cannot reach the ToolSpell server</h1>
          <Button variant="outline" onClick={retry}>
            Try again
          </Button>
        </Centered>
      );
    }
    return <Centered>Connecting…</Centered>;
  }
  if (current.value === "incompatible") {
    return (
      <Centered>
        <h1 className="text-lg font-semibold">This app is out of date</h1>
        <p>The server was updated. Reload the page to get the matching version.</p>
      </Centered>
    );
  }
  if (current.value === "unpaired") {
    return (
      <Centered>
        <h1 className="text-lg font-semibold">Pair this browser</h1>
        {pairError && <p className="text-destructive">{pairError}</p>}
        <p className="text-muted-foreground">
          Open a pairing link from a device that is already paired (Settings → Devices), or run{" "}
          <code className="rounded bg-muted px-1">toolspell pair</code> on the server.
        </p>
      </Centered>
    );
  }
  return <AppShell />;
}

function AppShell() {
  const reconnecting = useDelayedStatus(useAtomValue(atoms.connectionAtom) === "reconnecting");
  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center gap-4">
        <Link to="/" className="font-semibold">
          ToolSpell
        </Link>
        <nav className="flex gap-3 text-sm text-muted-foreground">
          <Link
            to="/"
            activeProps={{ className: "text-foreground" }}
            activeOptions={{ exact: true }}
          >
            Workspaces
          </Link>
          <Link to="/settings" activeProps={{ className: "text-foreground" }}>
            Settings
          </Link>
        </nav>
        {reconnecting && (
          <span role="status" className="ml-auto text-xs text-muted-foreground">
            Reconnecting…
          </span>
        )}
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
