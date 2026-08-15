# Review report — store-planning-contract-v2

- Reviewer: dispatched leaf reviewer (`rasen-review`, report-only mode). Author != verifier: I did not write this code and applied no fixes.
- Target: commit `eaefc01b` on `feat/store-v2-foundation` (25 files, +3858/-99), diffed against `eea78de8`.
- Behavior reference: `origin/dev/0.1.7` @ `a3f49007` (read-only).
- All source inspection is against COMMITTED bytes (`git show eaefc01b:<path>`); the working tree was verified byte-identical to the commit for `src/` and `test/` before and after every mutation (sha256 recorded below).

## Summary

| Severity | Count |
| --- | --- |
| Blocker | 0 |
| Major | 4 |
| Minor | 5 |
| Trivial | 2 |

The port itself is faithful and high quality. The complete delta of the five Layer-0 modules against
the 0.1.7 tip is exactly (a) the S3 subtractions design Decision 2 mandates, (b) one cosmetic regex
respelling, and (c) one behavior tightening beyond the reference. `tsc --noEmit`, `pnpm run lint`,
`pnpm run build`, and `rasen validate --strict` are all clean when re-run independently, and my own
full re-run of the task 6.4 baseline set is **110 files / 1438 passed / 1 skipped — zero failures**.

Every Major below is a **verification** defect, not a behavior defect: three of the design's own
"later fixes" ship with tests that provably cannot tell fixed from unfixed, and a fourth claim rests
on a failure the implementer never read. No wrong behavior was found in the shipped contract.

## Scope check

```
Scope Check: CLEAN
Intent:    Port 0.1.7's Layer-0 pure planning contract (a7135669 + own later fixes, minus S3's
           additions) onto 0.2.0, changing nothing observable.
Delivered: Exactly that. 7 new src modules + 6 new test suites + additive schema/export edits.
```

- No dependency change: `git diff eea78de8 eaefc01b -- package.json pnpm-lock.yaml` is empty.
- No command, CLI, management-API, UI, `archive-engine.ts`, or mutation-path file in the diff.
- The extra `export * from './change-metadata/index.js'` in `src/core/index.ts` is not scope creep:
  task 5.1 pre-authorized it ("the latter also gains the `change-metadata` export") and the tasks.md
  diff in this commit is checkbox-flips ONLY — no task text was edited to match the implementation.

## Standards axis

Clean. `pnpm exec tsc --noEmit` exit 0; `pnpm run lint` (eslint over `src/ test/ vitest.config.ts
vitest.setup.ts`) produced no output and exit 0; `pnpm run build` exit 0. No checklist-category
findings (no SQL/data-safety, concurrency, LLM-trust-boundary, or enum-completeness issue applies to
a pure contract layer). Style matches the surrounding `src/core/store/` code.

## Spec axis

Three ADDED spec scenarios have implementations but no test that can distinguish the implementation
from its absence (M1, M2, M3 below). One requirement's entry point has no direct test at all (m4).
No requirement was found with no implementation, and no behavior was found in the diff that the
specs did not ask for.

---

## Major

### M1 — Design Decision 5's drive-less Windows root rule has zero discriminating coverage

`src/core/store/planning-layout-v2.ts:93` (the `return path.win32.parse(storeRoot).root.length > 1;`
clause inside `isAbsoluteStoreRoot`, lines 80-94).

Mutation proof (run by me, against committed bytes):

```
mutate: line 93 -> `return true; // MUTATION: drive requirement removed`
run:    pnpm exec vitest run test/core/store/planning-{validation-v2,layout-v2,identity-v2}.test.ts \
                             test/core/store/finalization-v2.test.ts \
                             test/core/store/planning-foundation-{consumer,purity}.test.ts
result: Test Files 6 passed (6) | Tests 174 passed (174)   <-- fully GREEN with the fix removed
restore: cp of the pristine copy; sha256 40ecab21674080d48881699b099df60b0fc507cce4f06666316c92a3be26ec66 (matches `git show eaefc01b:...`)
```

Cause: no test ever supplies a drive-less root under Windows semantics. Every `storeRoot` fixture in
`test/core/store/planning-layout-v2.test.ts` is `C:\stores\example` / `C:\Stores\Example` (win32 or
native), `/store` / `/stores/example` with `flavor: 'posix'`, or the string `'relative'` (lines 295,
305, 322, 367, 376, 392, 412, 420, 439). The one combination that exercises the rule —
`storeRoot: '/store'` with `flavor: 'win32'` — never appears.

This is the headline of design Decision 5, the product rule stated in
`specs/store-planning-layout-v2/spec.md:182-186` ("Drive-less Windows root is refused"), and an
explicit item of task 2.7 ("relative **and drive-less** roots refused"). Task 2.7 is checked `[x]`.

Fix: add both `computeStorePlanningLayoutV2({...base, storeRoot: '/store', flavor: 'win32'})` and
`resolveStorePlanningLayoutV2Path('/store', {kind: 'store-metadata'}, 'win32')` cases asserting
`StorePlanningValidationError` with `code: 'invalid_store_layout_v2'`, plus a UNC/device-root
positive case.

### M2 — Design Decision 6's display-name fix has zero discriminating coverage

`src/core/store/planning-catalogs.ts:78` (`id: z.string().min(1).optional(),`).

Mutation proof — I restored the exact 0.1.7 defect Decision 6 says this child fixes (validating the
human display name as an identifier):

```
mutate: line 78 -> `id: z.string().min(1).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/u).optional(),`
run:    pnpm exec vitest run test/core/store/planning-layout-v2.test.ts \
                             test/core/store/planning-validation-v2.test.ts \
                             test/core/store/planning-foundation-consumer.test.ts
result: Test Files 3 passed (3) | Tests 92 passed (92)     <-- fully GREEN with the defect restored
restore: sha256 14774dedb0a3f7adaa317e5ce55302fa9cd7daba39d4870a2fdecc0d6ce85ca5 (matches commit)
```

Cause: the only project-catalog `id:` fixture is `id: example-project`
(`test/core/store/planning-layout-v2.test.ts:85`), which is itself a valid kebab id and therefore
passes both the fixed and the defective rule. The strings the spec and the tasks name explicitly —
`Elftia` and `my app` — appear nowhere under `test/`.

Spec: `specs/store-planning-layout-v2/spec.md:123-127` ("A project's display name is carried, never
validated as an identifier ... such as `Elftia` or `my app`"). Tasks 2.2 and 2.7 both name those two
values. Both are checked `[x]`.

Fix: parse a v2 project catalog carrying `id: Elftia` and one carrying `id: my app`, assert both are
valid and that `catalog.id` is carried through unchanged (and survives serialize/parse).

### M3 — Design Decision 7's nested capability address has zero discriminating coverage

`src/core/store/finalization-v2.ts:198-217` (`CapabilityPathSchema`).

Mutation proof — I restored the 0.1.7 defect (single-kebab capability id):

```
mutate: CapabilityPathSchema -> z.string().refine(v => /^[a-z0-9]+(-[a-z0-9]+)*$/u.test(v), ...)
run:    pnpm exec vitest run test/core/store/finalization-v2.test.ts
result: Test Files 1 passed (1) | Tests 41 passed (41)     <-- fully GREEN with the defect restored

seam liveness control (so the GREEN above is a coverage gap, not a dead seam):
mutate: CapabilityPathSchema -> z.string().refine(() => false, ...)
result: Tests 3 failed | 38 passed (41)                    <-- seam IS wired to the tests
restore: sha256 63346fa9ed0a10a9194b07be7b83f3e77f22497f1d9bfe5c436b27a1a497354e (matches commit)
```

Cause: every `capabilityId` fixture in `test/core/store/finalization-v2.test.ts` is the
single-segment `'auth'` (lines 249, 262, 263, 264, 272, 273, 274, 275). No slash-delimited address
is asserted anywhere.

Spec: `specs/change-finalization-record-v2/spec.md:98-101` ("Nested capability address is
accepted"). Task 4.6 names "nested capability addresses accepted" and is checked `[x]`.

Fix: accept `capabilityId: 'store/planning-layout-v2'` in a landed spec action and assert the
address is preserved verbatim; also assert `''`, `'.'`, `'..'`, `'a//b'`, and `'a\\b'` are rejected.

### M4 — The flake classification is unsupported, and its own evidence says half the failure was never read

`rasen/changes/store-planning-contract-v2/evidence/task-6-4-baseline-flake-analysis.md`.

The file records `Tests 2 failed`, then states the capture "only rendered 1 of the 2 FAIL blocks",
then concludes "pre-existing test-isolation flake ... not a regression". The conclusion is drawn
from one of two failures; the unread one is the more likely causal one.

Reading the failing path supports that: the rendered assertion is
`test/cli-e2e/store-lifecycle.test.ts:454`, in the machine-B scenario whose own change is
`add-invoicing` — but the observed stderr lists `add-billing` as an available change. `add-billing`
is **machine A's** change, archived at `store-lifecycle.test.ts:325-331`, and machine B clones the
store only afterwards (lines 349-353). So the observed state is what you would see if machine A's
archive step had itself failed first and cascaded — i.e. the unread second failure. The diff-scope
argument in the evidence ("the failing path is `workflow/shared.ts`/`status.ts`, outside the diff")
addresses the symptom's print site, not that causal chain, and the diff does touch `src/core/index.ts`,
a barrel on the package's public surface.

Independent evidence I produced, on the same commit and the same command:

```
pnpm exec vitest run test/core/store test/core/change-run test/commands/store.test.ts \
                     test/commands/store-root-selection.test.ts test/cli-e2e/store-lifecycle.test.ts
Test Files  110 passed (110)
     Tests  1438 passed | 1 skipped (1439)     duration 345.72s
```

Zero failures, including `store-lifecycle.test.ts`. Note 1438 = the implementer's 1436 passed + 2
failed, so the same test set ran. Combined with the LEAD's GREEN pre-change baseline of the same
file, the failure is **non-deterministic and did not reproduce**, but its cause is NOT established
and "pre-existing" is asserted rather than shown.

Fix: restate the evidence as "transient, did not reproduce, cause not established" (citing this
review's green re-run), or reproduce with `--reporter=verbose --no-color` redirected to a file and
enumerate BOTH failures before classifying. Do not ship a causal claim built on an unread failure.

---

## Minor

### m1 — The purity guard does not see dynamic imports

`test/core/store/planning-foundation-purity.test.ts:54-61`. `importSpecifiers()` matches
`/\bimport\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/gu`, which requires whitespace after
`import`, so `import('...')` is never collected; and `FORBIDDEN_PATTERNS` only names fs / child_process
/ os / execSync / spawn / process.cwd / process.env / registry, so an impure sibling slips through both.

Mutation proof: adding
`export async function reviewProbe() { const m = await import('./foundation.js'); return m; }`
to `finalization-v2.ts` leaves the guard at **15/15 GREEN** — and `src/core/store/foundation.ts`
imports `node:fs`, `FileSystemUtils`, and `getGlobalDataDir`.

Fix: collect dynamic-import specifiers too (add an `import\s*\(\s*['"]([^'"]+)['"]` pass) and run
them through the same allowlist.

### m2 — The guard does not enforce the transitive soundness design Decision 9 claims

Decision 9 argues the allowlist is "transitively sound: `id.ts` has no imports, `zod-issues.ts`
imports only a zod type, `identity-types.ts` imports only `node:crypto`, `remote.ts` imports only
`./errors.js` — each verified in this worktree." That verification is point-in-time and is not
encoded anywhere.

Mutation proof: adding `import * as fs from 'node:fs';` as line 1 of `src/core/id.ts` leaves
`planning-foundation-purity.test.ts` at **15/15 GREEN**, while the Layer-0 purity claim is now false.

Fix: extend `LAYER_0_MODULES` to a transitive closure (or add a second `it.each` over the five
allowlisted dependency files asserting their own imports stay within a dependency allowlist).

### m3 — The disambiguating re-export silently changes a published package-root type's meaning

`src/core/index.ts:42` (`export type { ChangeInstanceId } from './store/planning-identity.js';`).

The implementer's claim is TRUE as stated and I verified it: the only importer of `./core/index.js`
anywhere in `src/`, `test/`, or `packages/` is `src/index.ts:16` (`export *`), and no file imports
the bare `ChangeInstanceId` from either barrel. `change-run/index.ts` uses an explicit export list,
`deriveChangeInstanceId` is not in it (`src/commands/pipeline.ts:121` imports it from
`../core/change-run/internal/identity.js`), so no value-level collision exists either.

But `src/index.ts` IS the package's public entry (`package.json` `exports["."].types` ->
`dist/index.d.ts`), and it does `export * from './core/index.js'`. So
`import type { ChangeInstanceId } from '@atelierai/rasen'` resolved to change-run's brand before this
commit and resolves to the Store-planning brand after. The proposal's "no caller changes" /
"zero observable behavior change" claims are scoped to in-repo callers only.

Mitigating fact the barrel comment does not state (and which I did verify): the two are mutually
incompatible brands (`Brand<string,'ChangeInstanceId'>` vs `string & {[changeInstanceIdBrand]: true}`),
so a future importer that binds the wrong one gets a compile error, not a silent mis-bind; and a
future value-level collision would be a hard TS2308. The mechanism degrades loudly.

Fix (cheap, removes the ambiguity for future importers entirely): re-export under a distinct name,
e.g. `export type { ChangeInstanceId as StorePlanningChangeInstanceId } from './store/planning-identity.js';`
and leave the bare name unexported from the barrel, so neither meaning silently owns it.

### m4 — `resolveStorePlanningLayoutV2Path` is never called directly by any test

`git grep -n resolveStorePlanningLayoutV2Path -- test/` returns nothing. All coverage is indirect via
`computeStorePlanningLayoutV2`, which requires a full input record (including a
`VerifiedChangeInstanceId` and an `archiveDate`) even for a single address. The per-address entry
point S2/S3 will actually call therefore has no direct coverage of its `storeRoot.length === 0`
guard (`planning-layout-v2.ts:149`) or of its per-`kind` error `field` values.

### m5 — Task 6.5's "Record the run reference" is not satisfied

`evidence/task-6-5-windows-ci-verification.md` reasons correctly from `.github/workflows/ci.yml` and
`vitest.config.ts` (no include/exclude filter, so the six new suites are auto-discovered on all legs)
and from a local win32 run, but records no CI run id or URL. The one genuinely native assertion,
`it.runIf(process.platform === 'win32')` at `planning-layout-v2.test.ts:290`, skips on the Linux and
macOS legs by design, so the Windows leg's actual green remains unobserved. Honest reasoning, but the
task asked for a run reference.

---

## Trivial

### t1 — Undocumented cosmetic divergence from the frozen reference

Four sites respell the control-character class `/[\u0000-\u001f\u007f]/u` as `/[\x00-\x1f\x7f]/u`:
`planning-validation.ts:74`, `planning-identity.ts:41`, `planning-catalogs.ts:151`,
`finalization-v2.ts:87`. Semantically identical under the `u` flag. It is the only non-S3, non-fix
delta against `origin/dev/0.1.7` in the whole port, and it makes future byte-diffing against the
frozen reference noisier for no gain.

### t2 — `computeStorePlanningLayoutV2` was tightened beyond the reference without a record

Reference `origin/dev/0.1.7:src/core/store/planning-layout-v2.ts:302` still guards
`computeStorePlanningLayoutV2` with the weaker `api.isAbsolute(input.storeRoot)`; only
`resolveStorePlanningLayoutV2Path` got `isAbsoluteStoreRoot` in commit `1fa114d4`. This child applies
`isAbsoluteStoreRoot` to BOTH (`planning-layout-v2.ts:255`), closing a residual hole of the same
defect. That is an improvement, but design Decision 5 says only "this child ports the fixed
behavior", so a reader diffing against the reference finds an unexplained delta. Worth one sentence
in Decision 5 — and it is the very code path M1 leaves untested.

---

## Pressure-test verdicts

**1. `src/core/index.ts` disambiguating re-export — claim VERIFIED, resolution SOUND, one gap (m3).**
Nothing in `src/`, `test/`, or `packages/` imports the bare `ChangeInstanceId` from the top-level
barrel; the only barrel importer is `src/index.ts:16`. `change-run/index.ts` is an explicit export
list, so no value-level collision exists. For future importers the mechanism degrades LOUDLY, not
silently: incompatible brands make a wrong binding a compile error, and any new value-level clash is
a hard TS2308. The gap is that the package's published `ChangeInstanceId` silently changed meaning
(m3), with an easy rename fix.

**2. `.strict()` + `quality` passthrough — CORRECT, calibrated to the real writer, verified on real data.**
I read all 336 `.openspec.yaml` files under both planning roots through the built
`ChangeMetadataSchema`, and read a real archived record through the real `readChangeMetadata`:

```
CORPUS: 336 files | SCHEMA OK: 334 | WITH quality: 33
quality key shapes: [files,metrics] x20   [files,metrics,rulesExtracted] x13
REAL READER on rasen/changes/archive/2026-07-06-add-context-handoff: OK
  quality preserved: files, metrics, rulesExtracted (rulesExtracted = 0)
STRICT still catches a typo field: true  -> Unrecognized key: "creaetd"
quality.<unknown> accepted (passthrough): true, preserved verbatim
quality shapes rejected: missing files / missing metrics / metrics:string / metrics:null / null / files:[number]
```

The 2 non-OK files are **pre-existing, not caused by this change**:
`rasen/changes/archive/2026-07-07-ship-delivery-modes/.openspec.yaml` and
`.../2026-07-07-unify-expert-template-pipeline/.openspec.yaml` contain ONLY a `quality:` block with
no `schema:` field, and `schema` was already required by the PRE-change schema
(`git show eea78de8:src/core/change-metadata/schema.ts` — `schema: z.string().min(1)`). So the
commit's "rejects none newly" is accurate. The passthrough is neither too narrow (required
`files`/`metrics` exactly match `archive-engine.ts:2892`'s `{ files: [], metrics: {} }` initializer,
and the engine only writes when `files.length > 0`) nor too wide (`.strict()` still rejects unknown
top-level keys; only the engine-owned `quality` sub-object is loose, which is the stated intent).
`writeChangeMetadata` writes `parseResult.data`, so `quality` round-trips. Blast radius of the
throw-on-strict-failure is contained: only 2 call sites, both per-change, neither in a listing loop.

**3. Purity guard — DISCRIMINATES on the classes that matter; two escape vectors (m1, m2).**
I re-ran the mutation battery myself against committed bytes, not the recorded proof. RED and
correctly file-named on all five classes tested: `process.env`, `process.cwd`, `node:child_process`
import (2 failures: allowlist + forbidden pattern), Store registry import, and `node:fs`. The
recorded evidence's pristine hash `5627d7c5...` matches `git show eaefc01b:planning-validation.ts`.
Two vectors escape: dynamic `import()` of an impure sibling (m1) and a forbidden import added to an
allowlisted transitive dependency (m2) — both mutation-proven GREEN. `process.platform` is read at
`planning-layout-v2.ts:90` and is deliberately NOT forbidden; that is correct, since the `native`
flavor is host-dependent by design and the spec's purity list does not include it.

**4. Port-target correctness — CLEAN in both directions.**
S3-owned surfaces are absent: `git grep -E 'IssueId|ExecutionPlanRevision|invalid_issue_record|invalid_execution_plan|parseIssueId|EXECUTION_PLAN_REVISION|issue-record|execution-plans' eaefc01b -- src test`
returns nothing. This is proven, not inferred from line counts: the complete diff of all five modules
against the 0.1.7 tip is exactly the S3 removals (validation -93, layout -47) plus t1 and t2. The
converse also holds — nothing S1's own contract needs was removed: `tsc --noEmit` is clean, all six
suites pass, and I found no spec requirement in the three delta specs without an implementation.
(Three requirements have an implementation but no discriminating test: M1, M2, M3.)

**5. The claimed flake — UNPROVEN as classified, but did not reproduce.**
My independent full re-run of the exact task 6.4 command on the same commit is 110 files / 1438
passed / 1 skipped, zero failures. That is evidence the failure is transient, not that it is
"pre-existing" — and the evidence file's own reasoning is built on one of two failures, with the
unread one being the more likely cause (see M4). The classification should be corrected; no code fix
appears warranted.

---

## Test coverage (Layer-0 boundary)

```
CONTRACT-RULE COVERAGE (mutation-verified)
==========================================
[+] planning-validation.ts
    +-- portable segment rules / brands   [***  TESTED] planning-validation-v2.test.ts (43 tests)
    +-- WINDOWS_RESERVED_DEVICE_NAMES     [**   TESTED] planning-validation-v2.test.ts:69
[+] planning-catalogs.ts
    +-- strict v2 project catalog         [***  TESTED] planning-layout-v2.test.ts:82-220
    +-- Decision 6: id = display name     [GAP]  M2 — defect restored, 92/92 still GREEN
    +-- target-line catalog               [***  TESTED] planning-layout-v2.test.ts:223-286
[+] planning-layout-v2.ts
    +-- win32/posix address expectations  [***  TESTED] planning-layout-v2.test.ts:316
    +-- containment escape / relative root [**  TESTED] planning-layout-v2.test.ts:410
    +-- Decision 5: drive-less win32 root [GAP]  M1 — fix removed, 174/174 still GREEN
    +-- resolveStorePlanningLayoutV2Path  [GAP]  m4 — never called directly by any test
[+] planning-identity.ts
    +-- 4 domains, determinism, tamper    [***  TESTED] planning-identity-v2.test.ts (26 tests)
[+] finalization-v2.ts
    +-- outcome/successor/evidence matrix [***  TESTED] finalization-v2.test.ts (41 tests)
    +-- Decision 7: nested capability id  [GAP]  M3 — defect restored, 41/41 still GREEN
[+] change-metadata/schema.ts
    +-- strict + quality passthrough      [***  TESTED] change-metadata.test.ts + 336-file corpus
[+] purity guard
    +-- fs/env/cwd/child_process/registry [***  TESTED] re-mutated by this review, all RED
    +-- dynamic import()                  [GAP]  m1 — probe GREEN
    +-- transitive dependency purity      [GAP]  m2 — probe GREEN
```

## Out-of-scope observation (for LEAD triage, not a finding against this change)

`rasen/changes/archive/2026-07-07-ship-delivery-modes/.openspec.yaml` and
`rasen/changes/archive/2026-07-07-unify-expert-template-pipeline/.openspec.yaml` each contain ONLY a
`quality:` block — their `schema:` and `created:` fields are gone. This matches
`src/core/archive-engine.ts:2953-2966`, where a failed/absent read of the existing `.openspec.yaml`
leaves `metadata = {}` and the subsequent `metadata.quality = summary; writeFile(stringifyYaml(metadata))`
overwrites the file with the quality block alone. Pre-existing (both records fail the PRE-change
schema too), outside this diff, and it is data already lost — but it is a live archive-engine
data-loss path worth its own change.

## Mutation hygiene

Every mutation in this review was performed by copying pristine bytes to a location OUTSIDE the
repository first, editing with `sed` into the target, and restoring with `cp` from that copy —
never `git checkout --` (which `core.autocrlf` would rewrite to CRLF). Post-restore verification:

```
5627d7c57ffed212e47b771b8f78b710f10eb22b010228495fb9c76968df8192  src/core/store/planning-validation.ts
6de40f7805a55e9a9401e37d40442e43468c17a056fd5ac0f4ce6f15d9252429  src/core/store/planning-identity.ts
40ecab21674080d48881699b099df60b0fc507cce4f06666316c92a3be26ec66  src/core/store/planning-layout-v2.ts
63346fa9ed0a10a9194b07be7b83f3e77f22497f1d9bfe5c436b27a1a497354e  src/core/store/finalization-v2.ts
14774dedb0a3f7adaa317e5ce55302fa9cd7daba39d4870a2fdecc0d6ce85ca5  src/core/store/planning-catalogs.ts
8df535575aaf18e3aeca06c281037ce87daa12c4e1bcbbb07cd8e6c0632d266a  src/core/id.ts
git status --porcelain -- src test   ->   (empty)
```

The first five match `git show eaefc01b:<path> | sha256sum`; `src/core/id.ts` is unchanged by this
commit and matches its pre-existing content.

---
---

# Round 2 — fix-delta re-review

- Reviewer: a fresh leaf reviewer, seeded from `handoff/reviewer-1.md`. I did not write this code,
  did not author any fix, and applied no fixes. Round 1 above is a different worker's report and is
  left untouched.
- Target: the delta only — `git diff eaefc01b..HEAD` @ `fcb5d326` (`221bf789` fixes, `ebaf17a8`
  run-state, `e60249fd` round-1 report, `fcb5d326` LEAD's task-6.5 untick).
- The five round-1 pressure-test verdicts are closed and were not re-litigated.

## Verdict summary

| Finding | Verdict | Basis |
| --- | --- | --- |
| M1 drive-less Windows root | **RESOLVED** | mutation RED (2), plus an over-refusal control |
| M2 display name as identifier | **RESOLVED** | mutation RED (2), plus an independent v1-side control |
| M3 nested capability address | **RESOLVED** | mutation RED (2), plus the 9/9 rejection control |
| M4 flake classification | **RESOLVED** | classification retracted, not reworded |
| m1 dynamic import blind spot | **RESOLVED** | mutation RED, and `export … from` closed too |
| m2 transitive purity unenforced | **RESOLVED** | mutation RED (2), closure enforced over 11 files |
| m3 published type meaning | **RESOLVED (behavior)** | published meaning preserved; direction unpinned — see N1 |
| `fcb5d326` (LEAD's untick) | **reasoning ACCEPTED, marker REJECTED** | see N2 |

New this round: **Major 2 | Trivial 1**. Blocker 0.

## Shape check on the delta

`git diff --stat eaefc01b 221bf789 -- src/core/store` and `git diff --stat eaefc01b HEAD -- src/core/store`
are both **empty**. Every Layer-0 contract source is byte-identical to what round 1 reviewed, which is
the right shape: all three code Majors were verification defects, so the fix is tests only. The single
`src/` edit in the whole delta is `src/core/index.ts` (m3).

Baseline before any mutation: 6 files / **217 passed** (was 174 at round 1; +43).

## Re-run mutation proofs (mine, against committed bytes)

Recorded proofs in `evidence/fix-round-1-mutation-proofs.md` were treated as claims. Each was re-run.

### M1 — `planning-layout-v2.ts:93` → `return true`

```
Tests  2 failed | 215 passed (217)
FAIL  planning-layout-v2.test.ts > refuses a drive-less 'forward-slash'-rooted Windows Store root
FAIL  planning-layout-v2.test.ts > refuses a drive-less 'backslash'-rooted Windows Store root
```

Names the right thing. It pins the **rule**, not the symptom: the case asserts
`path.win32.isAbsolute(storeRoot) === true` *first* — stating the trap (absoluteness is not
self-containment under Windows semantics) — then requires refusal from **both** `isAbsoluteStoreRoot`
call sites with the typed `{ code: 'invalid_store_layout_v2', field: 'storeRoot' }`. It uses an
explicit `flavor: 'win32'`, not `it.runIf`, so unlike `planning-layout-v2.test.ts:290` it actually
executes on the Linux and macOS legs.

Control I added — the fix must not be satisfiable by refusing everything:

```
mutate line 93 -> return false;
Tests  5 failed | 50 passed (55)
FAIL  accepts a Windows Store root carrying 'a drive' / 'a UNC share' / 'a device root'
```

The three positive cases discriminate. M1 **RESOLVED**.

### M2 — `planning-catalogs.ts:78` → kebab regex restored

```
Tests  2 failed | 97 passed (99)
FAIL  carries the human display name Elftia through unvalidated, exactly as the v1 record does
FAIL  carries the human display name my app through unvalidated, exactly as the v1 record does
  -> catalog: id: Invalid string: must match pattern /^[a-z0-9]+(-[a-z0-9]+)*$/u
```

The LEAD asked me to verify the v1-membership assertion is really there and really pins the rule
("a migration must never block on data the schema it migrates FROM accepted"). It is there — but it
is the *last* assertion in the test, so the mutation above never reaches it. So I proved it
independently, by mutating the **other** side of the invariant, in a file this change does not own:

```
mutate src/core/store/project-records.ts:205 (the v1 record's own `id`) -> same kebab regex
Tests  2 failed | 53 passed (55)
  -> Invalid store project membership record: id: Invalid string: must match pattern ...
```

Both halves are independently live, and they fail with distinct messages. The test genuinely pins the
two-sided invariant rather than the symptom. M2 **RESOLVED**.

### M3 — `finalization-v2.ts:198` → single-kebab validator restored

```
Tests  2 failed | 51 passed (53)
FAIL  accepts capability address store/planning-layout-v2 and preserves it verbatim
FAIL  accepts capability address store/planning/layout-v2 and preserves it verbatim
```

The `auth` case stayed GREEN under the mutation — correctly identified by the fixer as the
non-discriminating fixture every pre-existing case used.

Audit of the fixer's own control (`CapabilityPathSchema = z.string()`), which the LEAD flagged as
exactly where theater would hide:

```
Tests  9 failed | 44 passed (53)
```

All nine failures are precisely the nine capability rejection cases (empty, current directory, parent
directory, traversal segment, empty inner segment, leading separator, trailing separator, backslash
separator, non-canonical case) — I enumerated them by name rather than trusting the count. The control
is the right instrument for this question: with the schema replaced by `z.string()` everything else in
the record is unchanged, so a case going RED proves `CapabilityPathSchema` is what rejected it. None
is decorative. M3 **RESOLVED**.

### M4 — flake classification

`evidence/task-6-4-baseline-flake-analysis.md` does more than M4 asked. It **retracts** the
classification in a leading blockquote rather than rewording it, tabulates all three runs, states
plainly that "pre-existing" is *contradicted* by the LEAD's zero-failure pre-change baseline, carries
the reviewer's causal chain as an explicit "lead, not a finding", and splits "What is established"
from "What is still open" including the never-read second failure. The filename is deliberately kept
so the round-1 reference keeps resolving, and that choice is stated in the file. M4 **RESOLVED**.

### m1 — dynamic import

```
add `export async function reviewProbe() { const m = await import('./foundation.js'); return m; }`
   to finalization-v2.ts
Tests  1 failed | 38 passed (39)
  -> core/store/finalization-v2.ts must not import './foundation.js'
```

The message names both the file and the offending specifier. The fix also closed a vector round 1 did
not name: the old collector required `import\s+`, so `export … from` escaped it too. Verified:

```
add `export { FileSystemUtils } from './foundation.js';` to finalization-v2.ts
  -> core/store/finalization-v2.ts must not import './foundation.js'   (RED)
```

m1 **RESOLVED**.

### m2 — transitive purity

```
add `import * as fs from 'node:fs';` to src/core/id.ts
Tests  2 failed | 37 passed (39)
  -> core/id.ts must not import 'node:fs'
  -> core/id.ts must not reference node:fs
```

Both failures name `core/id.ts`, a file no Layer-0 module is. The guard now governs an 11-file
closure (5 Layer-0 + 6 dependencies), and the fixer is right that design Decision 9's hand-verified
prose had omitted `canonical-json.ts` — enforcement caught a real gap in the hand verification, which
is the strongest possible argument for enforcing rather than asserting. m2 **RESOLVED**.

**On the exact-equality closure assertion** (the LEAD asked whether it fails legibly or becomes noise
a future worker deletes): I simulated a legitimate growth — added `'../path-identity.js'` to
`ALLOWED_IMPORT_SPECIFIERS` and the matching import to `planning-validation.ts`:

```
Tests  1 failed | 41 passed (42)
FAIL  walks exactly the Layer-0 modules and the dependencies Decision 9 claims are sound
AssertionError: expected [ 'core/canonical-json.ts', …(11) ] to deeply equal [ …(10) ]
  - Expected / + Received
      "core/id.ts",
  +   "core/path-identity.ts",
      "core/store/errors.ts",
```

My read: **it fails loudly and legibly, and it is not noise.**

- Exactly one test fails, not a cascade. The other 41 pass — including the new node's own allowlist
  and forbidden-pattern checks, so the reviewer of that future diff can see the new node was
  genuinely governed, not merely counted.
- The failure prints the exact array diff naming the added node, and vitest's source context prints
  the adjacent comment explaining *why* the assertion is exact ("growing it must be a visible diff
  someone approves"). The correct fix — one line in `EXPECTED_DEPENDENCY_LABELS` — is legible from
  the failure alone.
- It is fully deterministic (both sides sorted, no ordering or timing input), so it cannot generate
  the repeated spurious failures that train a worker to delete an assertion.
- Even in the worst case where a future worker does delete it, the purity guarantee itself does not
  open: the per-node allowlist and forbidden-pattern `it.each` still run over every walked node. What
  would be lost is the *approval* property, not the enforcement.

No finding here.

### m3 — the published `ChangeInstanceId`

The LEAD asked me to falsify the fixer's decision to pin both names rather than unexport the bare
one. I could not falsify the decision; I could falsify one claim about its durability.

**The published meaning is genuinely preserved.** At `eea78de8`, `src/core/index.ts` already
star-exported both `./store/index.js` (line 19) and `./change-run/index.js` (line 30) — but the store
barrel did not carry the name, so `ChangeInstanceId` at the package root unambiguously meant
change-run's brand. Line 48 re-exports from that same module, so the published declaration is
literally the same one, not a look-alike. The pairing is unambiguous for a future importer: the bare
name keeps its published meaning and `StorePlanningChangeInstanceId` names the new brand, with the
rationale in the barrel comment.

**The pairing cannot be silently dropped.** Removing line 48:

```
src/core/index.ts(31,1): error TS2308: Module './store/index.js' has already exported a member
named 'ChangeInstanceId'. Consider explicitly re-exporting to resolve the ambiguity.
```

A hard compile error, so the disambiguation is load-bearing for the build.

**But its direction is unpinned.** Pointing line 48 at the store brand instead — i.e. reverting to
exactly what `eaefc01b` shipped and round 1 flagged — leaves `pnpm exec tsc --noEmit` **clean** and no
test red. A future worker resolving TS2308 could pick either module and nothing would object. The
behavior is correct; the guarantee is protected by a code comment. That residual is folded into N1
below, since the natural place to pin it is the consumer test — which cannot pin anything.

m3 **RESOLVED** as to behavior.

---

## New findings (round 2)

### N1 (Major) — every type-level assertion in `planning-foundation-consumer.test.ts` is inert

`test/core/store/planning-foundation-consumer.test.ts:42-60`. Eleven `expectTypeOf` assertions.
**No check in this repository can make any of them fail.** Proof:

```
mutate line 44 -> expectTypeOf<number>().toMatchTypeOf<StorePlanningChangeInstanceId>();
pnpm exec tsc --noEmit   -> exit 0, no output
pnpm exec vitest run …consumer.test.ts -> Test Files 1 passed | Tests 1 passed
pnpm run lint            -> exit 0, no output
```

Three independent reasons, all confirmed:

- `tsconfig.json` is `"include": ["src/**/*"]`, `"exclude": ["node_modules", "dist", "test"]` — `tsc`
  never type-checks `test/`. `.github/workflows/ci.yml:274` runs that same `pnpm exec tsc --noEmit`,
  so CI does not close it either.
- `vitest.config.ts` declares no `typecheck` key, and `pnpm test` is plain `vitest run`, so
  `expectTypeOf` is a runtime no-op.
- `eslint.config.js` uses `tseslint.configs.recommended` with no `project`/`projectService`, so lint
  has no type information.

Why this is Major and not a nit: **task 5.2 is ticked `[x]`** and its text explicitly claims this
file proves "that the brands actually discriminate (a bare `string` and an unverified id must not
satisfy the APIs that require verified ones)". That half is carried entirely by
`expectTypeOf<string>().not.toMatchTypeOf<…>()` and its three siblings — assertions that cannot fail.
This is the same defect class as round-1's M1/M2/M3 (a ticked task naming coverage that cannot
distinguish fixed from unfixed), which makes it the fourth instance, in the round convened to close
the first three.

To be fair to what does work: the file's runtime half is real. It composes ids and a layout entirely
through the public `src/core/index.js` surface and asserts `layout.activeChange` at runtime, which
does prove the other half of 5.2 (no internal regex/hash/path import needed) and would break if the
barrel stopped exporting the values. It is the brand-discrimination half that is unproven.

In scope for round 2 because the delta edited exactly these lines (the m3 alias rename) and because
m3's alias has no other demonstration — but stated plainly: the inertness pre-dates the delta, it was
present at `eaefc01b`, and round 1 did not catch it.

Fix options, cheapest first: (a) add a `typecheck` block to `vitest.config.ts` covering these suites
and run it in CI; (b) move the type assertions to a `*.test-d.ts` file run under `vitest --typecheck`;
(c) drop `test` from the tsconfig `exclude` (largest blast radius — likely surfaces pre-existing
errors across the whole suite). Whichever is chosen, add the m3 direction pin at the same time:
`expectTypeOf<ChangeInstanceId>().toEqualTypeOf<…change-run brand…>()`, which is the assertion that
would have caught a flip of `src/core/index.ts:48`.

### N2 (Major) — `[~]` removes task 6.5 from the machine record entirely, so the archive gate no longer sees it

`rasen/changes/store-planning-contract-v2/tasks.md:51` (`fcb5d326`).

The LEAD's **reasoning is right and I would not reverse it**: the run reference is structurally
unsatisfiable before delivery, and leaving `[x]` would leave a false claim standing. The **marker** is
wrong for this engine. `src/utils/task-progress.ts:7-8`:

```ts
const TASK_PATTERN = /^[-*]\s+\[[\sx]\]/i;
const COMPLETED_TASK_PATTERN = /^[-*]\s+\[x\]/i;
```

`[~]` matches neither, so the line is not a task at all — it leaves the numerator *and* the
denominator. `tasks.md` has 36 task lines; the engine sees 35. Measured, on this worktree:

| marker | `rasen list --changes --json` | `rasen archive --dry-run --json` |
| --- | --- | --- |
| `[x]` (before `fcb5d326`) | 36/36 · `complete` | `blockers: []` |
| `[~]` (at HEAD) | **35/35 · `complete`** | **`blockers: []`** |
| `[ ]` | 35/36 · `in-progress` | `blockers: [{ operation: "tasks", message: "1 task(s) are incomplete." }]` |

So the edit removed the false claim from the prose and left it standing in the machine record: the
change still reports 100% complete, and the archive projection — the very gate this repo uses as its
pre-archive check — is still fully open. The item the LEAD designated "the inbound acceptance item
for portfolio delivery" is the one thing no automated gate can now see.

On convention: `[~]` does have precedent — three archived changes use it the same way
(`2026-06-02-upgrade-auto-orchestrated-pipelines` ×3, `2026-07-08-telemetry-rollups-dashboard:46`,
`2026-07-22-ui-config-redesign-config-page:44`), and `2026-07-08` is the closest analogue (a PARTIAL
with a structurally unreachable half). So it is an established *human* convention that no code
implements. That is worth knowing on its own: every past `[~]` silently shrank its change's
denominator too.

Fix: one character — `[~]` → `[ ]`, keeping the PARTIAL prose exactly as written. That makes
`archive --dry-run` report the blocker until the portfolio records the real Windows CI run, which is
precisely the behavior the LEAD's note describes wanting. `rasen validate … --strict` passes under all
three markers, so nothing else is affected.

### N3 (Trivial) — the retracted evidence file no longer quotes its capture verbatim

`evidence/task-6-4-baseline-flake-analysis.md`. The rewrite ASCII-ized the quoted terminal output
(`❯` → `>`, `✖` → `*`, `…` → `...`). The block is presented as a capture of what the reporter printed,
and it no longer is. Nothing turns on it; noted only because this file's whole purpose after the
rewrite is to be an honest record of what was and was not observed.

---

## Mutation hygiene (round 2)

Every mutation used an out-of-repo pristine snapshot under `E:\tmp\rev-s2-backup`, written back with
`Copy-Item`; `git checkout --` was never used. Post-restore, all twelve touched files verified
byte-exact against their pre-mutation snapshots:

```
RESTORED-EXACT  40ecab21…  src/core/store/planning-layout-v2.ts
RESTORED-EXACT  14774ded…  src/core/store/planning-catalogs.ts
RESTORED-EXACT  63346fa9…  src/core/store/finalization-v2.ts
RESTORED-EXACT  5627d7c5…  src/core/store/planning-validation.ts
RESTORED-EXACT  8df53557…  src/core/id.ts
RESTORED-EXACT  6262a35a…  src/core/index.ts
RESTORED-EXACT  0d8249a3…  src/core/store/project-records.ts
RESTORED-EXACT  5fde812b…  test/core/store/planning-foundation-purity.test.ts
RESTORED-EXACT  fb7f2947…  test/core/store/planning-foundation-consumer.test.ts
RESTORED-EXACT  701a6337…  test/core/store/finalization-v2.test.ts
RESTORED-EXACT  029b2445…  test/core/store/planning-layout-v2.test.ts
RESTORED-EXACT  871c46b8…  rasen/changes/store-planning-contract-v2/tasks.md
```

Per the correction the fixer established, working-tree sha256 is compared against the pre-mutation
snapshot rather than against `git show`, because `core.autocrlf=true` leaves pre-existing files
(`src/core/id.ts`, `src/core/index.ts`, `src/core/store/project-records.ts`) CRLF in the tree while
their blobs are LF. `git status --porcelain` is the authority, and it is clean.

Final state:

```
pnpm exec vitest run <the six Layer-0 suites>  ->  6 files / 217 passed
pnpm exec tsc --noEmit                          ->  exit 0
pnpm run lint                                   ->  exit 0
git status --porcelain -- src test              ->  (empty)
```

The `rasen archive --dry-run --json` invocations left no `.rasen-archive-stage-*` residue.

---

# Round 3 — fix confirmation and a systematic discrimination sweep

- Reviewer: a fresh leaf reviewer. I wrote none of this code, authored no fix, and applied no fix.
  Rounds 1 and 2 above are other workers' reports and are left untouched.
- Target: the round-2 fix delta (`git diff 5c1b22dd..HEAD`, substance in `9c0f548e`) plus an
  exhaustive discrimination sweep of every assertion this change owns.
- Verified against committed bytes at HEAD `79246f48`. Every mutation was restored from an
  out-of-repo snapshot under `E:\tmp\rev-s3-backup`; `git checkout --` was never used.

## Verdict summary

| Finding | Verdict | Basis |
| --- | --- | --- |
| N1 inert type assertions | **RESOLVED** | probes A/B/D re-run by me; the new gate is load-bearing and not a duplicate |
| N2 `[~]` marker | **RESOLVED** | measured 35/36 `in-progress` and the archive `tasks` blocker; no stage residue |
| N3 ASCII-ized capture | **RESOLVED** | exact character counts from committed bytes |
| CI step | **SOUND** | correctly placed, single-OS, correctly scoped; fails loudly if its file disappears |

New this round: **Major 2 | Minor 1 | Trivial 1**. Blocker 0.

---

## Part 1 — the round-2 fixes

### Shape invariance (re-checked at HEAD)

```
git diff --stat eaefc01b HEAD -- src/core/store   ->  (empty)
git diff --name-only eaefc01b..HEAD -- src/       ->  src/core/index.ts   (the only src edit)
```

Holds. All Layer-0 contract sources are byte-identical to what round 1 reviewed.

### N1 — RESOLVED

Baseline at HEAD: `pnpm run test:types` -> 1 file / 5 tests / no type errors (4.6s).

**Probe A — an obviously false assertion.** Replaced
`expectTypeOf<string>().not.toMatchTypeOf<ProjectId>();` with
`expectTypeOf<number>().toMatchTypeOf<StorePlanningChangeInstanceId>();`:

| gate | result |
| --- | --- |
| `pnpm exec tsc --noEmit` | **exit 0 — still blind** |
| `pnpm run lint` | **exit 0 — still blind** |
| `pnpm run test:types` | **exit 1, RED** |

```
 x public Store planning foundation type surface > refuses a bare string where a branded value is required
 TypeCheckError: Type 'ChangeInstanceId' does not satisfy the constraint
   '`Expected literal string ${ChangeInstanceId}, Actual number`'
 test/core/store/planning-foundation-consumer.test-d.ts:47:42
```

One test fails, not a cascade. The two "still blind" rows are the load-bearing part of this result:
they prove the new gate closes a hole no existing gate could see, rather than duplicating one.

**Probe B — the m3 direction pin.** Flipped `src/core/index.ts:48` to
`export type { ChangeInstanceId } from './store/planning-identity.js';`, keeping the
`StorePlanningChangeInstanceId` alias line so the only variable is the direction (removing the alias
would have produced a RED for the unrelated reason that the test file's import broke).

```
pnpm exec tsc --noEmit  ->  exit 0        (blind, as round 2 measured)
pnpm run test:types     ->  exit 1, RED
  x public Store planning foundation type surface > keeps the published ChangeInstanceId pointing at the change-run brand
```

**On the fixer's caveat about opaque error text — I judge it good enough.** The message really is
unattributable on its own (`Expected literal string ${ChangeInstanceId}, Actual literal string
${ChangeInstanceId}`, because both brands are *named* `ChangeInstanceId`), and a second failure on
the next line reads only `Expected 1 arguments, but got 0`. But what vitest actually prints around it
carries the attribution: the FAIL header is the full test name, which states the invariant in words
("keeps the published ChangeInstanceId pointing at the change-run brand"), and the source-context
block prints lines 84-89 — which include the tail of the comment explaining what a flip of that
re-export has to get past. A future worker who sees only this failure gets the invariant, the file,
the line, and the rationale. That is more than most failures in this repository carry.

**Probe C — weakening the real API.** The fixer's self-assessment is **correct**. I did not re-run it
as an isolating probe because it cannot be one: the recorded result already shows `tsc --noEmit`
exiting 2, which means the mutation breaks `src/` internally and the root type check catches it. It
demonstrates the assertions track the real API; it does not isolate the new gate. Recording it as a
partial rather than as evidence was the right call.

**Probe D — collapsing the brand, re-run against the CURRENT committed bytes.**
`src/core/store/planning-identity.ts:24`, `ChangeInstanceId = string & { readonly [brand]: true }`
-> `= string`:

```
pnpm exec tsc --noEmit  ->  exit 0     (src stays internally consistent — nothing objects)
pnpm run test:types     ->  exit 1, RED
  x refuses a bare string where a branded value is required
  test/core/store/planning-foundation-consumer.test-d.ts:49:32   (the individual StorePlanningChangeInstanceId pin)
```

**Genuinely RED now.** The fix works, and it fails at exactly the assertion the fixer added to close
its own gap. I take the fixer's account of the first (green) run at face value only as narrative; the
result that matters is this one, which I ran myself.

**Pushing further on probe D's class — I found more instances. See N6 below.** The general defect is
real and the fixer's fix is local to the names that already appeared in the file.

### The harness does not weaken `pnpm test`

- `vitest.config.ts:135` default include is `['test/**/*.test.ts']` (read from
  `resolveTestInclude`, the `!partition` branch). `.test-d.ts` does not match, so `pnpm test` never
  collects it. Confirmed by running `pnpm exec vitest run test/core/store/` -> **31 files / 648
  passed | 1 skipped**, matching the fixer's claim exactly.
- **Sharding claim confirmed specifically.** `vitest.config.ts:71` is
  `if (!entry.isFile() || !entry.name.endsWith('.test.ts')) return [];`. `planning-foundation-consumer.test-d.ts`
  ends with `-d.ts`, not `.test.ts`, so the partitioner never sees it and no shard's file list moves.
  I also ran `test/ci-workflow-contract.test.ts` (the repo's own partition contract, which asserts
  deterministic disjoint coverage over 8 partitions): **4 passed**, unaffected by the new step.
- `typecheck` is declared but **disabled by default**; only `test:types` passes
  `--typecheck.enabled --typecheck.only`.

### Review of the CI change on its own merits

The step is **correctly placed and correctly scoped**:

- It is in the `lint` job (`Lint & Type Check`), which is `runs-on: ubuntu-latest` — a single leg, not
  the `test_matrix`. Type checking is platform-independent, so one leg is right and it adds no
  multiplier to the matrix cost. Measured cost is ~5-10s.
- It sits between `Type check` and `Lint`, after `Install dependencies` and `Build project`, so
  everything it needs already exists.
- `tsconfig.typecheck.json` does **not** pull in more than intended: it extends the root config but
  overrides `include` to `["src/**/*", "test/**/*.test-d.ts"]`, so the closure is `src/` plus the one
  type-test file. It sets `noEmit` and disables `declaration`/`declarationMap`/`sourceMap`, so it
  cannot write output. Nothing else in the repo references it. The alternative the fixer rejected
  (dropping `test` from the root `exclude`) would indeed have signed the whole suite up at once.
- **Durability probe (mine).** I moved `planning-foundation-consumer.test-d.ts` out of the tree and
  re-ran `pnpm run test:types`: `No test files found, exiting with code 1`. The gate therefore cannot
  go vacuously green if a future worker renames or deletes the file — it fails loudly and prints both
  its include patterns. Restored; tree verified clean.

### N2 — RESOLVED

Measured by me on this worktree, at HEAD:

```
rasen list --changes --json
  {"name":"store-planning-contract-v2","completedTasks":35,"totalTasks":36,"status":"in-progress"}

rasen archive store-planning-contract-v2 --dry-run --json
  /archive/plan/blockers = [{"operation":"tasks","message":"1 task(s) are incomplete."}]
  /archive/blockers      = [{"operation":"tasks","message":"1 task(s) are incomplete."}]
```

The marker is `[ ]` at `tasks.md:51` and the LEAD's PARTIAL prose is kept verbatim. **This blocker is
the intended state, not a defect**: task 6.5 is genuinely incomplete until the portfolio PR's Windows
CI run exists, and the gate correctly refuses to let this child archive before then.

Residue: I checked for `.rasen-archive-stage-*` before and after the dry-run — none, and
`git status --porcelain` is empty (whole tree, not just `src`/`test`).

### N3 — RESOLVED

Counted from committed bytes (`git show HEAD:...task-6-4-baseline-flake-analysis.md`), not the
working tree:

```
U+276F  prompt      : 1
U+2716  cross       : 1
U+2026  ellipsis    : 4
U+FFFD  replacement : 0        <- the repo's known Write-path mangling did not occur
U+2717 / U+00D7     : 0 / 0    <- no look-alike substitutions either
```

Matches the required counts exactly. Restoring from `git show` via a script rather than retyping was
the right method for this repo.

---

## Part 2 — the systematic discrimination sweep

Rounds 1 and 2 found one new instance of the same defect class per round (M1, M2, M3, then N1), and
the fixer's own probe D found a fifth inside its own fix. This round replaced sampling with a
group-control pass over everything this change owns.

### Method

For each source module I built a **central accept-all control** (every rejection path neutered at one
seam) and, where the accept side carried claims, a **mirror refuse-all control**. Then I enumerated
the reddened tests **by name** and compared that set against the suite's full test inventory. A
rejection-named test that survives its module's accept-all control is a candidate finding; an
accept-named test that survives refuse-all likewise.

The levers used (all applied to pristine bytes, then restored):

| Module | Accept-all lever | Mirror control |
| --- | --- | --- |
| `planning-validation.ts` | `throw invalid(` -> `void invalid(` (20 sites) + the two hex regexes widened, because `isGitOid`/`isSha256Digest` bypass their parsers and test the regex directly | `assertPortableSegment` throws on entry + hex regexes never match |
| `planning-identity.ts` | `throw identityError(` -> `void identityError(` (10 sites) + `SEED_PATTERN` widened | preimage probes (K, L) below |
| `planning-layout-v2.ts` | `throw pathError(` -> `void pathError(` (5 sites) | — |
| `finalization-v2.ts` | every `superRefine` body short-circuited (5 sites) | cross-field probes (O, P) below |
| purity guard | forbidden-pattern injections, one per module for attribution | — |
| `.test-d.ts` | brand collapse, individually and in a 9-brand batch | — |

### Coverage achieved

| Suite | Tests | Swept by | Result |
| --- | --- | --- | --- |
| `planning-validation-v2.test.ts` | 43 | accept-all + refuse-all | **43/43 live in at least one direction** (35 RED under accept-all, 12 under refuse-all, 4 in both) |
| `planning-identity-v2.test.ts` | 26 | accept-all + 2 preimage probes | 14 RED under accept-all; **N5 found** |
| `planning-layout-v2.test.ts` | 55 | accept-all (own module) + inherited from validation control | 6 RED for layout-owned rules; the rest of its rejection surface is validation-owned and was swept there |
| `finalization-v2.test.ts` | 53 | superRefine no-op + 2 cross-field probes | 18 RED under superRefine no-op; **N4 found** |
| `planning-foundation-purity.test.ts` | 39 | 3 forbidden-pattern injections | 3 RED, each naming its own file and pattern — **all 8 forbidden patterns now mutation-proven** (5 by round 1, 3 by me) |
| `planning-foundation-consumer.test.ts` | 1 | (runtime composition; exercised under every control above) | live |
| `planning-foundation-consumer.test-d.ts` | 5 (20 assertions) | probes A/B/D + a 9-brand batch collapse | **N6 found** |

### What I could NOT reach — stated plainly

1. **I did not mutation-prove every assertion individually.** 217 runtime tests carry far more than
   217 assertions. I proved *families* via central seams and enumerated the reddened set by name. An
   assertion that is decorative but sits inside a test whose *other* assertions redden under a
   control would not be distinguishable by this method. The three cases I dug into individually
   (probe P's three tests, the reserved-device-name length assertion, the determinism test) were
   chosen by the risk heuristics; there could be others of that shape.
2. **`planning-catalogs.ts` did not get its own accept-all control.** Its rejection surface is
   covered by round 2's M2 proof (both sides of the display-name invariant, independently mutated)
   and by the layout-suite controls, but I did not run a dedicated catalogs-wide seam break. The
   catalog schemas are `.strict()` zod objects whose failures surface through `catalogError`; a
   `throw catalogError(` -> `void catalogError(` control would be the analogous sweep and I did not
   run it.
3. **`it.runIf(process.platform === 'win32')` at `planning-layout-v2.test.ts:329` ran here** (I am on
   win32), so I observed it live — but I cannot speak to the Linux/macOS legs, where it is skipped.
   That is round 1's standing observation, not a new one.
4. **I did not re-run round 2's m1/m2 purity mutations**; I extended that suite's proof to the three
   forbidden patterns nobody had mutated instead. Round 2's dynamic-import and transitive-closure
   proofs are taken as recorded.
5. **Round 1 and 2 findings were not re-litigated** and the five round-1 pressure-test verdicts stay
   closed, per instruction.

---

## New findings (round 3)

### N4 (Major) — the Archive v2 cross-field null constraints have zero discriminating coverage

`src/core/store/finalization-v2.ts:319-407`, `test/core/store/finalization-v2.test.ts`.

Task 4.4 is ticked `[x]` and claims the discriminated schema makes "landed-only applied spec sync,
null code merge on non-landed records, `implementation: none` landed records with no code merge, and
successor-only-on-superseded **structurally impossible to violate**". Task 4.6 is ticked `[x]` and
claims the suite carries "outcome and successor matrices".

**Probe O.** I relaxed every cross-field null constraint across all five Archive variants —
`codeMerge: z.null()` -> `z.any()` (3 sites), `supersededBy: z.null()` -> `z.any()` (3 sites),
`reason: z.null()` -> `z.any()` (2 sites):

```
pnpm exec vitest run test/core/store/finalization-v2.test.ts
  Tests  53 passed (53)          <- nothing reddens
```

So three of the four properties task 4.4 names are unenforced *by the tests*:

- `codeMerge` must be `null` on superseded / cancelled / abandoned records and on
  `implementation: none` landed records. No fixture ever puts a code merge on a passive record and
  asserts rejection.
- `supersededBy` must be `null` on every non-superseded record — "successor-only-on-superseded". No
  fixture ever puts a successor on a landed / cancelled / abandoned **archive record** and asserts
  rejection.
- `reason` must be `null` on landed records. No fixture ever puts a reason on a landed archive
  record and asserts rejection.

**The fourth property IS covered, and I verified it separately (probe P).** Pointing the passive and
superseded variants at `LandedSpecSyncSchema` turns exactly 3 tests RED:

```
  x accepts passive superseded history only with null merge and unapplied empty spec sync
  x accepts passive cancelled  history only with null merge and unapplied empty spec sync
  x accepts passive abandoned  history only with null merge and unapplied empty spec sync
```

**But note what those three test names say versus what they do.** The name claims "only with **null
merge** and unapplied empty spec sync". The body (`finalization-v2.test.ts:223-236`) builds one
*valid* passive record and asserts it is accepted. There is no negative case at all: it never
constructs a passive record carrying a code merge. They redden under probe P only because the valid
fixture stopped being accepted — an accept-side sensitivity, not the "only" claim. This is round-1
M2's shape exactly: the fixture cannot distinguish enforced from unenforced.

**A sharpening detail that shows this is an oversight, not a decision.** The parallel constraints on
the *smaller* `FinalizationOutcomeSchema` contract ARE properly covered — `finalization-v2.test.ts:117-121`
is a real rejection matrix including `{outcome:'landed', reason:'contradiction'}` and
`{outcome:'cancelled', ..., supersededBy: SUCCESSOR_INSTANCE}`. The author knew how to write that
matrix and wrote it for one contract; the Archive record never got one.

Behavior is **correct** — the schema does enforce all four. Only the coverage is missing. Fix: add
the negative half of the matrix for the archive record (a passive record with a `codeMerge`, a
non-superseded record with a `supersededBy`, a landed record with a `reason`), each asserted to
reject.

### N5 (Major) — the versioned domain in every identity preimage is unpinned, because no derived digest is pinned anywhere

`src/core/store/planning-identity.ts:183-303`, `test/core/store/planning-identity-v2.test.ts`.

Task 3.6 is ticked `[x]` and names "**domain separation across the four kinds**" as covered. Design
Decision 4 specifies the four preimages exactly (`H({ domain: "planning-scope/v2", storeUid,
projectId, targetLineId })` and siblings) and the spec requires each kind be "derived under its own
versioned domain".

**Probe K.** Bumped all four domains from `/v2` to `/v3` — which changes every derived digest for
every input:

```
six Layer-0 suites  ->  Tests  217 passed (217)
```

**Probe L.** Deleted the `domain` field from all four preimages entirely:

```
six Layer-0 suites  ->  Tests  217 passed (217)
```

**Root cause: no test pins any derived digest to a value.** Every identity assertion in the suite is
*relational* — `toMatch(/^ps_[0-9a-f]{64}$/u)`, `.toBe(other)`, `.not.toBe(other)`, and
`expect(new Set([...four digests]).size).toBe(4)` at line 80. All of those survive any change that
transforms every digest uniformly. The `Set(...).size === 4` assertion is what task 3.6's "domain
separation" rests on, and it cannot discriminate: the four preimages differ in their field names
regardless of the domain, so they hash to four distinct values with or without it. Round-1 M2's
non-discriminating-fixture shape again.

I also grepped the whole repository for a literal `(ps_|ci_|wt_|wp_)[0-9a-f]{16,}` — **no matches**,
so nothing anywhere pins a digest.

What IS covered, to be fair: cross-kind substitution is genuinely rejected by the prefix check, and
the spec scenario "Identity kind cannot be substituted" exercises it. Determinism across insertion
order is genuinely covered. Removing the domain would not create a collision *today*, because the
preimages differ structurally.

Why it is Major anyway: these identities are **durable** — the same suite (`planning-identity-v2.test.ts:341`)
writes and reads them through `writeChangeMetadata` into `.openspec.yaml`. A silent preimage change
invalidates every previously minted identity, and nothing in the repository would go red. A versioned
domain exists precisely to make that transition deliberate; here the version is a string no test
reads. Fix: one known-input/known-digest vector per kind, which pins the domain, the field names, and
the canonical-JSON encoding in a single assertion each.

### N6 (Minor) — 9 of 16 branded types are still unpinned, and the new comment claims otherwise

`test/core/store/planning-foundation-consumer.test-d.ts:41-56`.

This is probe D's class, generalized. The vocabulary is 16 brands (7 in `planning-validation.ts`, 8 in
`planning-identity.ts`, 1 in `planning-layout-v2.ts`). The new type suite pins 6 of them individually
against a bare `string`. The other 9 — `TargetLineId`, `ChangeId`, `FullGitRef`, `GitOid`,
`Sha256Digest`, `PlanningScopeId`, `ChangeInstanceSeed`, `WorktreeInstanceId`, `StorePlanningPath` —
appear in the suite only through derived types, or not at all.

**Probe E** (single instance): collapsing `StorePlanningPath` to `string` leaves `tsc --noEmit` at
exit 0, all 5 type tests green, and 109 runtime tests green. Its only reachable assertion is
`expectTypeOf<ReturnType<typeof computeStorePlanningLayoutV2>>().toEqualTypeOf<StorePlanningLayoutV2>()`,
where both sides collapse together.

**Probe F** (the group control): collapsing all 9 simultaneously:

```
pnpm exec tsc --noEmit                ->  exit 0        (src stays internally consistent)
pnpm run test:types                   ->  5 passed, no type errors
six Layer-0 suites                    ->  217 passed (217)
```

Every gate in the repository is blind to it.

Why Minor rather than Major: task 5.2's claim is glossed as "a bare `string` and an unverified id must
not satisfy **the APIs that require verified ones**", and that narrower claim *is* met — the verified
pins and the parameter pins hold, and I confirmed the verified/unverified distinction reddens
correctly. Design Decision 4's broader "branded TypeScript output so a bare `string` cannot satisfy a
downstream API by accident" is prose, not a ticked task.

What is squarely wrong is the **comment**, at lines 41-47: "Each branded name is pinned against a
bare `string` INDIVIDUALLY, not only through the verified-id parameters." That is not true of 9 of 16
names, and it is exactly the artifact a future worker would read before deciding a newly added brand
needs no pin. Fix is one line either way: add the 9 missing pins, or narrow the comment to the names
it actually covers.

### N7 (Trivial) — a parameterized test ignores its parameter, so its name claims coverage it does not have

`test/core/store/planning-validation-v2.test.ts:107-125`.
`it.each(['win32', 'posix'])('enforces Windows-representable path/ref components for %s materialization', _flavor => {...})`
— the parameter is discarded (`_flavor`) and the body runs identical assertions both times, because
`isPortableRelativePath` and `isFullGitRef` take no flavor argument. The two cases are the same test
run twice under two names that each claim a per-flavor guarantee. The assertions themselves are live
(both reddened under my accept-all and refuse-all controls); only the naming and the +1 to the test
count are misleading. Fix: drop the `it.each` and name it once for what it checks.

---

## Ship recommendation

**Do not ship past this without a decision: two Majors are open (N4, N5).**

Both are verification defects, not behavior defects — I found no wrong behavior anywhere in the
shipped contract this round, and the round-2 fixes for N1/N2/N3 are all genuinely resolved. But both
N4 and N5 are the same class rounds 1 and 2 rated Major and chose to fix: a task ticked `[x]` whose
text names coverage that provably cannot distinguish fixed from unfixed. Applying a different bar to
them now would be inconsistent with how M1, M2, M3, and N1 were handled in this very change.

Weighing them for the escalation ladder:

- **N5 is the one I would fix first.** It protects a durable, externally-visible identity format, its
  fix is four one-line assertions, and the property it protects (a preimage change must be
  deliberate) has no other guard anywhere in the repository.
- **N4 is a slightly larger but entirely mechanical fix** — three negative fixtures mirroring the
  matrix the same file already contains for `FinalizationOutcomeSchema`.
- **N6 and N7 are cheap enough to fold into whichever fix round happens**, and N6's comment is worth
  correcting whether or not the missing pins are added, because it actively misleads.

If the LEAD instead decides these are acceptable as recorded coverage gaps, the honest framing is
that tasks 3.6, 4.4, and 4.6 are ticked with claims their tests do not support, and that should be
written into the tasks the way task 6.5's PARTIAL was — not left standing.

This was round 3 of 3, so the loop is exhausted; the decision is the LEAD's.

## Mutation hygiene (round 3)

Every mutation used an out-of-repo pristine snapshot under `E:\tmp\rev-s3-backup`, applied and
restored with `cp`; `git checkout --` was never used. Seven touched files verified byte-exact against
their pre-mutation snapshots after restore:

```
RESTORED-EXACT  14774ded...  src/core/store/planning-catalogs.ts
RESTORED-EXACT  5627d7c5...  src/core/store/planning-validation.ts
RESTORED-EXACT  40ecab21...  src/core/store/planning-layout-v2.ts
RESTORED-EXACT  6de40f78...  src/core/store/planning-identity.ts
RESTORED-EXACT  63346fa9...  src/core/store/finalization-v2.ts
RESTORED-EXACT  6262a35a...  src/core/index.ts
RESTORED-EXACT  6bbf391d...  test/core/store/planning-foundation-consumer.test-d.ts
```

Per the correction round 2 established, working-tree sha256 is compared against the pre-mutation
snapshot, not against `git show`, because `core.autocrlf=true` leaves pre-existing files CRLF in the
tree while their blobs are LF. `git status --porcelain` is the authority and it is empty for the
whole tree.

Final state at HEAD, all run by me after the last restore:

```
pnpm exec tsc --noEmit                          ->  exit 0
pnpm run lint                                   ->  exit 0
pnpm run test:types                             ->  1 file / 5 tests / no type errors
pnpm exec vitest run test/core/store/           ->  31 files / 648 passed | 1 skipped
pnpm exec vitest run test/ci-workflow-contract  ->  4 passed
git status --porcelain                          ->  (empty, whole tree)
.rasen-archive-stage-*                          ->  none
```

---

# Round 3 verification — scoped confirmation of the ladder fixes

- Verifier: a fresh leaf worker. I wrote none of this code, authored none of the four fixes, and
  applied none of them. Rounds 1-3 above are other workers' reports and are left untouched.
- Scope: confirm N4, N5, N6, N7 are genuinely closed. This is **not** a fourth review round — no
  re-sweep, no re-litigation of rounds 1-3. Findings recorded below outside that scope fell out of
  the probes themselves.
- Target: `27b59b6e`. HEAD advanced to `2d1fdb9f` mid-verification (LEAD commits touching only
  `.rasen/**` ephemera); `git diff --name-only 27b59b6e..HEAD -- src/ test/` is **empty**, so every
  measurement below stands at the current HEAD.
- Every recorded result was re-run by me against committed bytes. Mutations restored from an
  out-of-repo snapshot under `E:\tmp\verify-s1-snap`; `git checkout --` was never used.

## Verdict summary

| Finding | Verdict | Basis |
| --- | --- | --- |
| N4 Archive v2 cross-field null matrix | **RESOLVED** | probe O re-run: 11 RED by name where it previously reddened none; the three passive tests redden at the "only" clause itself |
| N5 golden vectors for the derived identities | **RESOLVED** | probes K/L/M re-run; all five digests independently recomputed from the design preimage without importing the implementation |
| N6 brand vocabulary completeness | **RESOLVED** | probes F/G re-run; exact-match claim independently confirmed; generator sound for its declared scope, with three named blind spots |
| N7 parameterized test that discarded its parameter | **RESOLVED** | collapsed to one test; the recorded reason is true, not an excuse |

New this round: **Blocker 0 | Major 0 | Minor 0 | Trivial 2** (V1, V2 below).

---

## N5 — RESOLVED

### Probe K — bump all four identity domains `/v2` -> `/v3`

Six Layer-0 suites: `6 failed | 241 passed (247)`. Enumerated by name:

```
FAIL ... > Store planning v2 identity golden vectors > pins the PlanningScopeId preimage to a known digest
FAIL ... > Store planning v2 identity golden vectors > pins the ChangeInstanceId preimage to a known digest
FAIL ... > Store planning v2 identity golden vectors > pins the 'planning' WorktreeInstanceId preimage to a known digest
FAIL ... > Store planning v2 identity golden vectors > pins the 'execution' WorktreeInstanceId preimage to a known digest
FAIL ... > Store planning v2 identity golden vectors > pins the WorkspacePairId preimage to a known digest
FAIL ... > Store planning v2 identity golden vectors > accepts every golden digest through its own verifier
```

Matches the claim. **The load-bearing half of this result is the other 26 tests in that file staying
green**: the pre-existing relational assertions are still exactly as blind as round 3 diagnosed, so
the six new vectors are the entire discriminating power, not a duplicate of something already there.

### Probe L — delete the `domain` field from all four preimages

Six Layer-0 suites: `6 failed | 241 passed (247)`. The **same six**, by the same names.

### Probe M — `storeUid` -> `storeUuid` in the scope preimage only, domain untouched

```
Tests  2 failed | 245 passed (247)

FAIL ... > pins the PlanningScopeId preimage to a known digest
FAIL ... > accepts every golden digest through its own verifier
```

**The localisation design is real, and I confirmed it by both measurement and construction.** The
three untouched vectors stayed green because each takes pinned `GOLDEN.*` literals as input rather
than chaining off the previous derivation — `deriveChangeInstanceId({ planningScopeId:
GOLDEN.planningScopeId, ... })`, not `derivePlanningScopeId(...)`. Had the vectors been chained, a
scope-preimage change would have smeared across all four and the failure set would have carried no
diagnosis. It does: the RED set names the preimage that moved.

### Provenance of the pinned digests — stronger than "generated at `eaefc01b`"

The commit message's claim is trivially true and cannot be otherwise: `git diff --stat eaefc01b HEAD
-- src/core/store` is empty, so the implementation at `eaefc01b` *is* the implementation at HEAD.
There is no tree in which a laundered digest could have been generated.

I did not stop there, because a golden vector generated from the implementation pins whatever the
implementation does, correct or not. I recomputed all five digests **independently**, hand-rolling
RFC 8785 for flat string maps (sorted keys, no whitespace) from the preimages design Decision 4
specifies, in a standalone script that never imports `src/core/store`:

```
MATCH   ps   ps_384a664d...  (domain planning-scope/v2, storeUid, projectId, targetLineId)
MATCH   ci   ci_4f060f98...  (domain change-instance/v2, planningScopeId, instanceSeed)
MATCH   wt   wt_b752701b...  (domain worktree-instance/v2, planning role)
MATCH   wt   wt_df70478e...  (domain worktree-instance/v2, execution role)
MATCH   wp   wp_208017ab...  (domain workspace-pair/v2, ordered Change/planning/execution)
```

The vectors therefore pin the **designed** preimage, not merely the emitted one.

### The comment

Adequate, and load-bearing. It states the provenance (`eaefc01b`), that this pins today's format
rather than proposing a new one, and — the instruction that matters — "do not 'fix' it by pasting in
the new digest ... a change here is a breaking format change and needs a deliberate, versioned
decision." Its durability cross-reference is not decorative: `writeChangeMetadata` really does write
these identities to `.openspec.yaml` at `planning-identity-v2.test.ts:482` and `:530` in the same
file, so a reader who follows the pointer finds the reason.

## N4 — RESOLVED

### Probe O — relax `z.null()` -> `z.any()` at the 8 cross-field sites across the five Archive variants

I scoped the mutation to the Archive variants only (from `const ArchiveCommonShape` onward), leaving
the two spec-action digest nulls at `finalization-v2.ts:224,241` untouched. `61 tests: 11 failed | 50
passed`, enumerated by name:

```
FAIL ... > accepts passive superseded history only with null merge and unapplied empty spec sync
FAIL ... > accepts passive cancelled  history only with null merge and unapplied empty spec sync
FAIL ... > accepts passive abandoned  history only with null merge and unapplied empty spec sync
FAIL ... > rejects 'a landed record carrying a reason'
FAIL ... > rejects 'a landed record carrying a successor'
FAIL ... > rejects 'a planning-only landed record carrying a code merge'
FAIL ... > rejects 'a superseded record carrying a code merge'
FAIL ... > rejects 'a cancelled record carrying a code merge'
FAIL ... > rejects 'an abandoned record carrying a code merge'
FAIL ... > rejects 'a cancelled record carrying a successor'
FAIL ... > rejects 'an abandoned record carrying a successor'
```

Count and names both match. Previously this file reddened **nothing** under the same lever.

**The three passive-history tests now redden for the "only" clause itself, not through accept-side
sensitivity — verified, not assumed.** Probe O *widens* the schema, so the valid fixture those tests
build is still accepted; the accept-side assertion above still passes. The failure is
`finalization-v2.test.ts:242:9`, `expected [Function] to throw an error` — the newly added negative
half asserting a passive record carrying a `codeMerge` is rejected. That is the word "only",
literally. This is the exact defect shape round 1's M2 named, and it is closed here rather than
renamed.

## N6 — RESOLVED, with three named blind spots in the mechanism

### Probe F — collapse all 9 formerly-unpinned brands to bare `string` at once

| gate | result |
| --- | --- |
| `pnpm exec tsc --noEmit` | **exit 0 — still blind** |
| `pnpm run test:types` | **exit 1, 9 type errors** |
| six Layer-0 suites | `1 failed / 237 passed (238)` — see V1 |

The 9 type errors land at `planning-foundation-consumer.test-d.ts` lines 68, 69, 70, 71, 72, 75, 78,
79, 84 — which are exactly `TargetLineId`, `ChangeId`, `FullGitRef`, `GitOid`, `Sha256Digest`,
`PlanningScopeId`, `ChangeInstanceSeed`, `WorktreeInstanceId`, `StorePlanningPath`: one per collapsed
brand, no cascade, no misattribution, and no error at the seven brands I did not collapse. The
`tsc --noEmit` exit 0 row is the part that matters — it proves the new gate closes a hole no existing
gate can see.

### Probe G — delete the `GitOid` pin

`Tests 1 failed | 17 passed (18)`, named `pins GitOid against a bare string`, message:
`GitOid is declared in src/core/store but has no expectTypeOf<string>().not.toMatchTypeOf<GitOid>()
pin in planning-foundation-consumer.test-d.ts`. One test, named for the brand, message states the
exact line to add. Confirmed.

### Judgment on the generator's soundness

I pressured the mechanism rather than taking its description, with four further probes.

**The exact-match claim holds — confirmed, not taken.** I removed the `WorkspacePairId` pin while
leaving `VerifiedWorkspacePairId` in place. Under substring matching the guard would have stayed
green; it went RED naming `WorkspacePairId`. `pinnedBrands()` captures the type argument as `(\w+)`
into a `Set` and tests exact membership, so this change's own recurring defect — a verified subtype
satisfying a check meant for its base — cannot recur one level down inside the guard itself.

**A 17th brand in the ordinary declaration form cannot arrive unpinned.** I appended a new
`export type NewBrandId = string & { readonly [newBrandIdBrand]: true };` to `planning-validation.ts`:
2 RED, `finds the whole declared vocabulary` and `pins NewBrandId against a bare string`. The
mechanism does what it claims for the growth path it was built for. It also covers both declaration
shapes actually present in the sources (`= string & {` root brands and `= Y & {` verified subtypes),
including the four whose body is wrapped onto following lines.

Three blind spots, all confirmed by measurement (recorded as V2, Trivial):

1. **A commented-out pin still counts as present.** `pinnedBrands()` scans source text, so
   `// expectTypeOf<string>().not.toMatchTypeOf<GitOid>();` leaves the guard at 18/18 green while the
   assertion no longer runs. Deleting the pin is caught; commenting it out is not.
2. **A brand declared with a line break after the `=` is invisible**, and the `toBe(16)` backstop
   does *not* fire, because the regex still finds exactly 16. `export type NewBrandId =\n  string & {
   ... };` leaves the guard at 18/18 green. There is no formatter gate that would normalise this: the
   repo has no prettier config and `lint` is `eslint` only.
3. **A brand declared in any `src/core/store` file outside the three hardcoded sources is invisible.**
   Appending the same brand to `planning-catalogs.ts` leaves the guard at 18/18 green.

Blind spot 3 is the one with a live consumer: S2 (`store-worktree-bindings-v2`) and S3
(`store-issue-resources`) add new Store modules to this same directory, and a brand introduced there
inherits none of this guard. That is worth carrying into those children as an inbound note rather
than reopening this one — the guard is honest about its scope (`LAYER_0_BRAND_SOURCES` is right there
in the file), it is strictly better than the hand-maintained list it replaced, and none of the three
gaps is reachable without a deliberate act.

**Verdict on the mechanism: sound for its declared scope.** It converts a property that was false
(7 of 16 pinned under a comment claiming 16) into one that is enforced, and it fails by name with an
actionable message. It is not a universal brand detector and does not claim to be.

## N7 — RESOLVED

`it.each(['win32','posix'])` is gone; `planning-validation-v2.test.ts` now carries a single
`enforces Windows-representable path/ref components on every platform` with the identical body, and
the suite count drops 43 -> 42 for that reason alone.

**The recorded reason is true, not a convenient excuse.** I checked the signatures at committed
bytes: `isFullGitRef(value: unknown)` (`planning-validation.ts:197`) and
`isPortableRelativePath(value: unknown)` (`:251`) each take exactly one argument and no flavor. There
was no per-flavor behavior for the parameter to select, so the two cases were provably the same test
under two names that each claimed a guarantee neither exercised. Nothing was lost by collapsing it,
and the replacement comment records why it must not be re-parameterized.

## New findings (verification round)

### V1 (Trivial) — the recorded probe-F "runtime stays green" row is inaccurate

`evidence/fix-round-3-mutation-proofs.md` records, for probe F, `six Layer-0 suites | 217 passed |
passes — runtime cannot see a type collapse`. Measured: a literal bare-string collapse of the 9
brands leaves the six suites at `1 failed | 237 passed (238)`, RED at
`Store planning v2 branded vocabulary is pinned exhaustively > finds the whole declared vocabulary`,
with the total dropping 247 -> 238 because `it.each(declaredBrands())` generates 9 fewer cases.

The reasoning behind the recorded row ("runtime cannot see a type collapse") is sound in general but
no longer true of *this* suite, because the new guard reads the declarations as text. **The direction
of the error is safe** — the mechanism is more sensitive than recorded, not less — and the two rows
that carry probe F's argument (`tsc --noEmit` blind, `test:types` RED with 9) both reproduce exactly.
This is an evidence-recording inaccuracy, not a defect in the fix. Worth correcting only so a future
reader does not conclude the guard is insensitive to brand collapse.

Incidentally this exposes a good property: the per-brand test count is dynamic, so a brand vanishing
silently removes its own guard case — and `expect(brands.length).toBe(16)` is what catches that.

### V2 (Trivial) — three blind spots in the completeness guard

Enumerated and measured under "Judgment on the generator's soundness" above. Recommendation: carry
blind spot 3 (a brand in a fourth Store module) into S2/S3 as an inbound note. No action needed on
this child.

## Invariance, task honesty, and suite arithmetic

**Invariance — confirmed independently.**

```
git diff --stat eaefc01b HEAD -- src/core/store   ->  (empty)
git diff --name-only eaefc01b..HEAD -- src/       ->  src/core/index.ts   (the only src edit)
git diff --name-only 27b59b6e..HEAD -- src/ test/ ->  (empty)
```

All five Layer-0 contract sources are byte-identical to what round 1 reviewed. My pre-mutation
snapshot hashes match round 3's recorded `RESTORED-EXACT` values for all five files, which
corroborates that round's restore ledger from an independent snapshot.

**Task honesty — confirmed.**

- 35 `[x]`, 1 `[ ]` (6.5), **0 `[~]`** anywhere.
- 6.5 is still `[ ]` with round 1's PARTIAL prose verbatim, and was **not touched** by `27b59b6e`.
- 3.6 and 4.6 keep `[x]` with appended notes. **No requirement text was rewritten.** Every note is
  strictly additive: in each hunk the removed line's full text is the exact prefix of the added line,
  with the note appended after it. Nothing was softened, narrowed, or deleted to match what shipped.
- Both notes are accurate against what I measured. 3.6's "bumping every domain `/v2` -> `/v3` — or
  deleting the `domain` field outright — left the suite green" is what probes K and L show once the
  vectors are removed from consideration, and the 26 still-green relational tests confirm it directly.
  4.6's "three of its four properties" matches round 3's probe P finding that landed-only applied
  spec sync was the one property already covered.
- **4.4 carries no appended note** — it is unmodified. I judge this correct rather than an omission:
  4.4 is the implementation task, its behavior was never wrong (round 3 confirmed the schema enforces
  all four), and the gap was in verification, which is 4.6's task. 4.6's note names 4.4's claim
  explicitly, so the record points at the right place from the right task.

**Suite arithmetic — closes exactly.**

```
                              round 3   HEAD    delta
planning-validation-v2          43       42     -1   (N7 collapse)
planning-identity-v2            26       32     +6   (golden vectors)
planning-layout-v2              55       55      0
finalization-v2                 53       61     +8   (archive negatives)
planning-foundation-purity      39       39      0
planning-foundation-consumer     1       18     +17  (1 count + 16 per-brand)
                               ---      ---
                               217      247     +30
```

Corroborated at the wider scope: `pnpm exec vitest run test/core/store/` was `648 passed | 1 skipped`
in round 3 and is `678 passed | 1 skipped` now — the same +30, no collateral movement.

**Final gates, all run by me after the last restore:**

```
pnpm exec tsc --noEmit                     ->  exit 0
pnpm run lint                              ->  exit 0
pnpm run test:types                        ->  1 file / 5 tests / no type errors
six Layer-0 suites                         ->  247 passed (247)
pnpm exec vitest run test/core/store/      ->  31 files / 678 passed | 1 skipped
git status --porcelain                     ->  (empty, whole tree)
```

## Ship recommendation

**Ship this child.** N4, N5, N6 and N7 are all genuinely closed, confirmed by probes I re-ran myself
against committed bytes rather than by reading the record. Nothing Blocker or Major is open. The two
Trivials are an inaccurate row in a fix-evidence table (V1, safe direction) and three named,
deliberate-act-only blind spots in a new guard (V2), one of which is worth carrying to S2/S3 as an
inbound note.

Two judgments the LEAD asked for specifically, since they outlive the individual assertions:

- **The N5 localisation design is genuine.** Each vector consumes pinned literals, so the failure set
  identifies which preimage moved instead of smearing across all four — and the digests match an
  independent recomputation of the design's preimage, so they pin the contract rather than the code's
  current opinion of it.
- **The N6 generator is sound for its declared scope** and materially better than the hand-maintained
  list it replaced, with three blind spots I have enumerated. It is not a universal brand detector.

The only remaining open item on this child is task 6.5, whose CI run reference is structurally
unavailable until the portfolio opens its PR — unchanged from round 1, and the intended state.

## Mutation hygiene (verification round)

Every mutation was applied to a file restored from an out-of-repo pristine snapshot under
`E:\tmp\verify-s1-snap` and restored the same way; `git checkout --` was never used. Restoration
verified byte-exact against the pre-mutation snapshots:

```
RESTORED-EXACT  5627d7c5...  src/core/store/planning-validation.ts          (probe F, H1, H2)
RESTORED-EXACT  6de40f78...  src/core/store/planning-identity.ts            (probes K, L, M, F)
RESTORED-EXACT  40ecab21...  src/core/store/planning-layout-v2.ts           (probe F)
RESTORED-EXACT  63346fa9...  src/core/store/finalization-v2.ts              (probe O)
RESTORED-EXACT  6262a35a...  src/core/index.ts                              (untouched)
RESTORED-EXACT  21b437b0...  test/.../planning-foundation-consumer.test-d.ts (probes G, G2, G3)
RESTORED-EXACT  ab03db32...  test/.../planning-foundation-consumer.test.ts  (untouched)
```

`planning-catalogs.ts` (probe H3, appended-to rather than snapshotted) was restored by removing the
exact appended byte string and verified through `git status --porcelain`, which is empty for the
whole tree. Per round 2's correction, working-tree sha256 is compared against the pre-mutation
snapshot and never against `git show`.
