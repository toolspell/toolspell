import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { confirm } from "~/confirmDialog";

import { render } from "../../test/render";
import { ConfirmDialogHost } from "./ConfirmDialogHost";

it("answers with the user's choice, one question at a time, starting on Cancel", async () => {
  // The host is mounted alone; nothing here navigates.
  await using _screen = await render(<ConfirmDialogHost />, { router: false });
  const revoke = confirm({ title: "Revoke Laptop?", confirmLabel: "Revoke", destructive: true });
  const signOut = confirm({ title: "Sign out of this browser?", confirmLabel: "Sign out" });

  await expect.element(page.getByRole("button", { name: "Cancel" })).toHaveFocus();
  await userEvent.keyboard("{Tab}");
  await expect.element(page.getByRole("button", { name: "Revoke" })).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  await expect(revoke).resolves.toBe(true);

  await expect
    .element(page.getByRole("alertdialog", { name: "Sign out of this browser?" }))
    .toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect(signOut).resolves.toBe(false);
  await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
});
