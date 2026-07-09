## Why

A full live parity sweep (2026-07-08, Chrome 149) confirmed the vendored chrome-use proxy reproduces every browse capability, but surfaced three real gaps where chrome-use diverges from the retired browse tool. The user's bar is explicit: "保证 browse 的所有功能，我们都能够实现." These three gaps are the remaining distance to that bar, and one of them (proxy env hijacking localhost curl) was the root cause of the earlier false "Chrome hangs on all CDP commands" misdiagnosis, so it is worth closing permanently.

## What Changes

- **Gap 1 — `--noproxy '*'` on every chrome-use curl example.** On any machine with `HTTP(S)_PROXY` set, `curl http://localhost:3456/...` is hijacked by the proxy and returns 502. Add `--noproxy '*'` to the live curl examples in the expert templates (`_shared.ts` `CHROME_USE_SETUP` + `QA_METHODOLOGY` + `DESIGN_METHODOLOGY` + `DESIGN_SKETCH`), the self-contained `chrome-use.ts` template, and the vendored `cdp-api.md`, plus a one-line note explaining why. (Also fix the two dead-but-canonical shared blocks `CHROME_USE_SNAPSHOT`/`CHROME_USE_ENDPOINTS` for source hygiene — no runtime or hash impact.)
- **Gap 2 — `/perf` paint metrics on background tabs.** chrome-use opens background tabs, which never render, so `fp`/`fcp`/`lcp` come back `null`; additionally `getEntriesByType('largest-contentful-paint')` is spec-empty (LCP only surfaces via a buffered `PerformanceObserver`). Rework `/perf` to read LCP from a buffered observer, add an opt-in `?activate=true` that foregrounds the tab briefly to force paint, and always return a `visibility` field so callers understand why paint metrics are absent when a background tab is not activated.
- **Gap 3 — `/eval` bare `await` matches its docs.** The implementation uses `Runtime.evaluate` without `replMode`, so a bare top-level `await` throws `Uncaught SyntaxError`, yet `cdp-api.md` claims `await` is supported. Add `replMode: true` (one line, DevTools-console semantics) so bare `await` works, and add a doc example.
- Regenerate the parity golden hashes for exactly the six expert skills whose generated content includes a changed shared curl block; expert count (19) and all count assertions are unchanged.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `chrome-use-integration`: `/perf` performance endpoint now reads LCP from a buffered observer, exposes an opt-in `activate` parameter and a `visibility` field for background tabs; the `/eval` endpoint now supports bare top-level `await` via `replMode`.
- `chrome-use-expert-methodology`: the shared SETUP/methodology curl examples must pass `--noproxy '*'` so localhost calls are not hijacked by a configured HTTP(S) proxy; `/perf` methodology text is updated to reflect that paint metrics require a foregrounded (or activated) tab.

## Impact

- **Templates (parity-pinned):** `src/core/templates/experts/_shared.ts` — regenerates the function + generated-content golden hashes for `benchmark`, `design-consultation`, `design-review`, `office-hours`, `qa`, `qa-only` in `test/core/templates/skill-templates-parity.test.ts` (both `EXPECTED_FUNCTION_HASHES` and `EXPECTED_GENERATED_SKILL_CONTENT_HASHES`).
- **Templates (unpinned):** `src/core/templates/experts/chrome-use.ts` — not in the parity maps; edited for Gap 1 completeness.
- **Vendored proxy + docs:** `skills/experts/chrome-use/scripts/cdp-proxy.mjs` (`/perf`, `/eval`), `skills/experts/chrome-use/references/cdp-api.md` (`/perf`, `/eval`, basics note). No hash impact — vendored sidecars are not hashed by the parity test.
- **Verification:** `node --check` on the proxy, `pnpm build`, vitest (`skill-generation`, `skill-templates-parity`, `skill-sidecar-install`), `openspec validate`, and a live `/perf` re-check against the running proxy on `localhost:3456`.
- **Delivery:** local ship (commit only, no push), scope-limited to this change's files, per the fork-phase1 convention.
