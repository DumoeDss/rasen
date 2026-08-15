# Review round 1, Minor 3 — shape-(b) digest anchors strengthened and mutation-proved

## Background

Review round 1 (Minor 3) found that the two shape-(b) "reconstructed-and-rehashed"
digest anchors — `plan.ts:794` (`workspace-plan.test.ts`) and the with-entry branch
of `cleanup.ts:251` (`workspace-cleanup.test.ts`) — reconstruct their expected value
by calling production's own `canonicalBytes` a second time, so a change to
`canonicalBytes`/`canonicalJson` itself (the shared RFC 8785 serializer in
`src/core/canonical-json.ts`) moves both sides of the comparison together and the
anchor stays GREEN when it should redden. This is distinct from the five shape-(a)
pinned-literal anchors (`locks.ts:128`, `registry.ts:201`, `binding.ts:93`,
`dependencies.ts:343`, and the no-entry branch of `cleanup.ts:170`), which hardcode
the expected digest offline and are therefore not symmetric under this class of
change.

Fix: added one extra assertion to each of the two shape-(b) anchor tests, pinning
`canonicalBytes` of the small, deterministic (non-Git-fact) field slice of `body`
to a literal computed offline with the real `canonicalize` package, independent of
calling `canonicalBytes` again at test time. Because this new assertion's expected
side never re-invokes production's serializer, it is not symmetric under a
`canonicalBytes` change and reddens even when the original full-body comparison
does not.

Each anchor's strengthening was mutation-proved with its own independently
measured RED/GREEN cycle, not inferred from the other's cycle, per the reviewing
lead's explicit ruling that "structurally the same code, therefore proved" is not
acceptable evidence in this portfolio.

## Anchor 1 — `plan.ts:794` (`workspace-plan.test.ts`, test `'plan id is exactly
sha256(canonicalBytes(body)) hex, over body and nothing else'`)

### Pristine state

`sha256sum src/core/canonical-json.ts`:

```
c733a42f7e4b26f638731d7293298cf2edde139c2c0fe0ccffe70553611f3071
```

Baseline solo run, `test/core/store/workspace-plan.test.ts`: 23 passed (23), 0 failed.

### Mutation

This anchor's blind spot is specifically a `canonicalBytes` serialization shift, so
the mutation targets the shared serializer itself — the one production seam both
sides of the original (non-strengthened) comparison route through:

```ts
// src/core/canonical-json.ts, canonicalJson()
-  return result;
+  // MUTATION-PROOF (review round 1, Minor 3): uniform serialization shift.
+  // Must be reverted immediately after RED is recorded.
+  return `X${result}`;
```

### RED

Same command, same file, mutated. Result: 1 failed, 22 passed (23). The failure was
the new strengthening assertion at `workspace-plan.test.ts:249-258` — its expected
side is the offline literal `'{"changeId":"redesign-routing","intent":"new-change","pathFlavor":"native","schemaVersion":1}'`,
its received side is whatever `canonicalBytes(...)` returns at test time, which
under the mutation is that same string with the mutation's `X` prefix prepended
(`canonicalJson` is the sole formatter both `canonicalBytes` call sites route
through). The pre-existing full-body comparison two lines above it
(`expect(plan.planId).toBe(expectedPlanId)`) stayed green under the same
mutation, in the same run — reproducing exactly the blind spot review round 1
described: `planId` and `expectedPlanId` are both computed from the same mutated
serializer, so they moved together and the comparison could not tell.

### Revert

Reverted via `Edit` (not `git checkout --`, which under this repo's
`core.autocrlf=true` would rewrite the file to CRLF rather than restore it
byte-exactly).

`sha256sum src/core/canonical-json.ts` after revert:

```
c733a42f7e4b26f638731d7293298cf2edde139c2c0fe0ccffe70553611f3071
```

Matches the pristine hash exactly. `git diff -- src/core/canonical-json.ts` empty.

### GREEN

Same command, same file, reverted: 23 passed (23), 0 failed, 98.25s.

### Supplementary observation

`canonical-json.ts` is a shared Layer-0 file that the five shape-(a) pinned-literal
anchors also route through. As a byproduct of the same mutation window (captured
before revert, in a since-superseded run against `workspace-cleanup.test.ts`), the
pre-existing no-entry pinned-literal anchor at `cleanup.ts:170` was also observed
to redden under this mutation, alongside the new `cleanup.ts:251` strengthening
assertion — consistent with shape-(a) anchors never having been blind to this
class of change in the first place. That observation is reported here as
supplementary context only; it is not offered as the required per-anchor proof
for `cleanup.ts:251` — see Anchor 2 below for that, measured independently and
confined to `cleanup.ts` itself.

## Anchor 2 — `cleanup.ts:251` (`workspace-cleanup.test.ts`, test `'cleanup plan id
is exactly sha256(canonicalBytes(body)) hex, over body and nothing else'`)

Per the reviewing lead's explicit instruction, this anchor's strengthening was
proved with a mutation confined to `cleanup.ts` itself rather than a second
mutation of the shared `canonical-json.ts` — narrowing the blast radius to an
S2-owned file, and giving this anchor a genuinely independent measurement rather
than an inference from Anchor 1.

### Pristine state

`sha256sum src/core/store/workspace/cleanup.ts`:

```
9b08319f8f9e3eb7c0599e48eb86a8247ffbd44f8d76fcfad85d14ccc0c40826
```

Baseline solo run, `test/core/store/workspace-cleanup.test.ts`: 26 passed (26), 0 failed.

### Mutation

Perturbed the with-entry branch's own construction of one field feeding the pinned
slice, confirmed beforehand (by grep over the test file) that no other assertion
in the 26-test suite reads `plan.changeId` directly, so collateral from the
production-value change itself — as opposed to the assertion this is proving —
should be minimal:

```ts
// src/core/store/workspace/cleanup.ts
   const body = {
     schemaVersion: 1 as const,
     scope: input.scope,
-    changeId: input.changeId,
+    // MUTATION-PROOF (review round 1, Minor 3, cleanup.ts:251 anchor). Must be
+    // reverted immediately after RED is recorded.
+    changeId: `${input.changeId}!`,
     targets,
```

### RED

Isolated the anchor test with `pnpm exec vitest run test/core/store/workspace-cleanup.test.ts -t "cleanup plan id is exactly sha256"`, mutated:

```
FAIL test/core/store/workspace-cleanup.test.ts > workspace cleanup > cleanup plan id is exactly sha256(canonicalBytes(body)) hex, over body and nothing else
AssertionError: expected '{"applicable":true,"changeId":"redesi…' to be '{"applicable":true,"changeId":"redesi…' // Object.is equality

Expected: "{"applicable":true,"changeId":"redesign-routing","includeUntracked":false,"schemaVersion":1}"
Received: "{"applicable":true,"changeId":"redesign-routing!","includeUntracked":false,"schemaVersion":1}"

 ❯ test/core/store/workspace-cleanup.test.ts:398:9
```

1 failed, 25 skipped (26) in the filtered run. The new strengthening assertion
named the exact mismatch — the pinned literal's `changeId` vs. the mutated
production value with `!` appended — precisely the discrimination it exists to
provide.

A prior unfiltered full-suite run captured against the same live mutation (before
isolating to the single test above) showed materially wider collateral than
predicted: 9 of 26 tests failed, not only the new assertion. Because `body.changeId`
feeds `planId`, which several other tests re-derive and compare against
independently-observed state (resumed-phase records, sibling-Change refusal,
reachability, index-entry removal), the mutated `changeId` propagated into those
comparisons too. This collateral is a property of choosing `changeId` as the
perturbation point in this production function, not evidence against the anchor
itself; the isolated run above is the authoritative proof for the specific
assertion under review.

### Revert

Reverted via `Edit` (not `git checkout --`).

`sha256sum src/core/store/workspace/cleanup.ts` after revert:

```
9b08319f8f9e3eb7c0599e48eb86a8247ffbd44f8d76fcfad85d14ccc0c40826
```

Matches the pristine hash exactly. `git diff -- src/core/store/workspace/cleanup.ts` empty.

### GREEN

Same command, same file, reverted, full suite: 26 passed (26), 0 failed.

## Conclusion

Both shape-(b) anchors now carry a strengthening assertion that is not symmetric
under a `canonicalBytes` serialization shift, and each was proved with its own
independently measured RED/GREEN cycle — Anchor 1 via a mutation of the shared
serializer (the failure mode the strengthening exists to catch), Anchor 2 via a
mutation confined to its own owning file (the same discrimination, measured
without touching Layer-0 a second time). Both mutations were reverted byte-exactly
and confirmed via `sha256sum` against a pre-recorded pristine hash and an empty
`git diff`, and both suites were re-confirmed fully GREEN afterward. Design
Decision 4's claim about shape (b) is now backed rather than narrowed: the
blindness the reviewer described is closed for both sites named in task 6.1.
