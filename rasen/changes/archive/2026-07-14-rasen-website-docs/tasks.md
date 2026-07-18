# Tasks

## 1. Reconcile and wire up

- [x] 1.1 Read the ACTUAL rasen-site tree as shipped by `rasen-website-landing` (shell module export shape, build.mjs structure, CSS class vocabulary, output conventions) and note any deviations from the design seam — extend additively; do NOT edit `src/pages/landing.mjs`; escalate to the LEAD if the seam is fundamentally absent
- [x] 1.2 Add `marked` as a devDependency and a `src/docs-manifest.dev.json` fallback manifest (same `{version, sections[{label, pages[{title,slug,source}]}]}` shape, 2-3 stable docs) per design D2
- [x] 1.3 Implement manifest loading in `build.mjs`: resolve `../rasen/docs/website-manifest.json` (env-overridable `RASEN_DOCS_DIR`), fall back to the dev manifest with a printed notice, validate (`version === 1`, required fields, unique slugs) with clear errors on malformed input

## 2. Rendering pipeline

- [x] 2.1 Implement markdown→HTML rendering with GFM enabled and GitHub-style heading IDs; missing source file → warning naming the entry + skip (exit 0), per the fault-tolerance spec
- [x] 2.2 Implement internal-link rewriting (design D4): source-path→URL map, relative `.md` links normalized against the current doc's directory and rewritten with fragments preserved; absolute and non-manifest links pass through unchanged
- [x] 2.3 Implement `src/pages/doc.mjs` (`renderDoc`) — article + sidebar + prev/next composition rendered through the shared shell; flattened manifest order (post-skip) drives the prev/next chain
- [x] 2.4 Emit pages at `dist/docs/<slug>/index.html` (nested slugs via recursive mkdir, all path math through `node:path`) and generate the docs index page at `dist/docs/index.html` listing all sections/pages
- [x] 2.5 Add shell-level header navigation between landing and docs (register-strip cell, e.g. `[ DOCS ]`), preserving the landing page's rendered content module untouched

## 3. Styling

- [x] 3.1 Add the `.doc-article` CSS scope (design D6): heading hierarchy on the existing type scale, mono code panels and tables with hairline borders and `overflow-x: auto` wrappers, blockquote/list/hr idiom — no new colors, no radius, no banned effects
- [x] 3.2 Style the sidebar (current-page marker in the existing accent idiom) and its mobile collapse to a top `<details>` disclosure under ~900px; prev/next as a hairline footer row

## 4. Verify

- [x] 4.1 Fault-tolerance drill: build with (a) an entry pointing at a missing file → warn+skip+exit 0 and nav chain closes over the gap; (b) malformed manifest JSON / duplicate slug / version 2 → loud build error; (c) a torture-markdown fixture (raw HTML, nested lists, giant table, deep headings, odd links) → build succeeds, page legible
- [x] 4.2 Build with the real manifest (or dev fallback if C3 hasn't landed), run twice for idempotence, and click through under `wrangler dev`: sidebar order matches manifest, current-page marker, prev/next walks every page once, docs index and landing↔docs nav links work, rewritten cross-links (including a `#fragment` case) resolve
- [x] 4.3 Visual pre-flight on the longest rendered doc page and a 360px-width check (sidebar collapses, tables/code scroll internally, no horizontal page scroll, palette/radius/scanline rules hold); update the rasen-site README (docs build, manifest source, dev fallback, wrangler-dev preview note) and commit in the rasen-site repo (commit deferred to ship stage per LEAD)
