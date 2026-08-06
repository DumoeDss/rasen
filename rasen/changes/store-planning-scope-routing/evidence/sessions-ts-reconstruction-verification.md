# Lead verification: reconstruction of `src/core/management-api/sessions.ts`

- **Verifier:** portfolio lead (authored none of the reconstruction).
- **Incident:** during round-2 fixing, `git checkout -- src/core/management-api/sessions.ts` reset the file to baseline `b86fbb6b`, discarding this Change's own uncommitted modifications to it (the P5 run-state work and the space-identity listing filter). The round-2 fixer reconstructed it from inference.
- **Independent witness:** `sessions-ts-recollection.md`, written by the round-2 reviewer from its own context, under an explicit prohibition on reading the reconstruction.

## Recovery attempts (all failed)

The original was never staged, so it has no Git blob. Three avenues were checked and none held it:

| Avenue | Result |
| --- | --- |
| Git object store | Never `git add`ed (` M` in status at session start); no blob exists |
| Vitest transform cache (`node_modules/.vite`) | Holds only `vitest/<hash>/results.json` — no transformed sources |
| local-version harness (`%LOCALAPPDATA%\rasen\local-harness`) | `staging/` empty; `runtimes/` holds only 0.1.6 and 0.2.0 builds from other lines, not this 0.1.7 branch |

The original is unrecoverable mechanically. Verification is therefore by invariant checking, not by diff.

## Result against the witness's 8 invariants

**7 of 8 hold exactly.** Checked against the reconstruction at the line numbers below.

| # | Invariant | Verdict | Where |
| --- | --- | --- | --- |
| 1 | `import { ephemeraDir } from '../file-placement.js';` | HOLDS | `:18` (witness saw `:17`; one-line shift only) |
| 2 | `locations` has exactly 3 members, ordered `ephemeraDir`, `workDir`, conditional spread; condition is `storeV2Planning`, set from `planningScope.describe().kind === 'store-project'` | HOLDS | `:290-294`, `:273` |
| 3 | `workDir: home ? home.workDir(record.changeName) : null` — ternary yielding `null` | HOLDS | `:292` |
| 4 | `ephemeraDir` called unconditionally with `executionRoot` (not spread-guarded as in `pipeline.ts` / `project-space.ts`) | HOLDS | `:291` |
| 5 | `buildChangeRunEntry(record.changeName, changeDir, locations)` | HOLDS | `:295` |
| 6 | Two-line comment reading "Terminal locations belong to the frozen execution checkout. The / scope-resolved planning Change remains the oldest compatibility location." | **DIVERGES** | `:286-289` |
| 7 | Catch path uses `kind: 'error'`, `message: error instanceof Error ? error.message : String(error)`, then `continue;` | HOLDS | `:274-284` |
| 8 | `handleGetSession` returns `{ ok: true; status: 200; response: SessionDetailResponse } \| { ok: false; status: 404 }` | HOLDS | `:301-304` |

### The one divergence (invariant 6)

Comment text only; no behavioral impact. The witness recorded two lines; the reconstruction has four, and cites `task 5.5`:

> Terminal locations belong to the frozen execution checkout. For a Store v2 project scope the planning Change directory is NEVER an ephemera fallback (task 5.5); for standalone and legacy scopes it remains the oldest compatibility location.

Recorded rather than "corrected": it is evidence that the reconstruction is **not byte-faithful**, which bounds how much the 7 passing invariants can be trusted to imply elsewhere. A cosmetic-only divergence is the best available outcome, but it is not the same as an exact restore.

Also cosmetic: the final `sessions.push({...})` is now one line where the witness observed four (`:287-290`).

## The genuine residual risk

**The space-identity listing filter has no independent witness.** The reviewer states plainly that its review path never reached it — no verbatim text, no line numbers, no shape, no behavior — and that it never opened `sessions-space.test.ts` or `space-scoping.test.ts` either, so it holds no indirect evidence from the test side.

What does pin the reconstruction of that filter:

- **Strong, external:** `router.ts:1095` fixes the parameter type `Pick<ResolvedSpace, 'type' | 'id'> | undefined`, `:1102` fixes how it is constructed, and `:1104` fixes the call arity — the reconstruction at `:187` matches all three.
- **Strong, behavioral:** `test/core/management-api/sessions-space.test.ts` (12 tests) is this behavior's spec and passes, as does the whole `management-api` suite (615 passed, 1 skipped, 0 failed).
- **Semantic:** the filter is a three-condition guard at `:192-199` — skip unless `record.space` exists and both `type` and `id` match — filtering by recorded planning-space IDENTITY rather than canonical root, so a Store space matches every session recorded against it regardless of which member checkout executes it. That rationale is consistent with design D3 as quoted in `router.ts:1092-1094`.

What is NOT pinned: any behavior of that filter which no test covers and which the router signature does not constrain. Nothing can close that gap; it can only be read hard by a reviewer who knows it is reconstructed.

## UPDATE — the filter predicate residue is now CLOSED

The round-2 fixer's provenance audit named the filter predicate as its weakest residue, because no test distinguishes three candidate readings: compare `type`+`id`, compare `id` only, or still canonicalize the root for `project` spaces. It reasonably suspected the third, since the now-dead `canonicalizeOrResolve` helper had to have existed for some reason.

Two independent sources settle it, neither of which is the reconstruction.

**1. The baseline shows what the helper was for.** `git show b86fbb6b:src/core/management-api/sessions.ts`:

```ts
  filterRoot: string | undefined,
...
    if (filterRoot !== undefined) {
      if (!record.space || canonicalizeOrResolve(record.space.root) !== filterRoot) {
```

Baseline filtered by **canonical root**. So `canonicalizeOrResolve` is fully explained as baseline's mechanism, made dead by this Change's move to identity filtering. Its presence is not evidence that the Change's filter canonicalized anything, and the fixer's removal of it (with the now-unused `path` import) is correct.

**2. `router.ts` is NOT reconstructed, and it makes the root reading impossible.** The intact call site declares `filterSpace: Pick<ResolvedSpace, 'type' | 'id'> | undefined` (`:1095`), builds it as `{ type: resolved.space.type, id: resolved.space.id }` (`:1102`), and passes exactly that (`:1104`). The parameter type **excludes `root` by construction**, so the original `handleListSessions` had no root available to canonicalize. The "still canonicalizes the root" reading is not merely unsupported — it could not have compiled.

**3. The spec forbids the `id`-only reading.** `specs/planning-space-addressing/spec.md:30-32` requires "Same id in both namespaces is unambiguous": a Store and a project may both be `elftia`, and `space=store:elftia` must resolve unambiguously. A predicate comparing `id` alone would match a project session for a Store selector, violating that scenario.

Comparing `type` **and** `id` is therefore the minimal predicate consistent with all three constraints, and the more restrictive alternatives are excluded by `test/core/management-api/sessions-space.test.ts:379-450`. The reconstruction at `:192-199` does exactly that.

Wording note, per the round-3 reviewer: this is *not* "over-determined", which is what an earlier draft of this section claimed. Three constraints narrow the predicate to one minimal form and exclude the restrictive alternatives; they do not independently prove it. The distinction matters because residues (b) and (c) below rest on the same kind of reasoning, and overstating this one would license overstating those.

Residue (a) is closed. Residues (b) comment/docstring wording and (c) behavior neither tested nor constrained by siblings remain open by construction — though (c) is bounded: the diff touches only the imports and `handleListSessions`, and the other three exported handlers are byte-identical to baseline.

## Standing instruction for the next reviewer

Read `src/core/management-api/sessions.ts` knowing it is reconstructed, and weight the space-identity filter above everything else in the file. Passing tests establish consistency with what the tests check — they do not establish that the file is what was lost. Treat "the tests pass" as insufficient here and reason from the spec and the call sites instead.
