# Implementer 2 handoff

## Outcome

Tasks 2.8, 3.12, and every task in sections 4–6 are complete. The Change is now 47/69 tasks complete. The 22 remaining tasks are exactly sections 7–9; they were not started or checked in this tranche.

The sole shared fixture has seven authored connection entries. Each Run selects one mutually exclusive Choice branch, so it executes one six-edge / seven-node route. The successful proof imports only `CANVAS_V2_AUTHORING_DEFINITION` from `packages/ui/test/fixtures/canvas-v2-authoring.ts`; it does not construct a second Definition, `RuntimePlanInput`, canonical Record, lifecycle reducer, or projector.

No commit, push, ship, archive, machine/portfolio mutation, Session executor, automatic worker, automatic observation, or private reducer/store completion path was added.

## Product-boundary proof

`test/core/change-run/canvas-v2-vertical-proof.test.ts` now performs the complete trusted-host journey:

- Creates an isolated native-path temporary git project plus config, data, Run-store, and evidence roots.
- Validates and saves the exact Canvas fixture through the real Management API, reads it back through Management detail, and stops the Management server before launch.
- Uses the built CLI and a new Node process for every `start`, `status`, `resume-run`, `complete`, and `control` command.
- Launches with explicit reconciler ownership through the production registry, capability/profile resolver, lowerer, and filesystem-backed immutable store.
- Performs three deterministic scoped workspace mutations, captures before/after git workspace revisions, stages real evidence with the existing host upload/evidence format, commits public effect observations before domain results, and never mutates the reducer/store directly.
- Completes the Composite/BoundedLoop body, authored `done -> exit(done)` lifecycle, one Choice branch, FanOut required-member selection, the authored Gate, required AtomicStage, paired Join, and declared Finish.
- Proves stale Record versions and an unknown WaitId fail closed through typed `change-run-control/1` requests before approving the exact WaitId.
- Recovers after a named committed bounded-loop effect from fresh filesystem/CLI processes before the parallel member and Join settle; repeated reads at one Record head are equal and non-mutating.
- Uses a 24-step upper bound and fails with the last canonical view on unknown grants/waits, repeated non-progress, identity drift, or step exhaustion.
- Records 31 public command/process boundaries and 31 ledger entries. The final test sandbox was removed by cleanup, and no worktree-scoped Node process remained.

## Runtime gaps found and closed with TDD

1. The first real launch failed closed as `engine_unsupported / unsupported_pipeline_shape`. One declaration body is intentionally shared by both `CompositeRef` and `BoundedLoop`; native-v2 profile resolution emitted the same declaration capability/policy path twice. `src/core/pipeline-registry/profile-resolver.ts` now deduplicates identical node-path bindings/stages and rejects conflicting duplicates. `test/core/pipeline-registry/shared-declaration-profile.test.ts` is the focused discriminator.
2. The first expanded journey reached terminal success but never surfaced the Gate on the required FanOut member. The FanOut-specific reconciler branch admitted members without applying the ordinary AtomicStage gate disposition. `src/core/change-run/internal/reconciler.ts` now sends selected FanOut members through the existing `dispositionFor` / `awaitGateFor` contract. The focused test in `test/core/change-run/reconciler-ecp4.test.ts` was RED with direct `admit`, then GREEN with `await-gate`, no admission while awaiting, and deterministic admission only after approval.

## Exact successful identities and frozen digests

- RunId: `run:e883e67b9abd461a5adef36d162ae8ba627b8bec10c23722bb01985098499236`
- ActionIds:
  - `action:7db24d420ef1866ed0d20febe7bc8c2bed065452643b0f4a972553a215a82baf`
  - `action:9697d0d1ff30dd2278bebf8e965f7066107f56eb12f3484cdd7bde172c812154`
  - `action:6570571e6e1a75a54d4fac9ca0e78d00869ebba580fd0adb85ce155ccd3d52bf`
  - `action:5fe5ef46c839dfd271660e632ea3beb01b11347e2b525d3f4afc75a8545212dc`
  - `action:ad20918afb748e7ed68a1223bcd7a753a731cd3e9494a070774ec72bbbb68ab1`
- EffectIds:
  - `effect:211b58d6481f75566e1e56e83bec4a5b1889aacf291c600886b6f3b01c16f0c3`
  - `effect:3540c08d950bd5c587e262cb881f886539d2676c6773beffe00f02a832e23eaf`
  - `effect:cfac00e043713559a7bbe30dd824634d7e26d512245a7d71bb53f85df8971950`
- Gate WaitId: `wait:35a08ea4c0fde05557c51f8a8f08ba2137600ee9c29eaf65ff3ac0cfa478c231`
- source: `sha256:7c637546b22b91d2a242f01205165c3893aaef9ed2e33130198e9a10a865302d`
- capability: `sha256:36d43bb2dabb64819c987ab5af5dc703cd2183ba789bae4de427ea6227dc26f8`
- policy: `sha256:a11cd0e1eff98562ad73707155a8fc12ab145b338973195a0ad938f1e4d3b53c`
- plan: `sha256:727b593cbc1993ba8ca33bb6d3e8bd6aee441ab9aa816762aac4326aa6e61cd6`
- profile: `sha256:51773a842e60b9e80e066061a326a20e13b14bd4be76ba75449a5a49120220d8`

Every Run/Action/Invocation/Attempt/Effect/Wait identity and every receipt/evidence digest was asserted stable across fresh status processes and against the persisted canonical Record.

## Exact validation evidence

- Canvas regression matrix for task 2.8: 7 files, 149/149 tests passed. jsdom emitted only the known `window.scrollTo` stderr diagnostic.
- runtime regression matrix for task 3.12: 8 files, 122/122 tests passed.
- `pnpm exec vitest run test/core/pipeline-registry/shared-declaration-profile.test.ts test/core/change-run/reconciler-ecp4.test.ts --reporter=dot`: 2 files, 21/21 passed.
- `pnpm exec vitest run test/core/change-run/canvas-v2-vertical-proof.test.ts --reporter=verbose`: 1/1 passed, 145.83 seconds; the test body used 31 fresh CLI processes.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm --dir packages/ui run typecheck`: passed.
- `pnpm run build`: passed.
- `node dist/cli/index.js validate ecp-v2-authoring-loop-vertical-proof --type change --strict --json`: 1/1 valid, zero issues.
- `git diff --check`: passed; Git printed only existing LF-to-CRLF worktree warnings.
- `pipelines/auto-decompose/pipeline.yaml` remains byte-identical at blob hash `6f306544010a8950508f1223acfca5d62de407f5`.

## Files changed in this tranche

- `src/core/pipeline-registry/profile-resolver.ts`
- `src/core/change-run/internal/reconciler.ts`
- `test/core/pipeline-registry/shared-declaration-profile.test.ts`
- `test/core/change-run/reconciler-ecp4.test.ts`
- `test/core/change-run/canvas-v2-vertical-proof.test.ts`
- `rasen/changes/ecp-v2-authoring-loop-vertical-proof/tasks.md`
- `rasen/changes/ecp-v2-authoring-loop-vertical-proof/handoff/implementer-2.md`

## Remaining boundary and risks

Sections 7–9 still own malformed/identity/effect-order failures, the separate required-member-failure Run, CLI/Management/Operations cross-plane equality, full root/UI gates, implementation report, independent review, and parent delivery/CI. The successful vertical driver intentionally covers only the trusted manual observation seam; Session dispatch, worker reuse, automatic effect observation, handoff, and usage accounting remain ECP-7.
