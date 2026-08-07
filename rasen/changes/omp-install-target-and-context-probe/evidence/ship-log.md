# Ship Log: omp-install-target-and-context-probe

**Date:** 2026-08-07T04:56:30Z
**Mode:** pr
**Branch:** `feature/omp-install-target-and-context-probe`
**Commit:** `1288ca5b81d385d7c8d8d2fcdc59a6bef7a24e9b`
**Tree:** `7fadacb2de845ecf09bc744ed40977eb9c009772`
**Base:** `dev/0.1.7` (`DumoeDss/rasen`)
**PR:** https://github.com/DumoeDss/rasen/pull/142
**Status:** PR Created

Head pushed to `origin` (`pashifika/rasen`); base repository is `upstream`
(`DumoeDss/rasen`). Same fork-to-upstream shape as PR #136, #137 and #141. The
branch's own git tracking is left pointing at the `local` gitea remote,
unchanged by this ship — so `git push origin <branch>` was used without `-u`.

## Pre-Flight Results

- Verification: pass — `verification-report.md` (`VERIFY VERDICT: CLEAN —
  Blocker:0 Major:0 Minor:13 Trivial:8`) and `review-report.md` (two rounds; the
  thirteen Minors resolved in `c906a6ae` — seven fixed, six rejected with
  evidence).
- Tasks: 52/52 complete. Nothing was checked off during this ship; every box was
  already closed before it started.
- Base divergence: 0 behind / 11 ahead of `upstream/dev/0.1.7`, so no
  pre-validation merge was required.
- Working tree: two unrelated deltas left uncommitted and out of this delivery —
  `rasen/config.yaml` carries the same CLI-generated reformat (line rewrapping
  plus `tools: []`) that the previous two ships also excluded, and `bin/rasen.js`
  carries a mode-only change (`100644 → 100755`, zero content lines). Neither
  belongs to this change. This is now the third consecutive ship to exclude the
  identical pair, which makes it a standing repo wart rather than a one-off.
- Diff scan: 65 files, +5775 / -1178. The only `console.log` additions under
  `src/` are the two that render the nested-install disclosure in `init`'s and
  `update`'s success messages — user-facing output matching the surrounding
  code, not debug leftovers. No secrets and no TODO/FIXME markers in added lines.
- `git diff --check upstream/dev/0.1.7...HEAD`: exit 0. Run deliberately, because
  this is the exact CI gate that failed the previous branch after its PR was
  opened; the `pnpm-vitest-preflight-ci-parity` guidance names it and the
  previous ship recorded not running it as an execution miss.

## Test Gate

- Required scope: full repository suite, plus `packages/ui`'s suite and both
  typecheck realms.
- Rationale: the change widens a shared wire contract
  (`HandoffThresholdReport.shouldHandoff` became optional) consumed by the
  command layer and the generated orchestration templates; it edits the runtime
  capability matrix and the compile-time fixture that enforces it; and it moves
  workflow templates whose parity tests hash generated content. `packages/ui`
  sits outside the root vitest include and holds one half of the wire mirror this
  change widened, so the root suite alone does not cover the delivered risk.
- Tests: `pnpm run lint && pnpm exec tsc --noEmit && pnpm run build && pnpm exec
  vitest run` — pass, exit 0. **349 files, 6167 passed, 27 skipped (6194)**
  (166.12s). Then `pnpm --dir packages/ui typecheck` and `pnpm --dir packages/ui
  test` — pass, **49 files, 502 passed** (4.75s).
- Tree: `7fadacb2de845ecf09bc744ed40977eb9c009772`

Green evidence was **not** reused. `verification-report.md` records tree
`7b011ea6eaedee114f78f2c852f84d0b943509c6`, which is commit `cecc12b7` — three
code-bearing commits (`300fb515`, `a2d320e9`, `c906a6ae`) landed after it.
`review-report.md`'s gate table belongs to its first round and records no tree
fingerprint at all, so it cannot be matched against the delivered tree even
though its numbers postdate part of the work. The gate was re-run in full.

The gate ran against the delivered tree plus the two uncommitted non-source
deltas noted above. Neither is a test input: `bin/rasen.js` changed no content,
and `rasen/config.yaml` is this repo's own planning config, which the suite does
not read.

### The `packages/ui` gate needed a pnpm workaround

`pnpm --dir packages/ui <script>` fails before running anything:
`runDepsStatusCheck` invokes `pnpm install`, which exits 1 with
`ERR_PNPM_IGNORED_BUILDS: esbuild@0.25.12`. The root `pnpm-workspace.yaml`
declares no `onlyBuiltDependencies`, so esbuild's build script is unapproved and
the pre-run verification refuses. This is environmental and pre-existing — it has
nothing to do with this change's diff — and it was reproduced both concurrently
with the root gate and serially afterwards, so contention was not the cause.

Both `packages/ui` gates were therefore run as
`pnpm --dir packages/ui --config.verify-deps-before-run=false <script>`, which
skips the pre-run check and leaves the already-installed tree untouched. The
result (49 files, 502 tests) matches what `review-report.md` recorded
independently, which is the cross-check that the bypass changed nothing.

**One artifact was left behind by this.** The first `pnpm --dir packages/ui`
attempt wrote a stub `packages/ui/pnpm-workspace.yaml`
(`allowBuilds: {esbuild: set this to true or false}`) as its approval prompt. It
is untracked, so it is not in the delivery, but it should not stay: a
`pnpm-workspace.yaml` inside `packages/ui` makes that directory a pnpm workspace
root in its own right. Removing it was attempted and refused by this session's
command policy, so it is recorded here for manual removal:

```
rm packages/ui/pnpm-workspace.yaml
```

The underlying wart is worth fixing at the root: adding `esbuild` to
`onlyBuiltDependencies` in `pnpm-workspace.yaml` would make
`pnpm --dir packages/ui test` work without a flag, and the `packages/ui` suite is
a gate this project runs on every ship.

## Open follow-ups travel with the change

The verdict is CLEAN, which means no Blocker and no Major is open — not that
nothing is left. Thirteen deferred items are recorded in
`evidence/deferred-followups-report.md`, each with a named owner. Three are
called out in the PR body because they bear on approval:

- **FU-A / FU-B** — token auditing and worker dispatch for Oh My Pi stay out of
  scope by design, and between them own the four `runtime-adapter-interface-extraction`
  follow-ups (FU-1 dispatch spawn enforcement, FU-2 audit zero-report, FU-3 audit
  wire mirror, FU-4 viewer allow-list) that this change does not close.
- `isUnmeasurableWindow` returns `false` at `contextTokens === 0`, so an unlisted
  model whose session never measured anything, plus an absolute
  `{remainingTokens: N}` threshold, still answers `shouldHandoff: true`.
  Reproduced, narrowed a great deal by this change, left deliberately because
  tightening it would move the Codex young-rollout reading that
  `cli-agent-context` pins byte-identical.
- `findLatestOmpSession` compares path identity without canonicalizing, against a
  documented repo standard. Both realistic macOS aliases were attempted and
  neither reproduces — `process.cwd()` already returns the physical canonical
  path — so it is a standards-conformance gap, not a live defect.

## A separate change's planning artifacts ride along

Commit `1288ca5b` added `rasen/changes/agent-context-occupancy-contract-gaps/`
(proposal and two delta specs, no code) — the next change, proposing the three
occupancy-contract gaps this work surfaced but does not close. It is on the
branch and therefore in PR #142's diff. Recorded here and noted in the PR body so
a reviewer does not read it as unimplemented scope of this change.

## Deployment

Status: Pending (run `rasen-ship --deploy` to continue)

## Archive Timing

Timing: `on-merge`. The change stays ACTIVE during PR review — `status`,
`resume`, and fix-forward keep working. Retention (`rasen-retain`) is the next
lifecycle action; archive follows merge confirmation of PR #142.
