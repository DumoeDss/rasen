## Why

`docs/` (English) was cleaned of upstream-OpenSpec brand residuals by `specs-brand-rewrite` and `fix-brand-residuals`, but `docs/zh/` was last aligned to English before the rasen rebrand and never received the same pass. 33 of 34 `docs/zh/` files still carry ~270 `opsx-`/`OpenSpec` hits — including live product description ("OPSX 现在是 OpenSpec 的标准工作流") where the corresponding English text is itself stale in the same way ("OPSX is now the standard workflow for rasen"). A reader following either language today gets a product identity that doesn't match the shipped CLI.

**Scope correction (post-propose, ground-truth checked):** the initial version of this proposal treated "OPSX" as a current, legitimate rasen product term and left `docs/opsx.md` / `docs/opsx-workflow-guide.md` unrenamed on the strength of `docs/brand-independence-status.md:91`. That was wrong. `docs/brand-independence-status.md` §3.2 is a *pending-work inventory* ("docs 品牌回写待办"), not a keep decision, and a source check found zero live OPSX product surface: `src/core/config.ts`'s `LEGACY_COMMAND_PREFIX`, the `legacy-cleanup.ts` `opsx-*` patterns, and the `openspec-opsx-` double-prefix collapse in `pipeline-registry/legacy-skill.ts` exist only to detect and clean up pre-rebrand installs — never to present "OPSX" as a current name. Installed skills carry zero OPSX hits. This change is expanded to retire the OPSX term itself, bilingually, alongside the original brand-word alignment. The change name stays `docs-zh-rebrand-resync` (the retirement is a natural extension of the same brand-resync work, not a separate concern).

## What Changes

- Rewrite `docs/zh/` brand references to match `docs/` (English) passage-by-passage: where English currently says rasen, Chinese says rasen; where English legitimately retains "OpenSpec" (see Impact for the categories), Chinese retains it too, in the same framing.
- **BREAKING (docs only, no runtime impact)**: rename `docs/opsx.md` → `docs/artifact-workflow.md` and `docs/opsx-workflow-guide.md` → `docs/artifact-workflow-guide.md`, mirrored as `docs/zh/artifact-workflow.md` and `docs/zh/artifact-workflow-guide.md`. Every internal link to the old filenames, in both `docs/` and `docs/zh/`, is updated to point at the new ones.
- Rewrite every "OPSX is/是…standard workflow" style present-tense assertion, in both languages, to name the concept **the artifact workflow** instead — an existing term already used in `docs/workflow-packages.md` ("distinct from an artifact workflow schema and from a pipeline"), chosen specifically because it doesn't collide with `workflows.md` (which covers installable workflow *patterns and timing*, a different concept).
- `docs/grill-gstack-absorption.md` keeps its filename in both languages — it's a historical-narrative document about a different topic (the grill/gstack absorption), not an OPSX-named file — but its own "OPSX" mentions are reframed as historical narrative rather than current-state claims, consistent with the rest of the retirement.
- Extend the `docs-content-accuracy` capability's existing "Docs name the product rasen" requirement to explicitly cover `docs/zh/` mirrors, and add scenarios covering both the OPSX-term retirement and the new filenames.
- `docs/zh/codex-parity-solutions.md` remains out of scope — already aligned (0 hits), a condensed Chinese synthesis of the English `docs/codex-parity/` directory, not a 1:1 mirror.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `docs-content-accuracy`: the "Docs name the product rasen" requirement's scope is widened from `docs/` to explicitly include `docs/zh/`, with the rule that Chinese content aligns to the English passage's brand choice (not a blanket find-replace). New scenarios assert that "OPSX" is not presented as a current term in either language (only as literal legacy-detection identifiers or genuine historical narrative), and that the renamed `artifact-workflow.md` / `artifact-workflow-guide.md` files and their internal links are consistent across both languages.

## Impact

- **Files touched**: 32 of 33 `docs/zh/*.md` files for brand-word alignment (all except `codex-parity-solutions.md`), plus 2 EN + 2 ZH file renames (`opsx.md`/`opsx-workflow-guide.md` families) and an internal-link sweep across both trees for any file that links to them. Heaviest brand-alignment files: `supported-tools.md` (26 hits), `cli.md` (23), `migration-guide.md` (16), `local-install.md` (16).
- **Legitimate-retention categories** (where "OpenSpec" stays because English's own text keeps it there for the same reason):
  1. Historical/design-narrative docs describing the real upstream project or pre-rebrand architecture: `upstream-v1.5-stores-and-resolution.md` (analyzes upstream Fission-AI/OpenSpec v1.5), `review-cycle-workflow-design.md`, `codex-workflow-integration.md`, `grill-gstack-absorption.md`.
  2. Literal code/path/CLI identifiers, never translated: the legacy `openspec/` directory name, `openspec init`, `.openspec-store/store.yaml`, `/path/to/OpenSpec` source checkout paths, tarball filenames.
  3. `migration-guide.md`'s "what you currently have" framing — a user's existing pre-migration project genuinely is named OpenSpec.
  4. License, attribution, and fork-lineage callouts.
- **Not in scope**: rewriting `docs/grill-gstack-absorption.md`'s other staleness (e.g. its `/opsx:auto`-style retired colon-command syntax, a separate leftover from before `retire-colon-skill-names` shipped) beyond the OPSX-term reframing — flagged as an incidental finding, not fixed here. Non-brand staleness discovered incidentally in `docs/zh/` (outdated examples, broken content unrelated to branding) is likewise noted but not fixed in this change.
- **Sibling change**: `fix-docs-broken-tables` (this branch's parent) modifies a different requirement — "Documented commands match the shipped CLI" — on the same `docs-content-accuracy` capability. No overlap; both deltas land on the same capability without conflicting.
