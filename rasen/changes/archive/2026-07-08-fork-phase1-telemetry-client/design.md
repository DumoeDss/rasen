## Context

`src/telemetry/index.ts` currently uses `posthog-node` to send `command_executed` events (`{ distinctId, command, version, surface:'cli', $ip:null }`) to `https://edge.openspec.dev` (a PostHog reverse proxy). Batch B1 replaced that infrastructure with a maintainer-owned Cloudflare Worker. B2 repoints the client.

Verified facts:
- **Deployed endpoint** (from `openspec/changes/fork-phase1-telemetry-backend/notes.md`): `https://openspec-telemetry.ws11579.workers.dev`. Consume this exact URL.
- **Worker payload contract**: `POST` JSON `{ command, version, distinctId, os?, node_version? }`; extra fields ignored; `202` on accept; `405` non-POST; `400` missing/malformed; fields server-side truncated at 256B; the Worker never echoes payloads and returns `202` even on internal error.
- **Public interface consumed by `src/cli/index.ts:42,130,135,140`**: `maybeShowTelemetryNotice()`, `trackCommand(commandPath, version)`, `shutdown()`. These signatures must be preserved.
- **Retained infrastructure**: `isTelemetryEnabled()` (`:46`, `OPENSPEC_TELEMETRY=0` / `DO_NOT_TRACK=1` / `CI==='true'`), `getOrCreateAnonymousId()` reading/persisting the UUID via `src/telemetry/config.js` (`TelemetryConfig { anonymousId, noticeSeen }`), and `safeTelemetryFetch` (already a native-fetch wrapper with silent failure).

## Goals / Non-Goals

**Goals:**
- Swap the transport to a single native `fetch` `POST` to the B1 Worker, fire-and-forget with a ~1s timeout, matching the Worker's field names exactly.
- Remove `posthog-node` (code + package.json dependency) and the PostHog constants.
- Add optional `os`/`node_version` dimensions.
- Rewrite the first-run notice to be truthful about the destination.
- Preserve opt-out, anonymous UUID, silent failure, and the three public signatures.

**Non-Goals:**
- Changing `isTelemetryEnabled()` semantics, the config module, or the anonymous-id lifecycle.
- Renaming `GLOBAL_CONFIG_DIR_NAME` (`openspec`) — phase 2.
- Any change to `src/cli/index.ts` call sites.
- Batching, retries, or a response-driven control loop.

## Decisions

**D1 — Native `fetch` POST, reusing the existing silent-failure wrapper.** `trackCommand` builds the payload `{ command, version, distinctId, os, node_version }` and POSTs JSON to the endpoint with `AbortSignal.timeout(~1000ms)`, wrapped so any throw/timeout is swallowed. `safeTelemetryFetch` already exists and does exactly this (returns a 204 stub on failure); reuse/adapt it rather than introducing a new helper. The client ignores the response entirely (status and body) — the Worker returns `202` even on internal error by design, so parsing/retrying would be pointless and risky.

**D2 — Field names match the Worker exactly.** `{ command, version, distinctId, os?, node_version? }`. `distinctId` = `getOrCreateAnonymousId()`. `os` = `process.platform` (or `os.platform()`); `node_version` = `process.versions.node`. Drop the PostHog-only `surface` and `$ip` fields. Values stay short (well under the Worker's 256B truncation).

**D3 — `shutdown()` becomes a fast no-op that preserves the export.** With a synchronous-per-call fire-and-forget POST (awaited within `trackCommand`'s timeout), there is no batched client to flush. Keep `shutdown()` exported and awaited by the CLI, returning immediately (optionally awaiting any in-flight send with a bounded timeout). This keeps `src/cli/index.ts:140` working without edits.

**D4 — Endpoint as a module constant.** Replace `POSTHOG_API_KEY`/`POSTHOG_HOST` with a single `TELEMETRY_ENDPOINT = 'https://openspec-telemetry.ws11579.workers.dev'`. No API key needed (the Worker is unauthenticated by design). Keep `TELEMETRY_REQUEST_TIMEOUT_MS = 1000`.

**D5 — Notice text.** New one-liner, e.g.: `Note: OpenSpec sends anonymous usage stats (command, version, OS, Node version, and a random id) to its own Cloudflare Worker. Opt out: OPENSPEC_TELEMETRY=0`. Must not mention PostHog/`edge.openspec.dev`. Persisted-once via `noticeSeen` (unchanged).

**D6 — Tests mock `fetch`.** Unit tests inject/stub `globalThis.fetch` to assert: payload shape and field names; endpoint URL; opt-out short-circuits before any fetch; notice shown once then suppressed; failures/timeouts are swallowed. Tests never hit the live Worker. A separate manual task does one live smoke-test.

## Risks / Trade-offs

- **Client/Worker field-name drift** → tests assert exact keys `{command,version,distinctId,os,node_version}`; design pins them to B1's contract. Mitigated.
- **`shutdown()` semantics change** (no longer flushes) → could drop an in-flight event if the process exits instantly. Mitigation: `trackCommand` awaits its own send within the timeout before returning, so by the time `shutdown()` runs the send has resolved/aborted; `shutdown()` need only be a safe no-op.
- **Timeout too aggressive on slow networks** → 1s matches upstream behavior and telemetry is best-effort; silent failure covers it. Acceptable.
- **Leaving a stale PostHog reference** → grep for `posthog`/`edge.openspec.dev`/`$ip` after the rewrite to ensure none remain (red line).
- **`os`/`node_version` privacy** → coarse platform + runtime version only; decided as zero-cost, no device/user identification.

## Migration Plan

1. Rewrite `src/telemetry/index.ts` (transport, constants, payload, notice, shutdown); remove PostHog code paths.
2. Remove `posthog-node` from `package.json` dependencies; refresh the lockfile.
3. Update/extend telemetry unit tests (mock fetch); run affected tests + `pnpm build` green.
4. Manual live smoke-test: run a real command with telemetry enabled against the deployed Worker; confirm no error surfaced (optionally confirm receipt via `wrangler tail` on the backend).
5. Rollback: revert the file + package.json; B1 backend is independent and stays deployed.

## Open Questions

- Exact final notice wording — D5 is a sample; implementer may tighten, but it must name the maintainer's Cloudflare Worker, list what is sent, and give the opt-out, with no PostHog reference.
- Whether `shutdown()` should await a tracked in-flight promise or be a pure no-op — implementation detail; either satisfies the spec as long as exit is not blocked.
