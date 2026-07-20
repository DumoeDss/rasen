## Why

The config web UI served by `rasen config ui` works but looks unfinished — a bare system-font page with hairline dividers and unstyled form controls. For a visual configuration editor whose whole reason to exist is being nicer than the CLI, "简陋" (crude) undercuts the value proposition. A considered visual identity makes the editor feel trustworthy and worth installing, without changing a single thing it does.

## What Changes

- Restyle the entire `packages/ui` config editor to a warm, editorial design system (parchment canvas, terracotta accent, warm-toned neutrals, serif headlines, ring-based depth) adapted from the referenced Claude design system — a **presentation-layer change only**: every behavior, control, error surface, and the 59 existing tests are preserved.
- Introduce a token layer (CSS custom properties for color, type scale, spacing, radius, elevation, motion) in the package's stylesheet, so the whole UI is driven by named design tokens rather than ad-hoc values.
- Style each surface the UI already renders: the app shell header + nav + project switcher, the config page and its groups, each config entry row (key, source badge, description, warnings, scope chooser, every control kind, shadowed-value notes, field errors, unset buttons), and the full-screen relaunch notice.
- Ship both a **light** (primary) and a **dark** theme, the dark theme delivered via `prefers-color-scheme` from the same token set.
- Use a **system serif stack** (Georgia / Times New Roman) for headlines and a system sans stack for UI text — no webfonts, no CDNs, no network fetches at runtime; the build stays fully self-contained.
- Add **no new runtime dependencies** — a pure-CSS restyle with only minimal, class-additive JSX wrapper markup where layout requires it (no logic or behavior touched).

## Capabilities

### New Capabilities
<!-- none — this change adds no new capability; it extends the existing UI package's contract with a presentation requirement -->

### Modified Capabilities
- `config-ui-package`: adds a requirement that the editor present a coherent, warm-editorial visual identity across light and dark themes using self-contained assets (no runtime webfonts/CDNs), while preserving every existing behavioral requirement (token flow, project switcher, constraint-driven controls, source transparency, error surfacing) unchanged.

## Impact

- **Code**: `packages/ui/src/style.css` (rewritten into a tokenized stylesheet); `packages/ui/src/components/*.tsx` and `src/app.tsx` (class-additive JSX only — no behavior changes); `packages/ui/index.html` (optional `color-scheme` meta / theme hint). No changes to `src/config/*`, `src/store/*`, or `src/api/*` (logic layers).
- **APIs**: none — the config HTTP API, `src/core/config-api/`, and CLI command code are untouched.
- **Dependencies**: none added; bundle stays lean (CSS-only weight increase).
- **Tests**: all 59 existing tests must stay green; selectors and text the tests assert on (`.config-entry__source--<source>`, `.control--readonly`, control input types, scope `select`, unset button text) are preserved.
- **Out of scope**: UI package version bump and npm re-publish (a separate user decision); no HTTP API or CLI behavior changes.
