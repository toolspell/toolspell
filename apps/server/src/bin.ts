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
import { announceReady, readBootstrapToken } from "./bootstrap.ts";
import * as ServerConfig from "./config.ts";
import * as RuntimeState from "./persistence/RuntimeState.ts";
import * as FakeRunner from "./runners/FakeRunner.ts";
import * as Server from "./server.ts";

const DEFAULT_PORT = 3883;

const homeDirFlag = Flag.String("home-dir").pipe(
  Flag.withDescription(
    "Data directory (default ~/.toolspell, or the checkout's .toolspell when run from source). Runtime state lives in its userdata.",
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
    homeDir: ServerConfig.resolveHomeDir(Option.getOrUndefined(flags.homeDir)),
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
    admin: Flag.Boolean("admin").pipe(
      Flag.withDescription("Also allow managing access (pairing devices, revoking sessions)."),
      Flag.withDefault(false),
    ),
  },
  (flags) =>
    Effect.gen(function* () {
      // Before storage opens, so pair never creates or migrates a home no server uses.
      const server = yield* RuntimeState.findRunning();
      const grant = yield* Effect.gen(function* () {
        const auth = yield* AuthStore;
        return yield* auth.createPairingGrant(flags.admin ? ALL_AUTH_SCOPES : STANDARD_AUTH_SCOPES);
      }).pipe(Effect.provide(Server.layerAuth));
      yield* Console.log(`pairingUrl: ${server.webOrigin}/pair#token=${grant.token}`);
    }).pipe(
      Effect.provide(
        ServerConfig.layer({
          version: packageJson.version,
          homeDir: ServerConfig.resolveHomeDir(Option.getOrUndefined(flags.homeDir)),
          // Only the home matters here; the running server's file has its origins.
          host: "127.0.0.1",
          port: 0,
          webOrigin: Option.none(),
          staticDir: Option.none(),
          bootstrapToken: Option.none(),
        }),
      ),
    ),
).pipe(
  Command.withDescription(
    "Print a one-time link that pairs another browser or device with the running server.",
  ),
);

/**
 * Set by a launcher for this process only. A child that inherited them would read an unrelated
 * fd 3 as a token, tie its life to its own stdin, or run an Electron app as plain Node.
 */
const LAUNCHER_ENV = [
  "ELECTRON_RUN_AS_NODE",
  "TOOLSPELL_BOOTSTRAP_FD",
  "TOOLSPELL_READY_FD",
  "TOOLSPELL_EXIT_WITH_STDIN",
];

/**
 * A launcher such as the desktop app holds stdin open as a lifeline; its end closes when the
 * launcher dies, even by SIGKILL. The server then ends its program so finalizers run, which no
 * signal does on Windows.
 */
const launcherGone = Effect.callback<void>((resume) => {
  const gone = () => resume(Effect.void);
  process.stdin.once("end", gone).once("close", gone).once("error", gone).resume();
  return Effect.sync(() => process.stdin.pause());
}).pipe(Effect.andThen(Effect.logInfo("The launcher closed stdin; shutting down.")));

const serverCommand = Command.make(
  "toolspell",
  { homeDir: homeDirFlag, webOrigin: webOriginFlag, port: portFlag, host: hostFlag },
  (flags) =>
    Effect.gen(function* () {
      const exitWithStdin = yield* Config.Boolean("TOOLSPELL_EXIT_WITH_STDIN").pipe(
        Config.withDefault(false),
      );
      const readyFd = yield* Config.Int("TOOLSPELL_READY_FD").pipe(Config.option);
      const config = yield* configLayer(flags);
      yield* Effect.sync(() => LAUNCHER_ENV.forEach((name) => delete process.env[name]));
      const server = Layer.launch(
        Server.layer(FakeRunner.layer(), announceReady(readyFd)).pipe(Layer.provide(config)),
      );
      return yield* exitWithStdin ? Effect.raceFirst(server, launcherGone) : server;
    }),
).pipe(
  Command.withDescription("Run the ToolSpell server."),
  Command.withSubcommands([pairCommand]),
);

// Logs go to stdout and stderr, which may be a closed launcher pipe or a full disk. Node raises a
// failed write as an unhandled error that kills the server mid-shutdown, so drop the line instead.
process.stdout.on("error", () => {});
process.stderr.on("error", () => {});

// Exit codes: 0 when the launcher closed stdin, 130 after a signal, 1 on a failure, and
// SERVER_EXIT_CODE_HOME_IN_USE (78, in @toolspell/contracts/desktop) when another server holds the
// home. Restarting cannot fix 78, so launchers such as the desktop app report it instead.
Command.run(serverCommand, { version: packageJson.version }).pipe(
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
