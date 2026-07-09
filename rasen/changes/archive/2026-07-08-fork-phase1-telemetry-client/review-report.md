# Review Report — fork-phase1-telemetry-client (B2)

**Reviewer:** reviewer-b1 (independent; did not author this change; also reviewed the B1 backend)
**Date:** 2026-07-08
**Branch:** dev-harness
**Diff scope (uncommitted working tree vs HEAD), B2 file set only:** `src/telemetry/index.ts`, `package.json`, `pnpm-lock.yaml`, `test/telemetry/index.test.ts`. Excluded as concurrent sibling noise: `test/core/templates/skill-templates-parity.test.ts` (A2), `src/core/templates/**`, `skills/`, `telemetry-backend/`.

## Verdict

**APPROVE. Spec delta is MET.** The client faithfully implements all 7 telemetry requirements, matches the B1 Worker contract exactly, and preserves every privacy/opt-out/silent-failure guarantee. The documented transport deviation (`node:https` instead of native `fetch`) is **justified** — it is the correct call, not a shortcut. No Blockers, Majors, or Minors. Two Trivial/informational notes only.

---

## Special-attention assessment

### (a) Design deviation (`node:https` vs `fetch`) — JUSTIFIED

Design D1 said native `fetch`; the implementation uses `node:https` (`sendEvent`, `src/telemetry/index.ts:43-87`). The **spec** — which is authoritative over a design transport detail — requires only "a single fire-and-forget HTTP `POST` ... bounded by a short (~1 second) timeout" (spec line 50) and "Shutdown never blocks exit" (spec line 71). Native `fetch` measurably violated the never-block-exit contract: undici leaves a reffed keep-alive socket/connect timer in its pool that holds the event loop ~10s after the 1s abort (notes.md; measured 11s → 1.8s CLI exit; `cli-e2e/basic.test.ts` 16/16 green with telemetry enabled after the fix). The deviation is documented in both `notes.md` and the module header comment (`index.ts:15-22`). It does not touch the CLI (`src/cli/index.ts` unmodified) and does not use `process.exit`. This is the right decision and satisfies the authoritative spec text.

### (b) `https` implementation correctness across error paths — CORRECT

`sendEvent` (`index.ts:43-87`) returns a Promise that resolves via an idempotent `done()` (guarded by `settled`, `index.ts:47-52`) on every path, and never re-throws:

| Failure mode | Handling | Evidence |
| --- | --- | --- |
| DNS failure / TLS error / ECONNREFUSED / write error | `req.on('error', done)` | `index.ts:73`; test `silent failure > swallows a network error` |
| Slow / stalled response body | guard `setTimeout` → `req.destroy()` + `done()` at 1000ms | `index.ts:76-79`; test `gives up on a stalled request within the timeout` (ran ~1025ms on the real timer) |
| Synchronous throw from `https.request` | outer `try/catch` → `done()` | `index.ts:82-85`; test `swallows a request that throws synchronously` |
| Response body | drained (`res.on('data', () => {})`) and never parsed; `end`/`error` → `done()` | `index.ts:64-70` |

No reffed handle can linger: `agent: false` (`index.ts:62`) means no keep-alive pool, so the socket closes after the response instead of holding the loop open; the guard timer is `clearTimeout`-ed in `done()` (`index.ts:50`); and `done()` is guaranteed within ~1s because the guard timer always fires unless cleared. There is no path to an indefinite hang. Verified empirically: `pnpm build` green (exit 0), 20/20 telemetry tests pass.

### (c) Spec delta — MET (all 7 requirements)

1. **Command execution tracking** — payload `{ command, version, distinctId, os, node_version }` (`index.ts:155-161`). Full command path passed through as `command`. PASS.
2. **Privacy-preserving design** — exactly 5 keys; no args/paths/project/IP; `os = process.platform`, `node_version = process.versions.node` (coarse). Test asserts exact key set and absence of `surface`/`$ip`/`arguments`/`args`/`path`/`project`. PASS.
3. **First-run notice** — truthful text names "its own Cloudflare Worker", lists fields, gives `OPENSPEC_TELEMETRY=0`, no PostHog/`edge.openspec.dev`; shown once via `noticeSeen` (`index.ts:170-191`). Called before `trackCommand` in `src/cli/index.ts:130` vs `:135`. PASS.
4. **Immediate event sending** — one POST, no batch, no retry, no response parsing, ~1s timeout. PASS.
5. **Graceful shutdown** — `shutdown()` awaits only `inFlightSend`, itself bounded by the guard timer, and catches errors (`index.ts:199-211`). PASS.
6. **Silent failure** — all three scenarios covered and tested. PASS.
7. **Maintainer-owned destination + no `posthog-node`** — endpoint constant is the B1 Worker; `posthog-node` removed from `package.json` and lockfile; red-line grep clean. PASS.

### Worker-contract cross-check (against my B1 review)

- Payload keys exactly `{command, version, distinctId, os, node_version}`, no extras — confirmed; live-verified the exact client shape (`os:"win32", node_version:"22.1.0"`) POSTs to the deployed Worker → **HTTP 202**.
- Fire-and-forget, no retry, no body parse — confirmed (`index.ts:64-70,153-161`).
- Opt-out short-circuits before any network call: `trackCommand` and `maybeShowTelemetryNotice` both return at the `isTelemetryEnabled()` guard before `getOrCreateAnonymousId`/`sendEvent` (`index.ts:146-148,171-173`); test asserts `https.request` not called AND no config file written under any of the three opt-out vars.
- Notice truthful (own Cloudflare Worker; what is sent; opt-out; no PostHog) — confirmed and tested.
- Red-line grep (`posthog|edge.openspec.dev|POSTHOG_|$ip|surface`-field) in `src/` — 0 matches (only the English word "surface" in unrelated files). `dist/telemetry/index.js` — 0 posthog refs, endpoint present.
- Public exports unchanged (`trackCommand`, `maybeShowTelemetryNotice`, `shutdown`, `isTelemetryEnabled`, `getOrCreateAnonymousId`); `src/cli/index.ts` **zero-edit** (git status clean); call sites match signatures.
- `shutdown()` bounded and non-blocking — confirmed.

## Dependency / lockfile scrutiny

- `package.json`: only `posthog-node ^5.20.0` removed from `dependencies`; nothing else touched.
- `pnpm-lock.yaml`: removed the `posthog-node` importer entry plus the `posthog-node@5.20.0` and `@posthog/core@1.9.1` package + snapshot entries. `@posthog/core` depended on `cross-spawn`, but `cross-spawn` remains a direct CLI dependency, so pruning `@posthog/core` does not orphan it. `pnpm install --frozen-lockfile` passes ("Done in 519ms") — lockfile is internally consistent. 0 posthog references remain anywhere in the lockfile. Manual pruning is correct.

## Test scrutiny

Tests mock `https.request` (not a stale `fetch`), so they exercise the real transport. Coverage: opt-out (all 3 vars, incl. no-id-written), exact payload keys, PII-field absence, single-request/no-retry, endpoint/method/headers/`agent:false`, silent failure (network error, sync throw, stalled-via-real-guard-timer), notice once/truthful/no-posthog/precedes-send, shutdown safety. 20/20 pass. No test/impl mismatch.

---

## Findings

### Trivial

**T1 — `inFlightSend` retains only the most recent send.** `index.ts:155` overwrites `inFlightSend` on each `trackCommand`; `shutdown()` awaits only the latest. Harmless for the CLI (exactly one `trackCommand` per process invocation) and even under hypothetical multi-tracking there is no leak — each `sendEvent` self-bounds via its own guard timer. Noting the latent single-in-flight assumption only.

**T2 (informational) — `node:https` does not honor `HTTP(S)_PROXY`.** Behind an egress proxy, direct HTTPS to `workers.dev` fails and telemetry is silently dropped (guard timer → `done()`), with zero functional impact on the CLI. This is consistent with the silent-failure design and is **not a regression** — upstream `posthog-node` (undici) also does not auto-proxy. notes.md task 4.2 already observed this in the sandbox. No action needed.

---

## Durable findings (for C / release-prep)

- `posthog-node` is fully removed (package.json + lockfile pruned, `pnpm install --frozen-lockfile` consistent); no new runtime dependency added — telemetry now uses `node:https` (Node built-in). C should re-confirm nothing else re-introduces posthog.
- CLI exit is bounded ~1s by the telemetry guard timer even when the endpoint is unreachable (native `fetch` was replaced precisely because it hung exit ~10s); any future transport change must preserve `agent:false` + guard-timer teardown or CLI exit latency regresses.
- `src/cli/index.ts` is untouched and the five public telemetry exports are stable — safe for release without call-site changes.
