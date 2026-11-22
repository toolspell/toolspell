import { makeToolSpellAtoms } from "@toolspell/client-runtime/atoms";
import { makeDevicePreferences } from "@toolspell/client-runtime/preferences";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import * as Atom from "effect/reactivity/Atom";

import { randomUUID } from "./lib/randomUUID.ts";
import { THEME_IDS } from "./theme.ts";

/** The web client always talks to the origin that served it (Vite proxies in dev). */
export const atoms = makeToolSpellAtoms({ origin: window.location.origin });

export const preferences = makeDevicePreferences({
  store: KeyValueStore.layerStorage(() => window.localStorage),
  themeIds: THEME_IDS,
});

/** Set when a pairing link failed, so the pairing screen can say why. */
export const pairingErrorAtom = Atom.make<string | null>(null).pipe(Atom.keepAlive);

export const newId = (): string => randomUUID();

/** Turns a rejected call into text for the user. Tagged server errors carry a message. */
export const errorMessage = (error: unknown): string =>
  typeof error === "object" &&
  error !== null &&
  "message" in error &&
  typeof error.message === "string"
    ? error.message
    : "Something went wrong.";
