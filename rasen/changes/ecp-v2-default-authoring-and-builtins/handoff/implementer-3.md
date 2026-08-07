# Implementer 3 handoff: v2 defaults and built-ins closure

## Outcome and isolation

Child 2 implementation and local validation are complete. Exactly six Change-level built-ins are authored v2, fresh CLI/Canvas definitions default to the shared blank-v2 envelope, product inspection surfaces share the prepared execution view, and authored v1 remains a compatibility input. `auto-decompose` remains the byte-identical v1 Issue/Dispatch fixture.

- Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-wt-ecp-shared-bounded-loop-lifecycle`
- Branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`
- Migrated base HEAD: `050fc84332b26a75a07f441efd6b235842f89e1e`
- No commit, stash, branch operation, archive, or machine run-state update was performed.
- `.tmp-ecp6-defaults/`, the migrated test-output directories, and untracked test artifacts were preserved.

## Final implementation closure

- Native-v2 launch/read surfaces use the prepared Definition identity and exact capability/policy paths. CLI show/list/agents/resume, Management inventory/detail/dependency views, Canvas blank drafts, serialization, package paths, and frozen launch profiles now agree.
- Native-v2 `new change --pipeline` no longer depends on the deliberately absent legacy `PipelineYaml` adapter. It records the prepared pipeline identity and only root AtomicStage/BoundedLoop pending cursors for pre-Run resume. Gate, FanOut, Join, Finish, and loop-body nodes remain reconciler-owned and are not introduced as a second writable progression model.
- Flat authored v1 remains legacy. Composite/loop-normalized v1 may select the reconciler. Native v2 fails closed unless it is executable and has an explicit Finish.
- Dependency closure now includes reachable native-v2 Atomic capabilities, bounded-loop strategies, and FanOut conditions while preserving the v1/decompose loader seam.
- All native-v2 Atomic fixtures now carry complete execution declarations; no test fixture relies on the old partial execution shape.

## Exact fixtures, pins, and digests

Canonical fixtures added or made authoritative:

- `test/fixtures/blank-pipeline-definition-v2.ts`: shared core/UI blank-v2 parity fixture.
- `test/fixtures/builtin-pipeline-migration-oracle.ts`: semantic oracle for review, goal, and full-feature migration.
- `pipelines/auto-decompose/pipeline.yaml`: unchanged Git blob `6f306544010a8950508f1223acfca5d62de407f5`, authored v1, compatibility boundary `issue-dispatch-0.3.0`.

Exact bounded strategy pins:

- `rasen-review-cycle`: `sha256:982739146524b2359637c37564890799aa700905baf67f4825fcfc93e2b73427`
- `rasen-goal-iterate`: `sha256:9522e1108c941534a888d5a0230ba29f1b7719a75949411b36e05f664d95331b`

Preparation and current frozen-profile digests after the final build:

| Built-in | Source | Capability | Plan | Profile |
|---|---|---|---|---|
| `bug-fix` | `be9e76f0ab651dea0926d0d02a5d5788dca334d3c7e49328e874c531689cfc0b` | `55c1e6f774616af59c49923f6176bad8960a83bdf8523b270f7caa0601c3d74c` | `49e87f2ac0e09c07fdb4e446b050582bed6b72b1d06608c807230433899c9d60` | `sha256:f1239ecdc9d898bd0c9ea8abe5f4313203a7fe2d730f8f93239d2554790e7986` |
| `small-feature` | `e5c54f290e47564eb91bc90464dc692cf7e1325766b75474b91b1a537382af69` | `55c1e6f774616af59c49923f6176bad8960a83bdf8523b270f7caa0601c3d74c` | `68ec0a028ffe07b68f0cbc9e563a49f52a83a5baf369739b2afa6154ca0faa7c` | `sha256:473b18075128cafbc6506a91d56924e8316494685effef0ce21b2d09479e5036` |
| `full-feature` | `ad739185de2c085c37332c2e38bf93d5872c9cd6fa68496dea57391925f77245` | `f0f99e79e81492e5ff59cfbbf8e70bd8c3066fe70d5445f918bf72c7dc17ff2f` | `9b5091ee942122e1c681b411c367403f55b2d580aaca5d7470ece3a353ff66af` | `sha256:67919c0ad960c2e549680bb64390dd32bcc833f23a9915f12231d17b512ba771` |
| `goal-loop-measure` | `5cf5347babc820a8556ae0d05d2206ce6d7df3b783036d025adc38360fa20475` | `f9e936b565575ab361e65a548c507545cfa38cfc38a8c77e4f1bcb0543f9bbce` | `c15984b3cf5bebf63aaceb7a2f43c3304892b448323b7bcb7749474bd2430a41` | `sha256:3c1a22ce26189d41a5d6d9caeb3adb94242503c82e04b4a4a25a87c7651252ca` |
| `goal-loop-evaluate` | `a2e19f4dfc823e182274e325eb5321385834b4698dfdcad02c7cd64e43382f32` | `f9e936b565575ab361e65a548c507545cfa38cfc38a8c77e4f1bcb0543f9bbce` | `ff3b4e21ba4577ddcaa8d8ed553748a7b8bd21ff19ea2f5ae7f80e43edd66490` | `sha256:bd79498910d2a4bcf02820b115bbdd3236b844d2621fd84cb239e4aabe8b0d6f` |
| `goal-loop-research` | `4f8daac5c4244ea994a8ebb7735522f616a810a96a6a0e9cd9f0e60942037fdc` | `fb824e19f7b9dba83e2be7da077e80e42f260a2498b8fae9e4bf56f8ef7be88b` | `7d2a09971de4325f1ae17fee56f9a8b6bc91996a369f0bc5e4aec96add983e37` | `sha256:0267a87a0969b97da2f1eb66962e1add6a79f6adbfec69266c92e23b292a1c24` |

Profile digests include the effective local policy snapshot; source/capability/plan digests are the portable preparation identities.

## Validation evidence

- Strict Change validation: 1/1 passed, zero issues.
- Definition group: 114/114; serializer/library/package: 55/55; registry/resolver/profile: 109/109; lowerer/runtime: 150/150.
- Built-in group: 47/47. Dedicated six-built-in acceptance matrix: 6 files, 29/29.
- CLI: show 39/39; locale/list 11/11; agents/classify 9/9; resume 45/45; engine group 39/39.
- Management grouped suite: 92/92.
- Windows path-sensitive init/save/export/import/package/API group: 4 files, 111/111. LF/CRLF semantic equality and Windows lock simulation passed.
- Migrated E2E group: 3 files, 30/30, including native-v2 gate settlement/no-duplicate resume semantics.
- Composite dogfood/parity/validation: 3 files, 12/12.
- Clean-root final full root run: 432/432 files passed; 1786/1786 suites passed; 6822 total tests, 6788 passed, 34 pending, 0 failed. JSON report: `E:\OpenSpec-code-ecp6-final-root-temp-57b25ce8af7348f5a6889e0695c13751\ecp6-final-root-vitest.json`.
- Final root `tsc --noEmit`: passed. Final build: passed. Final lint: exit 0 with one pre-existing unused-disable warning at `test/core/change-run/facade-settle-completeness.test.ts:139`.
- UI typecheck: passed. Full UI: 57 files, 611/611 tests passed; existing jsdom `scrollTo`/navigation stderr remained non-failing.
- Root-selection environment diagnosis: a TEMP under `workflow` correctly finds the ancestor legacy `openspec/`; a fresh `E:\` TEMP with no Rasen/OpenSpec ancestor markers passed 44/44.
- Local-version runtime serial check under a fresh `E:\` TEMP: 7/7. Environment: Node v24.14.0, npm 11.9.0, pnpm 9.15.9, Node at `C:\nvm4w\nodejs\node.exe`.

## Accepted limitations and unresolved delivery gates

- Full Canvas primitive/Composite/BoundedLoop/Choice/FanOut/Join/Gate/Finish authoring parity remains child 3. This child only owns the truthful blank-v2 seed and lossless draft preservation.
- The blank-Canvas-to-canonical-Run success/resume/fail-closed vertical proof remains child 4. The ECP-6 Direction Slice must not be called passed before it completes.
- Session execution, worker reuse enforcement, real handoff/reuse limits, and agent lifecycle remain ECP-7.
- Issue Execution Plan, Dispatch, portfolio scheduling, multi-Change semantics, and `auto-decompose` migration remain the 0.3.0 boundary.
- Nested loops, recursive Composites, arbitrary scripts, remote runtimes, and release closure remain excluded.
- Task 9.5 stays open until the parent portfolio PR proves Windows plus normal Linux/macOS CI lanes.
- No Canvas-parity planner/reviewer artifact exists yet. Its planning inputs are now review-clean locally: the prerequisite shared lifecycle review cycle reports `CLEAN` with 2/2 blockers resolved, blank core/UI parity passes, and the full UI suite passes. This is readiness evidence, not child-3 review-clean evidence and not a Direction Slice pass.

## Next owner

The LEAD should review this child delta, keep task 9.5 open, then plan/execute child 3 Canvas parity and child 4 vertical dogfood serially. Parent delivery owns commit, PR, and remote CI evidence.
