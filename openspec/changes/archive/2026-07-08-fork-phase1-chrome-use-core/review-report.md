# Review Report — fork-phase1-chrome-use-core (A1)

**Reviewer:** reviewer-a1 (independent; did not author)
**Date:** 2026-07-08
**Branch:** dev-harness (uncommitted working tree)
**Verdict:** ✅ APPROVE — no Blockers, no Majors. 2 Minor, 3 Trivial/observation. All either design-accepted or low-impact.

## Scope reviewed (A1 file set only)
- `src/core/shared/skill-generation.ts` — `isSidecarFile` widening + chrome-use registration + import
- `src/core/templates/experts/chrome-use.ts` (new), `experts/index.ts`, `skill-templates.ts` (registration seam)
- `test/core/shared/skill-generation.test.ts` — count assertions 19→20 / 41→42, new sidecar-install test
- `skills/experts/chrome-use/scripts/{cdp-proxy,check-deps,match-site}.mjs` + `references/cdp-api.md`

Ignored per instructions: telemetry-backend/client (B1/B2), `_orchestration.ts`, docs, portfolio bookkeeping.

## Verification performed
- `node --check` on cdp-proxy.mjs → clean
- `npx vitest run test/core/shared/skill-generation.test.ts` → 38 passed
- `npx tsc --noEmit` → exit 0 (chrome-use.ts compiles; all 42 templates construct)
- Byte-diff of all 4 vendored files against `C:\Users\Sayo\.claude\skills\chrome-use\` originals
- `find skills -name '*.js' -o -name '*.mjs'` → only the 3 chrome-use scripts exist

## Spec conformance — 7 requirements (specs/chrome-use-integration/spec.md)

| # | Requirement | Status |
|---|---|---|
| 1 | Executable sidecars install (.mjs/.js) | ✅ `isSidecarFile` widened; SKILL.md/.tmpl still excluded; subdirs via `join()` (cross-platform) |
| 2 | Proxy vendored into package | ✅ 3 scripts + cdp-api.md present; no site-patterns; `copySkillSidecars` copies it |
| 3 | Registered as expert skill | ✅ `dirName: openspec-chrome-use`, `workflowId: chrome-use`, in `expertSkills` (always installed); SETUP covers all 5 mandated points; self-contained (no `_shared.ts` browse constants) |
| 4 | Interactive DOM snapshot | ✅ `/snapshot` modes i/C/D, refs+role+name, per-`targetId` baseline diff |
| 5 | Performance metrics | ⚠ `/perf` returns fcp/lcp/cls/longTasks/navTiming/resources — see Minor-1 (longtask fidelity) |
| 6 | Viewport/responsive emulation | ✅ `setDeviceMetricsOverride`; window not resized; 3 breakpoints |
| 7 | New endpoints discoverable | ✅ all 4 in 404 help object |

## Findings

### Minor-1 — `/perf` long-task metric will typically report empty
`skills/experts/chrome-use/scripts/cdp-proxy.mjs` (~:1360, `/perf` reader)
`performance.getEntriesByType('longtask')` does not return buffered entries — long tasks are delivered only to an *active* `PerformanceObserver` and are not retained in the timeline buffer. In practice `longTasks` will report `{count: 0}` on most pages. `largest-contentful-paint` and `layout-shift` *are* buffered and retrievable via `getEntriesByType` in Chrome, so LCP/CLS are fine.
**Why not higher:** Design D4 explicitly permitted a `getEntriesByType` reader and required "return available metrics rather than failing"; the code wraps longtask in try/catch and returns count:0 gracefully, so the requirement is met structurally. This is a fidelity gap vs browse's live-observer daemon, not a defect. **Unverified** because live CDP smoke was environment-blocked (accepted caveat).
**Suggested (A2 or follow-up, non-blocking):** a short-lived `PerformanceObserver({buffered:true})` reader would raise long-task/LCP fidelity.

### Minor-2 — 4 new endpoints ship with no executable verification
The `/snapshot` `/perf` `/viewport` `/responsive` code (the substantive new logic, ~180 lines) has no automated test and live CDP smoke was blocked in this environment (baseline `/new` `/targets` hang identically — blocker is upstream of the new code). Verified only by reading + `node --check`. CDP call shapes match the working `/resources` and `/screenshot` precedents exactly (`Runtime.evaluate`+`returnByValue`, `result.result.value`; `Page.captureScreenshot`, `result.data`; `Emulation.setDeviceMetricsOverride`), and all four inherit the handler's outer try/catch → 500. Already recorded as an accepted caveat; noting for the ledger. Re-run curl smoke once a responsive Chrome is available.

### Trivial-1 — `/snapshot` mode=D `changed` is churn count, not in-place edits
Diff keys on `role|name|tag`, so a text change surfaces as one removed + one added; `changed = added+removed`. Acceptable simple diff and matches the documented `cdp-api.md` shape. `unchanged = tree.length - added.length` is arithmetically correct (elements present in both).

### Trivial-2 — `/responsive` leaves the desktop override applied on exit
No reset after the final breakpoint. Documented in the response `note` and design risk-accepted (chrome-use uses disposable `/new` tabs → leakage bounded).

### Trivial-3 — `/snapshot` walker is top-document only
`document.querySelectorAll('*')` does not cross shadow DOM / iframes; iframes have a separate `/iframes` endpoint. Consistent with scope.

### Observation (not a finding) — `description: '|'`
Matches all 19 sibling expert templates (only `navigator` sets a real description). Consistent with the known deferred empty-description issue; not introduced by this change.

## Cross-cutting checks
- **isSidecarFile regression risk:** NONE. Only the 3 chrome-use `.mjs` files exist under `skills/`; no stray `.js`/`.mjs` in any other skill tree; browse skipped wholesale by `copySkillSidecars` (`:151`). `copySidecarTree` recreates subdirs with `join()` (no hardcoded slashes) — cross-platform scenario satisfied.
- **Vendoring fidelity:** `check-deps.mjs` and `match-site.mjs` byte-identical to originals. `cdp-api.md` additive-only (4 endpoint docs appended). `cdp-proxy.mjs` diff = exactly the `snapshotBaselines` map + 4 endpoints + 4 help lines; zero edits to baseline endpoints. No `site-patterns` (personal data) leaked (test asserts this).
- **Self-containment:** `chrome-use.ts` imports only `PREAMBLE`, `STORE_SELECTION_GUIDANCE`, `SkillTemplate` — no `BROWSE_SETUP`/`SNAPSHOT_FLAGS`/`COMMAND_REFERENCE`. A2/A3 seam is clean.
- **Test adequacy:** new test covers sidecar install (.mjs/.js), cdp-api.md, SKILL.md/.tmpl exclusion, site-patterns exclusion; count assertions consistently updated. Gap = the 4 endpoints (Minor-2).

## Conclusion
Ship-ready. The `isSidecarFile` seam is the correct general fix and carries no regression in the current tree. Vendoring is faithful and additive. The 4 endpoints are structurally correct against CDP and follow local precedent; the only substantive open item is fidelity/verification of `/perf` long-tasks (Minor-1) and the absence of executable endpoint tests (Minor-2), both already flagged as accepted caveats and both non-blocking for A1's foundation role.
