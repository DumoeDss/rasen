# Review Report: `CI-GIT-IDENTITY`

- Reviewed: 2026-08-31 (Asia/Shanghai)
- Mode: fresh, dispatched, report-only, non-author review; no source fix, commit, push, merge, archive, external reply, or subagent action was performed
- Branch: `feat/project-issue-onboarding`
- HEAD: `86170dc0e367725c76b5cf57cd817a0b36513589`
- PR: `#183`, base `dev/0.2.0`
- Review scope: `test/core/management-api/create-space.integration.test.ts`, the fixer's six inserted Git identity lines, and the directly related existing `beforeEach`/`afterEach` environment snapshot and restoration

REVIEW VERDICT: REVIEW-CLEAN — Blocker:0 Major:0 Minor:0 Trivial:0

CI-GIT-IDENTITY: RESOLVED

## Scope check

- Intent: make the real-CLI Store integration hermetic on CI hosts with no configured Git identity.
- Delivered: six insertions only—two explanatory comment lines plus all four author/committer environment assignments—inside the existing environment-isolation hook.
- Scope result: CLEAN. The pre-report worktree inventory contained only `M test/core/management-api/create-space.integration.test.ts`; the scoped diff was `1 file changed, 6 insertions(+)`.
- Baseline blob: `5906fe2bd86c48824f2c61121d2d96e1630f07ea`; reviewed worktree blob: `be155769de1194db0b4490b90c30ea79e1efd5f8`.

Exact inserted diff:

```diff
+    // The real Store setup creates a Git commit. Keep that integration hermetic
+    // on runners without a global Git identity; afterEach restores the snapshot.
+    process.env.GIT_AUTHOR_NAME = 'Rasen Test';
+    process.env.GIT_AUTHOR_EMAIL = 'rasen-test@example.invalid';
+    process.env.GIT_COMMITTER_NAME = 'Rasen Test';
+    process.env.GIT_COMMITTER_EMAIL = 'rasen-test@example.invalid';
```

## Standards axis

No findings.

- Snapshot ordering: `originalEnv = { ...process.env }` is at line 46, before every test-owned mutation and before the new identity injection at lines 54–57.
- Complete identity: `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, and `GIT_COMMITTER_EMAIL` are all explicitly set. The `.invalid` email domain is deterministic and cannot address real mail.
- Reliable restoration: `afterEach` assigns `process.env = originalEnv` at line 61 before either cleanup await at lines 62–63. This restores prior values and removes variables that were absent from the snapshot even when a test assertion fails; cleanup failures occur only after restoration.
- Restoration probe: a separate Node process began with two sentinel identity values present and the other two absent, applied the same snapshot/inject/whole-object-restore sequence, and returned `RESTORE_PRESENT_VALUES=PASS RESTORE_ABSENT_VALUES=PASS` with exit 0.
- Concurrency/later-test isolation: none of the three tests is marked concurrent; each receives the same `beforeEach`/`afterEach` pair. Root `vitest.config.ts:211-213` explicitly relies on per-file process isolation and uses `pool: 'forks'`, so other test files do not share this worker's `process.env`. If the worker itself terminates before teardown, its environment terminates with it.
- Test-only diff: no application path, enum, database, UI, dependency, documentation contract, or new executable branch changed. The coverage-diagram and design-review stages are therefore not applicable.
- Smell/checklist pass: no SQL/data-safety, concurrency, trust-boundary, completeness, dead-code, string-coupling, crypto, time-window, type-boundary, frontend, performance, or Fowler-baseline issue is introduced by the scoped diff.

## Spec axis

No findings. The scoped CI failure required the integration harness to supply disposable Git commit identity without depending on user or runner configuration. The four-variable injection plus existing whole-environment restoration implements exactly that requirement and does not change product behavior or the PR's Store-membership/onboarding contract.

## Commands and results

### Worktree and diff

```text
git branch --show-current
=> feat/project-issue-onboarding

git rev-parse HEAD
=> 86170dc0e367725c76b5cf57cd817a0b36513589

git status --short --untracked-files=all
=>  M test/core/management-api/create-space.integration.test.ts

git diff -- test/core/management-api/create-space.integration.test.ts
=> one hunk at lines 49–58 containing exactly the six insertions quoted above

git diff --numstat -- test/core/management-api/create-space.integration.test.ts
=> 6  0  test/core/management-api/create-space.integration.test.ts
```

### Targeted integration test, normal environment

```text
pnpm exec vitest run test/core/management-api/create-space.integration.test.ts
=> PASS, exit 0; 1/1 file and 3/3 tests passed; test time 15.799s, total duration 34.60s
```

The third test emitted the existing non-failing `storeMemberships` display-name hint; it did not affect either run and is unrelated to the scoped identity diff.

### Targeted integration test, system/global Git configuration disabled

```powershell
$env:GIT_CONFIG_NOSYSTEM = '1'
$env:GIT_CONFIG_GLOBAL = 'NUL'
Remove-Item -LiteralPath Env:\GIT_AUTHOR_NAME,Env:\GIT_AUTHOR_EMAIL,Env:\GIT_COMMITTER_NAME,Env:\GIT_COMMITTER_EMAIL -ErrorAction SilentlyContinue
pnpm exec vitest run test/core/management-api/create-space.integration.test.ts
```

Result:

```text
ISOLATION GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=NUL IDENTITY_VARS_PRESENT=0
PASS, exit 0; 1/1 file and 3/3 tests passed; test time 17.396s, total duration 33.31s
```

This run began with all four identity variables absent and made system/global Git configuration unavailable. The real Store-creation and membership tests still completed their Git commits, directly proving that the test does not depend on machine Git identity.

### Diff, encoding, newline, and whitespace hygiene

```text
git diff --check
=> PASS, exit 0, no output

git diff --stat -- test/core/management-api/create-space.integration.test.ts
=> 1 file changed, 6 insertions(+)

strict UTF-8 decoder + BOM/U+FFFD/mojibake/newline scan
=> STRICT_UTF8=PASS BOM=False U_FFFD=False MOJIBAKE_HITS=0 BYTES=8911 LF=190 CRLF=190 BARE_CR=0 FINAL_LF=True
```

The diff and byte scan show no unrelated edit, malformed UTF-8, BOM, replacement character, typical mojibake signature, mixed newline, bare carriage return, missing final newline, or whitespace damage.

### PR and Greptile

```text
gh pr view 183 --json number,url,baseRefName,headRefName,body,state,title
=> OPEN PR #183; head feat/project-issue-onboarding; base dev/0.2.0

gh api repos/DumoeDss/rasen/pulls/183/comments?per_page=100
gh api repos/DumoeDss/rasen/issues/183/comments?per_page=100
=> GREPTILE_LINE_CURRENT=0 GREPTILE_TOP=0
```

No current line-level or top-level Greptile comment required classification. No GitHub reply or other external mutation was made. With a six-line diff, the skill's small-diff rule also skips the adversarial subprocess pass.

## Findings by canonical severity

### Blocker

None.

### Major

None.

### Minor

None.

### Trivial

None.

Canonical counts: Blocker:0 Major:0 Minor:0 Trivial:0

## Worktree change inventory

- Pre-existing fixer change, reviewed but not authored or modified here: `M test/core/management-api/create-space.integration.test.ts`.
- Pre-existing verification evidence, tracked and unchanged: `rasen/changes/project-issue-onboarding/evidence/verification-report.md`, last changed by `db05f9df04584c7550ebe9074101b7e4463c877c` (`chore(rasen): prepare onboarding portfolio delivery`).
- This review's sole write: `rasen/changes/project-issue-onboarding/evidence/review-report.md` at the canonical evidence location. The file was absent at review start, so it was created there; no `.rasen/*-reports` file was written.

## Final assessment

The environment snapshot precedes injection; the teardown restores both pre-existing and originally absent variables; all four Git author/committer variables are covered; forked per-file isolation plus teardown prevents concurrent or later-test pollution; the isolated test run proves independence from system/global Git configuration; and the six-line diff is clean. `CI-GIT-IDENTITY` is resolved with no review findings.
