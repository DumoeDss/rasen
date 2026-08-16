# Handoff: store-v2-onto-020 — LEAD session 5

Written in English deliberately: the Write tool corrupts multibyte text in this repo.

Successor to `lead-4.md`. That handoff's task was to finish slice 1 and deliver the portfolio.
This session did that AND everything else: the workstream is TERMINAL. **All six slices plus the
L4 tail are merged into dev/0.2.0 (tip `222eb0f6`). There is no remaining code work.**

## Original intent

The operator's directive for this session (verbatim): 「当前cci报错。之前session遗漏的cci错误已经修好合并到
2.0.0了。你在处理cci之后，合并ppr再继续推进后续所有任务」 — fix the CI, merge the PR, then continue driving
ALL remaining tasks. That meant: reconcile PR #160's red CI, merge it, then port the remaining
slices (L3+L5 finalization, L4 dispatch-adapter, L7 management-api seams) under the standing
port-first directive from lead-3 ("port everything first, then check; fix only what CI reports red").

## Position

Pipeline: none — the whole session worked as direct git commits on feature branches, not through
rasen change directories. dev/0.2.0 tip `222eb0f6`. All PRs closed: #160 (958b75dd, five slices +
six CI rounds 13→9→6→4→2→0), #161 (cdbe7d0a, L7 seams, first-try green), #162 (222eb0f6, L4 tail,
first-try green).

## Done / Remaining

Done — the full port ledger:
- L2 layout-migration `964acecc` · L8 coordinator-bridge `4bdb53ba` · L6 spine+rim
  `4dfebd59`+`789643c0` · L3+L5 finalization+stored-plan `a675dd43` · L4 core `7cb155c9`
  (type providers `9cc328bf`) · CI rounds `ed301828`/`73c3fc94`/`8a62be08`/`3bd1513b` ·
  L7 `6fcd75b7`+`2a9e904a` · L4 tail `e61c499d`.
- Product behaviors now live on 0.2.0: `rasen archive` requires one explicit terminal outcome
  (`finalization_outcome_required`); `--store X --project Y` pairs; legacy flat stores are
  read-only until `store migrate-layout`; the uid-addressed Store HTTP route family; omp as a
  fourth runtime with a context reader.

Remaining: NOTHING in code. Two items belong to the operator, not to a successor:
- Direction bookkeeping (per-slice result.md) — this port ran on git, not change directories.
- Back-porting this line's four slice-1 fixes to 0.1.7 (the port-first directive explicitly
  excludes fixing 0.1.7's own defects; that is a separate decision).

## Key decisions (and why)

- The 0.1.7 archive-engine (which already carries that line's B-fix wave) replaced 0.2.0's
  independent B-fix re-implementation wholesale; the 0.2.0-only B-fix contract suite
  (`archive-validate-defects.test.ts`) was RETIRED on explicit supersession — the ported
  reference suites (archive-engine 149 tests incl. the fault matrix) cover the same defect
  classes. Do not resurrect it without an operator decision.
- The ECP association-ledger clearing hook (lived in the replaced archive.ts) was re-grafted
  verbatim — ECP integration is this line's own and superseded nothing.
- FOUR slice-1 fixes were kept through every collision, each verified against the ported
  0.1.7 tests that encoded the unfixed behavior: uncommitted-Change refusal (re-applied in
  reference-verification.ts), declared-empty-line groups, plan-node canonical order, ambiguity
  tightening. Tests asserting 0.1.7's unfixed behavior were adapted, never the fixes reverted.
- The finalize-api byte-snapshot closure: `GIT_OPTIONAL_LOCKS=0` in the bridge's child env.
  Root cause was read-only `git status` refreshing the planning worktree's index stat cache
  (NTFS mtime granularity); fix the product, not the test. finalize-api is 36/36, zero skips.
- L4 tail: claude-print availability facts read DISPATCH_ADAPTERS; codex keeps
  RASEN_CODEX_BIN because the registry's codex entry deliberately declares no binaryEnvVar
  (playbook-owned, D7).

## Dead ends & gotchas

- CI reconciliation classes seen (each cost a round): ported-test premises; replaced-engine
  contract suites; lost ECP hooks; S3-fix collisions; LF-pinned fixtures (fix:
  `.gitattributes test/fixtures/** text eol=lf`); `.git/objects/maintenance.lock` racing in
  byte-identity snapshots (fix: skip it in fs-snapshot.ts); runner-speed test timeouts.
- **A too-narrow `git add` pathspec silently drops files** — third occurrence on this branch
  (round 3 shipped consumers without their type providers). Always stage with `git add -A`
  on the change's full file set and review `git diff --cached --stat` before committing.
- **A bad pathspec fails a whole `git checkout <ref> -- <paths>` batch silently under
  2>/dev/null** — finalization fixtures went missing that way. Never redirect checkout stderr.
- `it.skip.each` works in vitest 3.2.6; `it.each(...).skip` is NOT a function.
- `git status` in any read-only inspection path refreshes the index stat cache on NTFS —
  spawn with GIT_OPTIONAL_LOCKS=0 or byte-identity assertions will flake.
- The bare `rasen` on PATH is a 0.1.7 global build; always `node bin/rasen.js` in this repo.

## Eliminated hypotheses

Not a fixer session — none. (The one investigation, the finalize-api index churn, is resolved
above.)

## Working set

Nothing mid-edit. Branches all merged and deleted-remote-clean; the worktree sits on
dev/0.2.0 at `222eb0f6` (plus unrelated pre-existing dirty files from other sessions:
`docs/zh/file-placement-and-planning-roots.md`, `.rasen/`, two untracked docs — do NOT
commit those; they predate this session).

## Next action

None — the workstream is terminal. If the operator wants the direction formally closed:
run the direction bookkeeping (per-slice result.md under
`rasen/work/issue-centered-automation-platform/store-v2-onto-020/slices/`), then mark
`work.yaml` status accordingly. A fresh session should verify intent with the operator
before inventing work.
