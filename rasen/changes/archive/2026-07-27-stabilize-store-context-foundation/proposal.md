## Why

The Store/context portfolio (children A–D2) is implemented and archived, but the
foundation it leaves behind is neither safe nor truthful. Resuming the paused
parent offers to **ship** a portfolio that still has two unstarted children; a
frozen run records which Store it belongs to by display name, so a renamed or
namesake Store silently re-targets it; the launch surface cannot tell a member
with no checkout here from a Store with no members at all; two helpers disagree
about which checkout knowledge applicability is decided in; and of nine unchecked
archived task boxes, eight misreport what was and was not verified, while the
ninth correctly reports work that was never done.

Phase E is about to build on exactly these seams. Fixing them afterwards means
migrating durable records that Phase E will already have written, so they are
worth one bounded change now — before E starts, and while nothing depends on the
current behavior.

## What Changes

- **A paused portfolio can no longer be resumed into delivery.** When a parent
  change was split into children, resume answers from the portfolio's own record
  and names the next runnable child. A portfolio record it cannot read is
  reported as unreadable — it never silently degrades into a plain single-change
  resume, which is the path that currently offers `ship`.
- **A parent can say a stage was delegated rather than skipped.** Stages handed
  to children are recorded as delegated and counted as outstanding, so a
  decomposed parent is never mistaken for a finished one. **BREAKING** only in
  the sense that `skipped` stops meaning "delegated"; existing records keep
  parsing.
- **A child's progress vocabulary covers "proposed but not started"**, and a
  child state the reader does not recognize counts as unfinished instead of
  invalidating the whole portfolio.
- **Frozen knowledge identity becomes permanent-identity-authoritative.** A run
  frozen against a Store that has a permanent identity records it; the display
  name travels for readability only. A Store whose metadata predates permanent
  identity has none to record, so such a run keeps the older name-keyed shape
  rather than being refused — refusing on write would stop runs that work today.
  Records written before this keep being readable, and every name-only record
  resolves fail-closed: exactly one match continues, none or several stop the
  run and name the candidates.
- **The launch surface tells the three Store situations apart** — members exist
  and can be worked in, members exist but none has a checkout on this machine,
  and the Store has no members — and states that choosing planning-only grants
  no permission to write code. English, Japanese, and Simplified Chinese all
  carry the new wording.
- **One rule decides where knowledge applicability is evaluated.** Both entry
  points fall back to the checkout the context already resolved, and the working
  directory stays the genuine last resort rather than a second, earlier answer.
- **Completion gates state evidence that can be checked.** A task gate SHALL
  name the evidence that settles it. All eight unsettleable archived gates are
  restated as the outcome actually owed and then settled: the four `full suite
  green` boxes against one recorded combined verification run, and the four
  archive-rehearsal boxes against the archive commits that performed the very
  merge each rehearsal was a proxy for. **No rehearsal was ever performed** —
  two of those boxes say so in their own text — so each restated line records
  that substitution rather than ticking against evidence that does not exist. No
  box is ticked next to a statement that is false.

## Capabilities

### New Capabilities

None. Every behavior below belongs to a capability that already exists; adding
new capability names for corrections to shipped behavior would split one
contract across two documents.

### Modified Capabilities

- `opsx-pipeline-registry`: resume answers for a decomposed parent from the
  portfolio record, reports an unreadable portfolio record instead of degrading,
  never exposes delivery while children remain — including when the record lists
  no children at all, which is not evidence that anything finished — and gains
  the delegated stage state plus a tolerant child-progress vocabulary.
- `session-runtime-context`: the launch surface distinguishes a member without a
  local checkout from a Store with no members, and states that planning-only
  confers no code-write permission.
- `store-scoped-learned-skills`: a frozen run records Store ownership by
  permanent identity wherever the Store has one, with fail-closed reading of the
  records that carry only a name.
- `learned-skill-effective-materialization`: a single stated fallback for the
  checkout applicability is evaluated in.
- `verify-ship-evidence`: a completion gate names checkable evidence, and a
  combined verification result records each failure's attribution.

## Impact

Affected code:

- `src/commands/pipeline.ts` — the resume surface for a decomposed parent, and
  `src/commands/pipeline-messages.ts` plus `src/locales/{en,ja,zh-cn}.json` for
  the one new human-readable string.
- `src/core/pipeline-registry/run-state.ts` — stage status vocabulary and which
  states count as outstanding.
- `src/core/pipeline-registry/portfolio-state.ts` — child progress vocabulary,
  tolerant reading, and reporting an unreadable record rather than returning
  nothing. Re-exported through `src/core/pipeline-registry/index.ts`.
- `src/core/management-api/task-detail.ts` and `runs.ts` — the two other readers
  of `portfolio-run.json`, moved onto the same "unreadable is not absent"
  distinction.
- `src/core/learned-skills/types.ts`, `context.ts`, `effective.ts`, `schema.ts`,
  `index.ts` — frozen identity shape and the evaluation-checkout fallback, plus
  the new `src/core/learned-skills/evaluation-root.ts` that holds the single
  shared fallback rule.
- `src/core/templates/workflows/retain.ts` — the instruction that currently tells
  a run to freeze identity by name.
- `packages/ui/src/components/LaunchSessionDialog.tsx` and the three locale files
  under `packages/ui/src/i18n/locales/`.
- The wire-type tail the widened status vocabulary forces:
  `src/core/management-api/wire-types.ts`, its hand-maintained mirror
  `packages/ui/src/api/types.ts`, and the one exhaustive status map,
  `packages/ui/src/components/SessionRow.tsx` (which would fail the build without
  its entry).

Affected records: `portfolio-run.json`, `auto-run.json`, and the frozen
`knowledgeContext` block inside it. Every existing record stays readable; none is
rewritten in place by this change.

Affected artifacts: the nine unchecked task boxes in the five archived A–D2
changes under `rasen/changes/archive/`. This change also ships
`combined-verification-A-D2.md` in its own change directory, so the four
restated `full suite green` gates cite evidence that archives with them and can
be reopened later — a gate whose evidence pointer nobody else can reach is not
checkable evidence.

Not in scope, and deliberately so: any Phase E (`store-bootstrap-and-hydration`)
or Phase F (`portable-project-knowledge`) behavior; the repository-level byte
guard; the broader `docs/zh` gap; `RuntimeExecutionRef.home?`;
`listStoreMemberCandidates`; and the final branch rebase. None of these is a
prerequisite for the five corrections above.
