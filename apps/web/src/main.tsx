import { RegistryContext } from "@effect/atom-react";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import * as Effect from "effect/Effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { atoms, errorMessage, pairingErrorAtom } from "./client.ts";
import { routeTree } from "./routeTree.gen.ts";
import "./styles.css";

const registry = AtomRegistry.make();

// A pairing link carries its token in the URL fragment, which browsers never send to
// a server, so it stays out of logs. It is exchanged once, before the first render,
// and removed from history so a reload or a shared screenshot cannot reuse it.
const consumePairingToken = async () => {
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  if (token === null) return;
  window.history.replaceState(null, "", "/");
  try {
    await Effect.runPromise(atoms.pair(token));
  } catch (error) {
    registry.set(pairingErrorAtom, errorMessage(error));
  }
};

// Follow the system theme; shadcn's tokens switch on the `dark` class.
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => document.documentElement.classList.toggle("dark", darkQuery.matches);
darkQuery.addEventListener("change", applyTheme);
applyTheme();

await consumePairingToken();

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RegistryContext.Provider value={registry}>
      <RouterProvider router={router} />
    </RegistryContext.Provider>
  </StrictMode>,
);
