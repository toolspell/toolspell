import { assert, describe, it } from "@effect/vitest";

import { isAllowedOrigin } from "./origin.ts";

const webOrigin = "http://localhost:28100";

describe("isAllowedOrigin", () => {
  it.each([
    {
      name: "the configured web origin",
      origin: webOrigin,
      host: "127.0.0.1:24100",
      allowed: true,
    },
    {
      name: "a page this server served",
      origin: "http://192.168.1.5:3883",
      host: "192.168.1.5:3883",
      allowed: true,
    },
    {
      name: "a non-browser client without Origin",
      origin: undefined,
      host: "127.0.0.1:3883",
      allowed: true,
    },
    {
      name: "another port on the same host",
      origin: "http://127.0.0.1:8080",
      host: "127.0.0.1:3883",
      allowed: false,
    },
    {
      name: "another site",
      origin: "https://evil.example",
      host: "127.0.0.1:3883",
      allowed: false,
    },
    { name: "a malformed Origin", origin: "null", host: "127.0.0.1:3883", allowed: false },
  ])("$name", ({ origin, host, allowed }) => {
    assert.strictEqual(isAllowedOrigin({ origin, host, webOrigin }), allowed);
  });
});
