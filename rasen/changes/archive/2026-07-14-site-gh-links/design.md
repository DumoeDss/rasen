## Context

rasen-site @ 1884b81 (4-locale landing live). The shell header is a hard 6-column grid: `1.4fr 0.9fr 0.6fr 0.6fr 0.9fr 1.6fr` = brand · docs · version · MIT · badge · lang-switch, fractions hand-tuned because translated chrome strings (ja especially) wrapped at 900–1200px with narrower fractions. Mobile ≤720px collapses to `1fr auto auto` and hides `nth-child(n+3)` with an explicit `.lang-switch { display: block }` exemption that must come after the hide rule. Chrome strings live in `src/i18n/*.mjs` under a `chrome` group; the completeness check makes new keys mandatory in all four locales automatically. Two placement targets: header (all pages, via `shell.mjs`) and the landing hero above the meta `dl` (via `landing.mjs`, which sits in `.meta-col`).

## Goals / Non-Goals

**Goals:**
- GitHub reachable from every page's header (icon) and from the landing hero (localized text link) at all viewports and locales, without breaking the tuned header layout.

**Non-Goals:**
- Any other chrome rework, star counts / GitHub API calls (would violate self-contained runtime), footer changes (repository link already there), docs content changes.

## Decisions

**D1 — Header: 7th cell, icon-only, explicitly exempt on mobile.** Add the icon as a new last cell AFTER `.lang-switch` (order: … badge · lang-switch · gh). Icon-only means near-zero width pressure: the cell is `auto`-sized by giving the grid `grid-template-columns: 1.4fr 0.9fr 0.6fr 0.6fr 0.9fr 1.6fr auto` — appending `auto` avoids re-tuning the five text fractions (the documented trap) because the icon's intrinsic width is a constant ~18px in every locale. Mobile: add `.site-header .shell > .gh-link { display: block }` after the `nth-child(n+3)` hide rule (same equal-specificity pattern as the M1 lang-switch exemption — the icon is the smallest affordance we have, and a GitHub link is chrome users expect on mobile too). Wrap re-check at 900–1200px in all four locales is still a verification task since gap×1 more column shaves ~30px from the fr columns.
Alternative considered: replace the `MIT` cell (lowest-value) — rejected: removing content cells changes the nth-child indexing and the l10n spec's header expectations for no need.

**D2 — Icon: GitHub mark as inline SVG path, `currentColor`.** Single `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">` with the canonical Octocat-mark path, inside `<a class="gh-link" aria-label="${chrome.githubLabel}">`. `currentColor` inherits phosphor-secondary from the header and flips to red via `.gh-link:hover { color: var(--red) }` — no fills to maintain, no radius anywhere (the mark's curves are the logo itself, not UI rounding; the CRT "radius 0" rule governs boxes, and the spec words the icon rule as "inline monochrome SVG mark"). `aria-hidden` on the svg + `aria-label` on the anchor = one accessible name, localized.

**D3 — Hero link: a `.gh-row` line above the `dl` in `.meta-col`.** Markup in `landing.mjs`: `<a class="gh-row" href="https://github.com/DumoeDss/rasen"><span class="arrow">&gt;&gt;&gt;</span> ${t.hero.githubLabel} · github.com/DumoeDss/rasen</a>` — reuses the existing `>>>` arrow idiom (also counts toward the ASCII-decoration quota), mono, `--fg2` at rest / red on hover, hairline top border aligning with the `dl`'s existing `border-top` rhythm. The URL text stays untranslated; only the label word ("Source" / "源码" / "ソースコード" / "소스") localizes.

**D4 — i18n keys: `chrome.githubLabel` (icon aria-label) + `hero.githubLabel` (text link label)** added to `en.mjs` and translated in zh/ja/ko within this change (four short words — no fleet needed; the completeness check enforces presence). Repository URL is a constant in the templates, not a locale string.

**D5 — Verification mirrors the l10n harness:** build twice (idempotent), diff `dist/docs` — expect ONLY the header icon delta on docs pages (this change intentionally alters the shared shell, so byte-identity does not apply; instead assert the docs diff contains nothing but the new header cell), check header wrap 900/1000/1200px × 4 locales, mobile 360px shows brand + icon + switcher without overflow, hover states, `wrangler dev` smoke.

## Risks / Trade-offs

- [7th column squeezes tuned fractions → ja chrome wraps again at ~1000px] → `auto` column adds only icon width (~30px incl. gap); explicit wrap re-check in all locales is a task; fallback lever: drop `gap` to 10px or shave `1.6fr`→`1.5fr` on `.lang-switch`, which has `white-space: nowrap` headroom.
- [Mobile header now shows 3 items in `1fr auto auto` → the collapsed template must place icon + switcher] → the collapsed template's `auto auto` slots now need three surviving cells (brand, switcher, icon); adjust the ≤720px template to `1fr auto auto` remains correct because hidden cells don't occupy tracks — verify, and if the track count misbehaves, switch the collapsed header to flex per the same visual result.
- [SVG mark's curves read as "rounded" in a radius-0 audit] → the pre-flight rule targets boxes/components; the brand mark is imagery (monochrome, flat) — noted here so the reviewer doesn't flag it.
- [GitHub link is an external navigation on an otherwise self-contained page] → allowed: self-containment governs render-time requests, not user-initiated navigation.

## Open Questions

None — small, well-bounded; label word choices are the implementer's within D4's examples.
