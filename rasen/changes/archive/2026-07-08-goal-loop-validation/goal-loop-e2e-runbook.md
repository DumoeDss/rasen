# Goal-Loop End-to-End Validation Runbook

> Date: 2026-07-08 · Change: `goal-loop-validation` · Applies to: the goal-loop feature shipped by `goal-loop-core`
> Related: [`docs/opsx-workflow-guide.md` §9](../../../docs/opsx-workflow-guide.md) (user-facing chapter), [`openspec/changes/goal-loop/planning-context.md`](../goal-loop/planning-context.md) (design of record, Step L).

## Why this is a manual runbook (not a vitest)

The goal-loop's **loop semantics** — the round protocol, stall detection, resume rules, measure-failure handling, maxRounds-exhaustion honesty — live in the **LEAD orchestration playbook as prose** (`_orchestration.ts` Step L), NOT as executable code. `goal-loop-core` correctly shipped vitests only for the deterministic machinery (schema parse/narrow, `loopConfig`/`loopProgress` round-trip, pipeline DAGs, skill-template registration, and — added by this change — the `pipeline show` display string and per-pipeline tail structure). The loop's *behavior* is agent-driven and is not code-testable.

This runbook is the validation surface for that behavior. A human (or a future harness) follows it to confirm the loop actually behaves end-to-end with a throwaway measure task. It is dated and references the concrete artifacts by name; if the loop ever becomes code-driven, this runbook is promotable into an automated harness spec.

## Prerequisites

- The `openspec` CLI built (`node build.js`) so `dist/cli/index.js` exists.
- A project with an `openspec/` root (changes/specs dirs). This repo itself works.
- `/opsx:goal` installed in your AI tool (it ships with the package; `openspec update` regenerates the skill/command). Tier A (Claude Code + `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) is the primary path; the resume branches are observable regardless of tier.

## The throwaway measure task

Goal-loop drives a task whose "done" is a measurable condition. We validate it with a deterministic, controllable measure command — a tiny script that reads/writes a counter file and emits the `{score, passed}` JSON the measure gate expects.

### 1. Create the measure script

Pick a throwaway location (e.g. the change directory once created, or a scratch dir). The script:

```bash
#!/usr/bin/env bash
# measure.sh — emits { score, passed } JSON. Score climbs three points per run,
# reading/writing a counter file. NEVER reaches the threshold in the exhaustion
# scenario (set the threshold above the ceiling). Edit COUNTER_FILE / CEILING.
set -euo pipefail
COUNTER_FILE="${1:-./goal-counter.txt}"
CEILING="${GOAL_CEILING:-95}"   # the script asymptotes here; never crosses 90 in the exhaustion run
if [[ ! -f "$COUNTER_FILE" ]]; then echo 80 > "$COUNTER_FILE"; fi
n="$(cat "$COUNTER_FILE")"
# climb toward CEILING by 3 each run, clamped
next=$(( n + 3 )); (( next > CEILING )) && next=$CEILING
echo "$next" > "$COUNTER_FILE"
score="$next"
passed="false"; (( score >= 90 )) && passed="true"
printf '{"score":%s,"passed":%s}\n' "$score" "$passed"
```

Make it executable (`chmod +x measure.sh`). Run it a few times — each invocation bumps the counter and prints JSON. Non-zero exit / malformed JSON is the failure path you will inject later.

> The exact script does not matter. What matters: it (a) emits valid `{score, passed}` JSON on success, (b) is deterministic and controllable, and (c) can be made to never satisfy the threshold (for the exhaustion scenario). A Node script or a one-liner works equally well.

### 2. Create the change + `goal-plan.md`

```bash
openspec new change goal-e2e --schema spec-driven   # or your default schema
```

The `/opsx:goal` flow's `define-goal` stage (skill `openspec-goal-plan`) writes `goal-plan.md` for you. For a controlled run you may also hand-write it to pin the gate. It SHALL point the measure gate at the script, with a threshold and maxRounds:

```markdown
# goal-plan.md

## Goal
Drive the measure script's score to the threshold.

## Gate
kind: measure
command: ./measure.sh ./goal-counter.txt
threshold: 90
direction: gte

## Work Product
code

## maxRounds
5
```

## Scenario A — happy path: rounds append to `goal-run.json`

1. Reset the counter: `rm -f goal-counter.txt`.
2. Invoke: `/opsx:goal measure drive the score to 90` (or `/opsx:goal --pipeline goal-loop-measure ...`).
3. **Observe the define-goal gate.** The LEAD pauses at the `define-goal` stage (`gate: true`) and shows the measure command (`./measure.sh ...`) + threshold for confirmation. **Confirm it.** This is the safety valve for "measure.command is arbitrary shell" — never skip it.
4. The LEAD injects the concrete gate config into `iterate.loopConfig` in `openspec/changes/goal-e2e/auto-run.json` before round 1. Inspect it:
   ```bash
   cat openspec/changes/goal-e2e/auto-run.json | grep -A20 loopConfig
   ```
   You should see `loopConfig.gate.kind === 'measure'`, the injected `command`, `threshold: 90`, `direction: 'gte'`, and `maxRounds`.
5. **Observe rounds append.** Each round dispatches the implementer (warm-reused), then the measure gate runs the script and appends a record to `goal-run.json`:
   ```bash
   cat openspec/changes/goal-e2e/goal-run.json
   ```
   Each record looks like `{ "round": 1, "score": 83, "measurePassed": false, "detail": "...", "gitTreeFingerprint": "<sha>" }`, then round 2, etc. Confirm the score climbs toward 90 and `measurePassed` flips to `true` once `score >= 90`.
6. On the satisfied round, the loop exits to the tail (`ship` → `archive`). Confirm `goal-run.json`'s **last record** has `measurePassed: true` and the run proceeded to ship — NOT a maxRounds-exhausted outcome.

**Pass:** `goal-run.json` shows ≥2 rounds, monotonically improving scores, a `measurePassed: true` final record, and the tail ran. `auto-run.json`'s `loopProgress` cache (`round`, `lastScore`, `measurePassed`, `historyRef`) is consistent with `goal-run.json` (the latter is authoritative on conflict).

## Scenario B — maxRounds exhaustion is honest (never reported as success)

1. Reset the counter. Set `GOAL_CEILING` below the threshold so the script can NEVER pass:
   ```bash
   rm -f goal-counter.txt
   GOAL_CEILING=85 ./measure.sh   # sanity: prints score ≤85, passed:false
   ```
2. Edit `goal-plan.md` to `maxRounds: 2` and `threshold: 90` (unreachable given the ceiling).
3. `/opsx:goal measure drive the score to 90` and confirm the define-goal gate.
4. **Observe:** the loop runs round 1, round 2 — both `measurePassed: false` — then stops because `maxRounds` is exhausted.
5. **Assert honesty:** the outcome is marked `maxRounds-exhausted`. It is **NOT** reported as success. Check:
   - `goal-run.json`'s last record has `measurePassed: false` (the gate was never satisfied).
   - The ship-log / report surfaces `outcome: maxRounds-exhausted`.
   - The tail still runs (the run is not aborted — it proceeds to ship/archive marked honestly), per the "never lie about success" termination invariant.

**Pass:** two rounds, both not-passed, the run stopped at the cap, and the outcome is explicitly `maxRounds-exhausted` — nowhere is it claimed satisfied.

## Scenario C — measure-failure does not deadlock

1. Point the gate at a command that fails: set `command` in `goal-plan.md` to a script that exits non-zero (or prints malformed JSON): `command: ./measure.sh --bad-flag` or `command: ./broken.sh`.
2. `/opsx:goal measure ...`, confirm the gate.
3. **Observe the failure branch:** the round is recorded with an `error` field (`{ "round": 1, "error": "...", "measurePassed": false }`), treated as not-passed, and the loop continues (next round, seeded with the stderr/parse-error as the gap). It does **not** hang or retry forever.

**Pass:** a record with an `error` key exists, the round counts as not-passed, and the loop proceeds (either to the next round or to maxRounds-exhausted) rather than deadlocking.

## Scenario D — kill + resume (the three resume branches)

The authoritative loop position is the **last record of `goal-run.json`**. After an interrupt, `openspec pipeline resume` reads it and branches. Validate all three.

### D.1 — last record satisfied → tail (do NOT re-run)

1. Reset and run Scenario A, but **interrupt (kill the session) immediately after the round whose `measurePassed` flips to `true`**, before the tail runs.
2. In a fresh session:
   ```bash
   openspec pipeline resume goal-e2e --json
   ```
3. **Observe:** because `goal-run.json`'s last record is satisfied, the LEAD proceeds **directly to the tail** (ship → archive). It does **not** re-run the satisfied round. `resume --json` reports the next stage as the tail (`ship` for measure/evaluate).

**Pass:** no new round is dispatched; the satisfied round is not repeated; the tail completes.

### D.2 — last record not-passed → resume at lastRound + 1

1. Reset and run with a high threshold, `maxRounds: 5`. **Interrupt after round 1 completes** (round 1 has a recorded judgment with `measurePassed: false`).
2. Fresh session: `openspec pipeline resume goal-e2e --json`.
3. **Observe:** the LEAD resumes at **round 2** (`lastRound + 1`) — a fresh dispatch seeded with round 1's gap. It does **not** re-run round 1, because round 1 already has its recorded judgment. `goal-run.json` shows round 1, then a new round 2 appended after resume.

**Pass:** the first post-resume round number is `lastRound + 1`, not a repeat of `lastRound`; round 1's record is unchanged.

### D.3 — no record → dispatch round 1

1. Reset. Start `/opsx:goal measure ...`, confirm the define-goal gate, then **interrupt inside round 1, before the measure gate runs** (so `define-goal` is done but `iterate` died before the first gate — `goal-run.json` is empty or absent).
2. Fresh session: `openspec pipeline resume goal-e2e --json`.
3. **Observe:** with no record in `goal-run.json`, the LEAD **dispatches round 1** (not round 0, not "resume N").

**Pass:** the first post-resume round is round 1; `goal-run.json` gains its first record after the resumed round's gate runs.

## Optional — stall triggers strategy review

1. Reset. Make the score **flat** across rounds so no round "progresses" (e.g. a script that always emits the same score): score movement is the progress signal for a `gte` measure gate.
2. `/opsx:goal measure ...`, confirm. Let it run without satisfying the gate.
3. **Observe:** after `loopStallLimit` (default 2) consecutive non-progressing rounds, the LEAD does **not** silently burn the remaining rounds — it triggers the strategy-review ladder (Step H.5: change approach / adjust seeding / escalate), recorded in `strategyAttempts`. Round 1 always counts as progress, so this fires on rounds 3+.

**Pass:** a stall is detected and acted upon (strategy attempt recorded / escalation), not silently run to maxRounds.

## Cleanup

The throwaway artifacts (`goal-counter.txt`, `measure.sh`, the `goal-e2e` change directory) are scratch — remove them after the run. This runbook itself is a validation artifact that accompanies this change's archive; a future test harness may promote it if the loop becomes code-driven.
