// @effect-diagnostics nodeBuiltinImport:off - the OS account's home directory has no Effect service.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Hash from "effect/Hash";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

export interface ServerConfigShape {
  readonly version: string;
  /** Base data directory. Runtime state lives below `<homeDir>/userdata`. */
  readonly homeDir: string;
  readonly stateDir: string;
  readonly databasePath: string;
  readonly host: string;
  readonly port: number;
  /** Origin the user opens in a browser; differs from the server's in dev, where Vite serves it. */
  readonly webOrigin: string;
  /** Built web client to serve. Absent in dev, where Vite serves it. */
  readonly staticDir: Option.Option<string>;
  /** One-time admin pairing token handed over by a launcher such as the desktop app. */
  readonly bootstrapToken: Option.Option<Redacted.Redacted<string>>;
  /** Cookies do not isolate ports, so servers sharing a host need distinct cookie names. */
  readonly sessionCookieName: string;
  /** Set when the web origin is HTTPS, such as behind a TLS proxy. */
  readonly secureCookies: boolean;
}

export class ServerConfig extends Context.Service<ServerConfig, ServerConfigShape>()(
  "toolspell/config/ServerConfig",
) {}

export interface ServerConfigInput {
  readonly version: string;
  readonly homeDir: string;
  readonly host: string;
  readonly port: number;
  readonly webOrigin: Option.Option<string>;
  readonly staticDir: Option.Option<string>;
  readonly bootstrapToken: Option.Option<Redacted.Redacted<string>>;
}

export interface HomeHost {
  /** Lazy: without HOME and a passwd entry (some containers) it throws, and a flag needs none. */
  readonly homedir: () => string;
  readonly platform: NodeJS.Platform;
}

const nodeHost: HomeHost = { homedir: NodeOS.homedir, platform: process.platform };

/**
 * The `--home-dir` flag with a leading `~` expanded, or `~/.toolspell`. The OS account's home,
 * not `HOME`: Windows keeps it in USERPROFILE, and some services run without HOME.
 */
export const resolveHomeDir = (flag: string | undefined, host: HomeHost = nodeHost) => {
  const path = host.platform === "win32" ? NodePath.win32 : NodePath.posix;
  const raw = flag?.trim() ?? "";
  if (raw === "") return path.join(host.homedir(), ".toolspell");
  if (raw === "~") return host.homedir();
  if (raw.startsWith("~/") || raw.startsWith("~\\")) return path.join(host.homedir(), raw.slice(2));
  return raw;
};

const make = Effect.fn("ServerConfig.make")(function* (input: ServerConfigInput) {
  const path = yield* Path.Path;
  const homeDir = path.resolve(input.homeDir);
  const stateDir = path.join(homeDir, "userdata");
  const displayHost = input.host === "0.0.0.0" || input.host === "::" ? "localhost" : input.host;
  const webOrigin = Option.getOrElse(input.webOrigin, () => `http://${displayHost}:${input.port}`);
  return ServerConfig.of({
    version: input.version,
    homeDir,
    stateDir,
    databasePath: path.join(stateDir, "state.sqlite"),
    host: input.host,
    port: input.port,
    webOrigin,
    staticDir: input.staticDir,
    bootstrapToken: input.bootstrapToken,
    sessionCookieName: `toolspell_session_${(Hash.string(stateDir) >>> 0).toString(36)}`,
    secureCookies: webOrigin.startsWith("https:"),
  });
});

export const layer = (input: ServerConfigInput) => Layer.effect(ServerConfig, make(input));

/** For tests: an in-memory database and no network listener. */
export const layerTest = (overrides: Partial<ServerConfigShape> = {}) =>
  Layer.succeed(
    ServerConfig,
    ServerConfig.of({
      version: "0.0.0-test",
      homeDir: "/tmp/toolspell-test",
      stateDir: "/tmp/toolspell-test/userdata",
      databasePath: ":memory:",
      host: "127.0.0.1",
      port: 0,
      webOrigin: "http://localhost:0",
      staticDir: Option.none(),
      bootstrapToken: Option.none(),
      sessionCookieName: "toolspell_session_test",
      secureCookies: false,
      ...overrides,
    }),
  );
