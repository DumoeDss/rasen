## Context

`packages/ui` (`@atelierai/rasen-ui`, Preact + preact-iso, Vite 6, Vitest/jsdom) is the optional visual config editor served by `rasen config ui`. It is a standalone package (not in the pnpm workspace) whose entire styling today is a ~50-line `src/style.css` using system fonts, hairline `#ddd`/`#eee` dividers, and unstyled native form controls — accurately described by the user as "简陋" (crude).

The referenced design system (`.../design-systems/claude/`: `DESIGN.md`, `tokens.css`, `components.html`, read-only external input) defines a warm-editorial identity: parchment canvas `#f5f4ed`, ivory surfaces `#faf9f5`, terracotta accent `#c96442`, exclusively warm-toned neutrals, serif headlines + sans UI, ring-based depth, and both light and dark palettes. Its `tokens.css` is a ready-made `:root` custom-property set that maps almost directly onto what this UI needs.

Constraints (from planning-context.md, authoritative): scope is `packages/ui` only; preserve ALL behavior and the 59 existing tests; no new runtime dependencies; no runtime webfonts/CDNs (the CLI serves only `dist/`); Anthropic's proprietary fonts substitute with system serif/sans stacks; version bump + npm re-publish are out of scope.

The test surface pins specific hooks the restyle must not break: `test/components/config-entry-row.test.tsx` queries `.config-entry__source--<source>`, `.control--readonly`, `input[type=number|radio]`, `select`, and unset-button text content. These class names, control element types, and text must survive the restyle.

## Goals / Non-Goals

**Goals:**
- Give every surface the editor renders a coherent warm-editorial identity driven by named design tokens.
- Deliver light (primary) + dark (`prefers-color-scheme`) themes from one token set.
- Keep the change presentation-only: zero behavior change, all 59 tests green, no new deps, no network fetches.
- Keep the bundle lean (CSS-only weight increase; current JS ~29KB).

**Non-Goals:**
- No changes to logic layers (`src/config/*`, `src/store/*`, `src/api/*`), the HTTP API, `src/core/config-api/`, or CLI code.
- No webfonts, icon fonts, CSS frameworks, or component libraries.
- No new modules, routes, or features; no version bump or publish.
- No user-facing theme toggle (dark follows the OS/browser preference only).

## Decisions

### D1: Pure-CSS restyle, token layer copied from the reference `tokens.css`
Rewrite `src/style.css` into two parts: a `:root` token block (color, type scale, spacing, radius, elevation, motion, layout — adapted from the reference `tokens.css`) followed by component rules that consume only `var(--*)`. This keeps the identity single-sourced and consistent, and makes the dark theme a token override rather than a second stylesheet.
- *Why over a CSS framework / CSS-in-JS:* no new dependency, smallest bundle delta, and the reference system is already expressed as plain custom properties.
- *Note on `color-mix`:* the reference tokens use `color-mix(in oklab, …)` for accent hover/active. Supported in all evergreen browsers; acceptable since the editor is a locally-launched dev tool. If a hard fallback is wanted, precompute the two hover/active hex values instead — a task-level detail, not an architectural one.

### D2: Style by existing class names and semantic elements; JSX changes are class-additive only
The components already emit meaningful class names (`app-header`, `app-content`, `config-group`, `config-entry`, `config-entry__header/__key/__source/__description/__warnings/__shadowed/__error/__scope-choice`, `control`, `control--readonly`, `control--threshold`, `project-switcher`, `relaunch-notice`). The restyle targets these. JSX edits are limited to **adding** wrapper elements/classes where layout needs them (e.g. a card wrapper, a control-row container, a `<button class="btn btn--primary">` for the primary action) — never removing or renaming a class a test asserts on, never touching handlers, state, or control element types.
- *Test-safety invariant:* `.config-entry__source--<source>`, `.control--readonly`, native `input[type=…]` / `select` control kinds, and unset-button text stay exactly as-is. Any new class is added alongside, not in place of, existing ones.
- *Why not restructure freely:* the tests are the behavior contract; the cheapest guarantee of "no behavior change" is to leave the DOM contract they assert on intact.

### D3: Dark theme via `prefers-color-scheme`, same tokens
Implement dark by overriding the surface/foreground/border token values inside `@media (prefers-color-scheme: dark)` on `:root`, using the reference system's dark palette (deep dark `#141413`, dark surface `#30302e`, warm silver text `#b0aea5`, dark borders). Accent and semantic hues carry over. Set `color-scheme: light dark` (via `index.html` meta or CSS) so native controls (checkbox, select, number spinner) and scrollbars adopt the scheme automatically — this is what makes the un-restyled internals of native controls look right in dark mode for near-zero cost.
- *Why token-override over a `[data-theme]` attribute:* no JS, no toggle, no state; the OS preference is the single source and both themes stay in lockstep by construction. A future explicit toggle can layer a `:root[data-theme=…]` selector on top without reworking this.

### D4: System font stacks, no downloaded typefaces
`--font-display: Georgia, "Times New Roman", serif` for headings; `--font-body: system-ui, -apple-system, "Segoe UI", Arial, sans-serif` for UI; `--font-mono: ui-monospace, Menlo, monospace` for code/values. This honors the reference system's serif/sans split without shipping or fetching Anthropic's proprietary faces.
- *Why:* the CLI serves only `dist/`; a remote `@font-face` would break offline and add a runtime network dependency. System serif is the reference doc's own prescribed fallback.

### D5: Native controls, restyled minimally and warmly
Keep native `<input>`/`<select>`/`<button>` elements (required by both behavior and tests) but give them warm surfaces, `--radius-md` corners, ring borders, terracotta `accent-color` (checkbox/radio), and the focus-blue `--focus-ring` on `:focus-visible`. The primary/only chromatic button (e.g. an action CTA if present) uses terracotta; unset buttons use the warm-sand secondary treatment.
- *Why not custom control widgets:* replacing native controls would risk behavior and test breakage for marginal visual gain; `accent-color` + focus ring gets most of the identity for near-zero risk.

### D6: Layout — editorial container, card-grouped config
Wrap `app-content` in a centered max-width column (`--container-max` scaled down for a config tool, ~880px) with editorial gutters; render each `config-group` as an ivory card with ring depth and a serif group heading; give each `config-entry` top-border separators within the card. The header becomes a sticky warm bar with serif wordmark, nav, and project switcher. The relaunch notice becomes a centered editorial empty-state.

## Risks / Trade-offs

- **Test breakage from DOM/class changes** → D2 pins the exact selectors/text the tests assert on; JSX edits are additive only. Run `pnpm test` after the CSS and after any JSX wrapper edit.
- **Native control appearance in dark mode looking off** → D3's `color-scheme: light dark` lets the browser theme native control chrome; `accent-color` handles checkbox/radio/spinner tint. Verified in the browser QA pass at review.
- **`color-mix` / `:focus-visible` support** → both are evergreen-baseline; the editor is a locally-launched tool, not a broad-audience public site. Precomputed hex fallbacks are available if needed (D1 note).
- **Bundle growth** → CSS-only; a tokenized stylesheet is a few KB, well within "keep it lean." No JS delta beyond additive markup.
- **Contrast/a11y regressions from the warm palette** → the reference palette is designed for AA; keep body text on `--fg`/`--muted` over parchment/ivory, reserve `--meta` for genuinely tertiary text, and keep the focus ring. Confirm at design-review.

## Migration Plan

Presentation-only, no data or API migration. Deploy = merge; the CLI serves the rebuilt `dist/` unchanged in contract. Rollback = revert the CSS/JSX diff (no schema, storage, or wire-format touched). Verification gate before ship: `pnpm test` (59 green), `pnpm typecheck`, `pnpm build` all pass in `packages/ui`, plus a browser QA / design-review pass against a running `rasen config ui` (light and dark).

## Open Questions

- Is there a primary CTA on any current surface that should carry the terracotta accent, or is terracotta reserved purely for accents/links until a future action exists? (Resolve during implementation by auditing rendered surfaces; default: reserve terracotta for links/focus/selected states and the single most important action if one exists, e.g. keep it sparing per the design system's "highest-signal only" rule.)
- Keep `color-mix` or precompute accent hover/active hex? (Default: keep `color-mix`; revisit only if review flags support.)
