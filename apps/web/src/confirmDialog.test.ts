import { describe, expect, it } from "vite-plus/test";

import {
  completeConfirmClose,
  confirm,
  readConfirmDialog,
  respondToConfirm,
  subscribeConfirmDialog,
} from "./confirmDialog";

const revoke = { title: "Revoke this device?", confirmLabel: "Revoke", destructive: true };
const signOut = { title: "Sign out of this browser?", confirmLabel: "Sign out" };

// Each test mounts its own host and unmounts it, which resets the module's state.
describe("confirm", () => {
  it("asks one question at a time and keeps the text while the dialog closes", async () => {
    const unmount = subscribeConfirmDialog(() => {});
    const first = confirm(revoke);
    const second = confirm(signOut);
    expect(readConfirmDialog()).toEqual({ open: true, options: revoke });

    respondToConfirm(true);
    await expect(first).resolves.toBe(true);
    expect(readConfirmDialog()).toEqual({ open: false, options: revoke });

    completeConfirmClose();
    expect(readConfirmDialog()).toEqual({ open: true, options: signOut });
    respondToConfirm(false);
    await expect(second).resolves.toBe(false);
    completeConfirmClose();
    expect(readConfirmDialog()).toEqual({ open: false, options: null });
    unmount();
  });

  it("answers no without a host, and when the last host unmounts", async () => {
    await expect(confirm(revoke)).resolves.toBe(false);

    const unmount = subscribeConfirmDialog(() => {});
    const open = confirm(revoke);
    const queued = confirm(signOut);
    unmount();
    await expect(Promise.all([open, queued])).resolves.toEqual([false, false]);
    expect(readConfirmDialog()).toEqual({ open: false, options: null });
  });
});
