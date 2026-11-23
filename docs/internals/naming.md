<!-- naming-allow-file: this guideline lists the spellings it forbids -->

# Naming

The product name is one word. Agents and people search, type, and install by it, so one spelling
everywhere keeps code, logs, docs, and the web on a single search term.

## Forms

| Where                                                             | Form                                                                                                                              |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Text people read: docs, UI, window title, app name, chat          | Toolspell (dev builds: Toolspell Dev)                                                                                             |
| Code, types, and trace names                                      | `Toolspell`: `ToolspellRpcs`, `makeToolspellAtoms`                                                                                |
| Code, lower camel case                                            | `toolspell`: `toolspellDesktop`                                                                                                   |
| CLI command                                                       | `toolspell`                                                                                                                       |
| Packages                                                          | `@toolspell/*`; the server package is `toolspell`                                                                                 |
| Folders                                                           | `~/.toolspell`, `.toolspell/`                                                                                                     |
| Storage keys, cookies, internal messages, lint rules, service IDs | `toolspell:`, `toolspell_`, `toolspell/`                                                                                          |
| Environment variables                                             | `TOOLSPELL_`                                                                                                                      |
| Link scheme                                                       | `toolspell://`                                                                                                                    |
| App IDs (desktop, stores)                                         | A reversed domain, such as `com.toolspell.desktop`, with `.dev` for dev builds. Fixed at the first signed build or store listing. |
| Social handles, taken package names                               | The full name plus a suffix (`toolspellhq`) or a namespace (`@toolspell/…`), never `tspell`                                       |

## Agents read one name

Docs, skills, `AGENTS.md`, examples, error messages, and help output use only `toolspell`. Agents
guess commands from the product name, try to install a missing command by that name, and do not
load personal shell aliases.

## The short form `tspell`

- Recommended as the prefix of secret tokens: `tspell_<type>_…`, so secret scanners and people
  recognize a leaked token and its kind.
- Allowed by deliberate choice where `toolspell` does not fit: service users and process names
  with length limits, short links and slugs, non-secret ID prefixes, a personal shell alias.
  Explain it once next to `toolspell` wherever people or agents read it.

## Never

- `TS` or `ts` as a short form of the name (TypeScript, Tailscale, and ts-node use it).
- `ToolSpell`, `Tool Spell`, `tool-spell`, or `TOOL_SPELL_`.
- `tspell` as a social handle, package name, environment variable prefix, or the command in docs.

## Intentional exceptions

`vp run check:naming` ([`scripts/check-naming.ts`](../../scripts/check-naming.ts)) runs in the
commit hook, in `check:changed`, and in CI. It rejects misspellings everywhere, the short form in
code, and the short form as a command in Markdown. A deliberate use carries a reason:

- `naming-allow: <reason>` on the line or the line above, in code;
- `naming-allow-file: <reason>` in the first five lines, for a file that has to show the forbidden
  forms, such as this guideline.
