import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { STANDARD_AUTH_SCOPES, type AuthSession, type PairingGrant } from "@toolspell/contracts";
import { createFileRoute } from "@tanstack/react-router";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { FieldError } from "~/components/ui/field";
import { Spinner } from "~/components/ui/spinner";
import { atoms, errorMessage, preferences } from "~/client";
import { confirm } from "~/confirmDialog";
import { useAction } from "~/hooks/useAction";
import { useRelativeTime } from "~/hooks/useRelativeTime";
import { THEME_IDS, THEMES, type ThemePreference } from "~/theme";

export const Route = createFileRoute("/settings")({ component: SettingsPage });

const THEME_OPTIONS: ReadonlyArray<{ readonly value: ThemePreference; readonly label: string }> = [
  { value: "system", label: "System" },
  ...THEME_IDS.map((id) => ({ value: id, label: THEMES[id].label })),
];

function ThemePicker() {
  const theme = useAtomValue(preferences.themeAtom);
  const setTheme = useAtomSet(preferences.themeAtom);
  return (
    <div role="group" aria-label="Theme" className="flex gap-2">
      {THEME_OPTIONS.map(({ value, label }) => (
        <Button
          key={value}
          variant={value === theme ? "default" : "outline"}
          aria-pressed={value === theme}
          onClick={() => setTheme(value)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

function SettingsPage() {
  const sessions = useAtomValue(atoms.sessionsAtom);
  const createPairingGrant = useAtomSet(atoms.createPairingGrantAtom, { mode: "promise" });
  const [grant, setGrant] = useState<PairingGrant | null>(null);
  const createLink = useAction(
    async () => setGrant(await createPairingGrant(STANDARD_AUTH_SCOPES)),
    "Could not create a pairing link",
  );

  const link = grant && `${window.location.origin}/pair#token=${grant.token}`;
  const list = AsyncResult.value(sessions);
  const loadError = AsyncResult.isFailure(sessions) ? errorMessage(sessions.cause) : null;

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Settings</h1>
      <div className="flex flex-col gap-3">
        <h2 className="font-medium">Appearance</h2>
        <p className="text-sm text-muted-foreground">
          The theme applies to this device only. System follows its light or dark mode.
        </p>
        <ThemePicker />
      </div>
      <div className="flex flex-col gap-3">
        <h2 className="font-medium">Devices</h2>
        <p className="text-sm text-muted-foreground">
          A pairing link lets another browser or device use this server. It works once and expires
          after 10 minutes.
        </p>
        <div>
          <Button variant="outline" disabled={createLink.pending} onClick={() => createLink.run()}>
            {createLink.slow && <Spinner data-icon="inline-start" />}
            Create pairing link
          </Button>
        </div>
        {link && (
          <div className="flex flex-col gap-1 rounded-md border p-3 text-sm">
            <code className="break-all">{link}</code>
            <span className="text-xs text-muted-foreground">
              Expires at {new Date(grant.expiresAt).toLocaleTimeString()}.
            </span>
          </div>
        )}
        {loadError && <FieldError>{loadError}</FieldError>}
        {Option.isSome(list) && (
          <Card>
            <ul className="divide-y">
              {list.value.map((session) => (
                <SessionRow key={session.id} session={session} />
              ))}
            </ul>
          </Card>
        )}
      </div>
    </section>
  );
}

function SessionRow({ session }: { readonly session: AuthSession }) {
  const revokeSession = useAtomSet(atoms.revokeSessionAtom, { mode: "promise" });
  const lastSeen = useRelativeTime(session.lastSeenAt);
  const verb = session.current ? "Sign out" : "Revoke";
  const revoke = useAction(
    () => revokeSession(session.id),
    session.current ? "Could not sign out" : "Could not revoke the device",
  );
  const ask = async () => {
    const confirmed = await confirm(
      session.current
        ? {
            title: "Sign out of this browser?",
            description: "Using it again takes a new pairing link.",
            confirmLabel: verb,
            destructive: true,
          }
        : {
            title: `Revoke ${session.label}?`,
            description: "That device loses access until it pairs again.",
            confirmLabel: verb,
            destructive: true,
          },
    );
    if (confirmed) await revoke.run();
  };

  return (
    <li className="flex items-center gap-3 px-4 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <p className="truncate">{session.label}</p>
        <p className="text-xs text-muted-foreground">
          {session.current ? "This device" : `Last seen ${lastSeen}`}
          {" · "}
          {session.scopes.join(", ")}
        </p>
      </div>
      <Button variant="destructive" size="sm" disabled={revoke.pending} onClick={ask}>
        {revoke.slow && <Spinner data-icon="inline-start" />}
        {verb}
      </Button>
    </li>
  );
}
