# Planning context — ui-workflow-title-sync

## User intent (verbatim)
开发者对 PR #38 的反馈:"你做的ui部分可能需要改一下,原来那个cmd用的workflow配置部分我直接给skill用了"。
LEAD 检查后用户指示:开始做(修复 packages/ui 对 PR #38 skill: 展示块的滞后)。

## Established findings (LEAD's own inspection, verified against 9457bddf = origin/dev/0.1.5)

PR #38 (merged) replaced the retired `command:` workflow-manifest block with a new optional strict
`skill:` presentation block (`skill.name` = author-declared display title; optional `category`, `tags`).
Core management API now exposes it; `packages/ui` was NOT touched by that PR and is stale.

Exact gaps:

1. **Wire-type mirror stale** — `packages/ui/src/api/types.ts`:
   - `WorkflowListEntry` (line ~611) is missing `title: string | null`
     (core: `src/core/management-api/wire-types.ts` `WorkflowListEntry.title`, doc comment:
     "Author-declared display title from the manifest's `skill:` block; null when the workflow declares none.")
   - `WorkflowDefinitionWire` (line ~638) is missing `title: string | null`, `category: string | null`,
     `tags: string[] | null` (same source, after `kind`).
   Mirror discipline: copy field order + doc comments from core wire-types verbatim (三件套纪律).

2. **List card ignores title** — `packages/ui/src/components/WorkflowsPage.tsx` line ~275:
   `<span class="workflow-card__name">{entry.skillName}</span>` should render `entry.title ?? entry.skillName`.
   CLI parity: profile picker shows `title ?? skill.template.name` verbatim (src/commands/profile-editor.ts, PR #38).

3. **Detail panel lacks new fields** — `WorkflowDetailPanel` facts `<dl>` shows Kind/Source/Skill/Digest only.
   Add Title row (when non-null); category/tags may also be surfaced (decide in design; core sends them).

4. **Fixtures must gain the new fields** — `packages/ui/test/fixtures/workflows.ts`
   (5 list entries + 1 detail fixture). The `satisfies WorkflowListResponse` / `satisfies WorkflowDetailResponse`
   tripwire will FORCE this once the mirror gains the non-optional `| null` fields — that is by design.
   Component test `packages/ui/test/components/workflows-page.test.tsx` needs a title-over-skillName
   rendering assertion (existing assertions at lines 157/201/367 use skillName / facts text).

## Constraints / decisions already made
- Work happens in worktree `wt-pr38-check`, branch `change/ui-workflow-title-sync`, base = origin/dev/0.1.5 @ 9457bddf.
- Do NOT touch `packages/ui/src/components/TelemetryDisclosure.tsx` — its `command` strings are the live
  telemetry payload keys, unrelated to workflow manifests.
- Core (CLI/API) side is DONE by PR #38 — this change is UI-only (packages/ui) + any spec delta for the
  management-ui/workflows-ui spec if one governs workflow presentation.
- Scope is small: 4 files-ish (types mirror, WorkflowsPage, fixtures, component test). Keep it one change.
- New wire fields are non-optional `string | null` in core — mirror them identically (not `?:`).

## Relevant specs
- `rasen/specs/` contains management-ui / workflows-ui related specs (workflow-library spec was updated by
  PR #38 for CLI side). Planner should check whether a UI spec scenario mentions the card display name and
  add a delta spec only if a governed behavior changes.

## Planner findings (propose stage, 2026-07-23)

- **Governing spec confirmed**: `rasen/specs/workflows-ui/spec.md` governs both the card display rule and
  the detail-view field list — it explicitly enumerates card fields ("id, skill name, source...") and
  detail-view fields ("identity, kind, source, digest, skill, requires/recommends, files"), neither
  mentioning title/category/tags. Wrote a MODIFIED delta on both requirements (full requirement +
  all existing scenarios reproduced, per the schema's MODIFIED-requirements rule, plus new scenarios for
  title fallback and title/category/tags detail display).
- **`workflow-http-api` spec is ALSO stale** (`rasen/specs/workflow-http-api/spec.md` requirement prose for
  `GET /api/v1/workflows` and `GET /api/v1/workflows/<id>` lists fields without `title`/`category`/`tags`,
  even though `src/core/management-api/wire-types.ts` already sends them) — this predates and is separate
  from this change; PR #38's own change dir (`rasen/changes/cli-locale-workflow-list-skill-title-fixes`,
  still un-archived) only touched `workflow-library` and `profiles` deltas, never `workflow-http-api`. Left
  untouched here (out of scope, UI-only) but flagged in proposal.md's Impact section for whoever next
  touches that spec.
- **Design decision recorded**: detail view surfaces Title/Category/Tags as additional facts rows (each
  shown only when non-null, Tags comma-joined) rather than a new section — matches the panel's existing
  omit-what-doesn't-apply style. Card fallback rule (`title ?? skillName`) mirrors the CLI profile picker's
  own fallback verbatim.
- **`cli-locale-workflow-list-skill-title-fixes` (i.e. "PR #38") is still an active, un-archived change
  directory** in this worktree even though its code is merged to `origin/dev/0.1.5` — a pre-existing
  archive-timing gap, not something this planner touched or needs to resolve.
