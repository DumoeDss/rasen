# Review Report: close-fusion-followups

**Reviewer:** reviewer-1 (independent non-author gate, verify stage)
**Date:** 2026-07-07
**Branch:** dev-harness
**Change dir:** `openspec/changes/close-fusion-followups/` (untracked); all code/test changes uncommitted in the working tree.

## VERDICT: APPROVE

One optional Minor test-fidelity note (non-blocking). No Blocker, no Major. All gates green (the single full-suite failure is a confirmed Windows spawn flake on an untouched file). Delta conformance verified against all four originals; the archive deletion safety boundary is exactly as designed; the tree-fingerprint change is internally consistent across all four sites; LEAD's Purpose repair (5.1) is accurate and the previously-failing normalization test now passes.

---

## Standards axis

No findings. The diff is small, idiomatic, and matches surrounding style.

- `fs.rm(path.dirname(update.target), { recursive: true, force: true })` uses the already-imported `promises as fs` in both `archive.ts` and `specs-apply.ts`; `force: true` correctly suppresses ENOENT. The deleted path is the capability directory (the unit a spec lives in), consistent with the design.
- `emptied` is threaded symmetrically through both callers' existing prepare→validate→write loops; validation remains a no-write pre-pass, so a late validation failure on a *different* spec still aborts before any `rm`. No partial-state risk.
- Comments state constraints the code can't show (why validation is skipped for emptied entries) — appropriate, not redundant.
- No SQL/concurrency/LLM-trust/enum-completeness concerns apply. No magic numbers.

## Spec axis

No findings. The diff faithfully implements `proposal.md` / `tasks.md`. All 5 task sections complete; the excluded `description: '|'` block-scalar bug was correctly left out (content decision, not mechanical). Delta conformance checked requirement-by-requirement against the four originals (see Priority 4).

---

## Findings by severity

### Blocker
(none)

### Major
(none)

### Minor
- **[Minor · optional, non-blocking] `test/core/archive.test.ts:582` — zero-req deletion test does not close the loop with an explicit `validate --strict`.** The new "should delete a spec whose requirements are all REMOVED" test asserts the spec dir and `spec.md` are gone, the deletion log fired, the archive did not abort on `min(1)`, and the change was archived. The `cli-archive` delta scenario additionally claims "`openspec validate --strict` SHALL pass afterward because the spec no longer exists rather than being left empty." The test proves the mechanism (dir gone → nothing to fail `min(1)`) but does not itself invoke `openspec validate --strict` against the post-archive integrated tree to prove that exact claim. Repo-wide `validate --all --strict` passes independently (93/93, see Gate Results), so the contract holds; this is a test-wording-fidelity nit, not a correctness gap. Optional: add a single `runCLI(['validate','--strict'])` assertion in the fixture if the team wants the test to mirror the scenario verbatim.

### Trivial
(none)

---

## Review priorities (as briefed)

### 1. archive deletion correctness / safety — PASS

`src/core/specs-apply.ts:313` computes `emptied = !isNewSpec && nameToBlock.size === 0`. `isNewSpec` is set `true` **only** in the `catch` of `fs.readFile(update.target)` (`specs-apply.ts:206-224`) — i.e. only when the target spec file did not exist. Confirmed consequence:

- **Emptied fires only for an existing spec fully emptied by REMOVED deltas.** An existing spec whose requirements are all REMOVED → `nameToBlock.size === 0` and `!isNewSpec` → `emptied = true`.
- **A new spec that ends empty still hits `min(1)`.** A delta whose only ops are REMOVEDs against a not-yet-existing spec: REMOVEDs are warned+ignored, a skeleton is built, `isNewSpec = true`, so `emptied = false`; the skeleton's empty Requirements section then goes through `validateSpecContent` and fails `requirements.min(1)`. Correct — creating an empty spec is never intended.
- **Partial removal keeps the spec.** Removing one of two requirements leaves `nameToBlock.size === 1` → `emptied = false` → normal write. Covered by the "partial-removal-keeps-spec" test (`archive.test.ts:642`+).

Both callers handle `emptied` symmetrically:
- **`archive.ts`** — validation loop skips emptied entries (`archive.ts:444` `if (p.emptied) continue;`); write loop does `fs.rm(path.dirname(p.update.target), { recursive, force })` + logs `Deleting spec '<capability>' — all requirements removed by this change.` (suppressed in JSON mode). `writeTotals` still accumulates `p.counts.removed` so the summary reports the removals.
- **`applySpecs` (`specs-apply.ts`)** — same skip in validation; write loop is a clean four-way branch (emptied×dryRun) that preserves the pre-existing non-emptied dry-run "Would apply…" display (`specs-apply.ts:494-500`). No display path was dropped in the restructuring.

Path correctness: `path.dirname(update.target)` where `update.target` is `<specs>/<cap>/spec.md` → removes `<specs>/<cap>/`, the capability directory. Matches design.

Tests (`test/core/archive.test.ts`, +112 lines): the zero-req test asserts both `spec.md` and the dir are gone via `fs.access(...).rejects.toThrow()`, asserts the deletion log, asserts no abort log, asserts the change archived. The partial-removal test asserts the surviving requirement remains, the removed one is gone, and no deletion log fired. Both green. (See the Minor above re: explicit `validate --strict`.)

### 2. tree-fingerprint fidelity — PASS

All four sites reference `HEAD^{tree}` consistently:
- `ship.ts` gate (Evidence-based test gate, ~line 87): "whose recorded content tree fingerprint (`git rev-parse HEAD^{tree}`) matches the current one… the commit in (b), which moves HEAD but changes no content, does not invalidate evidence; lint or review fixes change the tree and DO."
- `ship.ts` ship-log `Tree:` field (~line 129) + skip line "skipped — green at <evidence source>, tree <fingerprint>" (~line 139) + example (~line 187).
- `review-cycle.ts` (~line 51): "(HEAD + working-tree dirty or clean)" → "the content tree fingerprint (`git rev-parse HEAD^{tree}`)".
- `auto.ts` (~line 78): "(HEAD + dirty status)" → "the content tree fingerprint (`git rev-parse HEAD^{tree}`) of the git state".

Run-conditions intact: (1) base-merge new commits, (2) no green evidence with matching tree fingerprint, (3) user explicitly requests. The content-addressed tree hash correctly expresses the existing principle — a commit that moves HEAD without changing content leaves the tree hash unchanged, so evidence holds; content changes invalidate. Because a base merge that introduces new content changes the tree hash, condition (1) still fires when it should. `test/commands/review-cycle.test.ts` updated to assert `git rev-parse HEAD^{tree}` is present (green).

### 3. navigator blurb + parity — PASS

`navigator.ts:22` main-flow item 5 now reads: "resolve the delivery mode (pr / push / local), test only when evidence demands it, then deliver." — names all three modes, names evidence-gated testing, stays one line, does not inline resolution precedence / merge / ship-log fields. Accurate and terse.

Parity (`test/core/templates/skill-templates-parity.test.ts`): exactly two hashes changed — `getNavigatorSkillTemplate` (`c36d2b82…` → `10b7ff9c…`, line 93) and `openspec-navigator` (`1e2fcb40…` → `135684f7…`, line 127). No other hash moved. The parity test passes (6/6), confirming both recomputed values match the actual `navigator.ts` output. Ship/review-cycle/auto workflow templates are correctly absent from both maps (no spurious recompute).

### 4. delta conformance — PASS

Each MODIFIED requirement carries **all** scenarios of the original, with only the intended content changes — no silent scenario drops.

- **cli-archive › Spec Update Process** — original 3 scenarios (Applying delta changes, Validating delta changes, Conflict detection) all carried + 1 new (Zero-requirements spec deletion). Requirement body unchanged.
- **navigator-router-skill › Navigator maps OPSX…** — original 5 scenarios (Four-part map present, Reflects absorbed skills, No fork-absent grill skills, No removed parallel-lifecycle skills, No removed methodology skill) all carried + 1 new (Ship entry reflects the delivery modes). Body unchanged.
- **opsx-ship-command › Ship Execution** — all 7 original scenarios carried; only the "Evidence-based test gate" scenario's text changed to reference the tree fingerprint. Body unchanged.
- **opsx-ship-command › Ship Log** — both original scenarios carried; "Ship log written after delivery" adds the tree fingerprint to the recorded fields and the matched-fingerprint to the skip note. Body unchanged.
- **review-cycle-workflow › Gate-Run Test Evidence Is Recorded for Ship** — both original scenarios carried; both rewritten to specify the content tree fingerprint instead of HEAD + dirty. Body updated correspondingly.

**No `opsx-auto-command` delta needed — confirmed.** Its evidence scenario (`openspec/specs/opsx-auto-command/spec.md:82-83`) says only "the git code state it ran against SHALL be recorded in run-state" (generic). The `auto.ts` change records "the content tree fingerprint (`git rev-parse HEAD^{tree}`) of the git state" — a tree fingerprint is a git code state, so the generic scenario is satisfied without contradiction.

### 5. LEAD-inline Purpose repair (5.1) — PASS

`openspec/specs/expert-template-inlining/spec.md:4` — the skeleton `TBD - created by archiving change unify-expert-template-pipeline. Update Purpose after archive.` is replaced with a real single-sentence Purpose covering all five of the spec's requirements: inline TS template strings / no file-read getters / no committed generated `SKILL.md` (req 1), shared prose once in `_shared.ts` (req 2), byte-faithful migration (req 3), parity golden-master replaces the retired generator (req 4), build no longer invokes the generator (req 5). Single sentence, no skeleton markers, no `TBD`/placeholder. The deterministic failure it was causing — `test/specs/source-specs-normalization.test.ts` matching `/TBD - created by archiving change .*?\. Update Purpose after archive\./` — is now gone (test green).

### 6. Gate-run results (ship test evidence)

Git state at review time:
- **Branch:** `dev-harness`
- **HEAD:** `0ca96dc7b39611424ccd3d3c2407123a14616185` (`0ca96dc docs(openspec): document grill/gstack absorption into OpenSpec`)
- **HEAD^{tree}:** `5a1d585401ec6afc971294e9cc8969ef6cfcb9e4`
- **Working tree:** DIRTY — all 10 code/test/spec changes uncommitted; change dir untracked. (Verify stage; ship has not committed yet.)

> Note for the ship phase: the gate runs below executed against the **working-tree** (uncommitted) content. `HEAD^{tree}` above (`5a1d585`) is the *prior* commit's tree and does **not** yet include this change. Per the F2 design, the tree fingerprint that ship's gate compares must be re-recorded after the ship commit — "missing evidence means RUN", so ship will correctly run the gate fresh rather than skip on the stale pre-commit fingerprint.

| Gate | Command | Result |
|---|---|---|
| Build | `pnpm build` | **PASS** — "Build completed successfully", exit 0 |
| Targeted vitest (5 files) | `pnpm vitest run test/core/archive.test.ts test/core/templates/skill-templates-parity.test.ts test/core/validation.test.ts test/commands/review-cycle.test.ts test/specs/source-specs-normalization.test.ts` | **PASS** — 5 files, 90 tests, exit 0 (archive 27 incl. 2 new, parity 6, validation 36, review-cycle 20, normalization 1) |
| Validate (change) | `node ./bin/openspec.js validate close-fusion-followups --strict` | **PASS** — "Change 'close-fusion-followups' is valid", exit 0 |
| Validate (all) | `node ./bin/openspec.js validate --all --strict` | **PASS** — 93 passed, 0 failed, exit 0 |
| Full suite | `pnpm test` | **PASS (with 1 isolated flake)** — 2092 passed, 1 failed, 22 skipped; the 1 failure is `test/cli-e2e/basic.test.ts > validates the tmp-init fixture with --all --json` (10000ms timeout) |
| Flake isolation | `pnpm vitest run test/cli-e2e/basic.test.ts` | **PASS** — 16/16 green; the previously-timing-out test passed in 2254ms |

** Flake disposition:** `test/cli-e2e/basic.test.ts` is untouched by this change (it spawns the CLI binary in a temp fixture). The timeout is the documented Windows spawn/temp-dir flake class (memory: Windows test flakiness — `spec.test.ts` timeout / `artifact-workflow.test.ts` EBUSY). Isolated rerun is fully green, confirming non-logic, non-regression. The implementer's prior run was 2091 pass / 1 fail (the Purpose defect) / 22 skip; this run is 2092 pass / 1 fail (unrelated Windows flake) / 22 skip — the Purpose defect is fixed and the new failure is an unrelated untouched-file flake.

---

## Summary

- **Findings:** 0 Blocker, 0 Major, 1 Minor (optional, non-blocking), 0 Trivial.
- **Verdict: APPROVE.** The change is correct, safe (deletion boundary verified at the `isNewSpec` source), horizontally consistent (tree fingerprint at all four sites), delta-conformant (no scenario drops), and all gates are green modulo a confirmed unrelated Windows flake. The single Minor is an optional test-wording-fidelity improvement, not a ship blocker.
