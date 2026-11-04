# Review Report — backport-archive-validate-defects

**Reviewer:** reviewer-1 (leaf worker, author != verifier)
**Commit reviewed:** `5ee3e486` on `fix/020-archive-validate-defects` (branch from `dev/0.2.0`)
**Date:** 2026-08-10
**Verdict:** FINDINGS (1 Major, 1 Minor)

## Mutation Testing (all guards proven discriminating)

### B1 guard — `applicableArchiveBlockers` filter

- **Mutation applied:** replaced the filter body with `return plan.blockers;` (ignores `mergeConfirmed`).
- **Result:** 3 of 5 B1 tests went RED:
  - `the same plan applied with mergeConfirmed completes` — status `blocked` instead of `complete`
  - `the stored plan stays byte-identical (override stays false)` — same root cause
  - `MUTATION TEST: without mergeConfirmed, apply stays blocked` — `withGuard.length` expected 0, got 1
- **Restore:** `cp src/core/archive-engine.ts.bak src/core/archive-engine.ts` (byte-exact, not `git checkout --`).

### B6 guard — plan-time reserved-heading check

- **Mutation applied:** commented out the entire `if (input.shipLog?.source) { ... }` block.
- **Result:** 2 of 3 B6 tests went RED:
  - `rejects a ship log with reserved ## Archive heading` — `plan.complete` expected `false`, got `true`
  - `MUTATION TEST: reserved heading makes plan incomplete` — same assertion failed
- **Restore:** `cp src/core/archive-engine.ts.bak src/core/archive-engine.ts`.

## Test Runs

| Suite | Result |
|---|---|
| `test/core/archive-validate-defects.test.ts` (17 tests) | 17 passed |
| `test/core/archive-engine.test.ts` | passed |
| `test/core/archive.test.ts` | passed |
| `test/core/archive-fault-matrix.test.ts` | passed |
| `test/core/validation.test.ts` | passed |
| `test/commands/validate.test.ts` | passed |
| **Total** | **156 passed, 1 skipped, 0 failed** |

- `npx tsc --noEmit` — clean (no output).
- `npx eslint` on 5 touched files — clean (no output).
- Platform early-return check: no platform conditionals in the new test file. All assertions execute on Windows.

## B1 Logic Verification

- **Root cause confirmed:** the old `applyArchive` checked `!plan.complete || plan.blockers.length > 0`. `plan.complete` is computed at plan time as `source === 'directory' && target === 'absent' && cleaner.classification.complete && blockers.length === 0`. When the timing blocker exists, `blockers.length > 0` makes `complete = false`. Even after filtering the timing blocker, `plan.complete` stays `false`, so the old `!plan.complete` gate blocked the apply forever.
- **Fix is correct:** the new code drops `!plan.complete` and checks only `applicableArchiveBlockers(plan, options).length > 0`. Verified that every precondition failure (source missing/invalid/error, target present, cleaner incomplete, validation blocked, tasks incomplete, timing) pushes its own blocker. An empty filtered list guarantees applicability.
- **Regression check PASSED:** `applyArchive(plan, ..., { mergeConfirmed: false })` returns `blocked` (timing blocker remains). Unmerged PRs still refuse.

## B2/B3 Verification

- `mainSpecsDir` parameter is optional; existing callers that don't pass it (archive.ts:942, validation.test.ts) skip the preservation check. No regression.
- `Validator` constructor receives `opts.strict`, so `--strict` flag flows correctly to the ERROR/WARNING level decision.
- Multiple failing requirements are all collected and reported in a single pass (B3 test confirms 2 preservation issues for 2 failing requirements).

## B4 Verification

- Old generic message (`"Archive input must be schemaVersion 1, bound to this change, and contain complete handoff decisions plus probes."`) has zero references in the test tree or src. No consumers affected.
- Each failure mode produces a distinct, field-naming message. Tests verify this.

## Incidental Edits

None. The diff touches only the 4 expected source files and adds the new test file. No edits outside B1-B6 scope.

---

## FINDINGS

### Major-1: B4 missing-required-field acceptance gap

**Location:** `src/core/archive-engine.ts:1196, 1203, 1230`

**Problem:** The new per-field validation uses `!== undefined` guards before checking value validity. This means that when a required field is MISSING from the intent, no blocker is emitted — the field silently passes validation. The old code (single compound condition) caught these cases because it checked `root.schemaVersion !== 1` (which is `true` when `undefined`), `root.change !== change` (also `true` when `undefined`), and `root.handoff.complete !== true` (also `true` when `undefined`).

Three fields are affected:

1. **Missing `schemaVersion`** (line 1196): `root.schemaVersion !== undefined && root.schemaVersion !== 1` — if `schemaVersion` is absent, the check is skipped entirely. Old code: `undefined !== 1` fires the blocker.
2. **Missing `change`** (line 1203): `root.change !== undefined && root.change !== change` — if `change` is absent, skipped. Old code: `undefined !== change` fires.
3. **Missing `handoff.complete`** (line 1230): `root.handoff.complete !== undefined && root.handoff.complete !== true` — if `complete` is absent, skipped. Old code: `undefined !== true` fires.

Note: `handoff` and `probes` missing ARE caught (lines 1249-1261 push blockers for missing handoff and missing probes).

**Failure scenario:** An intent `{handoff: {complete: true, decisions: [{...}]}, probes: []}` (missing both `schemaVersion` and `change`) passes the new validation with zero blockers. The old code would have rejected it with the generic blocker.

**Fix:** Either add explicit "missing key" checks (`if (root.schemaVersion === undefined) blockers.push(...)`), or remove the `!== undefined` guards so the value check fires for both wrong-value and missing cases. Removing the guards would change the message for missing fields (e.g., `"received undefined"`), which is acceptable and arguably better than silently passing.

### Minor-1: Task 1.4 skill save/apply ordering fix not implemented

**Location:** Proposal/design/tasks 1.4 specify correcting the skill's save/apply ordering so `--yes` is documented at the apply step.

**Problem:** No skill files or templates (`src/core/templates/`) were modified in the commit. The recovery command at `archive.ts:337` already includes `--yes`, so that part is satisfied by the B1 wiring itself.

**Impact:** Documentation only. Core B1 functionality works correctly.

---

## Round 2 — Re-review of fix delta `8630749d`

**Reviewer:** reviewer-1 (non-author re-reviewer; fixer is a different worker)
**Commit reviewed:** `8630749d` on top of `5ee3e486`
**Date:** 2026-08-10
**Verdict: CLEAN** (0 Blocker, 0 Major, 0 Minor, 0 Trivial)

### Major-1 resolution — B4 missing-required-field acceptance gap

**Resolved.** The fixer added `if/else if` chains for all three fields (`schemaVersion`, `change`, `handoff.complete`):

- `if (root.schemaVersion === undefined)` → "missing the schemaVersion key" blocker; `else if (root.schemaVersion !== 1)` → wrong-value blocker.
- `if (root.change === undefined)` → "missing the change key" blocker; `else if (root.change !== change)` → wrong-value blocker.
- `if (root.handoff.complete === undefined)` → "missing the handoff.complete key" blocker; `else if (root.handoff.complete !== true)` → wrong-value blocker.

Verified: missing field emits only the missing-key blocker; present-but-wrong field emits only the wrong-value blocker; present-and-correct field emits no blocker. No double-blockers, no gaps.

### Mutation testing of 3 new missing-key guards

**Mutation applied:** reverted all three checks to the old `!== undefined &&` pattern simultaneously (same as the round-1 gap). Backed up via `cp <file> <file>.bak`.

| Test | Result |
|---|---|
| `rejects a missing schemaVersion key` | RED (expected `missing the "schemaVersion" key`, not found) |
| `rejects a missing change key` | RED (expected `missing the "change" key`, not found) |
| `rejects a missing handoff.complete key` | RED (expected `missing the "handoff.complete" key`, got empty string) |

All 3 new guards are mutation-discriminating. Restored via `cp <file>.bak <file>`.

### Minor-1 resolution — save-time warning text

**Resolved.** `archive.ts:534` changed from "rerun with --yes" to "apply the saved plan with --yes after confirming the merge yourself." This correctly directs `--yes` to the apply step.

Checked all remaining `--yes` references in `archive.ts`:
- Line 337 (recovery command): `--apply-plan ... --yes` — apply step, correct.
- Line 613 (tasks override): different `--yes` semantics, correct at save time.
- Line 630 (tasks warning): same, correct.
- Line 996 (spec-update confirmation): same, correct.

No remaining save-time merge-confirmation `--yes` misdirection.

### Test runs

| Suite | Result |
|---|---|
| `archive-validate-defects.test.ts` (20 tests) | 20 passed |
| `archive-engine.test.ts` | passed |
| `archive.test.ts` | passed |
| `archive-fault-matrix.test.ts` | passed |
| `validation.test.ts` | passed |
| `validate.test.ts` | passed |
| **Total** | **176 passed, 1 skipped, 0 failed** |

- `npx tsc --noEmit` — clean.
- Regression sweep on the delta: fix touches only the 3 missing-key checks (Major-1), the one-line text change (Minor-1), and 3 new test cases. No incidental edits outside scope.
