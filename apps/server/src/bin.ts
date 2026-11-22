import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ALL_AUTH_SCOPES, STANDARD_AUTH_SCOPES } from "@toolspell/contracts";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { Command, Flag } from "effect/cli";

import packageJson from "../package.json" with { type: "json" };
import { AuthStore } from "./auth/AuthStore.ts";
import { readBootstrapToken } from "./bootstrap.ts";
import * as ServerConfig from "./config.ts";
import * as FakeRunner from "./runners/FakeRunner.ts";
import * as Server from "./server.ts";

const DEFAULT_PORT = 3883;

const homeDirFlag = Flag.String("home-dir").pipe(
  Flag.withDescription(
    "Data directory (default ~/.toolspell). Runtime state lives in its userdata.",
  ),
  Flag.withFallbackConfig(Config.String("TOOLSPELL_HOME")),
  Flag.optional,
);
const webOriginFlag = Flag.String("web-origin").pipe(
  Flag.withDescription("Origin the browser opens, for printed links. Defaults to this server."),
  Flag.withFallbackConfig(Config.String("TOOLSPELL_WEB_URL")),
  Flag.optional,
);
const portFlag = Flag.Int("port").pipe(
  Flag.withDescription("Port for HTTP and WebSocket."),
  Flag.withFallbackConfig(Config.Int("TOOLSPELL_PORT")),
  Flag.withDefault(DEFAULT_PORT),
);
const hostFlag = Flag.String("host").pipe(
  Flag.withDescription(
    "Interface to bind. Use 0.0.0.0 or a tailnet IP to reach it from other devices.",
  ),
  Flag.withFallbackConfig(Config.String("TOOLSPELL_HOST")),
  Flag.withDefault("127.0.0.1"),
);

const resolveHomeDir = Effect.fn("bin.resolveHomeDir")(function* (flag: Option.Option<string>) {
  const path = yield* Path.Path;
  const home = yield* Config.String("HOME").pipe(Config.withDefault("."));
  return Option.getOrElse(flag, () => path.join(home, ".toolspell"));
});

/** A production build ships the web client beside the server bundle. */
const bundledClientDir = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = path.join(import.meta.dirname, "client");
  return (yield* fs.exists(path.join(dir, "index.html")).pipe(Effect.orElseSucceed(() => false)))
    ? Option.some(dir)
    : Option.none<string>();
});

const configLayer = Effect.fn("bin.configLayer")(function* (flags: {
  readonly homeDir: Option.Option<string>;
  readonly webOrigin: Option.Option<string>;
  readonly port: number;
  readonly host: string;
}) {
  return ServerConfig.layer({
    version: packageJson.version,
    homeDir: yield* resolveHomeDir(flags.homeDir),
    host: flags.host,
    port: flags.port,
    webOrigin: flags.webOrigin,
    staticDir: yield* bundledClientDir,
    bootstrapToken: yield* readBootstrapToken(
      yield* Config.Int("TOOLSPELL_BOOTSTRAP_FD").pipe(Config.option),
    ),
  });
});

const pairCommand = Command.make(
  "pair",
  {
    homeDir: homeDirFlag,
    webOrigin: webOriginFlag,
    port: portFlag,
    admin: Flag.Boolean("admin").pipe(
      Flag.withDescription("Also allow managing access (pairing devices, revoking sessions)."),
      Flag.withDefault(false),
    ),
  },
  (flags) =>
    Effect.gen(function* () {
      const auth = yield* AuthStore;
      const config = yield* ServerConfig.ServerConfig;
      const grant = yield* auth.createPairingGrant(
        flags.admin ? ALL_AUTH_SCOPES : STANDARD_AUTH_SCOPES,
      );
      yield* Console.log(`pairingUrl: ${config.webOrigin}/pair#token=${grant.token}`);
    }).pipe(
      Effect.provide(
        Layer.unwrap(
          Effect.map(configLayer({ ...flags, host: "127.0.0.1" }), (config) =>
            Server.layerAuth.pipe(Layer.provideMerge(config)),
          ),
        ),
      ),
    ),
).pipe(Command.withDescription("Print a one-time link that pairs another browser or device."));

const serverCommand = Command.make(
  "toolspell",
  { homeDir: homeDirFlag, webOrigin: webOriginFlag, port: portFlag, host: hostFlag },
  (flags) =>
    Layer.launch(
      Layer.unwrap(
        Effect.map(configLayer(flags), (config) =>
          Server.layer(FakeRunner.layer()).pipe(Layer.provide(config)),
        ),
      ),
    ),
).pipe(
  Command.withDescription("Run the ToolSpell server."),
  Command.withSubcommands([pairCommand]),
);

// A launcher such as the desktop app holds stdin open as a lifeline. When it dies, even by
// SIGKILL, the pipe closes and the server shuts down instead of holding the home lock.
if (process.env.TOOLSPELL_EXIT_WITH_STDIN === "1") {
  process.stdin.on("end", () => process.kill(process.pid, "SIGTERM"));
  process.stdin.resume();
}

Command.run(serverCommand, { version: packageJson.version }).pipe(
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
