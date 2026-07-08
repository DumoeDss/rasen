# fork-phase1-telemetry-client — implementation notes

## Design deviation: HTTPS transport instead of native `fetch` (from design D1)

Design D1 specified native `fetch`. Implementation uses `node:https` (`https.request`)
instead. This deviation is **required** to satisfy the spec's hard requirements
("Fast return" / "Immediate event sending … bounded by a short ~1s timeout" /
"Shutdown never blocks exit"), which override a transport-choice detail.

**Why fetch fails the fast-return contract (measured, not theoretical):**

- With native `fetch` + `AbortSignal.timeout(1000)`, the CLI hangs **~11 seconds**
  after every command when the telemetry endpoint is slow/unreachable. The
  `AbortSignal` correctly aborts the fetch at 1s, but Node's global `fetch`
  (undici) leaves a **reffed keep-alive socket / connect timer** in its pool that
  keeps the event loop alive ~10s more before the process can exit.
- Confirmed the hang is intrinsic to fetch here: `connection: close` header
  (forbidden/ignored by fetch), `response.body.cancel()`, and aborting the
  controller after the response all still hang ~10s.
- `undici` is **not importable** in this Node (`ERR_MODULE_NOT_FOUND`), so its
  dispatcher can't be tuned; and forcing `process.exit()` is out of scope (the
  CLI must need zero edits).
- This surfaced as the `test/cli-e2e/basic.test.ts` suite failing (10/16, 10s
  timeouts) with telemetry enabled — a real regression, not the documented
  Windows flakiness.

**The https implementation** (`src/telemetry/index.ts` `sendEvent`):
`https.request(TELEMETRY_ENDPOINT, { method:'POST', headers:{'content-type':'application/json'}, agent:false }, …)`
- `agent: false` → no keep-alive connection pool; the socket closes after the
  response instead of lingering.
- A guard `setTimeout(TELEMETRY_REQUEST_TIMEOUT_MS)` calls `req.destroy()` and
  resolves, so a stalled request can never delay exit beyond ~1s.
- Response body is drained and discarded, never parsed (Worker returns 202 even
  on internal error). No retry.

**Measured after fix:** CLI exit ~1.8s with telemetry enabled (was ~11s);
`cli-e2e/basic.test.ts` 16/16 green with telemetry enabled.

## Fire-and-forget shape (minor refinement of D1/D3)

`trackCommand` starts the send and stores it in `inFlightSend` **without
awaiting** (so the command is never blocked on the network); `shutdown()` awaits
`inFlightSend`, bounded by the send's own guard timer. This matches the spec's
fire-and-forget + graceful-shutdown model and the upstream architecture
(non-blocking track, flush at shutdown).

## Endpoint + payload (consumed from B1)

- Endpoint: `https://openspec-telemetry.ws11579.workers.dev`
- Payload: `{ command, version, distinctId, os, node_version }` — field names match
  B1 exactly; `distinctId` camelCase, `node_version` snake_case.
- Verified: POSTing this exact shape → HTTP 202.

## Dependency / lockfile

- `posthog-node ^5.20.0` removed from `package.json` dependencies.
- pnpm's `prefer-frozen-lockfile` up-to-date check tolerates a removed dep, so
  `pnpm install` would not prune it; the `posthog-node` + `@posthog/core`
  importer/package/snapshot entries were removed from `pnpm-lock.yaml` directly.
  `pnpm install --frozen-lockfile` passes (lockfile consistent, 0 posthog refs).
- Red-line grep (`posthog|edge.openspec.dev|POSTHOG_|$ip`) in `src/`: 0 matches.
