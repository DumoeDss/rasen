# Combined A–D2 verification result

The single recorded run that settles the four restated `full suite green` gates
(archived B 10.8, C 10.9, D1 8.5, D2 9.11 — restated per
`stabilize-store-context-foundation` design D6).

**This document lives in the change directory and archives with the change**, so
a later reader of `rasen/changes/archive/<date>-stabilize-store-context-foundation/`
can open the evidence the four gates cite. The original was written to the
machine-local work directory, which is untracked and exists on one machine only;
a gate whose evidence pointer nobody else can open is not checkable evidence,
which is exactly what this change's own `verify-ship-evidence` requirement is
about. Every claim below is re-checkable with one command against the branch.

- Branch: `feat/store-context-unification`
- Branch base: `d73c1da2` (`feat(release): publish CLI and UI in lockstep`)
- Tree state: working tree as of this change's implementation, before staging
- Date: 2026-07-26

## What was run

| Command | Result |
|---|---|
| `pnpm lint` (`eslint src/ test/ vitest.config.ts vitest.setup.ts`) | **exit 0**, no findings |
| `pnpm build` (`node build.js`, TypeScript 5.9.3) | **exit 0**, "Build completed successfully" |
| `npx tsc --noEmit -p tsconfig.json` | **exit 0**, no diagnostics |
| `pnpm test` (`vitest run`, whole CLI suite) | **exit 1** — 284 files, 280 passed, 4 failed; 4931 tests, 4897 passed, 3 failed, 31 skipped; duration 578s |
| `pnpm --dir packages/ui exec vitest run test/components/launch-session-dialog.test.tsx` | **exit 0**, 20/20 |

The `pnpm test` run was carried to completion. It was backgrounded with bounded
foreground polling (≤270s intervals), and no two vitest batches ran
concurrently, per the discipline that earlier work established after concurrent
batches produced spurious timeouts on this repository.

## Every failure observed, and its attribution

Four failing files. All four are accounted for; none is left unexplained.

### 1. `test/release-contract.test.ts` — suite-level `SyntaxError: Invalid or unexpected token`

Attribution: **pre-dates the entire portfolio.**

Evidence, each one command:

- `git diff d73c1da2..HEAD -- test/release-contract.test.ts scripts/release-contract.mjs` → **empty**. The test and the module it imports are byte-identical to the branch base.
- `git status --porcelain` over both paths → **empty**. Neither is modified in the working tree either.
- `git log -- test/release-contract.test.ts scripts/release-contract.mjs` → last touched by `d73c1da2`, which **is** the branch base.
- Both files are pure ASCII (byte scan: no NUL, no byte > 0x7F, no BOM), so the syntax error is not a content-corruption artifact introduced by any commit here.

Nothing on this branch — A–D2 or this change — can have caused it.

### 2. `test/cli-e2e/basic.test.ts` — "localizes pipeline human output while preserving machine and user values"

Failure: `expect(listResult.stderr).toBe('')` received an installed-skill
version warning: *"已安装的技能由 rasen v0.1.5-dev.local.1 生成；当前运行的 CLI
版本为 v0.1.5"*.

Attribution: **machine environment, not repository state.**

Evidence:

- `git diff d73c1da2..HEAD -- test/cli-e2e/basic.test.ts` → **empty** (byte-identical to base).
- The warning is emitted by `checkSkillVersionGuard` in `src/core/root-selection.ts:853`, which compares the version stamp of the **skills installed on this machine** against the running CLI's `OPENSPEC_VERSION`.
- The stamp is `0.1.5-dev.local.1`. The repository's `package.json` version is `0.1.5`, and `git grep "dev\.local" -- src test packages scripts` returns **nothing** — that version string exists nowhere in tracked source, so no commit on this branch could have produced it. It comes from a locally packed `-dev.local` tarball the developer installed globally.

Already recorded as a known pre-existing failure in this change's planning
context ("CLI locale test — installed-skill version warning on stderr").

### 3. `test/commands/handoff.test.ts` — "bounds relays with maxRelays and stall detection"

Failure: the orchestration playbook no longer contains the literal
`maxRelays: 3` the assertion looks for.

Attribution: **pre-dates the branch base.** This corrects the attribution
recorded during planning, which named the concurrent-session commit
`313df542`; the evidence below places it earlier, and `313df542` does not touch
`maxRelays` at all (`git show 313df542 | grep maxRelays` → no matches).

Evidence:

- `git diff d73c1da2..HEAD -- test/commands/handoff.test.ts src/core/templates/workflows/_orchestration.ts` → **empty**. Both the test and the playbook it asserts on are byte-identical to the branch base.
- `git log -S "maxRelays: 3" -- src/core/templates/workflows/_orchestration.ts` → `58faffad feat(ui): add threshold scheme management surfaces` is the commit that rewrote the precedence paragraph and dropped the literal, leaving the assertion stale.
- `git merge-base --is-ancestor 58faffad d73c1da2` → **true**. `58faffad` is an ancestor of the branch base, so it precedes every A–F commit.

Not an A–D2 commit, and not this change.

### 4. `test/commands/workset.test.ts` — "codex carries its sandbox pre-args; a single member attaches itself"

Failure in the full run: `Test timed out in 10000ms`, followed by
`EPERM, Permission denied` while removing
`C:\Users\Sayo\AppData\Local\Temp\rasen-workset-Z7zV1s` in `cleanupTempPath`.

Attribution: **the documented Windows temp-cleanup flake in CLI-spawning
tests**, not a logic failure.

Evidence:

- `git diff d73c1da2..HEAD -- test/commands/workset.test.ts src/commands/workset.ts` → **empty** (byte-identical to base).
- Isolated re-run after clearing leftover temp directories: `pnpm exec vitest run test/commands/workset.test.ts` → **exit 0, 41/41 passed**. The failure does not reproduce outside the loaded full-suite run.
- Signature matches the known pattern for this repository: 10s timeout plus `EPERM`/`EBUSY` on `rmSync` of a Windows temp directory still held by a spawned CLI process.

This file was **not** in the three failures planning had anticipated. It is
recorded here as a fourth observed failure with its own attribution rather than
being folded into the known set.

## Conclusion

Every failure the run observed is attributed to a cause outside A–D2 and
outside `stabilize-store-context-foundation`, each with evidence a later reader
can re-check with one command. No failure is unaccounted for, and no failure
counts against A–D2 or against this change.

The gate the four restated boxes state — lint and build green, plus one
combined verification run carried to completion in which every failure is
individually attributed outside the work being gated — is therefore **met**.

## This change did not add or alter a failure

Comparison against the failure set recorded before this change began:

| File | Before this change | After | Verdict |
|---|---|---|---|
| `test/release-contract.test.ts` | suite import `SyntaxError` | suite import `SyntaxError` | unchanged |
| `test/commands/handoff.test.ts` | stale `maxRelays: 3` assertion | stale `maxRelays: 3` assertion | unchanged |
| CLI locale case (`test/cli-e2e/basic.test.ts`) | installed-skill version warning on stderr | installed-skill version warning on stderr | unchanged |
| `test/commands/workset.test.ts` | not previously recorded | Windows temp flake; passes in isolation | pre-existing flake, newly recorded — byte-identical to base, so not introduced here |

No new failing file, and no existing failure's signature changed.

## Targeted suites this change touched, all green

| Suite | Result |
|---|---|
| `test/core/pipeline-registry/` + `test/commands/pipeline.test.ts` + `test/core/templates/skill-templates-parity.test.ts` | 13 files, **480/480** |
| `test/core/learned-skills/` | 7 files, **all passed** |
| `test/core/store/`, `test/core/learned-skill-materialization.test.ts`, `test/core/learned-skill-ledgers.test.ts`, `test/commands/knowledge.test.ts` | all passed |
| `packages/ui` `test/components/launch-session-dialog.test.tsx` | **20/20** |
