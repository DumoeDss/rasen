# Tasks: fix-store-retention-scope-resolution

## 1. Baseline and failing pins

- [x] 1.1 Sweep existing suites for assertions on the three refusal behaviors (root-config `project-binding` conflict, `not in the selected Store's v2 catalog`, `not planning-bound`) and record which expectations update vs. survive
- [x] 1.2 Write failing real-git end-to-end tests for the three reproduced 2026-08-26 scenarios (planning-worktree seat; store-main seat with `--project`; registry local_path vs linked worktree), each with its own timeout and Windows-safe exec

## 2. D1 — Store-checkout root config contributes no projectId fact

- [x] 2.1 In `src/core/store-planning/internal/resolver.ts` fact assembly, suppress the `project-binding` candidate's projectId when the config root carries Store metadata; keep standalone-project admission unchanged
- [x] 2.2 Fixture tests: store-checkout root config excluded from fact merge; standalone config still admitted; marker-vs-marker conflict still refuses

## 3. D2 — Registered-store worktree equivalence

- [x] 3.1 Add a substitutable git repository-identity probe (resolved common dir) to the store-planning dependencies seam
- [x] 3.2 Extend `findRegisteredStoreAtRoot` / `isRegisteredStoreRootPath` (`src/core/store/identity.ts`) with a path-miss fallback matching by repository identity; uid disagreement refuses; probe failure degrades to no match
- [x] 3.3 Real-git tests: linked worktree resolves to the registered entry; uid mismatch refuses; probe-unavailable leaves matching unchanged

## 4. D3 — Planning-bound gate

- [x] 4.1 Implement the gate's recorded-pair satisfier: index entry + planning-worktree marker + execution association agreeing on store/project/target-line, read via `src/core/store/workspace/registry.ts`
- [x] 4.2 Rewrite the `not planning-bound` refusal to name the exact repair command
- [x] 4.3 Tests for all four gate scenarios (pair-satisfies, catalog-satisfies, neither-refuses-with-repair, inconsistent-refuses-as-conflict)

## 5. Verification

- [x] 5.1 Store-planning, store-aggregate, store-issue, and workspace suites green with updated expectations from 1.1
- [x] 5.2 New e2e suites pass inside a binned full run alongside heavyweight neighbors (Windows)
- [x] 5.3 Re-run the three live repro invocations with the built CLI: each resolves (or fails only on a named, actionable selector requirement)

## 6. Dogfood pilot and delivery

- [ ] 6.1 `pnpm build`, reinstall the dogfood CLI (global dev-local or tarball harness), confirm `rasen --version` carries the new stamp
- [ ] 6.2 Operator-gated pilot: archive `document-multi-project-issues` through the `dmpi` pair with the official finalization engine (store-side merge, planning branch merge, worktree cleanup per protocol)
- [ ] 6.3 Record the corrected elftia outcome: both `document-skills-xlsx-*` Changes were ALREADY archived on 2026-08-25 (`outcome: landed`, schemaVersion 2, spec sync applied, code merge recorded) via the owner-waiver route — the waiver covered only the retention step, and the official finalization engine did the archiving. Nothing to re-archive. What this fix removes is the need for that waiver on the NEXT such delivery; verify a post-fix `retain prepare` succeeds from a real pair rather than claiming a retroactive repair

### Verification notes (2026-08-26)

- 5.1 evidence: store-planning + finalize-scope + the new e2e suite + identity = **121/121 green**.
- 5.2 run under the LEAD's restated criterion: nine files in one invocation, **8 passed / 1 failed, 208/215 tests, 394.94s**. The new real-git e2e suite held its own timeouts alongside `store-aggregate-query` (~315s), `store-query-lock-free`, `store-issue-scope` and `root-selection`, with no fixture collision or ordering dependence. The single failing file, `archive-consumer-integration`, is EXCLUDED on a **pristine-HEAD measurement**: with ALL of `src/` stashed (0 modified files, markers verified absent) that file still returned `Test Files 1 failed (1) | Tests 6 failed | 1 passed (7)`. It fails on committed dev/0.2.0 with a clean working tree, so it is attributable to no one's change. It is a real-CLI suite with seven tests, no explicit timeouts (30s global default), one observed failure at exactly 30013ms; under three-agent load with ~1332 leftover `rasen-*` temp fixtures it is a coin flip, and an early green during this run was the anomaly rather than the failures. Sibling-owned suites (`workspace-*`, `layout-migration-*`) were excluded by LEAD decision — they carry in-flight sibling work, so a failure there is unattributable to this change.
- The TRUE full 693-file run is DEFERRED to ship time on a quiet tree and is an OPEN OBLIGATION, not waived. It is not achievable while three agents share this tree: `build.js` `rm -rf`s the shared `dist/` before compiling (a sibling rebuild at 14:26:11 corrupted a run started 13:40:59), ~1272 leftover `rasen-*` temp fixtures drive EPERM/EBUSY, and 12+ real-CLI suites run on the 30s global default.
- 5.3 re-run against a dist rebuilt at 16:42:07 immediately beforehand (post-dating a full-`src/` stash/restore cycle; deliverable verified byte-identical afterwards). All three seats now fail only on named, actionable requirements; scope resolution itself succeeds in every seat.

## 7. Review fixes (round 1, independent fixer)

- [x] 7.1 A-1: stop `resolveStoreBinding` dropping `repositoryIdentityCache` when it builds `pathOptions` (`src/core/store/identity.ts`), so a caller-supplied per-invocation cache actually reaches the probe; pin it with a test that resolves three times through `resolveStoreBinding` and asserts one probe per distinct path
- [x] 7.2 A-1: correct design.md's D2 risk line, which claimed the probe is "cached per invocation" — the cache is opt-in and caller-owned, and no production caller constructs one yet; the multi-root callers that would pay for it (`doctor.ts`, `spaces.ts`, `learned-skills/context.ts`) stay a separate change
- [x] 7.3 A-2: DECIDED the delta was wrong, not the code — the disagreement refusal is a WITHIN-pair rule, as D3 already words it ("the index entry, marker, and association agree"; "naming both sources"). Narrowed the delta requirement and the "Inconsistent pair evidence refuses" scenario accordingly, and added "A torn sibling pair does not veto an agreeing pair"; spelled the cross-pair rule out in D3 and in the pair-evidence risk line
- [x] 7.4 A-2: made the rule legible in `assertProjectPlanningBound` (`agreed` flag + `if (agreed) return;` instead of an early `return` buried in the loop) — no behaviour change — and covered the untested NORMAL multi-pair shape: agreeing + torn sibling admits in BOTH enumeration orders; a torn pair alone refuses through the gate (asserting the gate's own diagnostic code and the sibling root, which the fact merge cannot name); two torn pairs enumerate both

### Verification notes (round 1 fixes, 2026-08-26)

- 7.1 red-before: `evidence/fixer-1/a1-red-before.txt` — `1 failed | 51 passed`, `expected [ …(6) ] to deeply equal [ …(2) ]` (six spawns instead of two: the dropped cache). Green-after: `evidence/fixer-1/a1-green-after.txt` — `52 passed`, EXIT=0.
- 7.4 is a CHARACTERIZATION pin, not a red-before guard, and honestly so: the code already implemented the semantics judged correct, so the new tests pass against the shipped loop (`evidence/fixer-1/a2-01-against-shipped-code.txt`, 7 passed). Their discriminating power is proved by MUTATION instead: implementing the rejected option (a) — refuse whenever any sibling pair disagrees — turns exactly the multi-pair admission test red (`evidence/fixer-1/a2-03-mutation-option-a-red.txt`, `1 failed | 50 passed`), with the two torn-pair refusal tests still green because they do not depend on which option is chosen. Both mutation landing sites were grep-counted unique before flipping; the file was restored byte-identical afterwards (sha256 `72801580b64697a6be4b56b6bf938639053e4459501b6c92a29065572e406182`) and re-run green (`evidence/fixer-1/a2-04-after-revert-green.txt`, 51 passed). Full receipt with both landing sites, both file hashes and the reverted comparison: `evidence/fixer-1/mutation-proof-a2.txt`.
- Post-fix re-run of the four owned suites in ONE invocation (`store-planning`, `finalize-scope`, `store-scope-resolution-e2e`, `store/identity`): **4 files / 125 tests passed, EXIT=0, 75.96s** — `evidence/fixer-1/post-fix-store-suites.txt`. `pnpm exec tsc --noEmit` EXIT=0 and `eslint` on the four touched files EXIT=0 (`evidence/fixer-1/tsc-noemit.txt`, `evidence/fixer-1/eslint.txt`).
- `rasen validate fix-store-retention-scope-resolution` and `--strict` both report valid, EXIT=0 (`evidence/fixer-1/rasen-validate.txt`, `rasen-validate-strict.txt`).
- The e2e suite's single-pair `refuses when the recorded pair sources disagree on the project` still matches the narrowed scenario (no pair agrees there), so it needed no edit. Reviewer finding A-6 (that test accepting either diagnostic code) is untouched and still open; the new fixture-level gate test does pin `planning_selection_conflict` exactly.
