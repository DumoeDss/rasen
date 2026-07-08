## 1. Scaffold the Worker project

- [x] 1.1 Create `telemetry-backend/` at the repo root with `package.json` (name `openspec-telemetry`, private, `wrangler` devDependency, scripts: `deploy` = `wrangler deploy`, `dev` = `wrangler dev`, `tail` = `wrangler tail`).
- [x] 1.2 Create `telemetry-backend/wrangler.toml`: `name = "openspec-telemetry"`, `main = "src/index.ts"`, `account_id = "5cc51d8388c780c03fb4c6161bd403c4"`, a `compatibility_date`, and an `[[analytics_engine_datasets]]` binding (e.g. `binding = "TELEMETRY"`, `dataset = "openspec_telemetry"`).
- [x] 1.3 Confirm `telemetry-backend/` is NOT matched by the CLI package.json `files` whitelist (`dist`/`bin`/`schemas`/`pipelines`/`scripts/postinstall.js`) so it is excluded from `npm pack` — no `.npmignore` change needed; record the confirmation. CONFIRMED: package.json `files` = `["dist","bin","schemas","pipelines","scripts/postinstall.js","!dist/**/*.test.js","!dist/**/__tests__","!dist/**/*.map"]` — a whitelist that never matches repo-root `telemetry-backend/`, so it is auto-excluded from `npm pack`. No `.npmignore` needed.

## 2. Implement the Worker

- [x] 2.1 Implement `telemetry-backend/src/index.ts` `fetch` handler: accept only `POST` (else `405`); parse JSON body; require `command`, `version`, `distinctId` as non-empty strings (else `400`); read optional `os`, `node_version`; ignore all other fields.
- [x] 2.2 On a valid event, call `env.TELEMETRY.writeDataPoint({ blobs: [command, version, os ?? '', node_version ?? ''], indexes: [distinctId] })` and return `202` with a tiny body. Never echo the payload; never persist IP/paths/args.
- [x] 2.3 Wrap handler logic so any internal error still returns fast (no unhandled rejection); telemetry ingestion must never hang the caller.

## 3. Deploy and verify

- [x] 3.1 Run `wrangler deploy` from `telemetry-backend/`; capture the deployed endpoint URL (`openspec-telemetry.<subdomain>.workers.dev` or custom route). DEPLOYED: `https://openspec-telemetry.ws11579.workers.dev` (Version ID 2076d5e9-4342-4060-817a-d47b16f0c5bb).
- [x] 3.2 Smoke-test the WRITE path: `POST` a synthetic event `{command:"test", version:"0.0.0", distinctId:"<uuid>", os:"linux", node_version:"22"}` to the deployed URL; assert a 2xx response. Optionally run `wrangler tail` to observe the request. RESULT: POST valid event → HTTP 202.
- [x] 3.3 Negative-path check: a `GET` returns 405 and a body missing `command`/`version`/`distinctId` returns 400. RESULT: GET → 405; POST missing distinctId → 400; malformed JSON → 400.

## 4. Maintainer docs + B2 handoff

- [x] 4.1 Write `telemetry-backend/README.md`: deploy steps, the event payload contract, the privacy contract (command+version+anonymous UUID +optional os/node_version; no paths/args/project/IP), and the Analytics Engine data-point mapping (blobs/indexes).
- [x] 4.2 Document CF SQL-API read queries in the README: endpoint `POST https://api.cloudflare.com/client/v4/accounts/5cc51d8388c780c03fb4c6161bd403c4/analytics_engine/sql` with an API token (Account Analytics read scope); example queries — DAU via `SELECT count() , count(DISTINCT index1) FROM openspec_telemetry ...`, breakdown via `GROUP BY blob1, blob2` (command, version). Note the token requirement so reads are documented, not a hard verification gate.
- [x] 4.3 Record the deployed endpoint URL in this change's ship-log/notes (e.g. `openspec/changes/fork-phase1-telemetry-backend/notes.md` or the ship log) as the explicit input for sibling change B2 (telemetry-client). RECORDED in `notes.md`: `https://openspec-telemetry.ws11579.workers.dev`.

## 5. Validate

- [x] 5.1 Run `openspec validate fork-phase1-telemetry-backend`; confirm valid. RESULT: "Change 'fork-phase1-telemetry-backend' is valid".
- [x] 5.2 Confirm no change to `src/telemetry/index.ts` or CLI `package.json` dependencies in this change (client rewrite and `posthog-node` removal are B2). CONFIRMED: `git status` shows only new untracked `telemetry-backend/` and the change dir; `src/telemetry/` and `package.json` are unmodified.
