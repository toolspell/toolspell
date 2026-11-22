import { makeDevicePreferences, THEME_PREFERENCE_KEY } from "@toolspell/client-runtime/preferences";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { describe, expect, it } from "vite-plus/test";

import indexHtml from "../index.html?raw";
import { applyTheme, resolveTheme, THEME_IDS, THEMES, type ThemeId } from "./theme.ts";

const bootScript = indexHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

const storageWith = (stored: string | undefined): Storage => {
  const map = new Map(stored === undefined ? [] : [[THEME_PREFERENCE_KEY, stored]]);
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  };
};

/** Records what a theme writes to the document. */
const fakeDocument = () => {
  const classes = new Set<string>();
  let themeColor = "";
  const documentElement = {
    dataset: {} as DOMStringMap,
    classList: {
      toggle: (token: string, force?: boolean) => {
        if (force) classes.add(token);
        else classes.delete(token);
        return classes.has(token);
      },
    },
    style: { colorScheme: "" },
  };
  return {
    target: {
      documentElement,
      querySelector: (selectors: string) =>
        selectors === 'meta[name="theme-color"]'
          ? { setAttribute: (_name: string, value: string) => void (themeColor = value) }
          : null,
    },
    written: () => ({
      theme: documentElement.dataset.theme,
      dark: classes.has("dark"),
      colorScheme: documentElement.style.colorScheme,
      themeColor,
    }),
  };
};

const expected = (id: ThemeId) => ({
  theme: id,
  dark: THEMES[id].appearance === "dark",
  colorScheme: THEMES[id].appearance,
  themeColor: THEMES[id].chrome,
});

const runBootScript = (stored: string | undefined, systemDark: boolean) => {
  const document = fakeDocument();
  // oxlint-disable-next-line no-new-func -- runs the inline script against fakes, as the browser would.
  new Function("localStorage", "matchMedia", "document", bootScript)(
    storageWith(stored),
    () => ({ matches: systemDark }),
    document.target,
  );
  return document.written();
};

const runRuntime = (stored: string | undefined, systemDark: boolean) => {
  const preferences = makeDevicePreferences({
    store: KeyValueStore.layerStorage(() => storageWith(stored)),
    themeIds: THEME_IDS,
  });
  const document = fakeDocument();
  applyTheme(
    document.target,
    resolveTheme(AtomRegistry.make().get(preferences.themeAtom), systemDark),
  );
  return document.written();
};

// The boot script paints before the app loads; the app must land on the same theme, or it flashes.
describe("theme before and after the app loads", () => {
  it.each([
    { stored: undefined, onLight: "light", onDark: "dark" },
    { stored: '"system"', onLight: "light", onDark: "dark" },
    ...THEME_IDS.map((id) => ({ stored: JSON.stringify(id), onLight: id, onDark: id })),
    { stored: '"midnight"', onLight: "light", onDark: "dark" },
    { stored: "dark", onLight: "light", onDark: "dark" },
    { stored: '["dark"]', onLight: "light", onDark: "dark" },
    { stored: '"__proto__"', onLight: "light", onDark: "dark" },
  ] as const)("stored $stored", ({ stored, onLight, onDark }) => {
    for (const [systemDark, id] of [
      [false, onLight],
      [true, onDark],
    ] as const) {
      expect(runBootScript(stored, systemDark)).toEqual(expected(id));
      expect(runRuntime(stored, systemDark)).toEqual(expected(id));
    }
  });
});
