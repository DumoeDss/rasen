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
