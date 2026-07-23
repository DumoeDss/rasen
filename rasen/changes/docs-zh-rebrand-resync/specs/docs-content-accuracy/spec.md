## MODIFIED Requirements

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
