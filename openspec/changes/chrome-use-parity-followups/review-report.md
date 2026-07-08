# Review Report — chrome-use-parity-followups

**Reviewer:** reviewer-parity (independent; did not author)
**Date:** 2026-07-09
**Branch:** dev-harness
**Verdict:** APPROVE (1 Minor, non-blocking)

## Verification Gate (all run, all pass)

| Gate | Result |
|---|---|
| `pnpm build` | ✅ Build completed successfully |
| `node --check cdp-proxy.mjs` | ✅ OK |
| `openspec validate chrome-use-parity-followups` | ✅ valid |
| vitest `skill-generation` | ✅ 37 passed |
| vitest `skill-templates-parity` | ✅ 6 passed |
| vitest `skill-sidecar-install` | ✅ 1 passed |
| **Trio total** | **✅ 44 passed / 44** |
| Live `/eval` object-literal (`JSON.stringify({a:1,b:2})`) | ✅ `{"value":"{\"a\":1,\"b\":2}"}` |
| Live `/eval` multi-statement (`const x=5; x*2`) | ✅ `{"value":10}` (replMode returns last completion value) |
| Live `/eval` bare await | ✅ `{"value":200}` |
| Live `/perf` background tab | ✅ `visibility:"hidden"`, null paints, explanatory `note` present |

## Review Dimensions

### 1. Spec-delta conformance — PASS (both capabilities)
- **chrome-use-integration**: `/perf` MODIFIED (buffered LCP observer, `visibility` always returned, opt-in `activate`) and `/eval` ADDED (top-level await via replMode) — all four scenarios map directly to `cdp-proxy.mjs` code and were confirmed live.
- **chrome-use-expert-methodology**: `--noproxy '*'` ADDED requirement + SETUP note; `/perf` background-tab caveat MODIFIED — satisfied in `_shared.ts`, `chrome-use.ts`, and `cdp-api.md`.

### 2. `/perf` code correctness — PASS with 1 Minor
- Buffered-observer promise resolves promptly: `PerformanceObserver` callback delivers buffered LCP on first tick; `Promise.race`-style guard via shared `done` flag prevents double-resolve.
- **Timeout guard present**: 400 ms `setTimeout(() => finish(null), 400)` guarantees `/perf` never hangs on zero-LCP pages. `try/catch` around `observe()` also falls back to `finish(null)`. Error paths return fast.
- `activate=true` path awaits `Target.activateTarget` (sessionless browser-level call — valid; `sendCDP(method, params, sessionId=null)` signature confirms sid is optional) then a 1200 ms settle before sampling. LEAD live-confirmed populated fp/fcp/lcp=3652.
- `note` condition (`fp===null && fcp===null && lcp===null && visibility!=='visible'`) is correctly scoped — only surfaces on genuinely-background, unrendered tabs.
- **[MINOR] Leaked PerformanceObserver per call** — `cdp-proxy.mjs:1349-1353`: `po` is `.observe()`'d but never `.disconnect()`'d. After the LCP promise resolves, the browser keeps the active observer registered in the page context, so each `/perf` invocation accumulates one dangling LCP observer on a long-lived tab. Not a hang, not a correctness bug (result is already serialized and returned), and impact is tiny per call — but it is a real per-call leak. **Fix:** call `po.disconnect()` inside the `finish` helper (the `done` guard already makes this safe/idempotent). Non-blocking.

### 3. `/eval` replMode regression — PASS (no regression)
Empirically confirmed live: object literals (via `JSON.stringify(...)`), multi-statement bodies (`const x=5; x*2` → 10), and bare await all evaluate correctly. `replMode` returns the last statement's completion value; `let`/`const` non-persistence across calls was already the case pre-change (each `Runtime.evaluate` is a fresh context) and is now documented in `cdp-api.md`. `awaitPromise: true` retained so returned Promises unwrap.

### 4. `--noproxy` completeness — PASS (LEAD's 58-vs-56 concern resolved)
`_shared.ts`: 58 lines mention `curl`; every runnable `curl` command carries `--noproxy '*'`. The 3 residuals are all prose, not commands:
- line 11 — module doc comment ("over its curl endpoints")
- line 128 — SETUP note text ("**Every curl below passes `--noproxy '*'`**")
- line 129 — SETUP note text (`curl localhost:3456` shown deliberately as the un-proxied form being explained)

`chrome-use.ts` and `cdp-api.md` curls all carry `--noproxy '*'`. **No missed commands.**

### 5. Parity maps — PASS
`git diff` on `skill-templates-parity.test.ts` shows exactly the 12 expected entries changed and no others: 6 function-hash keys (`getBenchmark/DesignConsultation/DesignReview/OfficeHours/Qa/QaOnly SkillTemplate`) + 6 content-hash keys (`openspec-benchmark/design-consultation/design-review/office-hours/qa/qa-only`). No count assertions or other skills touched. Trio green confirms the regenerated hashes are correct. Expert count remains 19 (validate passed).

### 6. `cdp-api.md` accuracy — PASS
`/perf` doc lists `visibility, note?`, documents `activate=true`, the buffered-observer rationale, the background-tab caveat, and the **no-focus-restore honesty note** ("不自动切回... CDP 无可靠的'当前前台 tab'信号"). `/eval` doc updated with bare-await example and the replMode cross-call caveat. Basics note explains the `--noproxy` proxy-hijack caveat. Doc matches actual behavior.

## Summary
Clean, tightly-scoped implementation. All 22 tasks substantiated. Full gate green. One Minor observer-leak in `/perf` worth a one-line `po.disconnect()` follow-up but does not block ship.
