## 1. Batch 1 — heaviest files

- [x] 1.1 Align `docs/zh/supported-tools.md` (26 hits) and `docs/zh/cli.md` (23 hits) to their `docs/` counterparts, passage by passage: rasen where English says rasen, OpenSpec only where English's same passage also says OpenSpec.

## 2. Batch 2 — migration-context files (careful judgment)

- [x] 2.1 Align `docs/zh/migration-guide.md` (16 hits) and `docs/zh/local-install.md` (16 hits) to `docs/migration-guide.md` and `docs/local-install.md`. These carry the heaviest legitimate-retention load — a user's pre-migration project genuinely is named "OpenSpec," and `/path/to/OpenSpec` source-checkout paths are literal, untranslated strings — so match English's per-passage choice rather than blanket-replacing.

## 3. Batch 3 — design/reference docs

- [x] 3.1 Align `docs/zh/review-cycle-workflow-design.md` (14 hits), `docs/zh/how-commands-work.md` (14 hits), and `docs/zh/faq.md` (12 hits) to their `docs/` counterparts.

## 4. Batch 4 — glossary and integration docs

- [x] 4.1 Align `docs/zh/glossary.md` (11 hits), `docs/zh/commands.md` (11 hits), `docs/zh/codex-workflow-integration.md` (11 hits), and `docs/zh/upstream-v1.5-stores-and-resolution.md` (10 hits) to their `docs/` counterparts. `upstream-v1.5-stores-and-resolution.md` analyzes the real upstream Fission-AI/OpenSpec project — most of its "OpenSpec" mentions are legitimate and should stay.

## 5. Batch 5 — home/overview/OPSX cluster

- [x] 5.1 Align `docs/zh/README.md` (10 hits), `docs/zh/concepts.md` (10 hits), `docs/zh/overview.md` (8 hits), `docs/zh/grill-gstack-absorption.md` (8 hits), `docs/zh/existing-projects.md` (8 hits), `docs/zh/opsx.md` (6 hits), and `docs/zh/opsx-workflow-guide.md` (3 hits) to their `docs/` counterparts. Do not rename `opsx.md` or `opsx-workflow-guide.md` — filenames stay unchanged in both languages; only the brand words inside the files change (e.g. zh `opsx.md` currently says "OPSX 现在是 OpenSpec 的标准工作流" where English now says "OPSX is now the standard workflow for rasen" — this is a real residual to fix, not a legitimate keep).

## 6. Batch 6 — remaining light-touch files

- [x] 6.1 Align the following files (1-7 hits each) to their `docs/` counterparts: `docs/zh/troubleshooting.md`, `docs/zh/installation.md`, `docs/zh/customization.md`, `docs/zh/getting-started.md`, `docs/zh/team-workflow.md`, `docs/zh/agent-contract.md`, `docs/zh/examples.md`, `docs/zh/workflows.md`, `docs/zh/autopilot.md`, `docs/zh/writing-specs.md`, `docs/zh/skill-authoring.md`, `docs/zh/reviewing-changes.md`, `docs/zh/multi-language.md`, `docs/zh/explore.md`, `docs/zh/editing-changes.md`.

## 7. Scope-correction note (read before batch 5 / batch 6)

- [x] 7.1 Note for whoever picks up batch 5 (`5.1`) or batch 6 (`6.1`): the "do not rename `opsx.md`/`opsx-workflow-guide.md`" language in task 5.1 is superseded by groups 8-11 below — a ground-truth check overruled that call (see design.md Context correction). Finish 5.1's non-OPSX-term brand alignment on `docs/zh/README.md`, `docs/zh/concepts.md`, `docs/zh/overview.md`, `docs/zh/grill-gstack-absorption.md`, and `docs/zh/existing-projects.md` as originally scoped, but do NOT hand-edit `docs/zh/opsx.md` / `docs/zh/opsx-workflow-guide.md` under 5.1 — those two files are handled by the rename groups (9 and 11) instead, to avoid duplicate/conflicting edits under two different filenames.

## 8. EN filename renames + link updates

- [x] 8.1 Rename `docs/opsx.md` → `docs/artifact-workflow.md` and `docs/opsx-workflow-guide.md` → `docs/artifact-workflow-guide.md` (git mv, preserving history).
- [x] 8.2 Grep `docs/*.md` for every link/reference to the old filenames (`opsx.md`, `opsx-workflow-guide.md`) and update them to the new filenames, preserving any anchor fragments.

## 9. EN prose rewrite — retire "OPSX" as a current term

- [x] 9.1 In the newly-renamed `docs/artifact-workflow.md` and `docs/artifact-workflow-guide.md`, rewrite present-tense "OPSX is/OPSX now…" assertions to name the concept **the artifact workflow** instead. Keep the CLI-facing facts (schema.yaml, templates, stage names) unchanged — only the label changes.
- [x] 9.2 Rewrite `docs/glossary.md`'s OPSX entry (and any other EN file with a present-tense "OPSX is the current workflow" style claim, per the `grep -rn "OPSX" docs/*.md` results excluding the two renamed files) to use "the artifact workflow" instead, keeping links pointed at the renamed files.
- [x] 9.3 In `docs/grill-gstack-absorption.md`, reframe its "OPSX" mentions (e.g. the absorption-table row naming OPSX as "the fusion workflow layer") as historical narrative — what the layer was called at the time of the absorption — rather than a current-state claim. Do not otherwise rewrite this file's content (its stale colon-syntax references are a separate, out-of-scope issue per design.md).
- [x] 9.4 Update any remaining EN cross-references to `opsx-workflow-guide.md` §-anchors (e.g. in `docs/autopilot.md`, `docs/commands.md`, `docs/editing-changes.md`, `docs/migration-guide.md`, `docs/codex-workflow-integration.md`, `docs/review-cycle-workflow-design.md` — found via the grep in 8.2) to point at `artifact-workflow-guide.md`'s equivalent anchors.

## 10. ZH filename renames + link updates

- [x] 10.1 Rename `docs/zh/opsx.md` → `docs/zh/artifact-workflow.md` and `docs/zh/opsx-workflow-guide.md` → `docs/zh/artifact-workflow-guide.md` (git mv, preserving history).
- [x] 10.2 Grep `docs/zh/*.md` for every link/reference to the old filenames and update them to the new filenames, including the deferred links in `docs/zh/README.md:70` ("OPSX 工作流" row) and `docs/zh/README.md:87` ("从旧工作流迁移到 OPSX").

## 11. ZH prose rewrite — mirror the OPSX retirement, including deferred batch-5 lines

- [x] 11.1 Bring the content of the renamed `docs/zh/artifact-workflow.md` and `docs/zh/artifact-workflow-guide.md` in line with their (now-rewritten) English counterparts from group 9 — brand words per the usual passage-by-passage rule, plus the "the artifact workflow" concept name in Chinese (e.g. "制品工作流" or an equivalent the implementer judges most natural — match whatever phrasing group 9 settles on in English, then translate consistently).
- [x] 11.2 Rewrite the deferred OPSX-term lines in `docs/zh/README.md` (the two lines noted in 10.2) and any other batch-5 file where the implementer deferred an OPSX-as-current-term line (`docs/zh/concepts.md`, `docs/zh/grill-gstack-absorption.md`, `docs/zh/existing-projects.md` — reframe per 9.3's historical-narrative treatment for the grill-gstack file specifically) and `docs/zh/glossary.md`'s OPSX entry, mirroring group 9.
- [x] 11.3 Sweep `docs/zh/workflows.md` and `docs/zh/autopilot.md` (batch 6, light-touch) for the same "OPSX is the current workflow" pattern while doing their batch-6 pass, since batch 6 was written before the OPSX-retirement scope existed.

## 12. Verification

- [x] 12.1 Re-run a full `opsx-`/`OpenSpec` scan across `docs/zh/` and confirm every remaining occurrence matches a legitimate-retention category from design.md (upstream/historical narrative, literal code/path/CLI identifier, migration-source framing, or license/attribution) with a corresponding English passage that also retains it.
- [x] 12.2 Separately, grep both `docs/` and `docs/zh/` for `OPSX`/`opsx` (case-insensitive) outside of literal code/path/CLI-identifier contexts, and confirm no remaining hit asserts it as a current term — only historical narrative or legacy-detection identifiers remain.
- [x] 12.3 Check every internal link within edited `docs/*.md` and `docs/zh/*.md` files (same-language and cross-language relative links) still resolves after edits, with particular attention to anything that used to point at `opsx.md` / `opsx-workflow-guide.md`.
- [x] 12.4 Confirm `docs/artifact-workflow.md`, `docs/artifact-workflow-guide.md`, `docs/zh/artifact-workflow.md`, and `docs/zh/artifact-workflow-guide.md` all exist at their new paths, `docs/grill-gstack-absorption.md` (both languages) kept its filename, and `docs/zh/codex-parity-solutions.md` was left untouched.
- [x] 12.5 Run `rasen validate docs-zh-rebrand-resync --strict` to confirm the delta spec applies cleanly against `docs-content-accuracy`.
