## 1. Rewrite the telemetry transport

- [x] 1.1 In `src/telemetry/index.ts`, remove the `posthog-node` import, the `POSTHOG_API_KEY`/`POSTHOG_HOST` constants (`:17`/`:19`), the `posthogClient` state, and the `getClient()` PostHog factory.
- [x] 1.2 Add `const TELEMETRY_ENDPOINT = 'https://openspec-telemetry.ws11579.workers.dev';` (keep `TELEMETRY_REQUEST_TIMEOUT_MS = 1000`).
- [x] 1.3 Rewrite `trackCommand(commandName, version)` to build `{ command: commandName, version, distinctId: await getOrCreateAnonymousId(), os: process.platform, node_version: process.versions.node }` and `POST` it as JSON to `TELEMETRY_ENDPOINT` via native `fetch` with `AbortSignal.timeout(TELEMETRY_REQUEST_TIMEOUT_MS)`. Reuse/adapt `safeTelemetryFetch` so all throws/timeouts are swallowed; do NOT read or parse the response body; do NOT retry. Keep the `isTelemetryEnabled()` short-circuit at the top.
- [x] 1.4 Rewrite `shutdown()` to preserve the export and return promptly with no PostHog client (fast no-op or bounded await of any in-flight send); it must never block CLI exit.
- [x] 1.5 Verify the public signatures `trackCommand(name, version)`, `maybeShowTelemetryNotice()`, `shutdown()`, `isTelemetryEnabled()`, `getOrCreateAnonymousId()` are unchanged so `src/cli/index.ts` needs no edits.

## 2. Notice + dependency cleanup

- [x] 2.1 Update `maybeShowTelemetryNotice()` (`:142`) text to truthfully state data goes to OpenSpec's own Cloudflare Worker, list what is sent (command, version, OS, Node version, anonymous id), and give the opt-out (`OPENSPEC_TELEMETRY=0`). Must not mention PostHog or `edge.openspec.dev`. Keep the `noticeSeen` once-only logic.
- [x] 2.2 Remove `posthog-node` (`^5.20.0`) from `package.json` `dependencies` and update the pnpm lockfile. NOTE: pnpm's `prefer-frozen-lockfile` up-to-date check tolerates an extra (removed) dep, so `pnpm install` would not prune it automatically; the stale `posthog-node`/`@posthog/core` importer + package + snapshot entries were removed from `pnpm-lock.yaml` directly. `pnpm install --frozen-lockfile` passes (lockfile consistent, 0 posthog refs).
- [x] 2.3 Grep the repo for `posthog`, `edge.openspec.dev`, `POSTHOG_`, and `$ip`; confirm no references remain in `src/` (red line — telemetry must never target PostHog again). CONFIRMED: 0 matches in `src/`.

## 3. Tests (mock fetch — no live network)

- [x] 3.1 Update/extend telemetry unit tests to stub `globalThis.fetch`: assert `trackCommand` POSTs to `TELEMETRY_ENDPOINT` with body containing exactly `command`, `version`, `distinctId`, `os`, `node_version` (and no arguments/paths/project fields).
- [x] 3.2 Assert opt-out short-circuits: with `OPENSPEC_TELEMETRY=0`, `DO_NOT_TRACK=1`, or `CI=true`, `fetch` is never called and no anonymousId is generated.
- [x] 3.3 Assert the notice is shown once (first run) then suppressed (`noticeSeen`), appears before any send, and its text names the Cloudflare Worker without mentioning PostHog.
- [x] 3.4 Assert silent failure: a rejecting/timing-out `fetch` does not throw out of `trackCommand`; `shutdown()` never throws.

## 4. Build + live smoke-test

- [x] 4.1 Run `pnpm build` and the affected test suites (telemetry + CLI); confirm green. RESULT: build green; `test/telemetry` 37/37 pass; `test/core/completions/command-registry.test.ts` + `test/cli-e2e/basic.test.ts` (16/16, telemetry ENABLED) pass. Fixed a real regression uncovered here — see notes.md (fetch→https transport; native fetch hung CLI exit ~10s via undici keep-alive socket linger).
- [x] 4.2 Manual live smoke-test (single, out-of-band): run a real `openspec` command with telemetry enabled against the deployed Worker; confirm the CLI completes with no error surfaced. Optionally confirm receipt via `wrangler tail` on the backend project. Do NOT add a live-network assertion to the automated test suite. RESULT: `openspec init` with telemetry ENABLED completes cleanly (exit 0) in ~1.8s across repeated runs. The exact client payload shape (`{command,version,distinctId,os,node_version}`) POSTs to the live Worker → HTTP 202 (verified via curl). Direct receipt from the Node CLI process wasn't confirmable from this sandbox (Node's egress to workers.dev is proxy-gated here; curl uses the proxy, Node fetch/https do not) — the CLI-completes-cleanly gate is met and the endpoint+payload are confirmed live.
- [x] 4.3 Run `openspec validate fork-phase1-telemetry-client`; confirm valid. RESULT: "Change 'fork-phase1-telemetry-client' is valid".
