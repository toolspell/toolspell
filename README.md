# Toolspell

A server that owns state and execution, with web and desktop clients that control it over
authenticated WebSocket RPC. Run it on your machine and use it from the desktop app, a browser, or
another device.

## Stack

- **Server** ([`apps/server`](apps/server)): Node with Effect 4, WebSocket RPC, SQLite. An
  event-sourced core decides commands without I/O, commits events, projections, and side effects
  in one transaction, and runs the side effects afterwards.
- **Web** ([`apps/web`](apps/web)): React 19, Vite, TanStack Router, Tailwind 4, shadcn on Base UI,
  React Compiler.
- **Desktop** ([`apps/desktop`](apps/desktop)): Electron, running the bundled server.
- **Shared** ([`packages`](packages)): the typed wire contract and the client runtime every client
  uses.

## Develop

```bash
vp i
vp run dev
```

Open the `pairingUrl:` the server prints. Before you push, run `vp run check:changed`.

- [Development runbook](docs/operations/development.md)
- [Architecture overview](docs/internals/overview.md)
- [Agent guide](AGENTS.md)

## Contributing

Review capacity is small, so focused bug fixes are the most likely to land. Read
[CONTRIBUTING.md](CONTRIBUTING.md) before you open an issue or a pull request. Report
vulnerabilities privately, as [SECURITY.md](SECURITY.md#report-a-vulnerability) describes.

## License

- Toolspell is licensed under the MIT License; see [LICENSE](LICENSE).
- Its architecture is inspired by [T3 Code](https://github.com/pingdotgg/t3code), and portions are
  adapted from it; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- The MIT License covers the code, not the Toolspell name or logo.
