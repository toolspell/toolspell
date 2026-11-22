import { describe, expect, it, vi } from "vite-plus/test";

import { isChunkLoadError, reloadOnceForChunkLoadError } from "./chunkReloadGuard";

const memoryStorage = () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  } as Storage;
  return () => storage;
};

describe("reloadOnceForChunkLoadError", () => {
  it("reloads on the first failure of a build and lets the next one surface", () => {
    const storage = memoryStorage();
    const reload = vi.fn();

    expect(reloadOnceForChunkLoadError(storage, reload, "build-1")).toBe(true);
    expect(reloadOnceForChunkLoadError(storage, reload, "build-1")).toBe(false);
    expect(reload).toHaveBeenCalledOnce();

    expect(reloadOnceForChunkLoadError(storage, reload, "build-2")).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("never reloads when storage is blocked, so a lasting failure cannot loop", () => {
    const reload = vi.fn();
    const blocked = () => {
      throw new DOMException("blocked", "SecurityError");
    };

    expect(reloadOnceForChunkLoadError(blocked, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("isChunkLoadError", () => {
  it.each([
    ["Failed to fetch dynamically imported module: http://localhost/assets/a.js", true],
    ["error loading dynamically imported module: http://localhost/assets/a.js", true],
    ["Importing a module script failed.", true],
    ["Cannot read properties of undefined", false],
  ])("%s", (message, expected) => {
    expect(isChunkLoadError(new TypeError(message))).toBe(expected);
  });
});
