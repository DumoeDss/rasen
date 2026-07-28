# Planning context: Pipeline content format v1 boundary

## User intent

> `$rasen-auto` 首先阅读交接文档：`rasen/handoff/composite-pipeline-version-strategy.md` 然后创建 worktree，从 `origin/dev/0.1.5` 创建开发分支，把我们计划中的 0.1.5 的任务都给完成。完成后提 PR。

## Release decision carried forward

The handoff and the research document
`rasen/work/issue-centered-automation-platform/deterministic-pipeline-kernel-research.md`
section 15 establish this release split:

- 0.1.5 adds only the Pipeline content-format compatibility boundary.
- 0.1.6 owns the first Composite/ReviewCycle deterministic runner slice.
- 0.1.7 may migrate GoalLoop and converge launchers after dogfood.
- 0.2.0 owns Issue Execution Plans and moving auto-decompose to Dispatch.

This change must not add a programmatic `pipeline run` engine, durable event
journal, nested Composite Canvas, runtime ownership changes, or behavior
changes to `rasen-auto` / `rasen-goal`.

## Required 0.1.5 outcomes

1. Add an explicit Pipeline content format v1 boundary to the public,
   round-trippable Pipeline definition contract.
2. Historical definitions without a version normalize to v1.
3. Detail/save/export preserve and expose the normalized version.
4. Unknown future content versions fail closed with actionable diagnostics.
5. v1 flat DAG and `stage.loop.kind: review-cycle|goal` remain readable and
   are documented as future compiler inputs; users do not need to rewrite
   existing YAML.
6. Pipeline/Canvas documentation must state that loops are still executed by
   the LEAD playbook and Canvas is not a programmatic runner.
7. Amend the existing `pipeline-definition-api` proposal, design, delta specs,
   and tasks to reflect these outcomes and the release boundary.

## Baseline facts

- Worktree:
  `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-pipeline-v1-boundary`
- Branch: `feat/pipeline-content-v1-boundary`
- Base: `origin/dev/0.1.5` at `b5107f67445e41dd0845f9a26d1710b9c5877988`.
- The original `pipeline-definition-api` implementation is already in this
  base (commit `1bc44794`) and was reviewed/archived through the
  `pipeline-online-assembly` portfolio.
- Its current planning artifacts still describe an unversioned
  `WirePipelineDefinition = PipelineYaml` round-trip contract and explicitly
  say there are no persisted format changes.
- `PipelineYamlSchema` in `src/core/pipeline-registry/types.ts` is currently
  unversioned.
- Existing external `review-report.md` and `ship-log.md` belong to the earlier
  child run. New run-state is authoritative; new verification and ship stages
  must replace the canonical reports with evidence for this new diff.

## Planning constraints

- Read the live code and tests before amending artifacts; do not assume the
  handoff's line numbers remain current.
- Keep product requirements user-observable. Put normalization and schema
  mechanics in design/tasks.
- Preserve cross-platform behavior and use the repository's existing path and
  schema sources.
- Keep backward compatibility explicit and fail closed on unknown versions.
- Append durable new findings to this file after the planning stage.

## Durable planning discoveries (2026-07-26 propose stage)

- The API and Canvas portfolio has advanced beyond the original design:
  `packages/ui/src/api/types.ts` now contains a full hand-maintained
  `WirePipelineDefinition` mirror and Canvas fixtures consume it. Adding a
  required normalized `version: 1` therefore requires core and UI mirrors plus
  their fixtures to move together; the old “no UI mirror in this change”
  statement is historical only.
- Detail/show/save already pass through parsed `PipelineYaml`, so a schema-level
  absent-to-v1 normalization naturally exposes/preserves the version there.
  `.rasenpkg` export is the exception: `exportPipeline` currently packages the
  user directory's raw bytes and must explicitly replace the packaged
  `pipeline.yaml` with normalized canonical YAML.
- All package built-ins and the `scaffoldPipeline` template are currently
  unversioned. They should be stamped v1 for new output while retaining
  dedicated unversioned fixtures as the compatibility proof. The Pipeline
  content version is independent of the package codec's `formatVersion`.
- Sections 1-6 of `tasks.md` describe work already delivered in the base (with
  a few later-superseded policy details). They are closed as historical ledger
  entries; only sections 7-11 are implementation work for this run.
