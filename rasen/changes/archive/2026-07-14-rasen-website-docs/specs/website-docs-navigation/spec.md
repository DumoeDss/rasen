# website-docs-navigation Specification

## ADDED Requirements

### Requirement: Sidebar navigation from the manifest
Every docs page SHALL show a sidebar listing the manifest's sections and pages in manifest order, with section labels as group headings, each page title linking to its page, and the current page visibly marked. The sidebar derives entirely from the manifest — adding or reordering a page on the site is a manifest edit, not a template edit.

#### Scenario: Sidebar reflects manifest order
- **WHEN** any docs page is viewed
- **THEN** the sidebar lists all published sections and pages in exactly the manifest's order, and the current page is distinguished (e.g. hazard-red marker or inverted cell) from the rest

#### Scenario: Skipped entries disappear coherently
- **WHEN** an entry was skipped at build time (missing source)
- **THEN** it appears in no page's sidebar and the prev/next chain closes over the gap

### Requirement: Docs index and prev/next reading order
The site SHALL provide a docs index page at the docs root listing every published section and page (titles linked), reachable from the landing page's navigation. Each doc page carries prev/next links following the manifest's flattened page order — first page has no prev, last has no next.

#### Scenario: Reader walks the docs linearly
- **WHEN** a reader starts at the first manifest page and follows "next" repeatedly
- **THEN** they visit every published page exactly once in manifest order and the last page shows no next link

#### Scenario: Docs are discoverable from the landing page
- **WHEN** a visitor lands on the site root
- **THEN** a navigation link leads to the docs index without editing the landing page's content module (header/shell-level navigation)

### Requirement: CRT document typography
Rendered markdown SHALL be styled within the brutalist-CRT contract: monospace body, headings in the established title/mono hierarchy, `border-radius: 0`, hairline `#2A2A28` rules for tables and section breaks, code blocks as charcoal-on-charcoal panels with hairline borders (no new colors beyond the existing palette), blockquotes and lists in the same idiom, and no banned effects (shadows, gradients, glow, rounded corners). Long content scrolls the page vertically; wide content (tables, code) scrolls inside its own container so doc pages never scroll horizontally.

#### Scenario: Style pre-flight holds on docs pages
- **WHEN** a rendered docs page is audited against the site's visual-system checklist
- **THEN** it passes: palette unchanged, zero radius, hairline tables, mono code panels, scanline overlay present, no banned effects introduced by markdown-derived elements

#### Scenario: Mobile docs reading
- **WHEN** a docs page is viewed at 360px width
- **THEN** body text wraps, the sidebar collapses to an accessible position (top list or toggle) rather than forcing horizontal scroll, and code blocks/tables scroll within their own bounds
