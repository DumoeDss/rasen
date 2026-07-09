## Why

The CLI still sends telemetry to PostHog through `edge.openspec.dev` (`src/telemetry/index.ts`), infrastructure the fork does not own. Batch B1 deployed a maintainer-owned replacement — a Cloudflare Worker at `https://openspec-telemetry.ws11579.workers.dev`. This change (batch B2) rewrites the client to send to that Worker instead, removes the `posthog-node` dependency, and updates the first-run notice to truthfully describe where data goes — while preserving every privacy guarantee (opt-out, anonymous UUID, silent failure) that upstream had.

## What Changes

- **Rewrite `src/telemetry/index.ts` transport**: remove `posthog-node` and the hardcoded `POSTHOG_API_KEY`/`POSTHOG_HOST`; send each event as a native `fetch` `POST` of `{ command, version, distinctId, os?, node_version? }` to the B1 Worker endpoint. Keep the existing fire-and-forget behavior: ~1s timeout, no retries, never parse the response body (the Worker returns `202` even on internal error, per B1 design).
- **Remove `posthog-node` from `package.json` dependencies** (`^5.20.0`).
- **Add optional `os` and `node_version` dimensions** to the event (zero privacy cost — decided in planning; no paths/args/project info).
- **Update the first-run notice text** (`maybeShowTelemetryNotice`) to truthfully state: data goes to the maintainer's own Cloudflare Worker; what is sent (command, version, OS, Node version, anonymous id); and how to opt out.
- **Preserve unchanged**: `isTelemetryEnabled()` opt-out (`OPENSPEC_TELEMETRY=0` / `DO_NOT_TRACK=1` / `CI` auto-off), anonymous UUID from `config.js`, and the public function signatures `trackCommand(name, version)` / `maybeShowTelemetryNotice()` / `shutdown()` consumed by `src/cli/index.ts`.
- **Hard red lines**: events must never go to `edge.openspec.dev` or PostHog again; no file paths, arguments, or project information are ever sent. `GLOBAL_CONFIG_DIR_NAME` stays `openspec` (phase 2 concern).

## Capabilities

### New Capabilities
<!-- None. This modifies the existing telemetry client behavior. -->

### Modified Capabilities
- `telemetry`: Change the telemetry transport from PostHog (`posthog-node` → `edge.openspec.dev`) to the maintainer's Cloudflare Worker via native `fetch`; add optional os/node_version dimensions; update the first-run notice and shutdown/immediate-send mechanics to reflect the new transport. Opt-out, anonymity, and silent-failure guarantees are retained.

## Impact

- **Code**: `src/telemetry/index.ts` (transport rewrite; `getClient`/PostHog removal; `shutdown` no longer flushes a PostHog client). No change needed at the call sites in `src/cli/index.ts` (signatures preserved).
- **Dependencies**: `posthog-node` removed from `package.json` dependencies; no new runtime dependency (native `fetch`, Node ≥20).
- **Network destination**: telemetry now targets `https://openspec-telemetry.ws11579.workers.dev` only.
- **Tests**: telemetry unit tests updated to mock `fetch` and assert payload/opt-out/notice behavior (no live network); one manual live smoke-test task against the deployed Worker.
- **Depends on**: B1 (backend) — deployed and verified. This change is the second half of the telemetry migration.
