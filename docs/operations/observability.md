# Observability

The server writes every Effect span it ends to a local trace file, one JSON object per line:

- `<home>/userdata/logs/server.trace.ndjson`; in dev that is `.toolspell/userdata/logs/` in the
  checkout.
- A file rotates before it passes 10 MiB. `server.trace.ndjson.1` is the newest rotated file and
  `.9` the oldest; older ones are deleted.
- Spans are written in batches about once a second and on shutdown. A crash loses at most the
  last batch. CLI commands such as `pair` write no trace.

A line looks like this (shortened):

```json
{
  "name": "AuthStore.pair",
  "traceId": "4267ab11277af3a39793b21ceb49d906",
  "spanId": "8e87565fa4bbbfa3",
  "parentSpanId": "6f163c8344cd4d96",
  "kind": "internal",
  "startTimeUnixNano": "1795344654853283042",
  "endTimeUnixNano": "1795344654853841417",
  "durationMs": 0.558375,
  "attributes": {},
  "events": [],
  "links": [],
  "exit": { "_tag": "Success" }
}
```

`exit._tag` is `Success`, `Interrupted`, or `Failure` with the pretty-printed `cause`. `events`
holds the log lines written inside the span. HTTP requests are `kind: "server"` spans named after
the method, with `http.route` and `http.response.status_code` attributes; SQL statements are
spans with `db.query.text` (placeholders, never values). Strings longer than 1000 characters are
truncated. Spans never carry request bodies, headers, or cookies; keep tokens out of span
attributes and error messages.

## jq recipes

Run these from the logs directory. `server.trace.ndjson*` includes the rotated files.

Slowest spans:

```bash
jq -s -r 'sort_by(-.durationMs) | .[:20][] | "\(.durationMs)ms \(.name)"' server.trace.ndjson*
```

Failures by span name, most frequent first:

```bash
jq -s -c 'map(select(.exit._tag == "Failure")) | group_by(.name)
  | map({name: .[0].name, count: length}) | sort_by(-.count) | .[]' server.trace.ndjson*
```

The causes of one span's failures:

```bash
jq -r 'select(.name == "AuthStore.pair" and .exit._tag == "Failure") | .exit.cause' server.trace.ndjson*
```

The trace ids of requests to one route, then one trace in start order:

```bash
jq -r 'select(.attributes["http.route"] == "/api/auth/pair") | .traceId' server.trace.ndjson*
jq -s -r --arg id <traceId> 'map(select(.traceId == $id)) | sort_by(.startTimeUnixNano)
  | .[] | "\(.durationMs)ms \(.name) \(.exit._tag)"' server.trace.ndjson*
```
