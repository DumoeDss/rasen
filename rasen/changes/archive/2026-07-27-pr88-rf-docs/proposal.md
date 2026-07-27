# Proposal — pr88-rf-docs (PR #88 review fixes: docs/specs/evidence closure)

## Why

PR #88 (`feat: Store/context portfolio — bootstrap, portable knowledge, and
stabilization`) landed 34 commits / 321 files against `dev/0.1.5`, then received
a full review (`rasen/explorations/global-store-project-unification-development-plan.md`,
§36, 2026-07-27). The review surfaced six code-bearing children (C1–C5) plus a
docs/specs/evidence closure child (C6). C1–C5 ship their own fixes; this change
(C6) closes out the non-code review findings that do NOT require product-source
edits: CHANGELOG accuracy, locale dedupe, locale-key promotion for C4's
degraded-reporting strings, the bootstrap command-header comment, honest
E1–E4 task status, and documentation verification.

## Scope

This change is the closure child for PR #88 review findings M12 / M13 /
M15 / Minor 1 / Minor 2 / Minor 3 (deferred) / Trivial 1 / Trivial 2 / B1
(evidence text). It is split across two workers:

- **docs worker (this file's owner)** — non-spec edits only:
  CHANGELOG, locale JSONs, knowledge.ts strings + knowledge-messages module,
  bootstrap.ts top comment, docs/cli.md verification, and honest corrections
  to the archived E1–E4 task checkmarks.
- **LEAD** — owns every `rasen/specs/**` edit, the
  `stabilize-store-context-foundation` archive + spec sync (M12), the
  diff-check whitespace fix on 14 canonical spec files, the evidence run
  (serial `pnpm lint` / `pnpm build` / `pnpm test`), and the PR body
  retraction/fix for Minor 1 (unprovable review-claim) and Trivial 2
  ("Blocklers" typo). The LEAD's spec edits and evidence run are NOT in this
  worker's scope.

## What Changes

### docs worker edits (this change record's scope)

1. **M15 — CHANGELOG.md** — add accurate entries covering the actual PR #88
   review-fix surface shipped this session: Store immutable identity +
   obtain/register safety (UID verify, staging clone, data-dir threading,
   metadata probe); owner-aware locking (bundle import, membership, config
   hints); project-keyed membership + owner-aware locking; Session runtime
   context (Store record = sole eligibility authority); merge-regression
   restores (delegated completion, init learned materialization, unknown
   child status); Store-scoped learned resolution (backup debris = degraded
   not empty); bootstrap credential-remote rejection + redaction;
   normalizeProjectIdentity portability. Plus the §29.2 / §36 boundary
   statement: 0.1.5 EXCLUDES Issue / Execution Plan / Issue Board / portable
   run checkpoint (those are 0.2.0). References shipped commits
   (ec28f743, 6e905340, 85f95e65, 277785be, a245503a, 7dcdbec0).

2. **Trivial 1 — locale dup keys** — `src/locales/ja.json` and
   `src/locales/zh-cn.json` each carry `unknownHostRuntimeWarning` twice
   (around lines 446 and 450). The duplicate value is byte-identical in each
   file. Remove the second occurrence in each.

3. **Minor 3 (deferred) — knowledge.ts locale keys** — `src/commands/knowledge.ts`
   carries inline-English degraded-reporting strings introduced by the C4
   (validation) fixer in `listCommand` and `showCommand` for the M5 "recoverable
   backup debris" surface. Promote them to proper locale keys in the
   knowledge-messages module + `src/locales/{en,ja,zh-cn}.json`, and reference
   them through `KnowledgeMessages`. No English fallback for new keys.

4. **Minor 2 — bootstrap.ts top comment** — `src/commands/bootstrap.ts:1-16`
   header comment still describes bootstrap as having "two read-only modes"
   and "no flag that would obtain, register, or write" — that was accurate
   for E1 but contradicts E2/E3's `--apply` mode. Update the comment to
   reflect the three modes (`--check`, `--dry-run`, `--apply`) accurately.

5. **B1 — E1-E4 task-status corrections** — the four `2026-07-27-store-bootstrap-*`
   archived children (`diagnose`, `adopt-local`, `obtain`, `repair-text`)
   each carry a "Full suite green" gate checkmark. The suite was NOT proven
   green at any of those times — three of the four were checked without
   evidence, and the fourth was checked despite its own text recording 530
   pre-existing failures. Correct each to honest status (uncheck + note the
   truth). Do NOT mark anything green that is not evidenced. (The LEAD's
   evidence run captures fresh numbers; this worker only fixes false
   checkmarks.)

6. **M13 (code-relevant part) — docs/cli.md verification** — verify
   `docs/cli.md` shows the real `rasen bootstrap` CLI surface
   (`--check` / `--dry-run` / `--apply` / `--path` / `--into`). The
   dev-plan exploration doc (§2.1/§2.4/§3.2/§19/§35) is an untracked note in
   the MAIN repo worktree and is NOT a PR commit — out of scope here; noted
   for the LEAD.

### LEAD-owned items (NOT in this worker's scope; listed for traceability)

- **M12** — actually archive `stabilize-store-context-foundation` + sync its
  delta to `rasen/specs/**`; update the `store-bootstrap` Purpose section
  (line 5) to post-E4 final semantics; run requirement-title +
  scenario-preservation + Purpose checks.
- **M13 (spec part)** — canonical spec edits for the obsolete markers, if any.
- **Minor 1** — PR body: retract or evidence the "every child passed
  role-isolated review" claim for the 13 archive changes with no auditable
  `review-report.md`/ship log.
- **Trivial 2** — PR body "Blocklers" typo.
- **B1 (evidence run)** — serial `pnpm lint` / `pnpm build` / `pnpm test`,
  save machine+command+exitcode+pass/fail+failures; fix the 14 EOF-whitespace
  spec files from `git diff --check`.

## Non-goals

- No product-source edits beyond `knowledge.ts` (strings → locale keys) and
  `bootstrap.ts` (comment only). No `rasen/specs/**` edits.
- No test-evidence capture — that is the LEAD's evidence run.
- No commit; the LEAD commits.
