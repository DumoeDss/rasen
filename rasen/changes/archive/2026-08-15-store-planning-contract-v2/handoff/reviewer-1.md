# Handoff — reviewer-1 (store-planning-contract-v2, round 1)

Reason: `rasen agent wait --role reviewer` returned `{"standDown": true, "reason": "beat-cap"}` after
12 beats with no fix delta dispatched. Round-1 review is COMPLETE and delivered; this is a warm-park
expiry, not an abandoned unit of work.

## State

- Round-1 review of commit `eaefc01b` is DONE. Full report:
  `rasen/changes/store-planning-contract-v2/evidence/review-report.md` (401 lines, LF, untracked).
- Findings delivered to the LEAD via SendMessage: **Blocker 0 | Major 4 | Minor 5 | Trivial 2**.
- Working tree left byte-clean. `git status --porcelain -- src test` is empty. Every file I mutated
  was restored from an out-of-repo pristine copy (never `git checkout --`, which `core.autocrlf`
  would rewrite to CRLF) and sha256-verified against `git show eaefc01b:<path>`.

## What a successor reviewer needs to know

### The four Majors are all VERIFICATION defects, not behavior defects

The port is faithful. The complete diff of all five Layer-0 modules against `origin/dev/0.1.7` is
exactly the S3 subtractions plus two documented deltas (t1, t2 in the report). No wrong behavior was
found in the shipped contract.

M1/M2/M3 are the same shape: each of design Decision 5, 6, and 7 is a "fix folded in beyond the
`a7135669` ship commit", each is implemented correctly, and each ships with tests that provably
cannot tell fixed from unfixed. Tasks 2.7 and 4.6 claim those exact test cases and are checked `[x]`.

### Re-verification recipe for the fix delta (do NOT accept a green run as proof)

Each fix must be re-mutation-proven. The seam and the exact mutation that must now go RED:

| Finding | File:line | Mutation that MUST now turn the suite RED |
| --- | --- | --- |
| M1 | `src/core/store/planning-layout-v2.ts:93` | `return path.win32.parse(storeRoot).root.length > 1;` -> `return true;` |
| M2 | `src/core/store/planning-catalogs.ts:78` | `id: z.string().min(1).optional(),` -> add `.regex(/^[a-z0-9]+(-[a-z0-9]+)*$/u)` |
| M3 | `src/core/store/finalization-v2.ts:198` | `CapabilityPathSchema` -> `z.string().refine(v => /^[a-z0-9]+(-[a-z0-9]+)*$/u.test(v), '...')` |
| m1 | `test/core/store/planning-foundation-purity.test.ts:54` | add `export async function p(){ return await import('./foundation.js'); }` to a Layer-0 module |
| m2 | same guard | add `import * as fs from 'node:fs';` to `src/core/id.ts` |

In round 1 every one of those mutations left the suites fully GREEN (174/174, 92/92, 41/41, 15/15,
15/15 respectively). If any still stays green after the fix, the fix is theater.

Seam-liveness control for M3 already established: replacing `CapabilityPathSchema` with
`z.string().refine(() => false, ...)` turns 3 tests RED, so the seam IS wired to the suite — a green
run under the single-kebab mutation is a genuine coverage gap, not a dead seam.

### Mutation hygiene that worked here

```
mkdir -p /tmp/rev-s1-backup
cp src/core/store/<file>.ts /tmp/rev-s1-backup/<f>.ts          # pristine copy OUTSIDE the repo
sed 's|<old>|<new>|' /tmp/rev-s1-backup/<f>.ts > src/core/store/<file>.ts
pnpm exec vitest run <suites>
cp /tmp/rev-s1-backup/<f>.ts src/core/store/<file>.ts          # restore
sha256sum src/core/store/<file>.ts                             # must match `git show eaefc01b:...`
```

Pristine hashes at `eaefc01b` (all re-verified after restore):

```
5627d7c57ffed212e47b771b8f78b710f10eb22b010228495fb9c76968df8192  src/core/store/planning-validation.ts
6de40f7805a55e9a9401e37d40442e43468c17a056fd5ac0f4ce6f15d9252429  src/core/store/planning-identity.ts
40ecab21674080d48881699b099df60b0fc507cce4f06666316c92a3be26ec66  src/core/store/planning-layout-v2.ts
63346fa9ed0a10a9194b07be7b83f3e77f22497f1d9bfe5c436b27a1a497354e  src/core/store/finalization-v2.ts
14774dedb0a3f7adaa317e5ce55302fa9cd7daba39d4870a2fdecc0d6ce85ca5  src/core/store/planning-catalogs.ts
8df535575aaf18e3aeca06c281037ce87daa12c4e1bcbbb07cd8e6c0632d266a  src/core/id.ts   (untouched by this commit)
```

## Settled — do not re-litigate

These were pressure-tested to completion in round 1; a fix delta does not reopen them.

1. **Barrel disambiguation (`src/core/index.ts:42`) is SOUND.** The claim "nothing imports the bare
   name" is verified: the only importer of `./core/index.js` is `src/index.ts:16` (`export *`), and
   no file in `src/`, `test/`, or `packages/` imports `ChangeInstanceId` from either barrel.
   `change-run/index.ts` is an explicit export list, so no value-level collision exists. Future
   mis-binds fail LOUDLY (incompatible brands = compile error; a new value clash = hard TS2308). The
   only residual is m3 (the PUBLISHED package-root type silently changed meaning; one-line alias fix).
2. **`.strict()` + `quality` passthrough is CORRECT.** 336 `.openspec.yaml` read through the built
   schema: 334 OK. The 2 failures (`archive/2026-07-07-ship-delivery-modes`,
   `archive/2026-07-07-unify-expert-template-pipeline`) are PRE-EXISTING — both lack `schema:`
   entirely, which the PRE-change schema at `eea78de8` already required. Real archived record read
   through the real `readChangeMetadata` preserves `quality` including `rulesExtracted`. Passthrough
   is exactly calibrated to `archive-engine.ts:2892`'s `{ files: [], metrics: {} }` writer.
3. **Purity guard DOES discriminate** on `process.env`, `process.cwd`, `node:child_process`, Store
   registry, and `node:fs` — I re-ran all five mutations myself, all RED and correctly file-named.
   `process.platform` at `planning-layout-v2.ts:90` is deliberately not forbidden and that is correct.
4. **Port target is CLEAN in both directions.** S3 surfaces absent (grep-proven); nothing S1 needs
   was removed; no spec requirement lacks an implementation.
5. **The store-lifecycle failure did not reproduce.** My independent full re-run of the task 6.4
   command on `eaefc01b` was 110 files / 1438 passed / 1 skipped, ZERO failures (345.72s). It is
   transient, NOT shown to be "pre-existing" (M4 is about the unsupported causal claim, not about a
   code fix). If the fixer only rewords the evidence file, that closes M4.

## A fix round landed while I was parked — NOT re-reviewed by me

At the moment of stand-down, `git log --oneline eaefc01b..HEAD` shows four commits that appeared
during my warm park and that I never saw:

```
fcb5d326 fix(s1): untick 6.5 - the run reference is unsatisfiable before delivery
e60249fd docs(s1): commit the review report that a narrow pathspec missed
221bf789 fix(store): close review round-1 coverage gaps in planning contract v2
ebaf17a8 chore(s1): record verify verdict and route fixes to a non-author
```

A new `evidence/fix-round-1-mutation-proofs.md` also exists, and
`evidence/purity-guard-mutation-proof.md` and `evidence/task-6-4-baseline-flake-analysis.md` were
modified. **I did not review any of this.** The beat cap expired before a resume instruction reached
me, so round 2 is entirely unstarted. Treat the fix delta as UNVERIFIED, and treat the new
`fix-round-1-mutation-proofs.md` as a recorded claim, not as evidence — this repo presumes a recorded
mutation proof is nothing until re-run.

## Next action for whoever resumes

Re-review ONLY the fix delta: `git diff eaefc01b..HEAD` (currently through `fcb5d326`). Run the five
mutations in the table above yourself against the CURRENT committed bytes and confirm each now turns
its suite RED — that is the whole point of round 2, and it is exactly what round 1 proved the old
suites could not do. Then confirm `git status --porcelain -- src test` is clean and update the
finding list in place at `rasen/changes/store-planning-contract-v2/evidence/review-report.md`
(sticky-legacy rule: update, do not create a second report).

Note `e60249fd` committed my round-1 report; re-read it from the commit rather than assuming the
working-tree copy is what shipped.

Out-of-scope item already handed to the LEAD (do not fix here): `src/core/archive-engine.ts:2953-2966`
overwrites `.openspec.yaml` with only the `quality` block when the prior read fails or the file is
absent, which is how the two archived records above lost `schema`/`created`. Live data-loss path,
already-lost data, deserves its own change.
