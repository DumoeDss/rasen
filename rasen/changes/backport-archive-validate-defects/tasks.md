## 1. B1 — apply-time merge confirmation (Blocker)

- [x] 1.1 Locate 0.2.0's archive apply path: the plan builder's timing gate (the `on-merge` + `pr` blocker) and the apply/inspect seam in `src/core/archive-engine.ts` and `src/commands/archive.ts`. Confirm 0.2.0 has no apply-time assertion today.
- [x] 1.2 Add an apply-time `mergeConfirmed` assertion that filters the timing blocker out of the blocker list at apply/inspect time; the stored immutable plan (and its frozen override) stays byte-identical.
- [x] 1.3 Wire CLI `--yes` at the **apply** step into the `mergeConfirmed` assertion (not at save time).
- [x] 1.4 Fix the blocked-apply recovery text to name the real fix; correct the skill's save/apply ordering so `--yes` is documented at the apply step.
- [x] 1.5 Test: a `pr` + `on-merge` plan saved **without** `--yes`, then applied **with** `--yes`, completes; and the stored plan's frozen override is unchanged.
- [x] 1.6 **Mutation-discriminating test**: disable the apply-time filter and assert `applicable` flips true→false (test goes red); restore → green.

## 2. B2 — validate --strict scenario preservation

- [x] 2.1 Locate 0.2.0's validator MODIFIED-block handling and the archive engine's existing scenario-preservation comparison; reuse the comparison, do not fork it.
- [x] 2.2 Run the preservation check inside `validate`: `ERROR` under `--strict`, `WARNING` otherwise; carry `missingScenarios` into the issue so the message names what would be lost.
- [x] 2.3 Test: a MODIFIED delta that drops baseline scenarios → `validate --strict` fails and names the missing scenarios; plain `validate` warns and preserves its exit code.

## 3. B3 — report all preservation failures in one pass

- [x] 3.1 Collect the preservation result for **every** MODIFIED requirement; deduplicate projected-spec failures only against the corresponding delta-shape issue so unrelated requirement errors stay visible.
- [x] 3.2 Test: several MODIFIED requirements each omit scenarios → a single `validate --strict` run reports every failing requirement, not only the first.

## 4. B4 — strict-intent named constraints

- [x] 4.1 Locate 0.2.0's archive intent strict-validation path (the resolver that produces sidecar blockers).
- [x] 4.2 Emit a stable code per failure mode that names the offending field/key: unexpected key (lists accepted keys), wrong `schemaVersion` (received value), mismatched `change` (received value), incomplete handoff. Drop the generic catch-all restatement.
- [x] 4.3 Test: each failure mode (unknown key / wrong schemaVersion / mismatched change / incomplete handoff) produces a distinct, field-naming rejection.

## 5. B6 — plan-time reserved ship-log heading (Blocker)

- [x] 5.1 Locate 0.2.0's archive plan builder and where the ship log is read into the plan input.
- [x] 5.2 When the ship log contains a reserved `## Archive` heading, emit a typed `evidence` blocker so the plan is not `complete` and no token is issued. Keep the apply-time collision guard as the second layer.
- [x] 5.3 Test: ship log with `## Archive` → plan is incomplete with the evidence blocker and no stage/journal is created (mutation-free); clean ship log → proceeds.
- [x] 5.4 **Mutation-discriminating test**: disable the plan-time blocker and assert `complete` flips false→true (test goes red); restore → green.

## 6. Cross-cutting verification

- [x] 6.1 `node build.js` (tsc + ProcessCapsule) succeeds; `pnpm lint` clean.
- [x] 6.2 Relevant suites green: `archive-engine`, `archive`, `validation`, `validate`, plus the fault-matrix if it exercises the apply/intent paths.
- [x] 6.3 `rasen validate --strict` on this change's own delta passes (the preservation check is exercised by the change it fixes).
- [x] 6.4 `rasen archive --dry-run --json` projection shows `blockers: []` for this change (the plan-time gate accepts it).
