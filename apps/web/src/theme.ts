import type { DesktopBridge } from "@toolspell/contracts/desktop";
import * as Record from "effect/Record";
import type * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

declare global {
  interface Window {
    readonly toolspellDesktop?: DesktopBridge;
  }
}

type Appearance = "light" | "dark";

/**
 * The built-in themes. Their tokens live in styles.css: light's in `:root`, dark's in `.dark`,
 * and any other theme's in a `:root[data-theme="<id>"]` block over its appearance's base.
 * `chrome` is the theme's --background as hex, for the browser bar and the desktop window.
 */
export const THEMES = {
  light: { label: "Light", appearance: "light", chrome: "#ffffff" },
  dark: { label: "Dark", appearance: "dark", chrome: "#0a0a0a" },
} as const satisfies Record.ReadonlyRecord<
  string,
  { readonly label: string; readonly appearance: Appearance; readonly chrome: string }
>;

export type ThemeId = keyof typeof THEMES;
export type ThemePreference = "system" | ThemeId;

export const THEME_IDS = Record.keys(THEMES);

/** `system` picks the built-in theme for the OS appearance. */
export const resolveTheme = (preference: ThemePreference, systemDark: boolean): ThemeId =>
  preference !== "system" ? preference : systemDark ? "dark" : "light";

/** The parts of a document a theme writes to. The boot script in index.html does the same. */
interface ThemeTarget {
  readonly documentElement: {
    readonly dataset: DOMStringMap;
    readonly classList: { toggle(token: string, force?: boolean): boolean };
    readonly style: { colorScheme: string };
  };
  querySelector(selectors: string): { setAttribute(name: string, value: string): void } | null;
}

export const applyTheme = (target: ThemeTarget, id: ThemeId) => {
  const { appearance, chrome } = THEMES[id];
  const root = target.documentElement;
  root.dataset.theme = id;
  root.classList.toggle("dark", appearance === "dark");
  root.style.colorScheme = appearance;
  target.querySelector('meta[name="theme-color"]')?.setAttribute("content", chrome);
};

/** Keeps the page, and the desktop window around it, on the preferred theme. */
export const syncTheme = (
  registry: AtomRegistry.AtomRegistry,
  preference: Atom.Atom<ThemePreference>,
) => {
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () =>
    applyTheme(document, resolveTheme(registry.get(preference), systemDark.matches));
  systemDark.addEventListener("change", apply);
  registry.subscribe(
    preference,
    (value) => {
      apply();
      // Only the window's background and pre-load pages follow this; the page already did.
      window.toolspellDesktop
        ?.setTheme(value === "system" ? "system" : THEMES[value].appearance)
        .catch(() => {});
    },
    { immediate: true },
  );
};
