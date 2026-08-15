# Fix round 2 — mutation proofs for N1 (inert type assertions) and N2

Round 2 found that **no check in this repository could make an `expectTypeOf` assertion fail**, while
task 5.2 was ticked claiming those assertions prove the brands discriminate. This records the harness
that closes it and the four mutations that prove it discriminates.

Protocol is unchanged from round 1: pristine bytes copied OUTSIDE the repository before any edit and
restored with `cp`; `git checkout --` never used (`core.autocrlf=true` would rewrite to CRLF).

## The harness

| File | Role |
| --- | --- |
| `test/core/store/planning-foundation-consumer.test-d.ts` | the type-level assertions (new) |
| `test/core/store/planning-foundation-consumer.test.ts` | keeps only the runtime composition half |
| `tsconfig.typecheck.json` | `src/**/*` + `test/**/*.test-d.ts`, nothing else |
| `vitest.config.ts` | `test.typecheck` block; **disabled by default**, so `pnpm test` is unchanged |
| `package.json` | `test:types` = `vitest run --typecheck.enabled --typecheck.only` |
| `.github/workflows/ci.yml` | one step, "Type check type-level tests", in the existing Lint & Type Check job |

Scope was deliberately held to `*.test-d.ts` rather than dropping `test` from the root tsconfig's
`exclude`, which would have signed the whole suite up for type checking in one step and likely
surfaced unrelated pre-existing errors.

```
pnpm run test:types
 ✓ TS test/core/store/planning-foundation-consumer.test-d.ts (5 tests)
 Test Files  1 passed (1)
 Type Errors  no errors
```

## A — an obviously false assertion (the reviewer's own probe)

```
mutate: expectTypeOf<VerifiedChangeInstanceId>().toMatchTypeOf<StorePlanningChangeInstanceId>();
    ->  expectTypeOf<number>().toMatchTypeOf<StorePlanningChangeInstanceId>();
```

| gate | before the fix (round-2 reviewer) | after the fix (this round) |
| --- | --- | --- |
| `pnpm exec tsc --noEmit` (CI's Type check step) | exit 0 | **exit 0 — still blind** |
| `pnpm run lint` | exit 0 | **exit 0 — still blind** |
| `pnpm exec vitest run …consumer.test.ts` | 1 passed | 1 passed — still blind |
| `pnpm run test:types` | did not exist | **exit 1, RED** |

```
 × public Store planning foundation type surface > refuses an unverified id where a verified one is required
 TypeCheckError: Type 'ChangeInstanceId' does not satisfy the constraint
   '`Expected literal string ${ChangeInstanceId}, Actual number`'
   test/core/store/planning-foundation-consumer.test-d.ts:47:42
```

One test fails, not a cascade; the other four pass. The two rows still reading "blind" are the point:
they identify exactly which gate closed the hole, and that the old ones remain unable to see it.

## B — the m3 direction flip

Round 2 established that deleting `src/core/index.ts:48` is a hard TS2308, but that *aiming* it at the
other brand — reverting to precisely what `eaefc01b` shipped — compiled clean and broke nothing.

```
mutate: export type { ChangeInstanceId } from './change-run/index.js';
    ->  export type { ChangeInstanceId } from './store/planning-identity.js';

pnpm exec tsc --noEmit  -> exit 0        (still blind, as round 2 measured)
pnpm run test:types     -> exit 1, RED
  × public Store planning foundation type surface > keeps the published ChangeInstanceId pointing at the change-run brand
```

The direction is now pinned. Note the TypeCheckError text is necessarily opaque here (both brands are
*named* `ChangeInstanceId`, so the message reads `Expected literal string ${ChangeInstanceId}, Actual
literal string ${ChangeInstanceId}`); the attribution comes from the test name, which states the
invariant in full.

## C — weakening the real API (partial result, recorded honestly)

```
mutate: ComputeStorePlanningLayoutV2Input.changeInstanceId: VerifiedChangeInstanceId -> string
pnpm run test:types    -> exit 1, RED (2 tests: the two bare-string/unverified-id cases)
pnpm exec tsc --noEmit -> exit 2  <-- ALSO caught
```

Recorded for completeness rather than as evidence for the harness: this mutation breaks `src/`
internally (`planning-layout-v2.ts:314`), so the root type check catches it too. It shows the
assertions track the real API, but it is **not** a case only the new gate sees. That is what probe D
is for.

## D — collapsing the brand itself, and the gap it exposed in my own assertions

The mutation task 5.2 actually claims to protect: make a bare `string` satisfy the branded vocabulary,
in a way `src/` stays internally consistent with.

```
mutate: src/core/store/planning-identity.ts
        export type ChangeInstanceId = string & { readonly [changeInstanceIdBrand]: true };
    ->  export type ChangeInstanceId = string;

pnpm exec tsc --noEmit                       -> exit 0   (the whole public vocabulary now accepts
                                                          bare strings, and nothing in src objects)
pnpm exec vitest run consumer + identity-v2  -> 27 passed (runtime cannot see a type collapse)
```

**First run of D against my own assertions was GREEN.** That was a real gap, found by mutation rather
than by reading: every bare-string assertion went through
`Parameters<typeof computeStorePlanningLayoutV2>[0]['changeInstanceId']`, i.e. through
`VerifiedChangeInstanceId` — which stays branded by *its own* symbol when `ChangeInstanceId` collapses.
So the parameter assertions held while the underlying vocabulary silently became `string`.

Fix: pin each branded name against a bare `string` individually, not only through the parameters.
Re-run with the mutation still in place:

```
 × public Store planning foundation type surface > refuses a bare string where a branded value is required
 Type Errors  1 failed
```

Restored: `sha256(src/core/store/planning-identity.ts) = 6de40f7805a55e9a9401e37d40442e43468c17a056fd5ac0f4ce6f15d9252429`
(matches `git show HEAD:` for this file — it is one of the LF-authored files, see the round-1 note on
`core.autocrlf`). Re-run after restore: 5 passed, no type errors.

## Restore ledger

```
RESTORED-EXACT  ae8bdf1f…  test/core/store/planning-foundation-consumer.test-d.ts   (probe A)
RESTORED-EXACT  6262a35a…  src/core/index.ts                                        (probe B)
RESTORED-EXACT  40ecab21…  src/core/store/planning-layout-v2.ts                     (probe C)
RESTORED-EXACT  6de40f78…  src/core/store/planning-identity.ts                      (probe D)
git diff --stat eaefc01b HEAD -- src/core/store   ->  (empty)
```

## N2 — the `[~]` marker

`tasks.md:51`, `[~]` → `[ ]`, PARTIAL prose kept verbatim. The LEAD's reasoning was accepted by the
reviewer; only the marker was wrong, because `src/utils/task-progress.ts:7` matches `[\sx]` only, so
`[~]` removed the line from numerator *and* denominator. Measured after the fix, on this worktree:

```
rasen list --changes --json
  { "name": "store-planning-contract-v2", "completedTasks": 35, "totalTasks": 36, "status": "in-progress" }

rasen archive store-planning-contract-v2 --dry-run --json
  /archive/plan/blockers = [{ "operation": "tasks", "message": "1 task(s) are incomplete." }]
  /archive/blockers      = [{ "operation": "tasks", "message": "1 task(s) are incomplete." }]
```

This is the intended end state, not a defect to clear: task 6.5 is genuinely incomplete until the
portfolio PR's Windows CI run exists, and this child must not archive before then. The dry-run left no
`.rasen-archive-stage-*` residue.
