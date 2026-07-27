# Tasks — pr88-rf-docs (docs worker scope)

> LEAD-owned items (M12 spec sync + archive, M13 spec edits, Minor 1 PR body,
> Trivial 2 PR body typo, B1 evidence run + 14 EOF-whitespace spec files)
> are listed in `proposal.md` and are NOT tasked here. The docs worker does
> NOT edit `rasen/specs/**`.

## 1. M15 — CHANGELOG.md accuracy

- [x] 1.1 Add CHANGELOG entries covering the actual PR #88 review-fix surface
  shipped this session: Store UID verify + staging clone + data-dir threading
  + metadata probe (commit 6e905340); owner-aware locking for bundle import +
  membership + config hints (ec28f743); merge-regression restores — delegated
  completion, init learned materialization, unknown child status (85f95e65);
  Store record as sole Session-eligibility authority (277785be); credential
  remote rejection + backup-debris degraded reporting + project identity
  normalization (a245503a + 7dcdbec0). Reference shipped commits; no
  unprovable claims.
- [x] 1.2 Add the §29.2 / §36 boundary statement: 0.1.5 EXCLUDES Issue /
  Execution Plan / Issue Board / portable run checkpoint (those are 0.2.0).

## 2. Trivial 1 — locale dup keys

- [x] 2.1 Remove the duplicate `unknownHostRuntimeWarning` key from
  `src/locales/ja.json` (was at ~line 450; the ~446 occurrence is kept).
- [x] 2.2 Remove the duplicate `unknownHostRuntimeWarning` key from
  `src/locales/zh-cn.json` (same layout).

## 3. Minor 3 (deferred) — knowledge.ts locale keys

- [x] 3.1 Add locale keys for the M5 degraded-reporting surface to
  `src/commands/knowledge-messages.ts`: `degradedHeading`,
  `degradedRow(scope, dirs)`, `degradedRepair`, and the
  `showDegradedSuffix(dirs)` companion used by `showCommand`.
- [x] 3.2 Add the matching translations to `src/locales/{en,ja,zh-cn}.json`
  under `knowledge.*`. No English fallback for new keys.
- [x] 3.3 Replace the inline English strings in `knowledge.ts` `listCommand`
  (degraded section) and `showCommand` (degraded catalog suffix) with the new
  message keys.
- [x] 3.4 `pnpm exec tsc --noEmit` and `pnpm run lint` pass.

## 4. Minor 2 — bootstrap.ts top comment

- [x] 4.1 Update the `src/commands/bootstrap.ts:1-16` header comment to
  reflect `--check` / `--dry-run` / `--apply` (mutation) accurately — it
  currently claims "two read-only modes" and "no flag that would obtain,
  register, or write", which was true for E1 and false after E2/E3.

## 5. B1 — E1-E4 task-status corrections (archived children)

For each of the four `2026-07-27-store-bootstrap-*` archived children, find
any "Full suite green" / full-suite-gate checkmark that is not backed by a
real green run, and correct it to honest status. Do NOT mark anything green
that is not evidenced.

- [x] 5.1 `diagnose/tasks.md` task 9.7 — already honestly unchecked with
  evidence (4949/6/31, every failure attributed). No change.
- [x] 5.2 `adopt-local/tasks.md` task 10.11 — was `[x]` with no evidence
  recorded. Flip to `[ ]` with an honest note (no green-run evidence).
- [x] 5.3 `obtain/tasks.md` task 9.12 — was `[x]` with no evidence recorded.
  Flip to `[ ]` with an honest note.
- [x] 5.4 `repair-text/tasks.md` task 10.7 — was `[x]` despite its own text
  recording 530 pre-existing failures. Flip to `[ ]`; keep the honest text.

## 6. M13 (code-relevant part) — docs/cli.md

- [x] 6.1 Verified `docs/cli.md` already shows the real `rasen bootstrap`
  surface (`--check` / `--dry-run` / `--apply` / `--path` / `--into`). No
  stale `--store-path/--project-path/--clone-root` references. No edits
  needed in this PR worktree.
- [x] 6.2 Note in `proposal.md` that the M13 dev-plan exploration doc is an
  untracked note in the MAIN repo worktree and is out of PR scope.

## 7. Verification

- [x] 7.1 `pnpm exec tsc --noEmit` passes after the locale-key promotion.
- [x] 7.2 `pnpm run lint` passes after all edits.
