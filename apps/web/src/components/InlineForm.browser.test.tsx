import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { InlineForm } from "./InlineForm";

const form = (onSubmit: (value: string) => Promise<unknown>) => (
  <InlineForm
    label="Job input"
    placeholder="Describe a job"
    submitLabel="Start job"
    onSubmit={onSubmit}
  />
);

describe("InlineForm", () => {
  it("submits on Enter, holds the button while pending, and clears on success", async () => {
    let finish = () => {};
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    await using screen = await render(form(onSubmit));
    const input = screen.getByRole("textbox", { name: "Job input" });
    const button = screen.getByRole("button", { name: "Start job" });

    await userEvent.type(input, "  build the docs {Enter}");
    await expect.element(button).toBeDisabled();
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("build the docs");

    finish();
    await expect.element(input).toHaveValue("");
    await expect.element(input).toHaveFocus();
  });

  it("keeps the value and shows the error when the submit is rejected", async () => {
    const onSubmit = vi.fn(() => Promise.reject({ message: "Workspace is archived" }));
    await using screen = await render(form(onSubmit));
    const input = screen.getByRole("textbox", { name: "Job input" });

    await userEvent.fill(input, "build the docs");
    await userEvent.click(screen.getByRole("button", { name: "Start job" }));

    await expect.element(screen.getByRole("alert")).toHaveTextContent("Workspace is archived");
    await expect.element(input).toHaveValue("build the docs");
    await expect.element(screen.getByRole("button", { name: "Start job" })).toBeEnabled();
  });
});
