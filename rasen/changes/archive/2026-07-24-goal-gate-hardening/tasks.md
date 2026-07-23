## 1. Schema plumbing (blockedThreshold)

- [x] 1.1 In `src/core/pipeline-registry/types.ts`, add `blockedThreshold` to the goal branch of `StageLoopSchema` (positive int, `.default(3)`), placed beside `loopStallLimit`; mirror the inline comment noting it is a distinct counter from `loopStallLimit`/`maxRounds`.
- [x] 1.2 In `src/core/pipeline-registry/run-state.ts`, add optional `blockedThreshold` (positive int, `.optional()`) to the `loopConfig` object, and add optional `blockedStreak` (nonnegative int) to the `loopProgress` cache object.
- [x] 1.3 Confirm no other consumer hardcodes the goal loop field set (grep `loopStallLimit` across `src/`); if `pipeline show` / effective-config surfaces the goal loop config, thread `blockedThreshold` only where `loopStallLimit` already flows — do NOT add it to the `pipeline show` meta label or locales (out of scope per design non-goal).

## 2. Orchestration playbook (Step L + counter table)

- [x] 2.1 In `src/core/templates/workflows/_orchestration.ts`, extend Step L: at Inject, copy `blockedThreshold` from goal-plan.md into `iterate.loopConfig` alongside `maxRounds`/`loopStallLimit`.
- [x] 2.2 Add a Step L "Blocked (distinct from stall)" clause: an implementer blocked report is not accepted immediately; the same blocker must recur for `blockedThreshold` (default 3) consecutive rounds, each round re-dispatched to try a materially different angle; any progress or a materially different blocker resets the streak; on reaching the threshold run the Step H.5/H.6 ladder (not a hard stop). Record the reported blocker + streak in the round record / `loopProgress`.
- [x] 2.3 Add the completion-audit discipline to Step L's evaluate branch reviewer dispatch and the Tier-C reset-pass fallback: treat completion as unproven and verify against the actual current state; derive requirements from goal/rubric; demand authoritative evidence (files/command output/tests/runtime behavior) per requirement; uncertain or indirect evidence = not achieved; the audit must prove completion, not merely fail to find remaining work; no intent/partial-progress/memory as proof.
- [x] 2.4 Add a `blocked streak` row to the Step H counter table (counts consecutive same-blocker rounds, cap `blockedThreshold` default 3, → Step H.5 ladder, independent of `loopStallLimit` and goal `maxRounds`).

## 3. Goal skill templates

- [x] 3.1 `goal-command.ts`: add the completion-audit discipline to the evaluate-gate termination invariant (and the Guardrails evaluate wording), mirroring Step L 2.3.
- [x] 3.2 `goal-iterate.ts`: add a fidelity clause to the implementer self-check forbidding redefining success around a smaller/easier task; add the blocked-reporting contract (report the blocker plainly when genuinely stuck; expect re-dispatch to try a different angle; never self-declare the gate satisfied).
- [x] 3.3 `goal-plan.ts`: add the anti-scope-shrink clause to goal framing, and document an optional `blockedThreshold` field in the goal-plan.md template (default 3 when omitted), beside `maxRounds`.

## 4. Template parity + build

- [x] 4.1 Run `pnpm build` (`node build.js`) so `dist/` reflects the template + schema edits.
- [x] 4.2 Run `pnpm test -- skill-templates-parity`; it will fail on the four changed goal templates. Paste the new SHA-256 values into BOTH `EXPECTED_FUNCTION_HASHES` and `EXPECTED_GENERATED_SKILL_CONTENT_HASHES` in `test/core/templates/skill-templates-parity.test.ts` for `rasen-goal-plan`, `rasen-goal-iterate`, `rasen-goal`, and (only if its body changed) `rasen-goal-report`. Do NOT hand-edit hashes for templates left unchanged.
- [x] 4.3 Re-run the parity test to confirm both maps pass.

## 5. Test coverage (goal-loop machinery)

- [x] 5.1 Add a run-state round-trip case (in the existing goal-loop run-state test file) asserting a `loopConfig` with `blockedThreshold` round-trips, and one without it still parses (additive).
- [x] 5.2 Add a registry schema case asserting the goal `loop` accepts `blockedThreshold` and defaults it to 3 when omitted.

## 6. Validate

- [x] 6.1 `rasen validate goal-gate-hardening --json` (or `node bin/rasen.js validate ...` once `dist/` is built) passes.
- [x] 6.2 Full `pnpm test` green (isolate any pre-existing Windows flake per repo convention before attributing a regression).
