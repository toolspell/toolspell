import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { Button } from "~/components/ui/button";
import { Toaster } from "~/components/ui/toast";

import { render } from "../../test/render";
import { useAction } from "./useAction";

function SaveButton({ action }: { readonly action: () => Promise<unknown> }) {
  const save = useAction(action, "Could not save");
  return (
    <Button disabled={save.pending} onClick={() => save.run()}>
      Save
    </Button>
  );
}

it("holds the button while the action runs and toasts its failure", async () => {
  let fail = (_cause: unknown) => {};
  const action = () => new Promise((_resolve, reject) => (fail = reject));
  // A bare hook probe; nothing here navigates.
  await using screen = await render(
    <>
      <SaveButton action={action} />
      <Toaster />
    </>,
    { router: false },
  );
  const button = screen.getByRole("button", { name: "Save" });

  await userEvent.click(button);
  await expect.element(button).toBeDisabled();

  fail({ message: "Workspace is archived" });
  await expect.element(page.getByText("Could not save")).toBeVisible();
  await expect.element(page.getByText("Workspace is archived")).toBeVisible();
  await expect.element(button).toBeEnabled();
});
