# fork-phase1-telemetry-backend — implementation notes

## Deployed endpoint (INPUT FOR SIBLING CHANGE B2 — telemetry-client)

**Endpoint URL:** `https://openspec-telemetry.ws11579.workers.dev`

B2 (`fork-phase1-telemetry-client`) MUST point the rewritten `src/telemetry/index.ts`
at this exact URL. Do not hardcode a guess — this is the live, verified Worker.

- Worker name: `openspec-telemetry`
- Version ID at deploy: `2076d5e9-4342-4060-817a-d47b16f0c5bb`
- Cloudflare account: `5cc51d8388c780c03fb4c6161bd403c4`
- Analytics Engine dataset: `openspec_telemetry`

## Payload contract (B2 client must match field names exactly)

`POST` JSON body:

```json
{ "command": "<string>", "version": "<string>", "distinctId": "<uuid>", "os": "<string?>", "node_version": "<string?>" }
```

- Required: `command`, `version`, `distinctId` (non-empty strings). Missing/empty → `400`.
- Optional: `os`, `node_version`.
- Method: `POST` only (else `405`). Malformed JSON → `400`.
- Success: `202` with a tiny body. Fire-and-forget; safe to await with a short (~1s) timeout.

Note the field name `node_version` (snake_case), and `distinctId` (camelCase).

## Verification results (2026-07-08)

| Test                                          | Result   |
| --------------------------------------------- | -------- |
| POST valid event                              | HTTP 202 |
| GET (wrong method)                            | HTTP 405 |
| POST missing `distinctId`                     | HTTP 400 |
| POST malformed JSON                           | HTTP 400 |

## Analytics Engine mapping

`writeDataPoint({ blobs: [command, version, os, node_version], indexes: [distinctId] })`

- DAU: `count(DISTINCT index1)`
- Breakdown: `GROUP BY blob1, blob2` (command, version)

SQL-API reads require a separate CF API token (Account Analytics read scope) —
documented in `telemetry-backend/README.md`, not a verification gate.
