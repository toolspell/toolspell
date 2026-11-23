# Pairing and access

Every browser or device signs in to your Toolspell server by opening a pairing link once. After
that it stays signed in until you sign it out or revoke it.

## Pair another device

- From a paired device with the admin permission: open **Settings → Devices** and choose
  **Create pairing link**. Open the link on the new device.
- From the server's machine, while the server runs: run `toolspell pair`, with the same
  `--home-dir` if the server uses one. Add `--admin` to let the new device manage access too.

A link works once and expires after 10 minutes. A device can only hand out the permissions it has
itself.

## Permissions

| Permission | Allows                                                         |
| ---------- | -------------------------------------------------------------- |
| read       | Seeing workspaces and jobs as they change.                     |
| operate    | Creating and renaming workspaces, starting and canceling jobs. |
| admin      | Seeing paired devices, pairing new ones, and revoking them.    |

Links from **Settings → Devices** grant read and operate. The desktop app and the link the server
prints at startup grant all three. **Settings → Devices** appears only on devices with admin; every
device can sign itself out.

## Sign out or revoke a device

- To sign out the browser you are using, open **Settings → This browser** and choose **Sign out**.
  The desktop app has no sign-out: it signs itself in each time it starts.
- To revoke another device, open **Settings → Devices** on a device with admin and choose
  **Revoke** next to it.

Confirm, and the device is disconnected right away and shows the pairing screen.

## If a link does not work

If the pairing screen says the link did not work, it was already used or has expired. Create a new one as
described above. Links contain a secret: share them only with the device you want to pair.
