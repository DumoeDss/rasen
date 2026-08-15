# Task 8.2 — the gate re-derived from this change's own test-file additions

Written in English for byte-safety, as every other evidence file in this directory is.

Task 8.2 has two halves. This document closes the **derivation** half. The **verification** half
("verify the run's reported file count against the change's test-file additions") requires the gate
run itself, which is task 8.3 and has not been taken. Task 8.2 therefore stays `[ ]`, for the same
reason S1 6.5 and S2 6.9 do: the tick would be a claim no run supports yet.

## The input: this change's actual test-file diff

Derived, not recalled — `git diff --name-status 501b8943..HEAD -- test packages/ui/test`
(child 2's ship commit to this child's HEAD):

**Added, root runner (11):**

| File | Covered by the prior gate list? |
|---|---|
| `test/core/store/store-aggregate-query.test.ts` | yes (`test/core/store`) |
| `test/core/store/store-issue-digest-anchors.test.ts` | yes (`test/core/store`) |
| `test/core/store/store-issue-layout.test.ts` | yes (`test/core/store`) |
| `test/core/store/store-issue-locks.test.ts` | yes (`test/core/store`) |
| `test/core/store/store-issue-scope.test.ts` | yes (`test/core/store`) |
| `test/core/store/store-query-lock-free.test.ts` | yes (`test/core/store`) |
| `test/core/store/store-query-read-only-guard.test.ts` | yes (`test/core/store`) |
| `test/commands/store-issue-cli.test.ts` | **NO** |
| `test/commands/store-aggregate-cli.test.ts` | **NO** |
| `test/core/management-api/stores.test.ts` | **NO** |
| `test/core/management-api/store-aggregate-wire-mirror.test.ts` | **NO** |

**Added, `packages/ui` runner (3):** `test/components/store-aggregate-board.test.tsx`,
`test/components/store-issues-view.test.tsx`, `test/fixtures/store-aggregate.ts`.

**Modified (4):** `test/core/store/planning-layout-v2.test.ts` (+80),
`test/core/store/planning-validation-v2.test.ts` (+75),
`test/core/store/planning-foundation-consumer.test.ts` (+5),
`test/core/store/planning-foundation-consumer.test-d.ts` (+11).

So **four** of this change's own acceptance suites were outside the prior gate list — the same
failure child 2 hit with its four command suites, reproduced at the same size. The cause is
structural and repeats: the list names `test/commands/store.test.ts` and
`test/commands/store-root-selection.test.ts` as *individual files*, so nothing a child later adds
under `test/commands/` is ever picked up, and `test/core/management-api/` was absent entirely.

## The corrected gate: three commands, not one

The root runner alone cannot cover this change. Two of its additions live outside what
`vitest run` reaches by default, and that is a property of the config, not an oversight to fix here.

### 1. Root no-regression gate

```
VITEST_MAX_WORKERS=2 pnpm exec vitest run \
  test/core/store test/core/change-run test/core/management-api \
  test/commands/store.test.ts test/commands/store-root-selection.test.ts \
  test/commands/store-target-line-cli.test.ts \
  test/commands/store-v2-workspace-concurrency.test.ts \
  test/commands/store-v2-workspace-journey.test.ts \
  test/commands/workspace-cli.test.ts \
  test/commands/store-issue-cli.test.ts test/commands/store-aggregate-cli.test.ts \
  test/cli-e2e/store-lifecycle.test.ts
```

`test/core/management-api` is added as a **directory**, not as the two files this change happens to
add. Naming files is precisely what froze the list twice; a directory absorbs the next child's
additions without anyone remembering to. The cost is real and accepted: the directory pulls in
`stores.test.ts` at ~200s plus the pre-existing management-api suites, and it will raise the gate's
file count well above child 2's 122.

`test/commands/` is deliberately **not** promoted to a directory: it contains `pipeline.test.ts`
(229s), `artifact-workflow.test.ts` (123s) and the rest of the heaviest table in
`KNOWN_SLOW_TEST_WEIGHTS_MS`, which would turn the gate into a near-full-suite run. The named-file
form is kept there with the standing obligation that each child appends its own.

### 2. Type-level gate — `pnpm run test:types`

`vitest.config.ts` sets `include: ['test/**/*.test.ts']`, which does **not** match
`*.test-d.ts`, and `typecheck` is disabled by default (`vitest.config.ts:154-162`). This change
modified `planning-foundation-consumer.test-d.ts` — extending S1's branded-vocabulary guard from 16
names to 18 with `IssueId` and `ExecutionPlanRevisionId` — and **no invocation of the root gate, at
any file list, runs it.** Only `pnpm run test:types`
(`vitest run --typecheck.enabled --typecheck.only`) does.

This is a **local-gate gap only, not a CI gap**: `.github/workflows/ci.yml:280` runs
`pnpm run test:types`. The guard is covered where it counts. But a local reviewer who runs the
no-regression gate and sees green has not exercised the change's type-level guard at all.

### 3. `packages/ui` gate — `pnpm -C packages/ui exec vitest run`

`packages/ui` is excluded from the root vitest config and is a standalone package with no workspace
link, so `pnpm exec vitest run packages/ui/test/` silently runs **zero** tests and prints "passed".
Recorded already under task 5.4; repeated here because it is part of this change's gate, not a
footnote to it.

## Finding: this change's UI suites never run in the PR's CI

Discovered while re-deriving the above, and outside what task 8.2 was looking for.

`.github/workflows/ci.yml:151-156` runs `packages/ui` tests in exactly one place — a step gated on
`matrix.label == 'windows-pwsh-shard-1'` — against a **hardcoded four-file list**:

```
pnpm --dir packages/ui exec vitest run test/components/local-path-picker.test.tsx \
  test/components/spaces-page.test.tsx test/components/workflows-page.test.tsx \
  test/components/pipelines-page.test.tsx
```

This change's two new component suites are not in that list, and no other `ci.yml` step runs
`packages/ui` tests. `.github/workflows/release.yml:93` does run the full
`pnpm --dir packages/ui test`, so the suites are not unreachable everywhere — but they are
**invisible to the pull request that this portfolio opens**, which is the only gate that runs before
the code lands.

This is the identical defect class as the two frozen gate lists above, found a third time, now
inside CI itself rather than in a local command. It is recorded rather than fixed: adding the two
files to `ci.yml` would put a `.github/` path into this child's diff, which task 8.8 has already
audited as clean of anything outside `.ts`/`.tsx`/`.json`/`.md`, and CI configuration is a
portfolio-delivery concern (portfolio task #8), not a child-scope one. **Decision owner: whoever
executes portfolio delivery.** The options are (a) append the two files to the `ci.yml` list,
(b) replace the hardcoded list with a full `packages/ui` run on one shard, or (c) accept that these
components' suites gate only at release.

## Finding: `packages/ui typecheck` IS invoked by a workflow

The recorded finding `unrunTypecheck` (auto-run.json, and
`evidence/packages-ui-unrun-typecheck.md`) states that **no** CI job invokes `packages/ui`'s
`typecheck` script, and concludes the pre-existing type errors "do not threaten delivery". The
verification behind it was scoped to `ci.yml` alone.

`.github/workflows/release.yml:89-90` runs `pnpm --dir packages/ui typecheck` as a named step, and
`packages/ui/package.json` additionally wires `prepublishOnly` to
`pnpm run typecheck && pnpm run test && pnpm run build`.

Measured this session on a clean tree: `pnpm -C packages/ui exec tsc --noEmit` **fails**, exit 2,
with **11 errors across 3 files** — `src/canvas/ConsultationBindingEditor.tsx` (8),
`src/canvas/IssuesDrawer.tsx` (1), `test/canvas/v2-node-panel-consultation.test.tsx` (2). The
earlier record says 8 errors; the file count matches but the error count does not.

Confirmed **not** caused by this portfolio: `git log --oneline origin/dev/0.2.0..HEAD` over those
three paths returns **no commits**, so they are unmodified since the merge base `657c546d`.

The correction that matters: "does not threaten delivery" holds for *this PR's CI* and does **not**
hold for the release workflow, which will fail on these errors at the next publish of 0.2.0. That
is a dated, live risk rather than a latent one, and it belongs to whoever owns the canvas/
consultation surface, not to this change.
