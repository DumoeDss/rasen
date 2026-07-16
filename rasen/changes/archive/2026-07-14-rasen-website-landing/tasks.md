# Tasks

## 1. Scaffold the rasen-site repository

- [x] 1.1 Create `/Users/sayo/repos/rasen-site/`, run `git init`, add `.gitignore` (dist/, node_modules/) and a short README (what the site is, build/preview/deploy commands, the shell/CSS extension seam for doc pages)
- [x] 1.2 Create `package.json` (private, `"type": "module"`, scripts `build` → `node build.mjs`, `dev`/`preview` → wrangler dev after build) and install `wrangler` as devDependency
- [x] 1.3 Create `wrangler.jsonc` — name `rasen-site`, `assets.directory: "./dist"`, current compatibility_date; no Worker script

## 2. Build pipeline and shared shell

- [x] 2.1 Implement `build.mjs`: clean-rebuild `dist/`, render pages through the shell, copy `src/assets/` and the stylesheet; all paths via `node:path`/`node:url` (Windows-safe); inject version by reading the sibling rasen repo's `package.json` with a pinned fallback when absent
- [x] 2.2 Implement `src/shell.mjs` — `renderPage({title, description, content})` producing the full HTML document: head with meta/OG tags, local favicon, stylesheet link, header register strip, footer colophon slot, scanline overlay
- [x] 2.3 Implement `src/styles/site.css` — design tokens as custom properties (charcoal/phosphor/red/green/hairline), type scale (mono body, grotesque titles at clamp(56px,7vw,96px)), zero border-radius, hairline telemetry-grid utilities, hazard-stripe block, scanline keyframe-free overlay, caret-blink and dot-pulse keyframes, responsive grid collapse, self-hosted `@font-face` or documented system fallback stacks per design D3

## 3. Landing page

- [x] 3.1 Write `src/pages/landing.mjs` hero: RASEN specimen title with blinking caret, 「不是循环，是螺旋」 line, mono meta column (version, MIT, Node ≥20.19.0) with the single green status dot
- [x] 3.2 Add briefing strip + spiral thesis sections: mono register cells (npm name, version, license, lineage) and the four `>>>` theses from README's "Not a circle — a spiral"
- [x] 3.3 Add telemetry-grid feature section: 1px-gap cells for spec-driven workflow, pipeline family, `/rasen:auto`, `/rasen:goal`, auto-decompose, chrome-use, context sensing & handoff — copy condensed from README "What you get" only
- [x] 3.4 Add terminal transcript section styled as a mono session block, using the README "See it in action" exchange verbatim (trimmed for length)
- [x] 3.5 Add the hazard-stripe install alert (`npm i -g @atelierai/rasen`, `rasen init`, selectable text, optional inline copy button per design D6) and the OpenSpec coexistence hairline table
- [x] 3.6 Add footer colophon (operator/system/build-version/license/GitHub link) and ensure ASCII decorations (`[ ... ]`, `>>>`, `///`) appear in ≥4 places across the page

## 4. Verify

- [x] 4.1 Run the build twice; confirm exit 0, `dist/` complete and idempotent, page renders correctly opened directly from the filesystem with network disabled
- [x] 4.2 Check responsiveness at 360px and ≥1440px (no horizontal page scroll; grids collapse; install block scrolls internally)
- [x] 4.3 Run the SKILL.md pre-flight checklist literally against the rendered page (palette, radius 0, ≥1 telemetry grid, scanline ≤0.08, exactly one hazard-stripe block, ≥4 ASCII decorations, tabular-nums, no banned effects, ≤1 green element) and fix violations
- [x] 4.4 Validate deploy config with `wrangler dev` (page serves at the local URL identically to file-open) and commit everything in the rasen-site repo with an initial + implementation commit (commit deferred to ship stage per LEAD)
