## 1. Token layer & global base

- [x] 1.1 Rewrite `src/style.css` opening with a `:root` design-token block adapted from the reference `tokens.css` (surfaces, warm-neutral foreground ramp, borders, terracotta accent + hover/active, semantic colors, type scale, `--font-display`/`--font-body`/`--font-mono` system stacks per D4, spacing, radius, elevation ring/raised, focus ring, motion, container).
- [x] 1.2 Add a `@media (prefers-color-scheme: dark)` `:root` override that swaps surface/foreground/border tokens to the reference dark palette (deep dark, dark surface, warm silver text, dark borders); keep accent/semantic hues (D3).
- [x] 1.3 Set `color-scheme: light dark` (via `index.html` `<meta name="color-scheme">` and/or CSS on `:root`) so native controls and scrollbars follow the scheme (D3).
- [x] 1.4 Style `body`/base: parchment `--bg`, `--fg` text, `--font-body`, body line-height; box-sizing reset; headings default to `--font-display` weight 500.

## 2. App shell (header, nav, project switcher, content container)

- [x] 2.1 Style `.app-header` as a warm sticky bar: serif wordmark (`h1`), nav links in warm neutrals with hover-to-foreground, bottom ring/border; add class-additive wrapper markup in `Layout.tsx` only if layout needs it (no behavior change, D2).
- [x] 2.2 Style `.app-content` as a centered editorial column (max-width ~880px, gutters, generous top spacing).
- [x] 2.3 Style `.project-switcher` (and `--loading` state) label + `<select>` to match the warm control treatment.

## 3. Config page & groups

- [x] 3.1 Style `.config-group` as an ivory card with ring depth (`--elev-ring`), `--radius-lg`, card padding; serif group heading (`h2`).
- [x] 3.2 Style `.config-page__no-project-hint` and `.config-page__error` as warm inline notices (error uses `--danger`), and the loading text.

## 4. Config entry row (all sub-parts, preserving test hooks)

- [x] 4.1 Style `.config-entry` with top-border separators inside the group card; `.config-entry__header` row layout for key + source badge.
- [x] 4.2 Style `.config-entry__key` (mono/emphasis) and `.config-entry__source` badge, including per-source modifier classes `--default/--global/--project/--env-override` (warm tints; keep the class names — tests assert `.config-entry__source--global`, D2).
- [x] 4.3 Style `.config-entry__description` (`--muted`), `.config-entry__warnings` (`--danger`), `.config-entry__shadowed` (`--meta`).
- [x] 4.4 Style `.config-entry__scope-choice` and all edit controls: native `input[type=text|number|checkbox|radio]`, `select`, with warm surfaces, `--radius-md`, ring borders, terracotta `accent-color`, and `--focus-ring` on `:focus-visible`; keep control element types and `.control`/`.control--readonly`/`.control--threshold` classes intact (D5, test-safety).
- [x] 4.5 Style `.config-entry__error` (`--danger`) and the unset `<button>`s with the warm-sand secondary treatment (keep button text unchanged); if a single highest-signal action exists, give it the terracotta primary treatment via an added `btn`/`btn--primary` class only (D2 additive).

## 5. Relaunch notice

- [x] 5.1 Style `.relaunch-notice` as a centered editorial empty-state: serif headline, `--muted` body, mono `<code>`, parchment canvas, adequate spacing.

## 6. Verification

- [x] 6.1 Run `pnpm typecheck` in `packages/ui` — passes.
- [x] 6.2 Run `pnpm test` in `packages/ui` — all 59 tests green (confirms no behavior/DOM-contract regression).
- [x] 6.3 Run `pnpm build` in `packages/ui` — succeeds, `dist/index.html` + assets produced, no new deps, no remote asset references in output.
- [x] 6.4 Browser QA pass against a running `rasen config ui` (use `--no-open --port <p>` + printed `#token=` URL): verify every surface in light and dark, control interactions, error/warning states, and focus rings; confirm no external network requests for styling.
