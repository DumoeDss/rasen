# docs-content-accuracy Specification

## Purpose
Keep the curated, publication-facing `docs/` content accurate to the current rasen product: correct self-naming, commands that match the shipped CLI, and publication-ready landing pages.
## Requirements
### Requirement: Docs name the product rasen
User-facing documentation under `docs/` SHALL refer to the product as **rasen** when describing itself: the docs home and guides introduce rasen, install instructions use `npm i -g @atelierai/rasen`, workspace paths shown are `rasen/` (specs, changes, config), terminal commands are `rasen …`, and slash commands are `/rasen-*`. References to upstream OpenSpec remain only where they genuinely refer to the upstream project — lineage, the coexistence/namespace table, `rasen migrate` from a legacy `openspec/` workspace, and license attribution — and are framed so a reader cannot mistake them for the product's own name.

#### Scenario: Self-reference audit passes
- **WHEN** the curated user-facing docs are searched for "OpenSpec" and `openspec`
- **THEN** every remaining occurrence refers to the upstream project (lineage, coexistence, migration source, attribution), and none describes rasen itself, its install command, or its workspace layout

#### Scenario: Install path is correct
- **WHEN** a reader follows any install instruction in the curated docs
- **THEN** the command installs `@atelierai/rasen` (never `@fission-ai/openspec`) and subsequent setup steps use `rasen init` and the `rasen/` workspace tree

### Requirement: Documented commands match the shipped CLI
Every terminal command (`rasen …`) and slash command (`/rasen-…`) mentioned in the curated docs SHALL exist in the current CLI build with the documented behavior, verified against `rasen --help` / subcommand help or the source. Commands the current build does not support are corrected or removed rather than left aspirational. Per-tool "command syntax" tables (e.g. `docs/commands.md`, `docs/how-commands-work.md`, and their `docs/zh/` mirrors) SHALL show every row using the invocation form that tool actually accepts, and SHALL NOT reference a retired invocation form (such as the colon-form skill invocation retired by `retire-colon-skill-names`) as if it were still in use.

#### Scenario: CLI reference is verifiable
- **WHEN** each documented command in the curated set is checked against the current CLI's help output
- **THEN** the command exists, its documented flags exist, and any described output shape matches current behavior

#### Scenario: Stale command discovered
- **WHEN** a documented command or flag is not present in the current CLI
- **THEN** the doc is updated to the current equivalent, or the mention is removed with surrounding prose adjusted — never left pointing at a nonexistent surface

#### Scenario: Per-tool syntax table stays internally consistent
- **WHEN** a reader compares rows in a "command syntax by tool" table across `docs/commands.md`, `docs/how-commands-work.md`, and their `docs/zh/` mirrors
- **THEN** every row uses the invocation form that tool's current integration actually accepts (e.g. Claude Code shows a leading `/`, matching every other row)
- **AND** no surrounding prose describes a retired invocation form (e.g. the colon form) as a currently valid alternative

### Requirement: Landing-facing pages are publication-ready
The pages the website surfaces most prominently — `overview.md`, `getting-started.md`, `installation.md` — SHALL read coherently as public product pages: accurate version/runtime prerequisites (Node ≥20.19.0), correct cross-links between docs pages, and no references to internal-only artifacts or unpublished work. Edits favor accuracy over restyling: prose that is already correct is left in the author's voice.

#### Scenario: Getting-started walkthrough is executable
- **WHEN** a new user follows getting-started end to end on a clean machine
- **THEN** every command shown works as documented (install, `rasen init`, the slash-command loop) and every directory tree shown matches what the tool actually creates

#### Scenario: Cross-links resolve
- **WHEN** relative links in the curated docs are followed
- **THEN** each resolves to an existing file in the docs tree

### Requirement: The conceptual model is documented

The documentation SHALL present rasen's conceptual model in a reader-facing concept document: `schema` as the content layer (what artifacts a methodology produces and how they depend on each other), `workflow` as the execution inner loop (how one task unit runs in a single session), and `pipeline` as the execution outer loop (how a harness chains multiple inner-loop tasks). The document SHALL explain the workflow `kind` taxonomy (`task`, `driver`, `internal`) consistently with the shipped `kind` field, and SHALL state why the three concept names are retained.

Any `rasen` CLI command or `/rasen-*` command the concept document presents as current behavior SHALL exist in the shipped CLI. Behavior that has not yet shipped SHALL be presented as design direction, not as current behavior.

#### Scenario: Concept document presents the model

- **WHEN** the concepts documentation is read
- **THEN** it SHALL describe schema, workflow, and pipeline as the content layer plus the inner and outer execution loops
- **AND** it SHALL describe the `task`, `driver`, and `internal` kinds consistently with the CLI's `kind` field

#### Scenario: Referenced commands exist

- **WHEN** the concept document names a `rasen` or `/rasen-*` command as current behavior
- **THEN** that command SHALL exist in the shipped CLI
- **AND** any not-yet-shipped capability the document mentions SHALL be marked as design direction rather than current behavior

