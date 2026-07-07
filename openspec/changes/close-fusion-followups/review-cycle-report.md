# Review-Cycle Report: close-fusion-followups

**Change:** close-fusion-followups
**Tier:** A (multi-agent; distinct reviewer/fixer workers)
**Reviewer (non-author):** reviewer-followups
**Fixer (round 1):** LEAD-inline
**Date:** 2026-07-07

## Round history

| Round | Findings (severity) | Triage | Fixer | Non-author confirmer | Disposition |
|---|---|---|---|---|---|
| 1 | 0 Blocker, 0 Major, 1 Minor (optional), 0 Trivial | Minor-1: zero-req archive test asserts dir deleted + no abort, but does not itself invoke strict validate to mirror the delta scenario's "validate --strict SHALL pass afterward" wording | LEAD-inline (added a per-spec `new Validator(true).validateSpec` + `expect(report.valid).toBe(true)` loop over the post-archive specs root) | reviewer-followups (warm resume) | **Resolved** — fix confirmed correct, faithful, non-overreaching; test 27/27 green |

### Round 1 detail

**Finding M1 (Minor, optional)** — `test/core/archive.test.ts`, zero-req-deletion test. The test proved the spec directory and `spec.md` are deleted, the deletion log fired, the archive did not abort on `min(1)`, and the change archived. It did not close the loop with an explicit strict validation of the post-archive main-specs tree that the `cli-archive` delta scenario claims ("`openspec validate --strict` SHALL pass afterward because the spec no longer exists rather than being left empty"). Mechanism was already sound (dir gone → nothing to fail `min(1)`) and repo-wide `validate --all --strict` passed independently; this was a test-wording-fidelity gap, not a correctness gap.

**Fix applied by LEAD-inline** (`test/core/archive.test.ts`, +11 lines). The zero-req-deletion test gained:

```ts
// The post-archive main-specs tree validates strictly — mirrors the delta's
// "validate --strict SHALL pass afterward": no emptied spec is left to fail min(1).
const strictValidator = new Validator(true);
const specsRoot = path.join(tempDir, 'openspec', 'specs');
for (const entry of await fs.readdir(specsRoot)) {
  const specFile = path.join(specsRoot, entry, 'spec.md');
  try { await fs.access(specFile); } catch { continue; }
  const report = await strictValidator.validateSpec(specFile);
  expect(report.valid).toBe(true);
}
```

**Non-author confirmation (reviewer-followups):**

- **(a) Faithful strict mirror.** `src/commands/validate.ts:276` and `:345` wire `--strict` to `new Validator(opts.strict)`. `src/core/validation/validator.ts:443-445` defines `valid = errors === 0 && warnings === 0` under `strictMode`. So `new Validator(true).validateSpec(file)` + `expect(report.valid).toBe(true)` is exactly what `openspec validate --strict` evaluates per spec (zero ERRORs AND zero WARNINGs). Bulk `validate --all --strict` over the specs scope is this same per-spec strict check aggregated, so the loop faithfully mirrors the relevant scope.
- **(b) Right root; deleted spec skipped.** `specsRoot = tempDir/openspec/specs` (the fixture's main specs root, created empty in `beforeEach` at `archive.test.ts:35`). The archive flow removed theta's directory entirely, so `theta` never appears in `fs.readdir(specsRoot)`, and the `fs.access` guard skips any entry lacking `spec.md`. The deleted spec is not validated — correct.
- **(c) No overreach.** The assertion validates only the post-archive main-specs tree, strictly, per spec — the precise scope of the delta scenario. It does not touch production code, validate changes, or assert beyond the contract. It also functions as a real regression guard: if the deletion path regressed to leaving an empty `theta/spec.md`, the loop would list `theta`, `validateSpec` would trip Zod `requirements.min(1)` → ERROR → `report.valid = false`, and the assertion would fail.

**Re-run (independent, by confirmer):** `pnpm vitest run test/core/archive.test.ts` → 27/27 green, exit 0.

## Final disposition: CLEAN

Round 1 terminated clean: zero unresolved Blocker or Major findings; the single Minor (optional test-fidelity) was fixed inline and confirmed by the non-author reviewer. The change is clear to ship.

## Final test evidence (final clean round)

Git state at confirmation:
- **Branch:** `dev-harness`
- **HEAD:** `0ca96dc7b39611424ccd3d3c2407123a14616185` (`0ca96dc docs(openspec): document grill/gstack absorption into OpenSpec`)
- **Content tree fingerprint (`git rev-parse HEAD^{tree}`):** `5a1d585401ec6afc971294e9cc8969ef6cfcb9e4`
- **Working tree:** DIRTY — all 10 code/test/spec changes uncommitted; change dir untracked. Verify stage; the ship phase has not committed yet.

> **PRE-COMMIT TREE — ship evidence-gate note.** The fingerprint recorded above (`5a1d585`) is the tree of the *prior* commit (`0ca96dc`). It does **not** include this change's content, which is still uncommitted in the working tree. The gate commands below ran against that uncommitted working-tree content. When the ship phase commits this change, the new commit's `HEAD^{tree}` will differ from `5a1d585`. Per the F2 evidence-based test gate this change itself introduces, ship compares the recorded fingerprint against the current one; a mismatch means "no green evidence exists for the current code state" → **RUN** (not skip). So the ship gate will correctly re-run the suite fresh after the commit rather than skip on the stale pre-commit fingerprint. "Missing evidence means RUN — the gate skips on proof, never on hope." This is the safe direction.

Gate commands and results (final clean round):

| Gate | Command | Result |
|---|---|---|
| Build | `pnpm build` | PASS — "Build completed successfully", exit 0 |
| Targeted vitest (5 files) | `pnpm vitest run test/core/archive.test.ts test/core/templates/skill-templates-parity.test.ts test/core/validation.test.ts test/commands/review-cycle.test.ts test/specs/source-specs-normalization.test.ts` | PASS — 5 files, 90 tests, exit 0 |
| Validate (change) | `node ./bin/openspec.js validate close-fusion-followups --strict` | PASS — "Change 'close-fusion-followups' is valid", exit 0 |
| Validate (all) | `node ./bin/openspec.js validate --all --strict` | PASS — 93 passed, 0 failed, exit 0 |
| Full suite | `pnpm test` | PASS (1 isolated flake) — 2092 passed, 1 failed, 22 skipped |
| Flake isolation | `pnpm vitest run test/cli-e2e/basic.test.ts` | PASS — 16/16 green (the timed-out test passed in 2254ms) |
| Round-1 fix re-run (confirmer) | `pnpm vitest run test/core/archive.test.ts` | PASS — 27/27 green, exit 0 |

**Flake disposition (full suite):** the single failure was `test/cli-e2e/basic.test.ts > validates the tmp-init fixture with --all --json` (10000ms timeout), an e2e file untouched by this change that spawns the CLI binary in a temp fixture. Isolated rerun was 16/16 green. This is the documented Windows spawn/temp-dir flake class (memory: Windows test flakiness — `spec.test.ts` timeout / `artifact-workflow.test.ts` EBUSY), non-logic, non-regression.
