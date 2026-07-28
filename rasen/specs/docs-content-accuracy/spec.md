# docs-content-accuracy Specification

## Purpose
Keep the curated, publication-facing `docs/` content accurate to the current rasen product: correct self-naming, commands that match the shipped CLI, and publication-ready landing pages.
## Requirements
### Requirement: Docs name the product rasen
User-facing documentation under `docs/` SHALL refer to the product as **rasen** when describing itself: the docs home and guides introduce rasen, install instructions use `npm i -g @atelierai/rasen`, workspace paths shown are `rasen/` (specs, changes, config), terminal commands are `rasen …`, and slash commands are `/rasen-*`. References to upstream OpenSpec remain only where they genuinely refer to the upstream project — lineage, the coexistence/namespace table, `rasen migrate` from a legacy `openspec/` workspace, and license attribution — and are framed so a reader cannot mistake them for the product's own name.

This requirement applies to `docs/zh/` exactly as it applies to `docs/`: each `docs/zh/` file SHALL make the same rasen-vs-OpenSpec choice its `docs/` counterpart makes, passage by passage. Where the English source has a passage genuinely referring to the upstream project (historical/design-narrative text, literal code/path/CLI identifiers, migration-source framing, or license/attribution), the Chinese mirror keeps that same reference rather than translating it away.

"OPSX" is a retired brand-era codename, not a current rasen product term: the shipped CLI/skills carry zero live OPSX surface — `LEGACY_COMMAND_PREFIX`, the `opsx-*` legacy path patterns, and the `openspec-opsx-` double-prefix collapse in `src/core/` exist solely to detect and clean up pre-rebrand installs, never to present "OPSX" as a current name. Curated docs (both `docs/` and `docs/zh/`) SHALL NOT assert "OPSX" as the current name of any rasen workflow, capability, or command; the concept it used to label (the fluid, schema-driven artifact workflow for rasen changes) is referred to in current prose as **the artifact workflow**. "OPSX" may still appear where it genuinely narrates history — e.g. describing what a stage or file was called before the rebrand, or documenting the legacy-cleanup machinery itself — provided the surrounding prose frames it as past, not current.

#### Scenario: Self-reference audit passes
- **WHEN** the curated user-facing docs (both `docs/` and `docs/zh/`) are searched for "OpenSpec" and `openspec`
- **THEN** every remaining occurrence refers to the upstream project (lineage, coexistence, migration source, attribution), and none describes rasen itself, its install command, or its workspace layout

#### Scenario: Install path is correct
- **WHEN** a reader follows any install instruction in the curated docs
- **THEN** the command installs `@atelierai/rasen` (never `@fission-ai/openspec`) and subsequent setup steps use `rasen init` and the `rasen/` workspace tree

#### Scenario: Chinese mirror matches its English counterpart's brand choice
- **WHEN** a `docs/zh/<file>.md` passage is compared against the corresponding passage in `docs/<file>.md`
- **THEN** the Chinese passage names the product the same way the English passage does — "rasen" where English says rasen, and "OpenSpec" only where English's same passage also says OpenSpec

#### Scenario: The retired OPSX term is not asserted as current
- **WHEN** the curated docs (both `docs/` and `docs/zh/`) are searched for "OPSX" / "opsx" outside of code-identifier contexts (file paths, CLI flags, legacy-cleanup pattern strings)
- **THEN** no remaining occurrence presents "OPSX" as the current name of a rasen workflow, capability, or command — present-tense product description uses "the artifact workflow" (or "rasen" where the English source already does), and any surviving "OPSX" mention is framed as historical narrative (what something used to be called) or as a literal legacy-detection identifier

#### Scenario: Artifact-workflow reference docs carry their new name in both languages
- **WHEN** a reader looks for the workflow reference documents formerly named `docs/opsx.md` and `docs/opsx-workflow-guide.md`
- **THEN** they are found at `docs/artifact-workflow.md` and `docs/artifact-workflow-guide.md`, with `docs/zh/artifact-workflow.md` and `docs/zh/artifact-workflow-guide.md` as their Chinese mirrors, and every internal link that used to point at the old filenames (in both `docs/` and `docs/zh/`) resolves to the new ones
- **AND** `docs/grill-gstack-absorption.md` (and its `docs/zh/` mirror) keeps its filename — it is a historical-narrative document about a different topic (the grill/gstack absorption), not an OPSX-named file — while its own "OPSX" mentions are reframed as historical per the scenario above

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

