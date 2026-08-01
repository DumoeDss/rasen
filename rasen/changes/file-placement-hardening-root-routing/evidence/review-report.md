# Review report — file-placement-hardening-root-routing

- Mode: dispatched, report-only
- Branch: `fix/pr121-file-placement-hardening`
- Authoritative baseline: `04cea87ae5bea9af2d90f526455b6ea513cd57e8`
- Reviewed scope: the child-owned migration command/core, Sessions join, completion/locales, and focused tests named in the review dispatch
- Verdict: **CLEAN (after Round 2)**
- Open count: 0 Blocker, 0 Major, 0 Minor
- Round 1 record: 0 Blocker, 1 Major, 2 Minor

## Scope and contract assessment

The implementation correctly introduces an explicit frozen migration root
context, routes Store planning separately from invocation-worktree execution,
uses one plan in the production preview/apply path, retains the foundation's
fingerprint/no-clobber/scoping mechanics, and joins Sessions terminal state
through the recorded execution root without Store or launch-project fallback.
The reviewed completion registry and three locale files present both selectors.

The remaining gaps are in the command adapter: incomplete-plan blockers are
discarded at the user-facing boundary, the established JSON `executed` meaning
changes for empty apply invocations, and the claimed command-level
preview/confirmation regression does not exercise the command flow.

## Blocker

None.

## Major

### 1. Incomplete migration plans are silently returned as successful previews and their blockers are omitted

- Evidence: the planner records typed blockers and marks the plan incomplete at
  `src/core/work-migration.ts:1107-1108`; the apply engine correctly refuses
  such a plan at `src/core/work-migration.ts:1475-1476`; and the report retains
  the blockers at `src/core/work-migration.ts:1706-1713`. The command then
  computes `canApply` from completeness at `src/commands/work.ts:242-245`.
  JSON/`--yes` downgrades an incomplete requested apply to `preview` at
  `src/commands/work.ts:247-258`, while interactive mode simply returns at
  `src/commands/work.ts:261-268`.
- User-visible failure: neither output path reports why the plan is incomplete.
  `toJsonPayload` drops `report.blockers` entirely at
  `src/commands/work.ts:99-139`, and `printHumanReport` prints only ordinary
  notes at `src/commands/work.ts:142-219`. An `EACCES`, `EPERM`, or `EIO`
  planning failure therefore produces exit code 0, `executed: false`, and
  preview-shaped candidate statuses, with no affected operation/path/code.
  Automation can treat a blocked `--json --yes` migration as a successful
  no-op even though discovery was incomplete.
- Test gap: core fault-injection tests prove the engine blocks apply at
  `test/core/work-migration.test.ts:1053-1139`, but no command test asserts the
  human/JSON projection or exit behavior for an incomplete plan.
- Contract: the completed foundation requirement at
  `rasen/changes/file-placement-hardening-migration-safety/specs/work-migration/spec.md:152`
  requires planning failures to be reported with the affected path and to
  block apply. The child compatibility requirement at
  `rasen/changes/file-placement-hardening-root-routing/specs/work-migration/spec.md:118-126`
  explicitly retains complete-plan blocking and fail-closed filesystem
  handling.
- Recommended action: surface the typed blockers in both human and JSON
  previews. When `--yes` requests apply for an incomplete plan, emit an
  actionable failure diagnostic and a non-zero exit rather than silently
  converting the invocation to a preview. Add command regressions for at least
  one injected non-`ENOENT` planning failure and assert operation, path, code,
  exit status, and unchanged disk bytes.

## Minor

### 2. The established JSON `executed` meaning changes for complete empty plans

- Evidence: at the fixed baseline, JSON execution intent was
  `!dryRun && yes`; a second idempotent `--json --yes` invocation therefore
  retained `executed: true` even with zero candidates. The new condition at
  `src/commands/work.ts:245-251` additionally requires
  `plan.actions.length > 0`, so a complete empty plan reports
  `executed: false`. The idempotence test at
  `test/commands/work.test.ts:230-241` checks only the candidate count and
  misses the changed field. The no-home case explicitly codifies the new value
  at `test/commands/work.test.ts:340-355`.
- Impact: existing JSON consumers can no longer distinguish “apply was
  explicitly requested and completed as a no-op” using the field's established
  meaning. This is a metadata compatibility regression, not a data-safety
  failure.
- Contract: the compatibility scenario requires existing JSON fields to retain
  their names and meanings at
  `rasen/changes/file-placement-hardening-root-routing/specs/work-migration/spec.md:128-134`.
- Recommended action: separate plan applicability from whether actions exist.
  A complete empty plan can be passed unchanged to apply (which is already a
  safe no-op), preserving `executed: true` for `--json --yes`; keep the
  interactive “nothing to migrate” early return as a distinct presentation
  decision. Add an `executed` assertion to the second-run regression. If the
  no-home case is intentionally not applicable, report that state
  diagnostically rather than silently redefining `executed`.

### 3. The exact-plan regression bypasses the command's preview/confirmation path

- Evidence: the test at `test/commands/work.test.ts:177-228` constructs a plan
  directly, mutates cwd/files, and invokes the exported
  `applyPlannedWorkMigration` helper directly. It never invokes
  `rasen work migrate`, never reaches the interactive confirmation at
  `src/commands/work.ts:270-283`, and never captures the plan that the command
  actually previewed. The production code is currently correct by inspection,
  but this test would still pass if `runMigrate` later replanned after
  confirmation or passed a different plan to the helper.
- Contract: checked task 2.3 at
  `rasen/changes/file-placement-hardening-root-routing/tasks.md:34-36`
  specifically requires command tests that mutate state before confirmation
  and prove apply receives the previewed plan.
- Recommended action: add a command-level dependency seam or in-process command
  harness that captures the previewed plan, pauses at confirmation, mutates
  cwd/source state, confirms, and asserts reference identity plus the
  foundation drift outcome. Keep the existing helper test as the narrower unit
  regression.

## Coverage diagram

```text
CODE PATH COVERAGE
==================
[+] work migrate root boundary
    ├─ [TESTED] project selection keeps planning/execution/home owner together
    ├─ [TESTED] Store planning + invocation member execution
    ├─ [TESTED] main and linked worktrees remain isolated
    └─ [TESTED] mutually exclusive selectors use shared diagnostics

[+] immutable migration plan/apply
    ├─ [TESTED] ordered actions and direct-helper plan reference identity
    ├─ [TESTED] source drift, destination races, fingerprints, no-clobber
    ├─ [TESTED] scoped filtering before unrelated filesystem inspection
    ├─ [GAP]    command preview → confirmation → exact apply reference
    └─ [GAP]    command projection/exit behavior for incomplete plans

[+] Sessions terminal-state join
    ├─ [TESTED] planning-space filter remains planning-owned
    ├─ [TESTED] member/worktree ephemera wins over Store/main/launch decoys
    ├─ [TESTED] legacy home follows frozen execution owner
    ├─ [TESTED] later pointer/membership changes do not retarget
    └─ [TESTED] missing, planning-only, removed, and inspection-error cases

[+] compatibility/presentation
    ├─ [TESTED] legacy command fields/options on non-empty preview/apply
    ├─ [TESTED] selector completion and locale JSON validity
    ├─ [GAP]    incomplete-plan blockers in human/JSON output
    └─ [GAP]    `executed` compatibility on an empty `--json --yes` run
```

## Independent verification

- `pnpm run build` — PASS.
- `pnpm run lint` — PASS.
- Focused Vitest command for the four dispatched files — PASS:
  **4 files, 114 tests**.
- `node bin/rasen.js validate file-placement-hardening-root-routing --strict --json`
  — PASS: 1/1 valid, 0 issues.
- Focused `git diff --check` against the fixed baseline — PASS; only expected
  LF-to-CRLF notices were emitted.
- Temp-fixture audit — no new `rasen-work-migrate-*` or `rasen-sessions-*`
  directory remained after the reviewer run. Older pre-existing temp
  directories were not modified or removed.
- Native cross-platform evidence remains limited to Windows. Explicit
  `win32`/`posix` flavor tests passed, but the closure-owned native
  macOS/Linux matrix is still outstanding.
- No external Codex pass was invoked. The reviewer made no implementation,
  test, task, or archive-owned edits.

## Round 1 verdict record

**FINDINGS** — 1 Major and 2 Minor findings require a fix/re-review cycle.

## Round 2 — delta re-review

- Reviewer: `/root/archive_engine_planner`
- Fixer: the non-reviewer author of `handoff/fixer-1.md`
- Independence: confirmed; this reviewer made no implementation or test edits.
- Delta scope: `src/commands/work.ts`, `test/commands/work.test.ts`, and
  `handoff/fixer-1.md`.
- Round 2 verdict: **CLEAN**

### Confirmed resolutions

1. **Round 1 Major — resolved.** The command JSON projection now exposes the
   plan's typed blockers at `src/commands/work.ts:127-174`, and human preview
   renders operation, path, optional code, and message at
   `src/commands/work.ts:256-265`. A requested JSON apply against an incomplete
   plan emits `work_migrate_plan_incomplete`, preserves the full preview
   payload, sets a non-zero exit status, and returns before apply at
   `src/commands/work.ts:303-323`. Human `--yes` prints the preview/blockers,
   emits the same failure, and returns before apply at
   `src/commands/work.ts:333-347`. The regressions at
   `test/commands/work.test.ts:333-439` inject `EACCES` and `EPERM`, assert the
   exact operation/path/code, non-zero requested-apply behavior, no apply call,
   and unchanged source bytes. Preview-only JSON remains successful while
   reporting the blockers.

2. **Round 1 Minor 2 — resolved.** Apply intent is now computed solely from
   `!dryRun && yes` at `src/commands/work.ts:297-306`; a complete plan is passed
   unchanged to apply regardless of action count at
   `src/commands/work.ts:318-323`. The empty second-run regression now asserts
   `executed: true` and zero candidates at
   `test/commands/work.test.ts:442-453`. The no-home regression at
   `test/commands/work.test.ts:553-568` also preserves `executed: true` while
   proving config bytes and the machine project registry remain untouched.
   Interactive empty-plan presentation remains a separate early return at
   `src/commands/work.ts:349-350`.

3. **Round 1 Minor 3 — resolved.** The command now has a narrow optional
   dependency seam for its real root resolver, planner, apply engine, and
   confirmation prompt at `src/commands/work.ts:43-67`; production registration
   still defaults every dependency to the real implementation at
   `src/commands/work.ts:277-284` and `src/commands/work.ts:379-397`. The
   in-process registered-command regression at
   `test/commands/work.test.ts:259-330` observes the printed preview, mutates
   cwd and source state inside the confirmation callback, adds a later
   candidate, and proves the apply dependency receives the exact same plan
   reference after one planner call. The real apply engine reports `ESTALE`,
   preserves both post-preview files, and creates nothing beneath the changed
   cwd.

### Narrow regression assessment

```text
ROUND-2 COVERAGE
================
[+] incomplete-plan command boundary
    ├─ [TESTED] JSON preview exposes typed blocker and exits successfully
    ├─ [TESTED] JSON --yes exits non-zero and never calls apply
    ├─ [TESTED] human --yes prints blocker, exits non-zero, never calls apply
    └─ [TESTED] source bytes remain unchanged

[+] complete empty plan
    ├─ [TESTED] second JSON --yes reports executed=true and zero candidates
    └─ [TESTED] no-home JSON --yes neither mints nor replans

[+] preview -> confirmation -> apply
    ├─ [TESTED] actual registered Commander action runs in process
    ├─ [TESTED] one planner call and exact plan reference reaches apply
    ├─ [TESTED] source/cwd drift produces ESTALE rather than replanning
    └─ [TESTED] later candidate and replacement bytes survive

[+] preserved behavior
    ├─ [TESTED] Store planning/member execution and two-worktree isolation
    ├─ [TESTED] Session frozen-execution joins and fail-closed absence
    ├─ [TESTED] foundation scoping/fingerprints/no-clobber/fail-closed apply
    └─ [TESTED] selectors, compatibility options, and no-mint preview
```

### Independent Round 2 verification

- `pnpm run build` — PASS.
- `pnpm run lint` — PASS.
- Focused Vitest command for the four dispatched files — PASS:
  **4 files, 117 tests**.
  - command: 20 tests;
  - migration foundation/root routing: 63 tests;
  - Sessions API/space: 34 tests.
- `node bin/rasen.js validate file-placement-hardening-root-routing --strict --json`
  — PASS: 1/1 valid, 0 issues.
- Focused `git diff --check` for the two Round 2 files — PASS; only expected
  LF-to-CRLF notices were emitted.
- Temp-fixture audit — no new `rasen-work-migrate-*` or `rasen-sessions-*`
  directory remained after the reviewer run.
- The native macOS/Linux matrix remains closure-owned and is not claimed by
  this Windows-host review.
- No external Codex pass was invoked.

## Final verdict

**CLEAN** — all three Round 1 findings are resolved, their narrow regressions
pass, and no new Blocker, Major, Minor, or Trivial finding remains in the
Round 2 delta.
