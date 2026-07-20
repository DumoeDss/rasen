# Planning context — config-ui-claude-design

## User intent (verbatim)
"当前的ui太简陋了，/Users/sayo/repos/elftia_dev/dev-branch-1/elftia/resources/design-studio-builtin/design-systems/claude 参考这个设计系统，为我们的ui进行更新。功能实现很重要，但是美观的页面也很重要！"

Restyle the `packages/ui` config web app (served by `rasen config ui`) using the referenced design system. Functionality must be preserved; visual quality is a first-class goal.

## Reference design system (read-only external input — do NOT modify it)
Location: `/Users/sayo/repos/elftia_dev/dev-branch-1/elftia/resources/design-studio-builtin/design-systems/claude/`
Three files: `DESIGN.md` (full spec), `tokens.css` (CSS custom properties), `components.html` (component examples).
Key traits (LEAD already read DESIGN.md):
- Warm parchment canvas `#f5f4ed`, ivory cards `#faf9f5`, warm sand `#e8e6dc`
- Terracotta brand accent `#c96442`, coral `#d97757`; error crimson `#b53333`; focus blue `#3898ec` (only cool color, a11y focus rings)
- ALL grays warm-toned (`#5e5d59`, `#87867f`, `#4d4c48`); cream borders `#f0eee6`/`#e8e6dc`
- Dark theme: deep dark `#141413`, dark surface `#30302e`, warm silver text `#b0aea5`
- Serif for headlines, sans for UI, mono for code; ring-based shadows (`0 0 0 1px`), gradient-free
- Editorial, generous spacing, quiet intellectual feel

## Current UI facts (verified this session)
- Package `@atelierai/rasen-ui` at `packages/ui/` — Preact + preact-iso, Vite 6, Vitest/jsdom. Standalone (NOT in pnpm workspace). Published to npm at 0.1.0 (2026-07-20); publishing config commit 1a3bbf1 on dev/0.1.5.
- Structure: `src/main.tsx`, `src/app.tsx` (token check → RelaunchNotice or Router), `components/{Layout,ConfigPage,ConfigEntryRow,ProjectSwitcher,RelaunchNotice}.tsx`, logic-only `config/{grouping,controls,errors}.ts`, `store/{project-store,use-project-state}.ts`, `api/{client,token,types}.ts`.
- Current styling is minimal (one small CSS file `dist/assets/*.css` ~0.6KB → "简陋" is accurate).
- Served same-origin by the CLI's `serveStatic` from the installed package `dist/`; `vite dev` proxies `/api`. Fully self-contained build (no external fonts/CDNs at runtime is the safe assumption — the CLI serves only the dist dir; prefer system font stacks or bundled assets over remote font links).
- 59 existing tests must stay green; logic files (controls/errors/grouping) should NOT change semantics — this is a presentation-layer change.

## Constraints / decisions already made
- Scope: `packages/ui` only. Do NOT touch the HTTP API, `src/core/config-api/`, or CLI command code. No new runtime dependencies unless clearly justified (bundle is 29KB JS — keep it lean; pure CSS restyle strongly preferred).
- Preserve ALL behavior: token flow, RelaunchNotice on 401, project switcher, control kinds per constraints, error mapping (field/page/full-screen), client-side validation mirror.
- Both light & dark: the design system defines both palettes; implement light as primary, dark via `prefers-color-scheme` if cheap, else light-only is acceptable for v1 (planner to decide and record).
- Anthropic Serif is proprietary — substitute with a system serif stack (e.g. Georgia/'Times New Roman'/serif) per DESIGN.md's spirit; do NOT fetch webfonts at runtime.
- Version bump of the UI package (0.1.0 → 0.1.1) and npm re-publish are OUT of scope for this change (publishing is a separate user decision; see version-discipline).
- Testing: `pnpm test` + `pnpm typecheck` + `pnpm build` in packages/ui must pass. A browser QA pass will run in review (rasen-qa/design-review may be used by verify stage; the app needs `rasen config ui` running — reviewer can use `--no-open --port <p>` and the printed `#token=` URL).

## Delivery
Single change, small-feature pipeline, gate policy off (flag). Ship mode: resolve at ship stage (likely local commit on dev/0.1.5).

## Planner findings (appended after propose)
- **Test-safety contract (load-bearing).** `packages/ui/test/components/config-entry-row.test.tsx` asserts on exact DOM hooks the restyle MUST preserve: class `.config-entry__source--<source>` (e.g. `--global`), `.control--readonly`, native control element types (`input[type=number|radio]`, `select`), and unset-button text (`"Unset project value"`). Other tests (controls/errors/grouping/api) are logic-only and don't touch styling. Decision recorded as design D2: JSX edits are **class-additive only** — never remove/rename an asserted class or change a control's element type.
- **Spec shape decision.** Used ADDED Requirements (not MODIFIED) against existing `config-ui-package` — this adds a new presentation concern without changing any existing behavioral requirement, matching the schema's "adding new concerns without changing existing behavior → ADDED" rule. Three new requirements: visual identity, light/dark via `prefers-color-scheme`, self-contained assets (no runtime fetches, no new deps). Delta validates clean.
- **Reference `tokens.css` maps ~1:1 onto this UI.** It's already a plain `:root` custom-property set (surfaces, warm-neutral ramp, terracotta accent with `color-mix` hover/active, type scale, spacing, radius, ring elevation, focus-blue ring). Plan copies it as the token layer (design D1). One watch item: it uses `color-mix(in oklab,…)` — evergreen-baseline, fine for a locally-launched tool; precomputed hex fallback available if review objects.
- **Dark theme is cheap.** Token-override under `@media (prefers-color-scheme: dark)` + `color-scheme: light dark` (so native controls/scrollbars theme themselves) + `accent-color` on checkbox/radio. No JS, no toggle — decided to ship dark (design D3), not defer.
- **Fonts:** system serif (Georgia/Times) for headlines, system sans (system-ui/-apple-system/Segoe UI/Arial) for UI, per D4 — honors the serif/sans split with zero webfonts.
- **Current surfaces to style** (all already emit usable class names): app shell header/nav/`.project-switcher`, `.app-content` container, `.config-group`, `.config-entry` + its `__header/__key/__source/__description/__warnings/__scope-choice/__shadowed/__error` parts, `.control`/`--readonly`/`--threshold`, `.relaunch-notice`. No CTA button currently carries chromatic weight — open question in design.md is whether terracotta stays reserved for links/focus/selected + unset-vs-primary treatment; default is sparing per the design system's "highest-signal only" rule.
