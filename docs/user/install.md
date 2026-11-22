# Run ToolSpell

ToolSpell runs as a server on your machine. You use it from the desktop app, or from a browser on
the same machine or another device.

## Desktop

Open the ToolSpell app. It starts its own server and signs itself in; there is nothing to set up.
Only one copy of the app runs at a time. On macOS, closing the window keeps ToolSpell running; click
its Dock icon to open it again, and quit it from the menu to stop the server.

If the server keeps stopping, the app shows the end of its log. The full log is `server.log` in
`~/Library/Logs/ToolSpell` on macOS, `%APPDATA%\ToolSpell\logs` on Windows, and
`~/.config/ToolSpell/logs` on Linux.

## Server and browser

Run the server from a terminal:

```bash
toolspell
```

It prints a `pairingUrl:` link. Open it in your browser to sign in; the link works once and
expires after 10 minutes. The server keeps its data in `~/.toolspell`.

Useful flags:

- `--port <port>` picks the port (default 3883).
- `--host <address>` makes the server reachable from other devices, for example on your local
  network or tailnet. The default only accepts connections from this machine.
- `--home-dir <dir>` keeps the data somewhere else.

Only one server can use a data directory at a time. Stop the desktop app before running the server
on the same data, or give one of them another `--home-dir`.

To use ToolSpell from another device, see [Pairing and access](./pairing-and-access.md).
