## Context

`docs/zh/` was translated from `docs/` before the OpenSpec → rasen rebrand. Two subsequent EN-only changes (`specs-brand-rewrite`, `fix-brand-residuals`) cleaned English brand references but never touched `docs/zh/`. The two trees have since drifted: English now describes rasen in the present tense almost everywhere, while Chinese still describes "OpenSpec" in the same present-tense passages. A raw find-replace of "OpenSpec" → "rasen" across `docs/zh/` would be wrong, because English itself still legitimately says "OpenSpec" in specific, deliberate places (upstream analysis, migration source references, literal CLI/path strings, license attribution) — those passages must stay as "OpenSpec" in Chinese too, matching English's own choice.

**Correction to the initial design (post-propose):** the first version of this document treated "OPSX" as a live rasen product term and cited `docs/brand-independence-status.md:91` as a keep decision for `opsx.md` / `opsx-workflow-guide.md`. A ground-truth check overruled that: `docs/brand-independence-status.md` §3.2 is a pending-work inventory ("67 个文件仍含 openspec/opsx 字样...文件名未改"), listing the unrenamed filenames as unfinished cleanup, not as something the project decided to keep. A source check confirms zero live OPSX surface — `src/core/config.ts` (`LEGACY_COMMAND_PREFIX = 'opsx'`), `src/core/legacy-cleanup.ts` (`opsx-*` file patterns), and `src/core/pipeline-registry/legacy-skill.ts` (`openspec-opsx-` double-prefix collapse) exist purely to detect and clean up pre-rebrand installs; installed skills carry zero OPSX hits. "OPSX" is a retired brand-era codename, not a current term, and this change now retires it from the docs bilingually.

## Goals / Non-Goals

**Goals:**
- Every `docs/zh/*.md` file's brand word choice ("rasen" vs "OpenSpec") matches its English counterpart passage-by-passage.
- The retired "OPSX" codename is no longer asserted as a current term in either language — the concept it named is now called **the artifact workflow** in present-tense prose.
- `docs/opsx.md` / `docs/opsx-workflow-guide.md` and their `docs/zh/` mirrors are renamed to `artifact-workflow.md` / `artifact-workflow-guide.md`, with every internal link updated in both trees.
- The `docs-content-accuracy` spec explicitly covers `docs/zh/` and the OPSX retirement going forward, so neither regresses silently again.

**Non-Goals:**
- Rewriting English `docs/` prose that isn't about branding or the OPSX term (already otherwise clean).
- Full re-translation or copy-editing of `docs/zh/` prose unrelated to branding.
- Renaming `docs/grill-gstack-absorption.md` — it's a historical-narrative document about a different topic (the grill/gstack absorption), not an OPSX-named file; only its OPSX-as-current-term assertions are reframed as historical.
- Fixing `docs/grill-gstack-absorption.md`'s other, unrelated staleness (e.g. references to the retired colon-command syntax `/opsx:auto`, a leftover from before `retire-colon-skill-names` shipped) — noted as an incidental finding, out of scope here.
- Reconciling `docs/zh/codex-parity-solutions.md` with the EN `docs/codex-parity/` directory structure — it's an intentionally condensed synthesis, already brand-clean.

## Decisions

**Decision: align per-passage against English, not global find-replace.**
Each `docs/zh/<file>.md` is edited by locating the corresponding English passage in `docs/<file>.md` and matching its brand choice. Where English text is itself unchanged from before the rebrand (the four retention categories below), the Chinese mirror keeps "OpenSpec" too. This is slower than a regex pass but is the only way to avoid two failure modes: (a) leaving real residuals in "looks historical" files, and (b) breaking legitimate "OpenSpec" references (upstream analysis, migration source, CLI literals, license text) that also exist correctly in English.

Legitimate-retention categories (used as the judgment framework while editing, not a literal checklist to paste into files):
1. Historical/design-narrative text describing the real upstream project or pre-rebrand architecture (`upstream-v1.5-stores-and-resolution.md`, `review-cycle-workflow-design.md`, `codex-workflow-integration.md`, `grill-gstack-absorption.md`).
2. Literal code/path/CLI identifiers, never translated regardless of language (`openspec/` legacy directory name, `openspec init`, `.openspec-store/store.yaml`, `/path/to/OpenSpec` source checkout paths, tarball filenames).
3. `migration-guide.md`'s "what you currently have" framing (a user's pre-migration project is genuinely named OpenSpec).
4. License, attribution, and fork-lineage callouts.

**Decision: batch tasks by file, grouped by residual density, not by category.**
Grouping by density (heaviest files first, light files batched together at the end) keeps each task's diff reviewable and lets the batches with the trickiest judgment calls (migration-guide.md, local-install.md — both migration-context-heavy) get dedicated, unhurried attention rather than being buried in a large mixed batch.

**Decision: retire "OPSX" to "the artifact workflow," reusing an existing term.**
`docs/workflow-packages.md` already draws a three-way distinction: an *installable workflow* (a skill + optional command entry point, what `workflows.md` covers), an *artifact workflow schema* (the schema.yaml + templates mechanism that drives `propose → apply → verify → review → ship → archive`, what `opsx.md`/`opsx-workflow-guide.md` actually describe), and a *pipeline* (what chains them). "The artifact workflow" was chosen as the replacement prose name because it's already load-bearing vocabulary elsewhere in the docs, not a new invention, and it doesn't collide with `workflows.md`'s existing meaning (workflow *patterns and timing*, a different concept).

**Decision: rename `opsx.md` → `artifact-workflow.md`, `opsx-workflow-guide.md` → `artifact-workflow-guide.md`, in both languages.**
This supersedes the original design's "filenames don't change" decision (see Context correction above). The new names describe what the documents are about instead of a retired codename, and match the "artifact workflow" prose name used in the rewritten content. `grill-gstack-absorption.md` is excluded from the rename — it's about a different topic and was never an OPSX-named file — but its content still gets the same "OPSX is not a current term" treatment as everything else.

**Decision: filenames and cross-links are in scope; the spec asserts the new state, not the old one.**
The spec delta's scenario about filenames now asserts the renamed paths and link consistency, replacing the earlier (incorrect) "filenames stay unchanged" scenario.

## Risks / Trade-offs

- [Risk] A file's English source has itself drifted further since `specs-brand-rewrite` shipped, so the "current English" snapshot used for comparison could already be stale in some corner. → Mitigation: diff against the live `docs/<file>.md` at implementation time, not against notes taken during proposal research.
- [Risk] Batch review fatigue on the two heaviest files (`supported-tools.md` 26 hits, `cli.md` 23 hits) could lead to skimming past a real residual. → Mitigation: these are their own dedicated batch (batch 1), not diluted with lighter files.
- [Risk] Internal cross-links between `docs/zh/` files (or to English `docs/`) could break if a heading anchor's Chinese text changes as part of a brand-word edit, or if a link to `opsx.md`/`opsx-workflow-guide.md` is missed during the rename sweep. → Mitigation: the verification group in tasks.md includes a dedicated link-integrity pass (including a grep for the old filenames) across all edited files, run after the rename groups land.
- [Risk] The implementer was already mid-sweep on batch 5 (`docs/zh/README.md`, `docs/zh/overview.md` already partially edited) when this scope expansion landed, and was told to defer OPSX-term lines rather than guess at the new naming. → Mitigation: the appended task groups explicitly pick up those deferrals (e.g. `docs/zh/README.md:70` and `:87` still link to `opsx.md` under the label "OPSX 工作流" / "从旧工作流迁移到 OPSX") alongside the rest of the OPSX-term rewrite, rather than assuming batch 5 is done.

## Migration Plan

Not applicable — this is a documentation content change with no runtime migration.
