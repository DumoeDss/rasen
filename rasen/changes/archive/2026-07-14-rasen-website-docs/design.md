## Context

`rasen-website-landing` (in implementation, parallel to this proposal) establishes the rasen-site repo with the seam this change extends: `build.mjs` orchestrates, `src/shell.mjs` exports `renderPage({title, description, content})`, `src/styles/site.css` holds the design system, pages are JS modules under `src/pages/`. `rasen-website-docs-refresh` supplies the input interface: `docs/website-manifest.json` — `{version: 1, sections: [{label, pages: [{title, slug, source}]}]}`, `source` forward-slash relative to the rasen repo's `docs/`, slugs unique kebab (possibly nested like `reference/cli`), `README.md` → slug `index`. This change is the consumer of both.

**Parallel-implementation caveat (binding):** the landing child may ship details that differ from its design doc. At apply time, reconcile against the ACTUAL rasen-site tree — treat `renderPage()`/`site.css`/`build.mjs` as the intended seam, but follow shipped signatures and file layout. If the shell as shipped can't host a sidebar layout, extend `shell.mjs` additively (e.g. optional `sidebar`/`nav` fields with defaults preserving landing output byte-for-byte) rather than editing `landing.mjs`.

## Goals / Non-Goals

**Goals:**
- `pnpm build` renders landing + all manifest docs into `dist/` in one pass; docs section fully navigable offline.
- Refresh-proof: no valid docs edit can break the build; missing sources warn+skip.
- Manifest is the single coupling point (no docs-dir globbing, no fumadocs config reads).

**Non-Goals:**
- Client-side search, syntax highlighting via JS, dark/light theming (site is single-theme by design).
- zh docs (manifest v1 is en-only; format can grow a locale dimension later).
- Editing any doc content (owned by the refresh child) or the landing page module.
- Deployment (config already deploy-ready from the landing change).

## Decisions

**D1 — Renderer: `marked` (devDependency).** Zero-dependency, actively maintained, GFM tables/fences out of the box, and a small renderer-override API used for link rewriting (D4) and heading IDs. `markdown-it` is the fallback if a needed extension point proves awkward — the specs are renderer-agnostic. No sanitization pass: sources are first-party repo docs, and the manifest whitelists them.

**D2 — Manifest resolution and dev fallback.** `build.mjs` locates the manifest at `path.resolve(siteRoot, '..', 'rasen', 'docs', 'website-manifest.json')` (overridable via `RASEN_DOCS_DIR` env for non-sibling layouts). If the file is absent (refresh child not landed yet), the build prints a notice and falls back to a checked-in `src/docs-manifest.dev.json` of the same shape listing 2-3 known-stable docs — so the docs pipeline is developable and testable before C3 ships, and the fallback is clearly labeled dev-only in the README. Malformed manifest (bad JSON, missing title/slug/source, duplicate slug) = build error naming the defect; missing source file = warn + skip per spec.

**D3 — Output convention: `dist/docs/<slug>/index.html`.** Directory-per-page gives clean URLs under wrangler static assets (`/docs/getting-started/`) and handles nested slugs (`reference/cli`) for free via recursive mkdir. Docs index at `dist/docs/index.html`. All asset/nav hrefs root-relative (`/docs/...`, `/styles/...`) — consistent with Workers serving; the landing change's file-open requirement applies to the landing page, and docs pages are verified via `wrangler dev` (root-relative links don't resolve under `file://`; this is the accepted trade-off, noted in README).

**D4 — Link rewriting via renderer hook, mapping-first.** Before rendering, build a map from each manifest entry's normalized `source` (and its basename) → site URL. In the link renderer hook: absolute URLs (scheme or `//`) pass through; relative hrefs ending in `.md` (with optional `#fragment`) are normalized against the current source's directory and looked up in the map — hit → rewrite to `/docs/<slug>/` + fragment; miss or ambiguous → emit unchanged. Heading anchors: generate GitHub-style IDs (lowercase, dashes) so preserved fragments keep working. No attempt to rewrite image paths in v1 (curated docs are text-first; if an image link 404s it is a content issue the refresh child owns).

**D5 — Docs page composition.** New `src/pages/doc.mjs` exports `renderDoc({page, sections, html, prev, next})` returning the content block: two-column CSS grid (sidebar `240px` + article) collapsing to single column under `~900px` with the sidebar rendered as a `<details>` disclosure at top (no JS). Prev/next as a hairline footer row. The flattened manifest order defines the chain; skipped entries are removed before chaining, satisfying the gap-closing scenario. Landing↔docs navigation lives in the shell's header register strip (a `[ DOCS ]` / `[ HOME ]` cell) — a shell-level addition, not a landing.mjs edit.

**D6 — CSS: additive `docs` scope in `site.css`.** A `.doc-article` scope styles rendered markdown (headings h1-h4 mapped to the existing type scale, mono code panels with hairline borders, `overflow-x: auto` wrappers for tables/pre, hairline `hr`/table rules, blockquote as left 2px rule + secondary color). No new custom properties, no new colors. If the landing shipped a different class vocabulary, adopt it — the contract is "additive, same palette", not exact selector names.

**D7 — Verification is behavioral, not unit-test.** The site repo has no test framework and shouldn't grow one for this: verification tasks exercise the build with (a) the real/dev manifest, (b) a deliberately missing source, (c) a malformed manifest, (d) a torture-markdown fixture — asserting exit codes and output presence via the shell. Plus `wrangler dev` click-through of sidebar/prev-next/index and the visual pre-flight on one long doc page.

## Risks / Trade-offs

- [Landing implementation diverges from design D1 seam] → binding reconcile-at-apply caveat above; additive-only extension rule; if a true conflict appears (e.g. no shell module at all), stop and surface to the LEAD rather than refactor landing code.
- [Root-relative URLs break file:// preview of docs pages] → accepted (D3); `wrangler dev` is the docs preview path and the README says so.
- [GitHub-flavored constructs beyond CommonMark (callouts, task lists) render flat] → `marked`'s GFM covers tables/strikethrough/task-lists; anything flat-but-legible satisfies the "degraded styling acceptable, crash not" spec line.
- [Manifest evolves (v2, locales)] → build asserts `version === 1` and errors with a clear message on higher versions, so a future format bump fails loud instead of rendering wrong.
- [Docs with huge content (commands.md) produce heavy pages] → static HTML, no JS — page weight is text; acceptable. No pagination in v1.
- [Windows path handling for nested slugs and `..` traversal] → all path math through `node:path`; slug→output path join tested in the torture task; manifest `source` is forward-slash by contract and split before joining.

## Open Questions

- Whether the header nav cell should list `[ HOME ] [ DOCS ] [ GITHUB ]` or just `[ DOCS ]` — implementer's call within the register-strip idiom.
- Syntax highlighting: out of scope for v1 (mono charcoal panels only); revisit only if the user asks after seeing real pages.
