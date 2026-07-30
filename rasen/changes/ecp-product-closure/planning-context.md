# Planning Context — ECP-5 `ecp-product-closure`

Seeded by the LEAD before the first propose. Read this FIRST, then research only what is missing.

## Position

Final (7th) child of the `executable-composite-pipelines` portfolio. DAG:

```
ecp-definition-v2 -> ecp-run-spine -> ecp-review-cycle -> ecp-custom-composite
  -> ecp-goal-loop -> ecp-full-feature -> ecp-product-closure
```

Every prerequisite has landed. ECP-4 (`ecp-full-feature`) shipped local on `feat/ecp-review-cycle`
at `2fcd5438`, review-clean after 3 rounds + 1 strategy step (17 findings, all non-author confirmed).
Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-ecp-review-cycle`.

**Do not touch** `E:\...\OpenSpec-code` (primary checkout, `dev/0.2.0`) — another session has
uncommitted work there.

## Declared scope (authoritative — from `rasen/changes/executable-composite-pipelines/decomposition-plan.md`)

> Close the 0.1.6 product and compatibility surface; **do not add a new runtime model.**

- `rasen-auto`, `rasen-goal`, `rasen-review-cycle` thin launcher/preset/adapter convergence
- reconciler engine selection/default/fallback and legacy recovery policy
- complete CLI/Canvas/Operations product wording and capability discovery
- built-in and Custom Composite end-to-end dogfood matrix
- migration/user documentation and 0.1.6 version/release contract
- remove duplicate prompt-owned mechanical rules where replacement evidence exists

**Acceptance:**
- no entry owns independent mechanical progression
- one Run has one engine owner and one canonical state
- all 0.1.6 exit conditions in the research document have evidence
- full root/composite crash-recovery and cross-plane parity suite passes
- packaging/build/release checks pass

**Why it is separate (keep this framing):** this is an **integration and deletion** slice. It can
only be reviewed honestly after every consumer has landed, and its job is to stop compatibility
code from becoming an accidental second implementation. Deleting is as much the deliverable as
adding.

Research doc to mine for the exit conditions: `rasen/work/issue-centered-automation-platform/`
(`deterministic-pipeline-kernel-research.md`, `roadmap.md`, `slices/`).

## Inherited work that is ALREADY in this slice's scope

ECP-3 (`ecp-goal-loop`) shipped with 56/62 tasks ticked. Two of the six unticked are explicitly
this slice's job — treat them as inherited scope, not as someone else's debt:

- **9.3** Update `auto.ts` (`rasen-auto`): remove goal-loop mechanical references; auto thins to
  selection/launch only
- **9.4** Update `goal-iterate.ts` and `goal-report.ts` to read from the `ChangeRunView` goal
  section instead of `goal-run.json`

The other four are ECP-3's own unfinished verification, and they bear directly on the
"all exit conditions have evidence" acceptance — decide explicitly whether ECP-5 discharges them:
**13.1** full suite zero regressions · **13.2** root+UI tsc · **13.3** ESLint on changed files ·
**13.4** cross-platform verification on Windows.

## Candidates to adjudicate (NOT pre-approved — judge each against declared scope)

1. **`getReviewCycleSection` has zero consumers** in `packages/ui/src` while ECP-1's delta spec
   PROMISES Operations consumption (`executable-review-cycle/spec.md:146`). This is a live
   false-promise in a shipped sibling's spec, and "cross-plane parity suite passes" plus
   "complete Operations product wording" both point at it. ECP-4 just closed the identical hole
   for parallel/choice, so there is a worked pattern to copy.
2. **Parallel-only v1 lowering is broken**: `resolveCapabilityBindings` emits `stage:<id>` while
   the v2 lowerer (routed via `requiresV2Lowering`) looks up `root:stage:<id>`, so a v1 pipeline
   with `parallelGroup` and no ReviewCycle cannot lower at all. `supported_v2_parallel` is
   therefore production-unreachable. Fits "engine selection/default/fallback".
3. **UI parity constants drift**: `packages/ui` structurally cannot import root `src/`, so the
   Operations parity test asserts hand-copied constants. A reviewer probe
   (`test/core/change-run/reviewer-r3-ui-constants-provenance.test.ts`) currently serves as the
   drift tripwire. Cheap mechanical closure: have the node-side test import canonical constants
   from a data module under `packages/ui/test/` and assert them against its own projection.
4. **Two pre-existing `packages/ui` test failures** in `test/canvas/pipeline-canvas-page.test.tsx`,
   failing since before ECP-4 (`00e63cfa`) — `fanout`/`join` editor-supported flag mismatch and a
   missing `composite` node kind. Every slice since has carried them as a known baseline.
   "Packaging/build/release checks pass" is the natural place to finally close or formally accept
   them. Decide which.

## Hard-won lessons from ECP-1..4 — apply these, do not relearn them

- **A green kernel suite proves almost nothing about the production path.** ECP-4 was 993/993
  green while the real CLI hit FIVE consecutive Blockers. Every acceptance claim in this slice
  needs fresh-process real-CLI evidence, not unit tests.
- **Fixing one defect makes the next reachable.** This happened THREE times in ECP-4. Anything
  this slice revives or re-enables must be re-reviewed end-to-end for its semantics, not just
  diffed.
- **A shared reader makes a parity suite blind by construction.** The parallel/choice sections are
  consumed by three planes calling one projector, so parity could only ever prove the planes agree
  — never that the reader is right; all three were wrong identically. The "cross-plane parity
  suite" acceptance must include a check of the reader against the KERNEL's answer for the same
  Record.
- **A test asserting current behavior is not a test asserting correct behavior.** A test encoding
  `finish: false` as EXPECTED turned a silent deadlock into a green check.
- **False ticks are this portfolio's signature defect — FOUR in ECP-4 alone** (3.4, 7.4, 8.5, 8.6),
  each "code written, test never was". Task 3.4 claimed a synthetic capability while
  `grep parallel-dispatch src/` returned nothing, and that tick is what let the first Blocker
  through. Cheap detector: grep the implementation's own error strings against `test/`.
- **Prefer build-time rejection when the invariant is a pure function of the plan** — it can name
  the offending node and no Run is created. Runtime escalation is for facts that only exist once
  execution has happened.
- **Status-blind result readers are a recurring class here**: any helper reading a committed result
  to make a control-flow decision must filter on completion status, and every absent-field fallback
  turns a failed action's partial output into maximal blast radius.
- `counters.attempts` bounds the WHOLE Run, not retries per invocation.

## Delivery

Children ship **local** (commit only, no push, no PR). `feat/ecp-review-cycle` has no upstream. The
**portfolio** delivers once, at the parent, as a single PR **to `dev/0.2.0`** after this last child
is review-clean. Archive is `on-merge` and follows the user's merge — ECP-4 is parked at `pending`
awaiting exactly that.

**Target corrected 2026-07-30 (user):** the ECP paradigm lands on **`dev/0.2.0`**, not `dev/0.1.6`.
Strategy changed — `0.1.6` is now the **bug-fix line off `0.1.5`**, not the ECP release. The
retarget costs nothing mechanically: `origin/dev/0.2.0` (`8270941a`) is an **ancestor of this
branch** (114 ahead, 0 behind), so the PR fast-forwards, and `origin/dev/0.2.0` carries the same
`0.1.5`/`0.1.5` package versions the lockstep evidence was taken against. `origin/dev/0.1.6` holds
**8 commits absent from `0.2.0`**, two of them breaking (`feat(cli)!: separate structure from
localized copy` #110, `feat(agent)!: add runtime edit boundary`) — so the old target was the harder
one. Watch #110 when those 8 reach `0.2.0`: it reshapes skill structure/copy, and this portfolio
owns the generated-skill parity hashes.

Known parked items, owned by the user, NOT this slice's job unless the proposal argues otherwise:
- `packages/ui/package-lock.json` — stray npm lockfile in a pnpm repo, predates ECP-4, awaiting a
  user decision. Do not delete it.
- Archive will mint `TBD - created by archiving` Purpose placeholders for new capabilities; the fix
  belongs at archive time, after the merge.
