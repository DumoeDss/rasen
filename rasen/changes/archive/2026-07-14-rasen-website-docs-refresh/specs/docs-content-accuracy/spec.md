# docs-content-accuracy Specification

## ADDED Requirements

### Requirement: Docs name the product rasen
User-facing documentation under `docs/` SHALL refer to the product as **rasen** when describing itself: the docs home and guides introduce rasen, install instructions use `npm i -g @atelierai/rasen`, workspace paths shown are `rasen/` (specs, changes, config), terminal commands are `rasen …`, and slash commands are `/rasen:*`. References to upstream OpenSpec remain only where they genuinely refer to the upstream project — lineage, the coexistence/namespace table, `rasen migrate` from a legacy `openspec/` workspace, and license attribution — and are framed so a reader cannot mistake them for the product's own name.

#### Scenario: Self-reference audit passes
- **WHEN** the curated user-facing docs are searched for "OpenSpec" and `openspec`
- **THEN** every remaining occurrence refers to the upstream project (lineage, coexistence, migration source, attribution), and none describes rasen itself, its install command, or its workspace layout

#### Scenario: Install path is correct
- **WHEN** a reader follows any install instruction in the curated docs
- **THEN** the command installs `@atelierai/rasen` (never `@fission-ai/openspec`) and subsequent setup steps use `rasen init` and the `rasen/` workspace tree

### Requirement: Documented commands match the shipped CLI
Every terminal command (`rasen …`) and slash command (`/rasen:…`) mentioned in the curated docs SHALL exist in the current CLI build with the documented behavior, verified against `rasen --help` / subcommand help or the source. Commands the current build does not support are corrected or removed rather than left aspirational.

#### Scenario: CLI reference is verifiable
- **WHEN** each documented command in the curated set is checked against the current CLI's help output
- **THEN** the command exists, its documented flags exist, and any described output shape matches current behavior

#### Scenario: Stale command discovered
- **WHEN** a documented command or flag is not present in the current CLI
- **THEN** the doc is updated to the current equivalent, or the mention is removed with surrounding prose adjusted — never left pointing at a nonexistent surface

### Requirement: Landing-facing pages are publication-ready
The pages the website surfaces most prominently — `overview.md`, `getting-started.md`, `installation.md` — SHALL read coherently as public product pages: accurate version/runtime prerequisites (Node ≥20.19.0), correct cross-links between docs pages, and no references to internal-only artifacts or unpublished work. Edits favor accuracy over restyling: prose that is already correct is left in the author's voice.

#### Scenario: Getting-started walkthrough is executable
- **WHEN** a new user follows getting-started end to end on a clean machine
- **THEN** every command shown works as documented (install, `rasen init`, the slash-command loop) and every directory tree shown matches what the tool actually creates

#### Scenario: Cross-links resolve
- **WHEN** relative links in the curated docs are followed
- **THEN** each resolves to an existing file in the docs tree
