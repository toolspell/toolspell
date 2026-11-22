import { expect, it, vi } from "vite-plus/test";

import { randomUUID } from "./randomUUID.ts";

it("makes a valid v4 UUID when crypto.randomUUID is unavailable", () => {
  vi.stubGlobal("crypto", {
    getRandomValues: crypto.getRandomValues.bind(crypto),
  });
  try {
    const id = randomUUID();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(randomUUID()).not.toBe(id);
  } finally {
    vi.unstubAllGlobals();
  }
});
