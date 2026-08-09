# FIXER round 1 handoff (relay 4) — COMPLETE

## Why this handoff exists

Relays 1–3 ran under `codex` and each compacted mid-work; relay 3 left the deterministic full-suite matrix at shard 7/32 with the remaining matrix + final evidence unfinished. `codex` then ran out of credits. The user assigned `claude` to take over the fixer role and finish round 1.

## Runtime handoff: codex → claude

- Review-loop worker was recorded as `codex` in `.rasen/.../auto-run.json`. This relay completed the round under `claude`. The LEAD (or user) should update `auto-run.json`'s review-loop worker/handoff record when reconciling — the fixer did not edit `auto-run.json`, `review-report.md`, or any LEAD state, and did not commit, ship, or archive.

## What this relay completed

1. **Re-verified** the two shards codex repaired mid-matrix: shard 3/32 (profile-leak, 358 pass/7 skip) and shard 7/32 (refusal-ordering, 151 pass) — both green.
2. **Ran the full deterministic matrix to completion** (shards 1–31, single worker, `TEMP=C:\Windows\Temp`; shard 32 empty). Resumable runners: `run-matrix.sh` (7–31) and `run-matrix-1-6.sh` (1–6); results in `evidence/matrix-results.md`, per-shard logs in `evidence/matrix-logs/`.
   - Totals: **6,760 passed / 8 failed / 34 skipped**. 4 failing shards: 15, 26, 29, 30.
3. **Triaged every failure** (full list, not extrapolated):
   - **Shard 26 + shard 29 — branch-caused, FIXED.** Both from one intended change (`builtins.ts`: auto's `requires.skills` += `rasen-task-loop`, task 3.4). `selection.test.ts:74` (exact `toEqual`) and `config-profile.test.ts`'s synced fixture both needed `task-loop` added to auto's now-correct install closure. Fixed; re-verified 2 files / 36 tests green.
   - **Shard 15 (×1) + shard 30 (×5) — environmental, proven non-task-loop.** Version-guard stamp (`0.1.6-dev.local.2` vs `0.1.6`), `rasen/config.yaml` `handoff.threshold: 0.7`, and a gitignored `packages/ui/dist` build artifact. Each reproduced deterministically in isolation; each on a code path the change does not touch.
4. **Wrote `evidence/review-fix-round-1.md`** — F1–F9 disposition table, focused gates, full matrix table, failure attribution, residual limitations, diff-tree fingerprint.

## Remaining required work (for the LEAD / user)

- Update `.rasen/changes/add-task-loop-pipeline/ephemera/auto-run.json`: mark review-loop round 1 complete (handoffs now 1–4; worker `claude` for relay 4) and unblock ship.
- Drive **ship** then **archive** (the fixer did neither). The 6 environmental failures are not blockers — they are pre-existing environment/version state on untouched code paths; F3 is closed by the conclusive matrix + attribution.
- Optional environment hygiene (not required for the change, and per version-discipline the user's call): re-stamp installed skills at `0.1.6`, decide on `rasen/config.yaml`'s `handoff.threshold`, and ignore/remove the `packages/ui/dist` build artifact — doing so would green shards 15 and 30.

## Constraints honored

- No self-review/certify, commit, ship, or archive.
- No edits to `.rasen/.../auto-run.json` or `evidence/review-report.md`.
- Unrelated user work preserved: `rasen/config.yaml`, `.rasen/`, `rasen/changes/add-thing/`, `rasen/changes/ecp-v2-default-authoring-and-builtins/`, `rasen/specs/billing/`.

## Return value

**DONE** — round-1 matrix and evidence complete; 0 remaining branch-caused failures.
