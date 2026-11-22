import { assert, describe, it } from "@effect/vitest";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";

import { makeDevicePreferences, THEME_PREFERENCE_KEY } from "./preferences.ts";

const memoryStorage = (entries: Record<string, string>): Storage => {
  const map = new Map(Object.entries(entries));
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

const setup = (entries: Record<string, string>) => {
  const storage = memoryStorage(entries);
  const preferences = makeDevicePreferences({
    store: KeyValueStore.layerStorage(() => storage),
    themeIds: ["light", "dark"],
  });
  return { storage, registry: AtomRegistry.make(), preferences };
};

describe("device preferences", () => {
  // The first read must already be the stored value: the theme is applied from it at startup.
  it.each([
    { stored: undefined, expected: "system" },
    { stored: '"dark"', expected: "dark" },
    { stored: '"system"', expected: "system" },
    { stored: '"midnight"', expected: "system" },
    { stored: "dark", expected: "system" },
    { stored: '["dark"]', expected: "system" },
  ])("reads the theme $stored as $expected", ({ stored, expected }) => {
    const { registry, preferences } = setup(
      stored === undefined ? {} : { [THEME_PREFERENCE_KEY]: stored },
    );
    assert.strictEqual(registry.get(preferences.themeAtom), expected);
  });

  it("stores a chosen theme over a value that did not decode", () => {
    const { storage, registry, preferences } = setup({ [THEME_PREFERENCE_KEY]: "garbage" });
    registry.set(preferences.themeAtom, "dark");
    assert.strictEqual(registry.get(preferences.themeAtom), "dark");
    assert.strictEqual(storage.getItem(THEME_PREFERENCE_KEY), '"dark"');
  });
});
