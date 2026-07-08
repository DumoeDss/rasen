## Why

The fork's release strategy (Phase 1, batch A) removes `browse` — a vendored bun-compiled headless Chromium tool with a heavy Playwright dependency and platform-locked binaries — and replaces it with `chrome-use`, a CDP proxy that drives the user's everyday Chrome (login state, anti-bot resilience, browser-layer capture) with no native binary to distribute. This change delivers the chrome-use foundation: the vendored proxy must actually ship with the skill, and the browser-QA capabilities that browse had but chrome-use lacks (structured DOM snapshot with diff, performance metrics, viewport/responsive emulation) must be present at first release — not deferred. It is the first of three sibling changes (this, expert-templates, browse-removal) and unblocks both.

## What Changes

- **Ship-blocker fix**: skill sidecar copying (`isSidecarFile`) currently only admits `.md`/`.sh`, so the proxy's `.mjs` scripts are silently skipped by `copySidecarTree` and never install. Extend it to also admit `.mjs`/`.js` executable sidecars.
- **Vendor the chrome-use proxy** into `skills/experts/chrome-use/scripts/` (`cdp-proxy.mjs`, `check-deps.mjs`, `match-site.mjs`) plus its `references/cdp-api.md`, so the fork is self-contained and the fork copy is canonical.
- **Implement four gap endpoints** on the vendored `cdp-proxy.mjs` so browser QA does not regress relative to browse:
  - `/snapshot` — serialized interactive DOM tree (clickable elements, ARIA roles, text) with baseline diff, matching browse `snapshot -i`/`-C`/`-D` semantics.
  - `/perf` — CDP Performance-domain metrics (LCP/FCP/CLS, resource timing, long tasks), matching browse daemon `perf`.
  - `/viewport` + `/responsive` — per-tab viewport/device emulation via `Emulation.setDeviceMetricsOverride` (does not resize the real window).
- **Register a new `chrome-use` expert skill** (new expert id `chrome-use`, dir `openspec-chrome-use`) with a self-contained SETUP section covering: running `check-deps`; Chrome / Node 22+ / remote-debugging prerequisites; the first-CDP-connection Chrome "Allow" permission popup; and the sticky-proxy + `targetId` lifecycle conventions.

Out of scope (sibling changes): rewriting `_shared.ts` and the consuming expert templates (qa, design-review, etc.) to call the new endpoints — `fork-phase1-expert-templates`; deleting `browse/` and its bin/build/import wiring — `fork-phase1-browse-removal`. This change leaves clean seams for both: the new `chrome-use` expert template is self-contained (does not depend on browse's `_shared.ts` constants), and browse registration is left untouched.

## Capabilities

### New Capabilities
- `chrome-use-integration`: Bundle and install the vendored chrome-use CDP proxy as skill sidecars, expose it as a first-class `chrome-use` expert skill with dependency-checked SETUP, and provide the browser-QA endpoints (`/snapshot`, `/perf`, `/viewport`, `/responsive`) needed for parity with the removed browse tool.

### Modified Capabilities
<!-- None. browse-integration removal and expert-template rewrites are sibling changes. -->

## Impact

- **Code**: `src/core/shared/skill-generation.ts` (`isSidecarFile` filter); new `src/core/templates/experts/chrome-use.ts` + export in `experts/index.ts`, re-export in `skill-templates.ts`, and registration in `skill-generation.ts` `getSkillTemplates`; new vendored tree `skills/experts/chrome-use/scripts/*.mjs` + `references/cdp-api.md`.
- **Install/runtime**: `openspec init`/`update` now copies `.mjs`/`.js` sidecars for every skill; the chrome-use proxy installs to `.openspec/skills/openspec-chrome-use/scripts/` and is launched by `check-deps.mjs`.
- **Dependencies**: none added — chrome-use uses native Node ≥22 WebSocket and the user's own Chrome; no Playwright, no bun compile, no distributed binary.
- **Seams left for siblings**: browse and chrome-use skills coexist after this change (browse removed in A3); no consuming template is rewritten here (A2).
