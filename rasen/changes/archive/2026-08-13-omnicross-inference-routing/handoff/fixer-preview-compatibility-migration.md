# Preview compatibility migration handoff

## Status

HANDOFF. Terminal permission blocked the required source failure-log read and every attempted verification command. The bounded compatibility migration is present but unverified; all 14 files are **not** claimed passing, template hashes are not rebaselined, and tasks 7.1–7.8 remain unchecked.

## Shared migration seams added

1. `test/helpers/change-run-admission.ts`
   - consumes only `receipt.candidates` from an exact preview;
   - rejects duplicate, altered, unpreviewed, and unused candidate identities;
   - renders deterministic trusted test input keyed by candidate id, Run, Record version, node, occurrence, profile, and structured input;
   - invokes public `facade.admit` and returns canonical granted Actions;
   - provides a lifecycle driver wrapper that preserves start/resume/control/complete boundaries while admitting only a returned frontier.
2. `test/helpers/pipeline-cli-admission.ts`
   - runs the original fresh-process public command first;
   - writes an exact `agent-turn-input-manifest/1` with no extras under `rasen/changes/<change>/ephemera/`;
   - invokes shipped `pipeline admit --run ... --turn-input-file ... --json` in a second fresh process;
   - merges launch metadata with the admitted receipt for existing E2E assertions.
3. `scripts/session-cache-acceptance/prepare-physical.mjs`
   - production-entry preparation now explicitly consumes candidate previews and calls `facade.admit`; no Action internals are bypassed.

## Per-cluster state

### Lifecycle helpers — migrated, unverified

- `test/core/change-run/goal-cycle-canonical.test.ts`
- `test/core/change-run/review-cycle-runtime.test.ts`

Their shared harness construction and restart helper use the canonical admitting driver. Existing raw fresh runtimes in crash/ack-loss assertions remain raw intentionally because an already-admitted Action must stay active and must not be admitted again.

### Facade completion/validation — migrated, unverified

- `test/core/change-run/facade-evaluator-validation.test.ts`
- `test/core/change-run/cli-complete.test.ts`

Each fixture explicitly previews, admits the exact candidate with trusted bytes, then performs its original completion validation. Malformed completion/envelope/upload guard assertions were not weakened.

### Production-entry and dogfood — migrated, unverified

- `test/acceptance/session-cache/physical-readiness.test.ts` through its source helper `scripts/session-cache-acceptance/prepare-physical.mjs`
- `test/core/change-run/ecp-composite-dogfood.test.ts`
- `test/core/change-run/ack-loss-journeys.test.ts`
- `test/core/change-run/canvas-v2-vertical-proof.test.ts`

The three fresh-process journeys use the CLI admission helper; composite dogfood uses the in-process driver. Ack-loss replay after an admitted Action remains raw/no-new-grant behavior.

### Fresh-process command E2E — migrated, unverified

- `test/commands/pipeline-bugfix-e2e.test.ts`
- `test/commands/pipeline-complex-e2e.test.ts`

Every public command continues to spawn a fresh CLI process. Candidate-bearing start/control/resume/complete receipts now cause a second shipped `pipeline admit` process using private ephemera.

### Help/completion/templates — expectations updated, hashes pending

- `test/cli-e2e/basic.test.ts`: expected pipeline subcommands include `admit`.
- `test/core/completions/command-registry.test.ts`: expected registry includes `pipeline admit`.
- `test/core/templates/orchestration-bundles.test.ts`: pins exact private manifest and `pipeline admit` invocation.
- `test/core/templates/skill-templates-parity.test.ts`: **not changed in this pass**. Existing modified hashes must be compared with actual generator output after tests can run; rebaseline only reported source/generated mismatches.

## Evidence updated

`rasen/changes/omnicross-inference-routing/evidence/review-cycle-report.md` under the existing exact heading `Post-cap strategy attempt 2 fix` records the shared compatibility approach and truthful blocked-verification state.

## Blocked commands

The permission layer blocked these before execution:

```text
Read C:/Users/Sayo/AppData/Local/Temp/claude/E--AI-ChatAI-Agents-VibeCodingProjects-workflow/Reference/OpenSpec-code/999328bd-d63f-42bc-8601-06c98da26b69/tasks/bm7pn88xv.output
pnpm exec vitest run test/core/change-run/goal-cycle-canonical.test.ts
pnpm exec tsc --noEmit
```

The required full failure output therefore was not available in this worker context.

## Required continuation

1. Read the complete LEAD output named above and reconcile exact failures against this migration.
2. Run `pnpm exec tsc --noEmit`; fix helper typing first if needed.
3. Run goal and review files separately.
4. Run evaluator/CLI-complete, production-entry/dogfood, and fresh-process clusters incrementally.
5. Run the exact original 14-file set and record files/tests counts.
6. Run template parity; recompute only actual changed generator hashes.
7. Update evidence with exact commands and counts. Do not mark DONE or check tasks 7.1–7.8 unless all 14 previously failed files pass and final gates are green.
