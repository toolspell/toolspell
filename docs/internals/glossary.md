# Glossary

Shared vocabulary for code, docs, and conversations. It defines terms; it is not a feature index.

## Environment

| Term           | Meaning                                                                          |
| -------------- | -------------------------------------------------------------------------------- |
| environment    | One running ToolSpell server and the machine, files, and state it owns.          |
| ToolSpell home | The base data directory (`~/.toolspell`, or the checkout's `.toolspell` in dev). |
| userdata       | The home's runtime state directory: the database and the server lock.            |
| client         | The web or desktop UI. Clients control an environment; they never own its state. |
| session        | A paired client's credential, carried as an HttpOnly cookie, with scopes.        |
| pairing grant  | A one-time, short-lived token that opens a session.                              |
| scope          | `read`, `operate`, or `admin`: what a session may call.                          |

## Domain

The domain is a placeholder meant to be renamed; the mechanics stay.

| Term      | Meaning                                                                     |
| --------- | --------------------------------------------------------------------------- |
| workspace | A named container that owns jobs.                                           |
| job       | One unit of work with an input, a status, progress, and an output or error. |
| runner    | The adapter that executes a job against an outside system.                  |

## Orchestration

| Term          | Meaning                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------ |
| command       | A request to change state. Client commands carry a client-generated `commandId`.           |
| decider       | The pure function that turns a command and current records into events and outbox effects. |
| event         | A stored fact with a sequence number. Events are replayed, so they stay decodable forever. |
| sequence      | An event's position in the log; clients resume subscriptions after one.                    |
| projection    | A read-model record built from events, such as a workspace or a job.                       |
| receipt       | The record that a command was accepted, so a retry returns the original result.            |
| outbox        | Side effects stored in the same transaction as their events, run afterwards.               |
| effect worker | The process that runs outbox effects and reports results back as internal commands.        |
| snapshot      | The current projections plus the sequence they reflect, sent when a subscription starts.   |
