# Proposal: close-fusion-followups

## Why

The fusion series (`ship-delivery-modes` + `unify-expert-template-pipeline`) shipped three sharp edges that this change closes:

1. **`openspec archive` has no supported way to delete a spec.** When a change's delta REMOVES every requirement of an existing spec, the rebuilt spec has zero requirements and the archive command aborts on `Spec must have at least one requirement — Aborted. No files were changed`. The only workaround is `--no-validate` plus a manual directory removal — used twice already (archiving `fuse-methodology-into-opsx` and three specs at once archiving `unify-expert-template-pipeline`). Deleting a spec through a change should be a first-class, validated path, not an error followed by a hand-delete.
2. **The navigator's `/opsx:ship` one-liner is stale.** It still reads "test, push, open the PR from the proposal", describing the old single-mode GitHub flow. The ship contract now resolves three delivery modes (pr / push / local) behind an evidence-based test gate, so the router misrepresents the command it points at.
3. **The ship evidence gate conflates commit identity with content identity.** It compares "HEAD + dirty status" to decide whether code is unchanged since the last green test run, then separately argues that "a commit that moves HEAD but changes no content does not invalidate evidence". The content-tree hash (`git rev-parse HEAD^{tree}`) expresses that principle directly and removes the ambiguity.

## What Changes

- **archive: zero-requirement spec deletion is a first-class path.** When a change's delta REMOVES every requirement of an existing spec, archive deletes that spec's directory (and archives the delta as usual) instead of aborting on the `min(1)` validation. A clear log line names the deleted spec, and `openspec validate --strict` passes because the spec no longer exists rather than being left empty. The standalone spec-sync path (`buildUpdatedSpec` / `applySpecs`) gains the same behavior so archive and apply stay consistent.
- **navigator: `/opsx:ship` one-liner reflects the three delivery modes.** The navigator's main-flow entry for `/opsx:ship` becomes a one-line "when to reach for it" that names pr / push / local and evidence-gated testing — keeping the navigator's one-line style, not inlining the full ship contract.
- **ship: evidence gate and ship log use a content tree fingerprint.** The evidence-based test gate compares the content-tree hash (`git rev-parse HEAD^{tree}`) recorded at the last green run against the current one, replacing the looser "HEAD + dirty status" comparison; the base-merge and user-request overrides are unchanged. The ship log records the tree fingerprint. The companion evidence-recording sites (review-cycle report, auto adaptive-verify run-state) record the same tree fingerprint, so ship can consume any of them uniformly.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `cli-archive`: the Spec Update Process gains a zero-requirements-means-delete path — an existing spec emptied by a delta is deleted from the main specs, logged, and not treated as a validation failure.
- `navigator-router-skill`: the main-flow map requirement gains a scenario pinning the `/opsx:ship` one-liner to the three delivery modes plus evidence-gated testing.
- `opsx-ship-command`: the Evidence-based test gate and the Ship Log requirements use the content tree fingerprint as the code-state token.
- `review-cycle-workflow`: the gate-run evidence requirement records the tree fingerprint instead of HEAD + dirty status, so ship's gate can consume it without translation.

## Impact

- **Code:** `src/core/specs-apply.ts` (`buildUpdatedSpec` signals an emptied existing spec; `applySpecs` deletes the directory); `src/core/archive.ts` (archive loop deletes the directory and logs); `src/core/templates/experts/navigator.ts` (ship one-liner); `src/core/templates/workflows/ship.ts` (evidence gate + ship log tree fingerprint); `src/core/templates/workflows/review-cycle.ts` (report records tree fingerprint); `src/core/templates/workflows/auto.ts` (run-state records tree fingerprint).
- **Golden master:** navigator is pinned in `test/core/templates/skill-templates-parity.test.ts` by BOTH `getNavigatorSkillTemplate` (function hash) and `openspec-navigator` (generated content hash); editing `navigator.ts` requires recomputing both. The ship, review-cycle, and auto workflow templates are NOT in either hash map and need no recompute.
- **Tests:** a new archive test (a delta REMOVING all requirements of an existing spec → archive deletes the directory, does not abort, `validate --strict` passes); existing archive and apply tests stay green.
- **No breaking change, no new CLI flag.** No main-spec Purpose line needs hand-editing (each change refines behavior inside an existing requirement).
