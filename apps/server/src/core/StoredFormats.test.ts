import { assert, describe, it } from "@effect/vitest";
import { DomainEvent, Job, Workspace } from "@toolspell/contracts";
import * as Schema from "effect/Schema";

import { OutboxEffect } from "./Decider.ts";

// Rows as earlier builds stored them. Never edit one to make a schema change pass: a change
// that breaks a row here breaks every existing database, so add the field as optional or ship
// a migration that rewrites the rows. Add a row for each new record, event, or effect type.
const decoder = <S extends Schema.Top>(schema: S & Schema.Codec<S["Type"], S["Encoded"]>) =>
  Schema.decodeUnknownSync(Schema.fromJsonString(schema));

const ids = `"jobId":"j1","workspaceId":"w1"`;

const events: Record<DomainEvent["type"], string> = {
  "workspace.created": `{"type":"workspace.created","workspaceId":"w1","name":"Main"}`,
  "workspace.renamed": `{"type":"workspace.renamed","workspaceId":"w1","name":"Renamed"}`,
  "job.queued": `{"type":"job.queued",${ids},"input":"go"}`,
  "job.started": `{"type":"job.started",${ids}}`,
  "job.progressed": `{"type":"job.progressed",${ids},"progress":50,"message":null}`,
  "job.succeeded": `{"type":"job.succeeded",${ids},"output":"Echo: go"}`,
  "job.failed": `{"type":"job.failed",${ids},"error":"disk full"}`,
  "job.cancelled": `{"type":"job.cancelled",${ids}}`,
};

const effects: Record<OutboxEffect["type"], string> = {
  "job.run": `{"type":"job.run",${ids},"input":"go"}`,
  "job.cancel": `{"type":"job.cancel","jobId":"j1"}`,
};

const rows: ReadonlyArray<readonly [string, (json: string) => unknown, string]> = [
  [
    "Workspace",
    decoder(Workspace),
    `{"id":"w1","name":"Main","createdAt":1700000000000,"updatedAt":1700000000000}`,
  ],
  [
    "Job",
    decoder(Job),
    `{"id":"j1","workspaceId":"w1","input":"go","status":"succeeded","progress":100,` +
      `"message":null,"output":"Echo: go","error":null,"createdAt":1700000000000,` +
      `"updatedAt":1700000000001}`,
  ],
  ...Object.entries(events).map(([type, json]) => [type, decoder(DomainEvent), json] as const),
  ...Object.entries(effects).map(
    ([type, json]) => [`outbox ${type}`, decoder(OutboxEffect), json] as const,
  ),
];

describe("stored formats", () => {
  it.each(rows)("a stored %s row still decodes", (_name, decode, json) => {
    assert.doesNotThrow(() => decode(json));
  });
});
