## Context

`browse` is a vendored bun-compiled headless-Chromium CLI driven by Playwright. It is the fork's largest engineering debt: bun `--compile` locks the binary to the build machine's OS/arch, Playwright drags a large optional dependency, and the binary is gitignored (must be CI-compiled). The fork replaces it with `chrome-use` — a maintainer-authored CDP proxy (currently at `~/.claude/skills/chrome-use`) that drives the user's everyday Chrome over the DevTools Protocol. chrome-use needs no Playwright, no bun compile, and no distributed binary; it inherits login state and real-browser fingerprint for free.

This change (batch A1) lands the chrome-use foundation. Two sibling changes follow and depend on it: `fork-phase1-expert-templates` (A2) rewrites `_shared.ts` and the consuming expert templates to call the new endpoints; `fork-phase1-browse-removal` (A3) deletes the browse tree and its wiring. The canonical design is `openspec/office-hours/browse-to-chrome-use.md` (r3); locked decisions live in `openspec/changes/fork-phase1/planning-context.md`.

Verified current state (line numbers as of this change):
- `isSidecarFile` (`src/core/shared/skill-generation.ts:105-109`) admits only `.md` (except `SKILL.md`) and `.sh`; `.tmpl` excluded. The proxy's `.mjs` files would be silently dropped by `copySidecarTree` — this is a ship-blocker.
- `copySkillSidecars` (`:142-149`) copies from `skills/experts/<workflowId>/` into the installed dir and special-cases `workflowId === 'browse'` to skip (browse's heavy `.ts` tree). chrome-use is not skipped.
- Expert skills are registered in `getSkillTemplates` (`:185-205`), re-exported through `skill-templates.ts:36-56`, and each has an `experts/<name>.ts` template exported from `experts/index.ts`.
- Vendored proxy source: `C:\Users\Sayo\.claude\skills\chrome-use\scripts\{cdp-proxy.mjs,check-deps.mjs,match-site.mjs}` + `references/cdp-api.md`. `cdp-proxy.mjs` routing is a single `if/else if (pathname === '…')` chain inside `http.createServer` (`:658-1296`) ending in a `404` help block (`:1244-1291`). Helpers: `sendCDP(method, params={}, sessionId=null)` returns `{ result }`; `ensureSession(targetId)` returns a sessionId; `waitForLoad(sessionId)`; `enableNetworkCapture(...)`. `/resources` (`:1200-1219`) already runs `Runtime.evaluate` over `performance.getEntriesByType("resource")` — a model for `/perf`. `/screenshot` (`:907-940`) models `Page.captureScreenshot` + retry.

## Goals / Non-Goals

**Goals:**
- Fix `isSidecarFile` so executable `.mjs`/`.js` sidecars install (ship-blocker, first task).
- Vendor the chrome-use proxy + `cdp-api.md` into `skills/experts/chrome-use/` as the canonical copy.
- Implement `/snapshot`, `/perf`, `/viewport`, `/responsive` on the vendored `cdp-proxy.mjs` so browser QA / benchmark / responsive audits reach parity with browse.
- Register a self-contained `chrome-use` expert skill whose SETUP handles the CDP prerequisites and lifecycle.
- Leave clean seams for A2 (template rewrites) and A3 (browse deletion): do not touch `_shared.ts` browse constants; do not delete browse.

**Non-Goals:**
- Rewriting `_shared.ts` or the consuming expert templates (qa/qa-only/design-review/design-consultation/benchmark/office-hours + navigator/verify-enhanced) — A2.
- Deleting `browse/`, `skills/experts/browse/`, or browse's package.json bin/build/import wiring — A3.
- A browser extension (rejected in the office-hours design).
- Vendoring the maintainer's personal `references/site-patterns/*` browsing data.

## Decisions

**D1 — Extend `isSidecarFile` to admit `.mjs` and `.js`.** Add `|| fileName.endsWith('.mjs') || fileName.endsWith('.js')` to the return, keeping the `SKILL.md` and `.tmpl` guards. Alternative (a chrome-use-specific copy path) was rejected: the filter is the correct general seam, browse is already excluded wholesale by `copySkillSidecars`, and no other current skill ships stray `.js`. This must land first — without it every later task's install is untested.

**D2 — Vendor by direct copy; fork copy is canonical.** Copy the three scripts + `references/cdp-api.md` verbatim into `skills/experts/chrome-use/`, then add the four endpoints to the fork copy only. chrome-use is maintainer-authored (no third-party license), so direct vendoring is clean. The `~/.claude` copy is downstream and hand-synced. Do not vendor `references/site-patterns/` (personal data; `check-deps.mjs` and `match-site.mjs` already tolerate an absent dir).

**D3 — Self-contained `chrome-use.ts` expert template.** The new template inlines its own SETUP and endpoint reference rather than importing browse's `_shared.ts` constants (`BROWSE_SETUP`/`SNAPSHOT_FLAGS`/`COMMAND_REFERENCE`). This is the key seam: A1 does not touch `_shared.ts` at all, so A2 can rewrite those constants without a merge collision, and A3 can delete browse without breaking chrome-use. Registration mirrors the other experts: new `experts/chrome-use.ts` → export in `experts/index.ts` → re-export in `skill-templates.ts` → entry in `getSkillTemplates` `expertSkills` (`dirName: 'openspec-chrome-use'`, `workflowId: 'chrome-use'`).

**D4 — Endpoint implementation, all inserted before the `404` else at `cdp-proxy.mjs:1244`, reusing `ensureSession`/`sendCDP`.**
- `/snapshot` — `Runtime.evaluate` injecting a DOM walker that emits interactive elements (elements with role/onclick/tabindex/cursor:pointer), each with a stable `@ref`, role, and text; modes mirror browse: `-i` interactive-only, `-C` include non-ARIA clickables, `-D` diff. Diff stores the last tree per `targetId` in a module-level map and returns a unified-style delta. Prefer replicating browse's output shape (LEAD default) to minimize A2 template churn.
- `/perf` — enable the CDP `Performance` domain and/or `Runtime.evaluate` a PerformanceObserver/`performance.getEntriesByType` reader for paint (FCP/LCP), layout-shift (CLS), long tasks, and resource timing; shape mirrors browse daemon `perf`. `/resources` is the working precedent for the `Runtime.evaluate` path.
- `/viewport` — `Emulation.setDeviceMetricsOverride` (width/height/deviceScaleFactor/mobile) on the tab's session; does not touch the OS window.
- `/responsive` — iterate a fixed mobile/tablet/desktop breakpoint set applying `setDeviceMetricsOverride` per step (optionally capturing a screenshot per breakpoint like browse `responsive`).
- Add all four to the `404` help object so they are discoverable.

**D5 — Path model.** `SKILL.md` addresses scripts via `${CLAUDE_SKILL_DIR}/scripts/…`; the proxy binds port 3456 and logs to `os.tmpdir()`. Verify these resolve from the OpenSpec install location (`.openspec/skills/openspec-chrome-use/`). The SETUP text uses `${CLAUDE_SKILL_DIR}` so it is host-agnostic.

## Risks / Trade-offs

- **`${CLAUDE_SKILL_DIR}` may not resolve in OpenSpec's install layout** → SETUP task must verify path resolution at `.openspec/skills/openspec-chrome-use/`; if the variable is host-specific, document the concrete relative path the skill should use.
- **`.js`/`.mjs` sidecar filter is broad** → any skill shipping a stray `.js` now installs it. Verified no current non-browse skill has stray `.js` sidecars; browse is skipped wholesale. Acceptable.
- **`/snapshot` diff parity with browse** → browse's `snapshot -D` unified-diff format is nontrivial; if exact parity is costly, match observable semantics (what changed) and let A2 adapt the template. Diff baseline is per-`targetId` and in-memory, lost on proxy restart (acceptable — snapshots are taken in pairs within a session).
- **`/perf` metric availability varies by page/Chrome version** (LCP/CLS require the page to have painted/shifted) → return whatever metrics are available rather than failing; document partial results.
- **Emulation persists on the tab** → `/viewport`/`/responsive` leave the override set; document that callers reset via a full-window override or tab close (chrome-use uses disposable `/new` tabs, so leakage is bounded).
- **Sticky proxy** → the proxy must not be stopped (restart forces re-authorizing CDP). SETUP states this; lifecycle is per-`targetId`, shared across sub-agents.

## Migration Plan

1. Land D1 (`isSidecarFile`) first and confirm `.mjs` copy via an install/update run.
2. Vendor scripts + `cdp-api.md`; add the four endpoints to the fork copy.
3. Add `chrome-use.ts` + registration; generate and inspect the installed skill.
4. No rollback coupling to browse: browse remains registered and functional until A3, so this change is additive and independently revertable.

## Open Questions

- Exact `/snapshot` diff serialization (full unified diff vs. structured added/removed/changed) — resolve during implementation against browse's actual output; default to replicating browse shape.
- Whether `/perf` should enable the Performance domain up front or lazily per request — implementation detail; prefer lazy to avoid per-tab overhead.
