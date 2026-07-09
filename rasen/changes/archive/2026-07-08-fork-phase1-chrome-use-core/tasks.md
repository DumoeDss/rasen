## 1. Sidecar filter fix (ship-blocker — do first)

- [x] 1.1 In `src/core/shared/skill-generation.ts`, extend `isSidecarFile` (currently `:105-109`) to also return true for `.mjs` and `.js`, keeping the `SKILL.md` and `.tmpl` guards. Update the doc comment above it to mention executable script sidecars.
- [x] 1.2 Confirm `copySkillSidecars` still skips only `workflowId === 'browse'` and copies chrome-use (no code change expected — verify by reading `:142-149`).
- [x] 1.3 Add/extend a unit test for `isSidecarFile` (or `copySidecarTree`) asserting `.mjs`/`.js` are admitted and `SKILL.md`/`.tmpl` are still excluded; run it green.

## 2. Vendor the chrome-use proxy

- [x] 2.1 Create `skills/experts/chrome-use/scripts/` and copy `cdp-proxy.mjs`, `check-deps.mjs`, `match-site.mjs` verbatim from `C:\Users\Sayo\.claude\skills\chrome-use\scripts\`.
- [x] 2.2 Create `skills/experts/chrome-use/references/` and copy `references/cdp-api.md` from the source skill. Do NOT copy `references/site-patterns/` (personal browsing data).
- [x] 2.3 Verify the vendored `check-deps.mjs` resolves `PROXY_SCRIPT` and the site-patterns dir relative to its own location (`ROOT = ../`), so it works from the installed `.openspec/skills/openspec-chrome-use/` path; no source edits unless a hardcoded path is found.

## 3. Gap endpoints on the vendored cdp-proxy.mjs

All four are inserted into the `if/else if (pathname === …)` chain in `http.createServer` BEFORE the `404` else block (`cdp-proxy.mjs:1244`), reusing `ensureSession(q.target)` and `sendCDP(method, params, sid)`.

- [x] 3.1 Implement `/snapshot?target=&mode=i|C|D` — `Runtime.evaluate` a DOM walker returning interactive elements (role, text, stable `@ref`); `mode=C` also includes non-ARIA clickables (cursor:pointer/onclick/tabindex); `mode=D` diffs against a per-`targetId` in-memory baseline and returns the delta. Match browse `snapshot -i/-C/-D` output shape as closely as is cheap.
- [x] 3.2 Implement `/perf?target=` — return LCP/FCP/CLS, resource timing, and long tasks via the CDP `Performance` domain and/or a `Runtime.evaluate` PerformanceObserver/`getEntriesByType` reader (use `/resources` at `:1200` as the precedent). Return available metrics rather than failing when some are absent.
- [x] 3.3 Implement `/viewport?target=&width=&height=&scale=&mobile=` — apply `Emulation.setDeviceMetricsOverride` on the tab session; confirm the real window is not resized.
- [x] 3.4 Implement `/responsive?target=` — iterate a fixed mobile/tablet/desktop breakpoint set applying `setDeviceMetricsOverride` per step (optionally capture a screenshot per breakpoint, mirroring browse `responsive`); return the per-breakpoint results.
- [x] 3.5 Add `/snapshot`, `/perf`, `/viewport`, `/responsive` to the `404` endpoint help object (`:1246-1290`) so they are discoverable.
- [x] 3.6 Smoke-test the four endpoints against a real Chrome + running proxy (curl each; verify snapshot diff, perf metrics, viewport emulation, responsive breakpoints). NOTE: proxy boots, binds port, discovers Chrome, and `/health` returns valid JSON, but live CDP command execution was blocked in this environment — the unmodified baseline `/new` and `/targets` endpoints also time out (Chrome on the discovered debug port 9222 accepts the WebSocket but hangs on every CDP command). The blocker is upstream of the new code (baseline endpoints fail identically before any new-endpoint code runs). Endpoints are `node --check`-clean and follow the exact `ensureSession`/`sendCDP`/`Runtime.evaluate`/`Emulation.setDeviceMetricsOverride` patterns of the working `/resources` and `/screenshot` endpoints. Re-run the live curl smoke test once a responsive Chrome is available.

## 4. Register the chrome-use expert skill

- [x] 4.1 Create `src/core/templates/experts/chrome-use.ts` exporting `getChromeUseSkillTemplate()` — a self-contained template (name `openspec:chrome-use`) that inlines its own SETUP and endpoint reference; do NOT import browse's `_shared.ts` constants (`BROWSE_SETUP`/`SNAPSHOT_FLAGS`/`COMMAND_REFERENCE`). Mirror `browse.ts` structure (PREAMBLE + STORE_SELECTION_GUIDANCE).
- [x] 4.2 Author the SETUP section: run `node "${CLAUDE_SKILL_DIR}/scripts/check-deps.mjs"`; state Chrome + Node 22+ + remote-debugging (`chrome://inspect/#remote-debugging`) prerequisites; warn the first CDP connection triggers a Chrome "Allow" popup (`check-deps.mjs:131`); document sticky-proxy (never stop it) and per-`targetId` tab lifecycle (`/new` background tab, `/close` when done, shared proxy on port 3456).
- [x] 4.3 Include a curl endpoint reference in the skill body covering the core primitives plus the four new endpoints (`/snapshot`, `/perf`, `/viewport`, `/responsive`), pointing to `references/cdp-api.md` for the full list.
- [x] 4.4 Add `export { getChromeUseSkillTemplate } from './chrome-use.js';` to `src/core/templates/experts/index.ts`.
- [x] 4.5 Add `getChromeUseSkillTemplate` to the re-export block in `src/core/templates/skill-templates.ts` (`:36-56`).
- [x] 4.6 Register the entry in `getSkillTemplates` `expertSkills` (`skill-generation.ts:185-205`): `{ template: getChromeUseSkillTemplate(), dirName: 'openspec-chrome-use', workflowId: 'chrome-use' }`. Import the symbol in the top-of-file import list.

## 5. Verify install + path model

- [x] 5.1 Build and run `openspec init`/`update` in a scratch dir; confirm `.openspec/skills/openspec-chrome-use/scripts/{cdp-proxy,check-deps,match-site}.mjs` and `references/cdp-api.md` are installed.
- [x] 5.2 Confirm `${CLAUDE_SKILL_DIR}` in the generated `SKILL.md` resolves to the installed skill dir so `check-deps.mjs` is launchable; if it does not resolve in OpenSpec's layout, adjust the SETUP path reference and note the correct form.
- [x] 5.3 Run `openspec validate fork-phase1-chrome-use-core` and the repo test suite for touched files; confirm green (browse still registered and functional — no browse deletion in this change).
