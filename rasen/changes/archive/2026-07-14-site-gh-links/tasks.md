# Tasks

## 1. Strings

- [x] 1.1 Add `chrome.githubLabel` (icon accessible name) and `hero.githubLabel` (hero link label) to `src/i18n/en.mjs`, with zh/ja/ko values in their modules (design D4); confirm the completeness check passes

## 2. Header icon (all pages)

- [x] 2.1 Add the GitHub anchor + inline SVG mark (`currentColor`, `aria-hidden` svg, localized `aria-label`) as the 7th header cell after `.lang-switch` in `src/shell.mjs`, href `https://github.com/DumoeDss/rasen` (design D2/D1)
- [x] 2.2 Extend the header grid with a trailing `auto` column, style `.gh-link` (phosphor-secondary at rest, red hover, ~16px mark, radius 0), and add the mobile exemption `display: block` AFTER the `nth-child(n+3)` hide rule per the documented equal-specificity pattern. NOTE: "no re-tuning of the five fr fractions" did NOT hold as originally hoped — the 7th column + its gap alone shaved ~0.7px off the brand track, which was enough to flip `ja`'s translated brand tagline from fitting to wrapping at 900px (verified against a pre-change worktree). Design D1's own risk section pre-authorized exactly this fallback (retune gap/fractions); the actual fix moves fr share into brand (1.4→1.7) from the three columns with slack — version/MIT/badge (0.6/0.6/0.9 → 0.5/0.5/0.8) — not from `.lang-switch` (nowrap, can't shrink). Re-verified clean at 900/1000/1200 in all 4 locales.

## 3. Hero link (landing only)

- [x] 3.1 Add the `.gh-row` link above the meta `dl` in `src/pages/landing.mjs` (`>>>` arrow idiom + localized label + literal `github.com/DumoeDss/rasen`), per design D3
- [x] 3.2 Style `.gh-row` in `site.css` (mono, `--fg2` rest / red hover, hairline alignment with the meta grid rhythm, radius 0, no new colors)

## 4. Verify

- [x] 4.1 Build twice (idempotent); diff docs output vs pre-change build and confirm the ONLY docs delta is the new header cell; confirm all four landing variants carry both links with localized labels/aria-labels
- [x] 4.2 Layout check: header wrap at 900/1000/1200px in all four locales (no two-line chrome), 360px mobile shows brand + switcher + GitHub icon without overflow, hero link renders above the meta grid at 360px and 1440px
- [x] 4.3 Interaction/visual check under `wrangler dev`: both links navigate to the repo, hover turns red, icon is monochrome inline SVG (no external requests added — network panel clean); commit deferred to ship stage per LEAD convention (matches hero-fix/i18n children) — not yet committed as of this checkbox
