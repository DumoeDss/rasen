## Why

The landing change (`rasen-website-landing`) gives rasen a front door but no documentation: visitors who want to learn the workflow still have to leave the site for GitHub markdown. The docs-refresh change (`rasen-website-docs-refresh`) is curating `docs/` and declaring a publication set in `docs/website-manifest.json` — but nothing consumes that manifest yet. This change closes the loop: a build-time markdown→HTML pipeline in the rasen-site repo that renders the manifest's curated docs into pages sharing the landing page's CRT shell, giving the website a complete `/docs/` section.

## What Changes

- Extend the `rasen-site` build (`/Users/sayo/repos/rasen-site`, created by `rasen-website-landing`) with a docs pipeline: `build.mjs` reads `docs/website-manifest.json` from the sibling rasen repo, renders each listed markdown source with a markdown library (`marked` or `markdown-it`, build-time devDependency only), and emits one HTML page per manifest entry through the existing `renderPage()` shell.
- Add a docs page layout inside the brutalist-CRT contract: sidebar navigation built from the manifest's sections/order (current page marked), prev/next links following manifest order, and a `/docs/` index page listing the sections. Doc typography (headings, code blocks, tables, blockquotes, lists) styled in the CRT idiom — hairlines, monospace, zero radius, no new colors.
- Robust by construction against content changes: the pipeline tolerates arbitrary valid markdown (the refresh child's edits can never break the build); a manifest entry whose source file is missing produces a build warning and is skipped from output and navigation — never a crash.
- Internal links between manifest pages (`*.md` relative links) are rewritten to their site slugs where the mapping is unambiguous; external links and non-manifest links pass through untouched.
- The landing page module (`src/pages/landing.mjs`) is not edited; the extension happens purely through new page modules, new build steps, and additive CSS — the seam promised by the landing change's design (D1). Because the landing child is being implemented in parallel, the implementer MUST reconcile against the actual rasen-site tree at apply time: the seam contract (renderPage() in `src/shell.mjs`, `src/styles/site.css`, `build.mjs` structure) is authoritative in intent, but exact signatures/paths follow what actually shipped.

## Capabilities

### New Capabilities
- `website-docs-rendering`: the build-time markdown→HTML docs pipeline — manifest-driven page generation through the shared shell, fault tolerance (skip+warn on missing sources, never crash on valid markdown), and internal-link rewriting.
- `website-docs-navigation`: the reader-facing docs experience — sidebar built from manifest sections, prev/next ordering, `/docs/` index, and CRT-styled document typography, responsive on mobile.

### Modified Capabilities

None in `rasen/specs/` — `website-scaffold` and `website-landing` (pending capabilities from the sibling landing change) are extended additively, not modified: the scaffold spec already requires the shell to be reusable by doc pages, and this change exercises exactly that requirement.

## Impact

- **rasen-site repo (all writes):** `build.mjs` (docs steps added), new `src/pages/` doc modules/templates, additive rules in `src/styles/site.css` (or a docs-scoped stylesheet), `package.json` (+`marked` or `markdown-it` devDependency), README note on the docs build. `src/pages/landing.mjs` untouched.
- **rasen repo:** read-only — `docs/website-manifest.json` and the markdown sources it lists. Planning artifacts only under `rasen/changes/`.
- **Dependencies:** one markdown renderer as devDependency; runtime output stays static HTML/CSS with no client-side JS required for docs reading.
- **Ordering:** depends on `rasen-website-landing` (the scaffold/shell); consumes `rasen-website-docs-refresh`'s manifest — if the manifest hasn't landed when this applies, the implementer uses a temporary local manifest of the same shape for development and the real one when available.
- **Delivery:** ships LOCAL (commits in the rasen-site repo); portfolio-level delivery decision at the end.
