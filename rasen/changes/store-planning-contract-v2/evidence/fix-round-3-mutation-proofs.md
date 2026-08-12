# Fix round 3 — golden vectors, the Archive negative matrix, and an exhaustive brand pin

Rounds 1-3 found six instances of one defect class: an assertion that cannot fail. This round was
directed at the class rather than the instances, so two of the four fixes below install a *mechanism*
that keeps the property true as the code grows, not just an assertion that is true today.

**This round touched no contract source.** `git diff --stat eaefc01b HEAD -- src/core/store` is empty,
and `git diff --name-only eaefc01b..HEAD -- src/` is still just `src/core/index.ts` from round 1.

Protocol unchanged: out-of-repo pristine snapshots, restored with `cp`, `git checkout --` never used
(`core.autocrlf=true` would rewrite the tree to CRLF).

## N5 — golden vectors for the four derived identities

Every identity assertion in the suite was *relational* — `toMatch(/^ps_[0-9a-f]{64}$/u)`,
`.toBe(other)`, `.not.toBe(other)`, `new Set([...]).size === 4`. All of those survive any change that
transforms every digest uniformly, which is why bumping all four domains and deleting the `domain`
field both left 217/217 green.

Six new tests in `planning-identity-v2.test.ts` pin known input to known digest, one per derived kind
(the worktree kind twice, planning and execution role), plus one that walks every golden digest back
through its own verifier so a preimage change cannot hide behind a verifier that stopped checking.

The digests were generated from the implementation **as committed at `eaefc01b`** — this pins today's
format as the contract, it does not propose a new one. The test file states, in the block comment
above the vectors, that a failure here is a breaking format change requiring a deliberate versioned
decision, and must not be "fixed" by pasting in the new digest: these identities are written into
`.openspec.yaml`, so a silent preimage change invalidates every identity ever minted.

### Probe K — bump every versioned domain `/v2` → `/v3` (4 sites)

Before: 217/217 green. After, across the six Layer-0 suites:

```
Tests  6 failed | 217 passed (223)

FAIL ... > Store planning v2 identity golden vectors > pins the PlanningScopeId preimage to a known digest
FAIL ... > Store planning v2 identity golden vectors > pins the ChangeInstanceId preimage to a known digest
FAIL ... > Store planning v2 identity golden vectors > pins the 'planning' WorktreeInstanceId preimage to a known digest
FAIL ... > Store planning v2 identity golden vectors > pins the 'execution' WorktreeInstanceId preimage to a known digest
FAIL ... > Store planning v2 identity golden vectors > pins the WorkspacePairId preimage to a known digest
FAIL ... > Store planning v2 identity golden vectors > accepts every golden digest through its own verifier
```

### Probe L — delete the `domain` field from all four preimages (4 sites)

Before: 217/217 green. After: the **same six** RED, by the same names.

### Probe M — rename one preimage field, domain untouched

`storeUid` → `storeUuid` in the `PlanningScopeId` preimage only. This isolates the claim that the
vectors pin *field names*, not just the domain string — a claim the test comment makes, so it should
not be taken on trust:

```
Tests  2 failed | 30 passed (32)

FAIL ... > pins the PlanningScopeId preimage to a known digest
FAIL ... > accepts every golden digest through its own verifier
```

The two worktree vectors and the change-instance/workspace-pair vectors stayed **green**, which is the
intended signature: each vector takes pinned literals as input rather than chaining off the previous
derivation, so a break in one preimage does not smear across all four. The failure set localises the
preimage that changed.

Restored: `sha256(src/core/store/planning-identity.ts) = 6de40f7805a55e9a9401e37d40442e43468c17a056fd5ac0f4ce6f15d9252429`.

## N4 — the Archive v2 cross-field null matrix

Task 4.4 claims four properties are "structurally impossible to violate". The schema does enforce all
four; three had no negative fixture anywhere. Added eight rejection fixtures mirroring the matrix the
same file already carried for the smaller `FinalizationOutcomeSchema`, and gave the three
passive-history tests the negative half their name promised ("**only** with null merge and unapplied
empty spec sync" — the body previously built one valid record and asserted acceptance).

### Probe O — relax every cross-field null constraint across all five variants

`codeMerge: z.null()` → `z.any()` (3 sites), `supersededBy` (3 sites), `reason` (2 sites).
Before this fix: **53/53 passing, nothing reddened.** After:

```
Tests  11 failed | 50 passed (61)

FAIL ... > accepts passive superseded history only with null merge and unapplied empty spec sync
FAIL ... > accepts passive cancelled history only with null merge and unapplied empty spec sync
FAIL ... > accepts passive abandoned history only with null merge and unapplied empty spec sync
FAIL ... > rejects 'a landed record carrying a reason'
FAIL ... > rejects 'a landed record carrying a successor'
FAIL ... > rejects 'a planning-only landed record carrying a code merge'
FAIL ... > rejects 'a superseded record carrying a code merge'
FAIL ... > rejects 'a cancelled record carrying a code merge'
FAIL ... > rejects 'an abandoned record carrying a code merge'
FAIL ... > rejects 'a cancelled record carrying a successor'
FAIL ... > rejects 'an abandoned record carrying a successor'
```

All eleven enumerated by name. The three passive-history tests now redden for the right reason — the
"only" clause — rather than through accept-side sensitivity.

Restored: `sha256(src/core/store/finalization-v2.ts) = 63346fa9ed0a10a9194b07be7b83f3e77f22497f1d9bfe5c436b27a1a497354e`.

## N6 — all 16 brands pinned, and a guard so a 17th cannot arrive unpinned

The comment claiming "each branded name is pinned INDIVIDUALLY" was true of 7 of 16. Rather than
correct the comment or hand-extend the list, both were done **and** the completeness property was
mechanised: `planning-foundation-consumer.test.ts` now reads the brand declarations out of the three
Layer-0 sources (`export type X = string & {` and `export type X = Y & {`, which catches the two
verified subtypes) and asserts each has an exact bare-string pin in the type suite.

Exactness matters here: a substring check would let `VerifiedWorkspacePairId` satisfy the requirement
for `WorkspacePairId`. The guard parses the exact type argument out of each
`expectTypeOf<string>().not.toMatchTypeOf<X>()` and compares set membership, with one explicit alias —
the store-planning `ChangeInstanceId` is published as `StorePlanningChangeInstanceId`, because
`change-run` owns the bare name at the package root.

### Probe F — collapse all 9 previously-unpinned brands at once

`TargetLineId`, `ChangeId`, `FullGitRef`, `GitOid`, `Sha256Digest`, `PlanningScopeId`,
`ChangeInstanceSeed`, `WorktreeInstanceId`, `StorePlanningPath` → bare `string`.

| gate | before this fix | after |
| --- | --- | --- |
| `pnpm exec tsc --noEmit` | exit 0 | **exit 0 — still blind** (the collapse is internally consistent) |
| six Layer-0 suites | 217 passed | passes — runtime cannot see a type collapse |
| `pnpm run test:types` | 5 passed, no type errors | **exit 1, 9 type errors** |

All nine land in `refuses a bare string where a branded value is required`, one per collapsed brand.

### Probe G — remove a single pin

The guard must catch the case it exists for, so I deleted the `GitOid` pin from the type suite:

```
Tests  1 failed | 17 passed (18)

FAIL ... > Store planning v2 branded vocabulary is pinned exhaustively > pins GitOid against a bare string
AssertionError: GitOid is declared in src/core/store but has no
  expectTypeOf<string>().not.toMatchTypeOf<GitOid>() pin in planning-foundation-consumer.test-d.ts
```

One test, named for the brand, and the message states the exact line to add.

## N7 — a parameterized test that discarded its parameter

`planning-validation-v2.test.ts` ran `it.each(['win32','posix'])` over a body that never used the
flavor, because `isPortableRelativePath` and `isFullGitRef` take none. Collapsed to a single test named
for what it checks — the rule is unconditional on every platform, which is the point — with a comment
recording why it must not be re-parameterized. Test count drops by one for this reason.

## Restore ledger

```
RESTORED-EXACT  6de40f78...  src/core/store/planning-identity.ts      (probes K, L, M, F)
RESTORED-EXACT  63346fa9...  src/core/store/finalization-v2.ts        (probe O)
RESTORED-EXACT  5627d7c5...  src/core/store/planning-validation.ts    (probe F)
RESTORED-EXACT  40ecab21...  src/core/store/planning-layout-v2.ts     (probe F)
git diff --stat eaefc01b HEAD -- src/core/store   ->  (empty)
git diff --name-only eaefc01b..HEAD -- src/       ->  src/core/index.ts   (round 1's m3 only)
```

## Counts

```
six Layer-0 suites   217 -> 247   (+6 golden vectors, +8 archive negatives,
                                   +17 vocabulary guard, -1 from the N7 collapse)
pnpm run test:types  5 type tests, no type errors
tsc --noEmit / lint / build / rasen validate --strict   all clean
```
