# Planning context — rehearse-legacy-store-layout-migration

Seeded by the LEAD before the first propose. Read this FIRST, then research only what is missing.

## Why this change exists

Operator approved scope "A+B+G2" on 2026-08-26 to close the Store-v2 retention/archive gap. This is
a **G2** item. The layout-migration module (`src/core/store/layout-migration/`, 15 files) implements
design SS11 (flat -> partitioned v2 migration: inventory / attribution / mapping / plan / apply /
recovery), but it has **never been exercised against a real legacy store** — only fixtures. The
design's own acceptance matrix (SS15 "迁移") lists cases that fixtures alone cannot honestly cover:
Windows path case / drive letters, UTF-8 Chinese names, long paths, recoverable failure at any
copy/rename/manifest step, and multiple target refs that still carry the old layout.

## The real material

`E:/AI/ChatAI/Agents/VibeCodingProjects/workflow/Reference/rasen-store` (uid
`f35acc7d-e088-4186-9ad6-b4b770649b0b`, alias `rasen-store`, registered on this machine) is a
genuine legacy flat store: v2 metadata (`.rasen-store/store.yaml` says `version: 2`) but a FLAT
planning tree — `rasen/specs/`, `rasen/changes/`, `rasen/changes/archive/`, and NO
`.rasen-store/projects/` catalog and no `rasen/projects/` partitions. Single worktree on `master`.
This is exactly the shape `legacy_flat_store_requires_migration` refuses writes for.

**HARD CONSTRAINT: never migrate, mutate, or run a non-dry-run command against the real
`rasen-store`.** It is the user's live planning store for another project. The rehearsal runs
against a **disposable copy** (copy the directory, or `git clone` it, into a temp root, register the
copy under a redirected registry via env, rehearse there, then unregister and delete). The
established repo pattern is full isolation: redirect XDG/global-data + `GIT_CONFIG_GLOBAL`, set a
git identity (commits fail without one), and use the real built CLI (`node bin/rasen.js`) so
uncommitted src is included.

## What "rehearsal" means here (this is a real-evidence change, not a code-first change)

1. Run the official flow against the disposable copy: detect layout, `inventory`, `plan`, inspect
   the mapping/attribution decisions, then `apply`, then verify the published tree + recovery
   manifest + retired old paths.
2. Attribution is the sharp edge. Design SS11.2 forbids guessing: `projectId` may only come from a
   recorded stable projectId, an adoption/migration journal, a consistent ChangeInstance/Session
   association, or a user-supplied audited mapping file — never from a name prefix, branch name,
   directory adjacency, or "the only project that looks similar". A store with no project catalog at
   all should therefore land most entries as `unresolved` and BLOCK apply until an explicit mapping
   file is supplied. Verify that it actually does, and that the refusal is legible.
3. Spec provenance (SS11.2 tail): a canonical spec touched by several archived Changes must not be
   silently assigned; the migrator must build a provenance view and either demand one authoritative
   owner or stay blocked. Verify.
4. Whatever the rehearsal SURFACES becomes the fix scope of this change: real defects, refusals that
   are correct but illegible, missing recovery, Windows-specific breakage. Record the evidence
   under the change's evidence directory.

## Constraints and decisions already made

- **Fail-closed is the design, not a bug.** SS11.3/SS16: unresolved attribution, conflicting
  evidence, or shared-spec ambiguity MUST block apply. If the rehearsal hits a refusal, the question
  is "is this refusal correct and legible?", never "how do I get past it".
- Sibling changes own other seams — do NOT edit them: A (`fix-store-retention-scope-resolution`)
  owns `src/core/store-planning/internal/resolver.ts` and `src/core/store/identity.ts`; B
  (`fix-store-workspace-pair-transactions`) owns `src/core/store/workspace/plan.ts` and `apply.ts`.
  If this change believes it needs a change in those files, say so in design.md and leave it to the
  sibling rather than colliding.
- Windows is the primary host. Known local hazards: `git -C` / `git init` chdir before reading
  `core.longpaths`, so paths >= ~247 chars fail regardless of the setting; EBUSY on rmdir of temp
  trees; leftover temp fixtures.
- Real-git suites must carry explicit per-test timeouts (the 30s default passes solo and fails in a
  parallel full run, where it then looks like a broken assertion). Never pipe a test run through
  tail/head — it masks a red exit code and destroys the failure list. Long runs go through
  background + bounded foreground polling.
- A guard test that passes against unmutated code proves nothing; each new guard must be shown to
  fail against the pre-fix behavior.

## Open questions for the planner to settle in design.md

- Copy vs `git clone` for the disposable store: which preserves the legacy shape faithfully enough
  (archive history, refs) while staying safely disposable?
- Does the flow support "multiple refs still carrying the old layout" (SS11.3 tail) at all, and does
  it report them?
- What is the minimum honest acceptance set for THIS change: which SS15 migration rows can a
  rehearsal + new tests actually close, and which must be stated as still-uncovered?
