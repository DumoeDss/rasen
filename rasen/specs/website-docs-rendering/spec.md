# website-docs-rendering Specification

## Purpose
Define the build-time pipeline that renders the curated `docs/` markdown into HTML pages on the rasen website: manifest-driven page generation, fault tolerance for arbitrary valid markdown, and internal link rewriting.

## Requirements

### Requirement: Manifest-driven docs build
The site build SHALL read the curated publication manifest (`docs/website-manifest.json` in the sibling rasen repo, path resolved cross-platform) and emit one HTML page per listed entry, rendered from its markdown source through the site's shared page shell so every doc page carries the same header, footer, stylesheet, and scanline overlay as the rest of the site. Pages appear in the built output under stable slug-derived paths (e.g. `dist/docs/<slug>/index.html` or `dist/docs/<slug>.html`, one convention used consistently).

#### Scenario: Full build from manifest
- **WHEN** the site build runs with a valid manifest whose sources all exist
- **THEN** `dist/` contains a docs page for every manifest entry, each wrapped in the shared shell, plus the docs index — and re-running the build yields the same output (idempotent, no stale pages from removed entries)

#### Scenario: Manifest is the only coupling
- **WHEN** the build renders docs
- **THEN** it discovers pages exclusively via the manifest (no globbing of the docs directory), so docs absent from the manifest never appear on the site

### Requirement: Content-fault tolerance
The docs build SHALL succeed for arbitrary valid markdown content: edits to any curated doc (headings, code fences, tables, HTML fragments, unusual link forms) can change a page's appearance but never break the build. A manifest entry whose source file does not exist produces a clearly worded build warning naming the entry and is skipped from both output and navigation; the build still exits successfully. Only a malformed manifest itself (unparseable JSON or entries missing required fields) fails the build, with an error saying what is wrong.

#### Scenario: Missing source file
- **WHEN** a manifest entry's source path resolves to no file
- **THEN** the build prints a warning identifying that entry, omits the page from output and from the sidebar/prev-next chain, and exits with code 0

#### Scenario: Arbitrary markdown survives
- **WHEN** a curated doc contains any valid CommonMark/GFM construct (nested lists, raw HTML, deep heading levels, long tables, fenced code in any language)
- **THEN** the build completes and the page renders the construct as reasonable HTML — degraded styling is acceptable, a crash is not

### Requirement: Internal link rewriting
Relative markdown links between manifest pages SHALL resolve on the built site: a link whose target unambiguously maps to another manifest entry's source (including `#fragment` suffixes) is rewritten to that entry's site URL. External links (absolute URLs) are left untouched, and relative links whose targets are not in the manifest are left as-is rather than guessed.

#### Scenario: Cross-page link resolves
- **WHEN** a curated doc links to `getting-started.md#how-it-works` and that source is in the manifest
- **THEN** the built page links to the getting-started doc page's URL with the fragment preserved

#### Scenario: Non-manifest link passes through
- **WHEN** a doc links to an external URL or to a repo file not in the manifest
- **THEN** the link's href is emitted unchanged
