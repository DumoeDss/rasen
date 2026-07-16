# website-docs-manifest Specification

## Purpose
Define the machine-readable manifest that declares which curated `docs/` content the public rasen website publishes, decoupling site navigation from directory globbing.

## Requirements

### Requirement: Docs tree declares what the website publishes
The docs tree SHALL contain a machine-readable manifest at `docs/website-manifest.json` declaring the ordered, curated subset of documentation the public website publishes. The manifest lists ordered sections, each with a label and ordered pages; every page entry carries a human title, a URL slug, and a source path relative to the `docs/` directory (forward-slash separators, since these are URL-ish identifiers consumed cross-platform). Documents absent from the manifest are not published, so internal notes (session handoffs, design retrospectives, parity research) stay private by default.

#### Scenario: Manifest is valid and complete
- **WHEN** the manifest is parsed as JSON
- **THEN** it yields ordered sections of pages where every entry has a non-empty title, a unique slug across the whole manifest, and a source path that resolves to an existing file under `docs/`

#### Scenario: Curation excludes internal documents
- **WHEN** the manifest's page list is reviewed
- **THEN** it contains only reader-facing documentation (start-here guides, concepts, workflows, references, FAQ/troubleshooting) and no session handoffs, internal design notes, or research directories

#### Scenario: A renderer can build navigation from the manifest alone
- **WHEN** a site generator reads only the manifest
- **THEN** it has everything needed to order the sidebar, title each page, and locate each source file — without globbing `docs/` or consulting the fumadocs `website/` config
