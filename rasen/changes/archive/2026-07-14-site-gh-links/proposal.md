## Why

The live rasen.io site nowhere links to the project's GitHub repository from its chrome — the only GitHub links are buried in the footer colophon and the coexistence section's upstream reference. A visitor who wants the source, issues, or stars has no visible affordance in the header or the hero area (user request, 2026-07-14: GitHub icon in the top nav + a GitHub link above the hero's VERSION/LICENSE/REQUIRES/PACKAGE meta grid).

## What Changes

- Add a GitHub icon link (to `https://github.com/DumoeDss/rasen`) to the header register strip in the shared shell — visible on all four locale landing pages AND on docs pages. The icon is the GitHub mark as an inline SVG path: monochrome phosphor, hover red, `border-radius: 0`, no external assets or icon fonts; accessible name supplied per locale via the existing i18n chrome keys.
- Add a visible GitHub text link on the landing hero, directly above the VERSION/LICENSE/REQUIRES/PACKAGE meta grid, in the CRT idiom (e.g. `>>> github.com/DumoeDss/rasen`) with a localized label from the i18n string modules — all four locales.
- Respect the two documented header traps: the header is a hard 6-column grid whose fractions were tuned to the four locales' string lengths (adding a cell requires re-checking wrap at 900–1200px in all locales), and the mobile rule hides header cells from the 3rd onward (`nth-child(n+3)`), so the new icon cell must be explicitly exempted (like the language switcher already is) or deliberately hidden — decided in design, verified on mobile.
- No new colors, radii, JS, or dependencies; i18n completeness check picks up the new keys automatically (every locale must fill them or the build fails).

## Capabilities

### New Capabilities

None — this extends existing landing/l10n surface contracts rather than introducing a new capability area.

### Modified Capabilities
- `website-landing`: the "Landing page content is real and complete" requirement gains the repository affordances — a header GitHub icon link and a hero-area GitHub text link above the meta grid — as part of the canonical page content.
- `website-l10n`: the "Faithful externalized translations" requirement's string set now includes the GitHub link labels/accessible names (localized like all other chrome), and the switcher-bearing header must accommodate the icon cell on every locale and viewport.

## Impact

- **Files (all in `/Users/sayo/repos/rasen-site`):** `src/shell.mjs` (header cell with inline SVG), `src/pages/landing.mjs` (hero link above the meta `dl`), `src/i18n/{en,zh,ja,ko}.mjs` (new label/aria keys), `src/styles/site.css` (icon sizing/hover, header grid fraction retune, mobile exemption or hide decision).
- **Docs pages:** gain the header icon through the shared shell; docs content/build pipeline untouched.
- **Downstream:** `site-docs-i18n` follows serially and also edits `shell.mjs`/i18n — this change lands first and small.
- **Delivery:** ships LOCAL (commit in rasen-site); deploy to rasen.io at portfolio end.
