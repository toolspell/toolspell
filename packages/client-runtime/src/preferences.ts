import type * as Layer from "effect/Layer";
import type * as KeyValueStore from "effect/persistence/KeyValueStore";
import * as Schema from "effect/Schema";
import * as Atom from "effect/reactivity/Atom";

/** Where the theme preference is stored; the web client's boot script reads it before React. */
export const THEME_PREFERENCE_KEY = "toolspell:theme";

/**
 * UI preferences that belong to this device, not to the server: a laptop and a phone may differ.
 * Each entry is its own key, and a value that no longer decodes (a removed theme, an older
 * format) reads as the default without touching the others.
 */
export const makeDevicePreferences = <const ThemeId extends string>(options: {
  readonly store: Layer.Layer<KeyValueStore.KeyValueStore>;
  readonly themeIds: ReadonlyArray<ThemeId>;
}) => {
  const runtime = Atom.runtime(options.store);
  return {
    /** `system` follows the OS appearance; anything else names a theme. */
    themeAtom: Atom.kvs({
      runtime,
      key: THEME_PREFERENCE_KEY,
      schema: Schema.Literals(["system", ...options.themeIds]),
      defaultValue: () => "system" as const,
    }).pipe(Atom.keepAlive),
  };
};
