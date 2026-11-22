# Pairing and access

Every browser or device signs in to your ToolSpell server by opening a pairing link once. After
that it stays signed in until you sign it out or revoke it.

## Pair another device

- From a paired device: open **Settings → Devices** and choose **Create pairing link**. Open the
  link on the new device.
- From the server's machine, while the server runs: run `toolspell pair`, with the same
  `--home-dir` if the server uses one. Add `--admin` to let the new device manage access too.

A link works once and expires after 10 minutes. A device can only hand out the permissions it has
itself.

## Permissions

| Permission | Allows                                                         |
| ---------- | -------------------------------------------------------------- |
| read       | Seeing workspaces and jobs as they change.                     |
| operate    | Creating and renaming workspaces, starting and canceling jobs. |
| admin      | Pairing devices and revoking sessions.                         |

Links from **Settings → Devices** grant read and operate. The desktop app and the link the server
prints at startup grant all three.

## Revoke a device

Open **Settings → Devices** and choose **Revoke** next to the device, or **Sign out** for the one
you are using. A revoked device is disconnected right away and shows the pairing screen.

## If a link does not work

If the pairing screen says the link did not work, it was already used or has expired. Create a new one as
described above. Links contain a secret: share them only with the device you want to pair.
