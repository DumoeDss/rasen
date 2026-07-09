# Tasks: close-fusion-followups

## 1. archive: zero-requirement spec deletion

- [x] 1.1 Confirm the rebuild/validation sites before editing: `buildUpdatedSpec` in `src/core/specs-apply.ts` applies RENAMED→REMOVED→MODIFIED→ADDED onto `nameToBlock` and already knows `isNewSpec`; the `min(1)` gate is `SpecSchema.requirements` in `src/core/schemas/spec.schema.ts`, reached via `Validator.validateSpecContent` at `src/core/archive.ts` (~line 442) and `applySpecs` in `src/core/specs-apply.ts` (~line 442).
- [x] 1.2 In `buildUpdatedSpec`, after all operations set `emptied = (!isNewSpec) && nameToBlock.size === 0` and return it alongside `{ rebuilt, counts }`. Do NOT relax the general `requirements.min(1)` rule — an empty spec stays invalid everywhere except this supported deletion path.
- [x] 1.3 In the `archive.ts` spec-update loop: skip `validateSpecContent` for `emptied` entries; in the write pass delete the target spec directory via `fs.rm(path.dirname(update.target), { recursive: true, force: true })` instead of calling `writeUpdatedSpec`; print one clear line naming the deleted capability (e.g. `Deleting spec '<capability>' — all requirements removed by this change.`), suppressed in JSON mode like the other prose.
- [x] 1.4 Mirror the same `emptied` handling in `applySpecs` (`src/core/specs-apply.ts`) so `openspec apply` and `openspec archive` delete on the same condition and cannot drift.
- [x] 1.5 Add an archive test in `test/core/archive.test.ts`: a fixture change whose delta REMOVES every requirement of an existing spec → archiving deletes that spec's directory, does NOT abort on `min(1)`, leaves no empty spec behind, and the resulting main-specs tree passes `openspec validate --strict`. Model the fixture on the existing temp-dir setup in that file.

## 2. F3: navigator `/opsx:ship` one-liner

- [x] 2.1 Edit the `/opsx:ship` line (main-flow item 5) in the `BODY` string of `src/core/templates/experts/navigator.ts` to a one-liner that names the three delivery modes (pr / push / local) and evidence-gated testing. Keep it one line; do not inline resolution precedence, the merge step, or the ship-log fields (those stay in `opsx-ship-command`).
- [x] 2.2 Recompute BOTH navigator parity hashes in `test/core/templates/skill-templates-parity.test.ts`: `getNavigatorSkillTemplate` in `EXPECTED_FUNCTION_HASHES` AND `openspec-navigator` in `EXPECTED_GENERATED_SKILL_CONTENT_HASHES`. Run the parity test once to read the actual values, then paste them in.
- [x] 2.3 Confirm `getShipCommandSkillTemplate` / `getOpsxShipCommandTemplate` are absent from BOTH parity hash maps (they are workflow templates, not in the golden master) — no recompute needed for the F2 ship edit.

## 3. F2: ship tree-fingerprint evidence

- [x] 3.1 In `src/core/templates/workflows/ship.ts` step 3d (Evidence-based test gate), replace the "HEAD + dirty status" comparison with the content tree fingerprint `git rev-parse HEAD^{tree}` — compare the fingerprint recorded at the last green run against the current one. Keep run-condition (a) base merge introduced new commits and (c) user explicitly requests, unchanged.
- [x] 3.2 Add a `Tree:` field to the ship-log markdown template in `ship.ts` step 4, and have the `Tests: skipped` line cite the matched tree fingerprint and evidence source.
- [x] 3.3 Align `src/core/templates/workflows/review-cycle.ts`: the cycle-report evidence line (~"HEAD + working-tree dirty or clean") records the tree fingerprint instead, so ship can consume it without translation.
- [x] 3.4 Align `src/core/templates/workflows/auto.ts`: the adaptive-verify run-state evidence line (~"HEAD + dirty status") records the tree fingerprint instead. No spec delta for `opsx-auto-command` — its scenario says "the git code state it ran against" generically, which the tree fingerprint satisfies.

## 4. Verification

- [x] 4.1 `pnpm build` succeeds (TypeScript compile).
- [x] 4.2 Targeted tests green: `test/core/archive.test.ts` (incl. the new zero-req test from 1.5), `test/core/templates/skill-templates-parity.test.ts` (recomputed navigator hashes from 2.2), and `test/core/validation.test.ts`.
- [x] 4.3 `node ./bin/openspec.js validate close-fusion-followups --strict` passes (in PowerShell this may exit 255 with correct output — judge by the output, not the exit code).
- [x] 4.4 If the Windows full suite flakes (known temp-dir EBUSY / `spec.test.ts` timeout — non-logic), isolate-rerun the failing file to confirm green before shipping.

## 5. Main-spec defect repair (LEAD inline, folded into this change)

- [x] 5.1 Replace the skeleton `TBD` Purpose in `openspec/specs/expert-template-inlining/spec.md` (left behind by the `unify-expert-template-pipeline` archive, commit bdc8bae) with a real single-sentence Purpose matching its requirements. This defect deterministically failed `test/specs/source-specs-normalization.test.ts` and reds the full suite, blocking the ship evidence gate. Fixed as a fusion follow-up; to be confirmed by the non-author reviewer in verify.
