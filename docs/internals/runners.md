# Runners

A runner is how Toolspell hands a job to something outside its own code (a CLI, a remote API, a
model) and gets progress and a result back. Everything past the
[runner interface](../../apps/server/src/runners/Runner.ts) is normalized: the decider, the event
log, subscriptions, and clients never know which runner ran a job. Adapted from T3 Code's provider
constraints, which are its runners.

## When a runner fits

Use a runner for work that takes time, can be cancelled, can fail, and must still show up correctly
after a restart. Quick reads (a config file, a folder listing) and pure app logic stay ordinary
services or decider rules. A runner is not a place for business decisions: it reports what happened,
and the decider decides what that means for the job.

## The contract

`run({ jobId, input })` returns a stream of `progress` updates followed by exactly one `completed`
update. The [effect worker](../../apps/server/src/core/EffectWorker.ts) turns each update into an
internal command, so a report that arrives after a cancel is dropped by the decider instead of
reviving the job.

- **Cancel stops the outside work.** Cancelling interrupts the stream. The runner must release what
  it started: kill the process tree, abort the request. A stream that ignores interruption leaves
  work running that the user believes is stopped.
- **Every way out settles the job.** Completion, cancel, a typed `RunnerError`, a defect, and the
  outside process dying must each end the job. The worker fails a job on any failure, a defect
  included, so a runner never needs to catch its own crashes; it must still avoid ending the
  stream without a `completed` update when the work succeeded.
- **Errors carry a message a user can act on.** `RunnerError.message` is shown as the job's error.
  Translate the outside system's codes; keep raw output for logs.
- **Report only what the system does.** Progress is an integer from 0 to 100 (the worker clamps
  loose values). If the outside system reports no progress, send messages, not invented numbers.
- **Jobs do not resume across restarts.** A job left `running` when the server stopped fails on the
  next start, because its runner is gone. A runner that can reattach to outside work (it has an
  external job ID) is a future capability, not something to imitate by rerunning the input.

## Traps

- **Cancel right after start.** A cancel can reach the outside system before it registered the work,
  which may then ignore it and run to completion. Find the system's own "started" signal and test a
  cancel sent immediately after starting.
- **Status checks have no side effects.** Probing whether a tool is installed or signed in must not
  start work, run hooks, or open a login flow. Keep heavier probes behind an explicit action.
- **Credentials belong to the server.** A runner reads its configuration and secrets on the server,
  never from the client, and drops inherited credentials it was not configured with, so two setups
  cannot silently share an account.
- **Processes and environment.** Spawn through Effect's `ChildProcess`, which kills the whole tree,
  also on Windows. Do not pass Toolspell's own variables (such as `ELECTRON_RUN_AS_NODE`) to child
  processes. A desktop app launched from Finder or the Start menu has a minimal `PATH`, so a tool
  found in development can be missing in the installed app (see the [backlog](../backlog.md)).
  Test a symlinked working directory, such as macOS `/tmp`.

## Several runners

When Toolspell grows a second runner, select it through a registry keyed by what the job asks for,
and describe differences as capabilities the decider and clients read, never as checks on the
runner's name. A capability that is advertised but fails at runtime is a bug; turn it off instead.

## Tests

- Unit tests use a scripted runner layer: see the fakes in
  [`Orchestration.test.ts`](../../apps/server/src/core/Orchestration.test.ts) and the
  [test kit](../../apps/server/src/testkit.ts). Block on a `Deferred` to hold a job running; never
  sleep.
- A real runner proves its protocol handling with recorded transcripts from the real system,
  replayed through the real worker and projections. Hand-written frames are a guess about the
  protocol. A gated live test is welcome but does not replace replays, because CI skips it.
- Cover each way out: completion, cancel, runner error, and the outside process dying.

## Where a runner plugs in

The [fake runner](../../apps/server/src/runners/FakeRunner.ts) is the template. The CLI picks the
runner layer in [`bin.ts`](../../apps/server/src/bin.ts) and passes it to
[`server.ts`](../../apps/server/src/server.ts); nothing else needs to change.
