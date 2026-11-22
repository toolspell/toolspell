import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";

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

export const make = Effect.fn("ServerConfig.make")(function* (input: ServerConfigInput) {
  const path = yield* Path.Path;
  const homeDir = path.resolve(input.homeDir);
  const stateDir = path.join(homeDir, "userdata");
  const displayHost = input.host === "0.0.0.0" || input.host === "::" ? "localhost" : input.host;
  return ServerConfig.of({
    version: input.version,
    homeDir,
    stateDir,
    databasePath: path.join(stateDir, "state.sqlite"),
    host: input.host,
    port: input.port,
    webOrigin: Option.getOrElse(input.webOrigin, () => `http://${displayHost}:${input.port}`),
    staticDir: input.staticDir,
    bootstrapToken: input.bootstrapToken,
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
      ...overrides,
    }),
  );
