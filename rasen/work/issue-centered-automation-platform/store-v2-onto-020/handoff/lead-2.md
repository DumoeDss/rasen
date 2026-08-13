# Handoff: store-v2-onto-020 — LEAD session 2

Written in English deliberately: the Write tool corrupts multibyte Chinese to U+FFFD in this repo.

Successor to `lead-1.md`. That handoff's "Next action (Step 2)" is what this session executed.

## Position

**Worktree:** `.claude/worktrees/store-v2-foundation`, branch `feat/store-v2-foundation`, based on
`origin/dev/0.2.0` @ `657c546d`. **Nothing is pushed.** Deps installed (root + `packages/ui`
separately — see Traps).

**Direction is ACTIVE**: `work.yaml` `status: active`, `activeSlice: slices/store-v2-foundation`
(commit `eb16db63`).

**The slice was decomposed into three strictly serial children** (no parallelism; every dependency
edge grepped; `plan.md` independently says `Parallelism: None`). The slicing mirrors 0.1.7's own
proven delivery order.

| Child | State | Delivery |
|---|---|---|
| `store-planning-contract-v2` (S1, Layer 0) | **done** | shipped `local` @ `f8e17e3d` |
| `store-worktree-bindings-v2` (S2, Layer 1) | **done** | shipped `local` @ `501b8943` |
| `store-issue-resources` (S3, Layer 2) | **apply in flight** | — |

Authoritative records — read these before acting:
- `.rasen/changes/store-v2-foundation/ephemera/portfolio-run.json` (portfolio, lessons, taxonomy)
- `.rasen/changes/<child>/ephemera/auto-run.json` (per-child stage state)
- `rasen/changes/store-v2-foundation/planning-context.md` (the planner's accumulated findings)

**Both shipped children have `archive` PENDING BY DESIGN.** Each has a task requiring a CI run
reference, and CI only runs on the pull request the portfolio opens **once, at the parent**, after
all three children are terminal. `archive --dry-run` correctly reports a tasks blocker. That blocker
is the machine record telling the truth — do not clear it, do not tick those tasks, and never use
`[~]` (see Traps).

## Next action

1. **Finish S3.** It is mid-`apply`: Sections 1–6 done, Section 7 (anti-blindness anchors) in
   flight, Section 8 (gates) pending. Its `auto-run.json` carries per-section state and six
   recorded findings. Then verify → review-loop → ship `local`, exactly as S1 and S2 ran.
2. **Portfolio delivery** at the parent: resolve the mode, open **one** PR, get CI green.
3. **Then archive all three children** — the PR's CI run reference is what unblocks the deliberately
   incomplete tasks (S1 6.5, S2 6.9/6.10, and S3's equivalent).

## Locked decisions (do not relitigate)

From `target-state.md` D1–D5, plus what this session settled:

- **The 0.1.7 line is a read-only behaviour reference, never a copy target.** Merge and cherry-pick
  are both proven unviable.
- **`git diff e62b101f origin/dev/0.2.0 -- src/core/store` is EMPTY.** 0.2.0 never touched the store
  directory since the merge-base, so store internals are a **greenfield drop**. The real collision is
  the consumer rim (`management-api/{router,wire-types}.ts`, `packages/ui/src/api/types.ts`,
  `cli/index.ts`, `completions/command-registry.ts`, six locale files). Re-run that one command
  before trusting any future "the store lines diverged" claim — it is the cheapest possible check.
- **`issues/` ⇄ `query/` is a real bidirectional import cycle** — inseparable, one Change.
- **`StoreIssues` has exactly three methods** (`create`/`setState`/`publishPlan`). The reads live on
  `StoreAggregateQuery`. The slice spec was corrected; it previously claimed `list`/`show` were on
  `StoreIssues`.
- **`session-runtime-context.ts` is carved out of S2** and handed to the slice that owns it. 0.1.7
  raises `RUNTIME_CONTEXT_VERSION` 1→2 and declares it breaking; 0.2.0 pins it at 1 and guards it
  **twice** (`z.literal` at :95 **and** an independent rejection at :255), with 14 consumers of which
  6 sit inside `management-api/` and did not exist on 0.1.7. Porting the bump makes every on-disk
  context file unreadable under a live daemon — a direct hit on locked Outcome 5.
- **`membership-layout.ts` moved out of S2** to the layout-migration slice: it reaches
  `layout-migration/receipt.js` via `layout-write-guard.ts`, and no consumer inside this portfolio
  imports it.
- **Deferring a test CASE is acceptable; shipping the behaviour untested is not.** Every deferral in
  this portfolio carries mandatory substitute coverage plus an inbound acceptance item for the slice
  that owns the missing piece.

## Method that must survive: per-commit attribution

**The 0.1.7 tip is never assumed to be the port target.** For each child: `git log e62b101f..origin/dev/0.1.7 -- <the child's files>` to find its base, then `git diff <base> origin/dev/0.1.7 -- <files>`
to see what *later* children added. It gave a **different correct answer three times**:

- **S1** — not the tip. The tip carried ~140 lines of S3-owned code (`IssueId`,
  `ExecutionPlanRevisionId`, the four `issue*` layout addresses) that no S1 suite exercises.
- **S2** — the tip. Its base is a five-child squash, and every post-squash change is one of the two
  mandated fixups or the block they rewrote.
- **S3** — the squash base, excluding `f4a48a36` (the coordinator-bridge slice, +409) entirely.
  Verified safe: at `0ede6cfb`, `module.ts` performs reference verification **inline**
  (`verifyReferences` at :336, called at :216, `resolveChangeReference` at :407, raising
  `issue_reference_ambiguous`/`issue_reference_unresolved` at :408-438), so excluding a commit that
  only *extracted* it does not lose this slice's named deliverable. Accepted consequence: S3's
  `issues/module.ts` is **not** byte-identical to the tip — the portfolio's first deliberate
  departure from byte-comparability.

**Never assume the answer carries over.** Run it fresh.

## The one defect class that cost this portfolio everything

**A guard that is silent about the thing it exists to catch.** Six variants surfaced, four of them in
work convened to fix earlier ones:

1. **Relational assertions are uniformly blind to uniform change.** A suite of `toMatch(shape)`,
   `.toBe(other)`, `.not.toBe(other)` and distinct-set counts cannot detect anything that transforms
   every value the same way — which is exactly what a preimage, digest or format change is. S1 passed
   **217/217 with every derived digest unanchored**. Cost: three review rounds plus an
   escalation-ladder attempt.
2. **A gate command frozen in time stops measuring what the subject grows.** The baseline gate was
   written before S2 existed and silently never ran any of S2's four command-level acceptance suites.
   Caught only by reconciling a skipped-test count that did not add up.
3. **A tripwire that checks shape but not existence.** `packages/ui/test/api/fixtures.test.ts` proves
   an *existing* wire-type mirror is shape-compatible and is **silent when the mirror was never
   written at all** — the exact failure mode it is relied on to prevent.
4. **A check that exists but is never invoked.** `packages/ui` has a `typecheck` script no CI job
   runs (CI runs `vite build`, which does not type-check, and `vitest run`). Eight type errors
   accumulated there unnoticed.
5. **A summarised count carried forward as an inventory.** My own briefs undercounted the capability
   set for **all three children** (told each planner 2; real answers 3, 3, 7) because I used the
   survey's `referenceSpecs` field as a directory listing. Every planner caught it independently.
   **Fix: list the prior-art change's own `specs/` directory.**
6. **A defensive requirement protecting behaviour that was never tested.** `issues/scope.ts` had
   **zero coverage anywhere** — including in the very file my own task assumed was its sole coverage.

**The habit that catches all six: ask what would have to be true for this to be silent, then make it
true and check.** In practice that means mutation-proving every guard, and it is why every finding in
this portfolio was re-run by a non-author rather than read.

## The anchor-shape taxonomy (earned, reusable)

Recorded in full under `anchorShapeTaxonomy` in `portfolio-run.json`. Picking the wrong shape produces
a test that cannot fail against the change it exists to catch.

- **Pinned literal** — value is offline-determinable. The default.
- **Reconstruct-and-rehash** — value embeds live per-run facts, so a literal is *physically*
  impossible. **Blind to a symmetric change**: if the test rebuilds by calling production's own
  serializer, a serializer shift moves both sides together. Needs an offline-pinned slice beside it.
- **Behavioural** — value is never externally observable (an internal de-dup key). Pinning a literal
  would pin an implementation detail; anchor the observable consequence instead.
- **Relational** — not a valid anchor. This is the blind shape.

**Proof rule:** the mutation used to prove an anchor must discriminate **the property the anchor
exists for**, not merely make something go red.

## Traps this session paid for

- **Use `node bin/rasen.js …`, never bare `rasen`.** The bare command is a globally installed
  dev-local build at **0.1.7** while this repo is **0.2.0**. I read a `--help` output as a fact about
  this branch when it was a fact about that binary. Every load-bearing measurement was re-run against
  the local build and all were identical — but check yours.
- **`[~]` is not a valid task marker.** `TASK_PATTERN = /^[-*]\s+\[[\sx]\]/i` does not match it, so a
  `[~]` task vanishes from **numerator and denominator** and no gate can see it. `validate --strict`
  passes under all three markers; only `archive --dry-run` blockers and `list --changes` counts
  discriminate. I made this mistake myself trying to *fix* a false claim, and moved it from prose a
  human reads into the machine record where nothing could.
- **One agent runs suites at a time.** Two of my own gate measurements were **void** — taken against a
  tree a reviewer was concurrently mutating, so they measured the reviewer.
- **Never triage a full-run failure by its shape.** A default-parallelism run produced six failures
  that **all passed solo** — and one was a hard assertion failure (`expected 1 to be +0`), not a
  timeout. A busy filesystem makes commands genuinely fail. Only a solo re-run separates contention
  from defect. Re-take gates at `VITEST_MAX_WORKERS=2`.
- **Never leave a mutation live across a background wait, and always label a mutation in place.** One
  implementer idled mid-mutation with a broken serializer in a shared Layer-0 file while a background
  suite ran against it. It was diagnosable *only* because the mutation carried a label saying what it
  was; a silent mutate-and-restore habit would have left an unexplained edit to a Layer-0 file.
- **Never `git checkout --` to revert a mutation** — `core.autocrlf` rewrites the tree to CRLF and
  produces a spurious whole-file diff. Restore from an out-of-repo snapshot and verify by sha256.
- **Parked workers are reachable only by signal file.** I sent a re-review instruction by
  `SendMessage` to a worker parked in `rasen agent wait`; it never arrived, the worker idled 12 beats
  to the keepalive cap and retired with the fix delta entirely unreviewed. Signal file is the only
  channel: `<changeRoot>/signals/<role>.json`. Check parked-vs-idle before every re-engagement.
- **`packages/ui` is excluded from the root vitest config** and had **empty `node_modules`** in this
  worktree — it is a standalone package with no workspace link. `pnpm exec vitest run packages/ui/test/`
  silently runs ZERO tests and prints "passed". Use `pnpm -C packages/ui exec …`.
- **Raw control bytes in source.** Two real production defects: a grouping-key separator written as a
  **raw NUL byte** instead of the two-character escape text, and `CONTROL_PATTERN`'s hex escapes
  written as raw bytes. `tsc` and every suite were silent. The detection path is `file` reporting
  `data` instead of text, and ripgrep refusing to grep a source file. A new variant of this repo's
  known Write-tool mangling hazard.
- **`commander-presentation.ts` hard-crashes CLI startup** on a structural mismatch between the live
  Commander tree and `command-registry.ts`, or on missing English locale copy for any registered
  command or flag. The failure mode is a dead binary, not a failing test.
- **Do not pre-write an `## Archive` heading in a ship log** — `rasen archive` treats it as belonging
  to another transaction and refuses with `archive_recovery_required`.
- **Commit with narrow explicit pathspecs** in this shared worktree — but check what you excluded. I
  missed a review report and a handoff document twice by being *too* narrow.

## Open items, carried not closed

- **`archive-engine.ts:2953-2966` is a live data-loss path.** A failed or absent read leaves
  `metadata = {}`, and the subsequent `quality` write overwrites the file with only that block. **Two
  archived records have already lost their `schema`/`created`** (`2026-07-07-ship-delivery-modes`,
  `2026-07-07-unify-expert-template-pipeline`). Found out-of-scope during S1 review. **Deserves its
  own change; the operator has not ruled on timing.** I raised it twice and did not press further.
- **A transient 2-test failure** in `test/cli-e2e/store-lifecycle.test.ts`, seen once during S1's
  apply, clean four times since. Verdict: transient / non-reproducing / **cause unestablished** —
  explicitly not "pre-existing" and not dismissed as flake. **One of the two failures was never
  read.** Lead preserved in `evidence/task-6-4-baseline-flake-analysis.md`.
- **The API/CLI resolver asymmetry.** `stores.ts` → `resolveStoreSpace` → `resolveStoreBinding` runs a
  stricter root-health check than the CLI-side `resolveRegisteredStore` path, so **a Store that works
  from the command line can fail over the API**. Open question, not fixed, out of scope for S3.
- **`workspace-cleanup.test.ts` ran 396.85s solo** against a `KNOWN_SLOW_TEST_WEIGHTS_MS` entry of
  `166610` — possibly a >2x underestimate. Shard-skew risk for CI.
- **The S1 brand-vocabulary guard reads only three hardcoded Layer-0 sources.** A brand introduced
  elsewhere inherits no coverage. S2 added none; S3 adds `IssueId`/`ExecutionPlanRevisionId` to a file
  the guard already reads, so no extension was needed — but re-run `git grep 'unique symbol'` for any
  future surface rather than inheriting that answer.
- **Eight pre-existing `packages/ui` type errors** in three files this portfolio never touches. They
  do **not** threaten delivery (CI never type-checks that package), but the unrun `typecheck` script
  is the standing defect.
- **S3's UI components are not nav-wired** — reachable only by direct import. Deliberate: neither
  governing spec requires reachability, and wiring would modify shell structure in the divergent rim
  against the additive-only rule. Named as a follow-up for whoever lands the operations-UI surface.

## What went right, and why it is worth keeping

S1 took **three review rounds plus an escalation-ladder attempt** to close 17 findings. S2 closed 5 in
**one round, 0 Blocker / 0 Major**. The workers were not better; **S1's most expensive lesson was
written into S2's `tasks.md` at propose time instead of being discovered at review time.**

The other thing that repeatedly worked: **inviting challenge to my own shortcuts.** I ruled that an
anchor could be proved by mutating a child-owned file rather than a shared Layer-0 one — right about
blast radius, **wrong about sufficiency**, because the perturbation moved only one side of the
comparison. A verifier caught it *because I told it explicitly not to pre-trust my ruling*. A shortcut
authored by the orchestrator is the one least likely to be challenged unless the challenge is invited.
