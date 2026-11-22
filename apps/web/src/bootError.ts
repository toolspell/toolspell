/**
 * Replaces the page with the startup error and a reload button. Plain DOM, because React may
 * be what failed; `scripts/verify-built-boot.ts` looks for the button to tell a failed boot.
 */
export function showBootError(error: unknown) {
  console.error(error);
  const element = (tag: string, className: string, text: string) => {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  };
  const reload = element("button", "rounded-md border px-3 py-1.5 text-sm", "Reload");
  reload.id = "boot-error-reload";
  reload.addEventListener("click", () => window.location.reload());
  const panel = element(
    "div",
    "flex min-h-screen flex-col items-center justify-center gap-3 p-6",
    "",
  );
  panel.id = "boot-error";
  panel.append(
    element("h1", "text-lg font-semibold", "ToolSpell could not start"),
    element("p", "max-w-md text-center text-sm text-muted-foreground", String(error)),
    reload,
  );
  (document.getElementById("root") ?? document.body).replaceChildren(panel);
}
