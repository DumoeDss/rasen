# Implementer 3 handoff — persistence, compatibility, and apply-stage closure

## Scope and state

- Apply-stage work only in `OpenSpec-code-wt-ecp-shared-bounded-loop-lifecycle` on `wip/ecp-shared-bounded-loop-lifecycle-resume`.
- No machine run-state, canonical Run, commit, push, PR, ship, archive, stash, or parent delivery mutation was performed.
- The shared dirty tree and Implementer 1/2 work were preserved. No source file outside this Child's tests/artifacts was overwritten.
- Change progress after this relay: **61/67 complete**. Only independent review/remediation/consumer/parent-CI tasks **9.1–9.6** remain open.

## Completed tasks

- 1.1, 1.5, 1.6: shared eight-kind baseline plus honest historical red-to-green evidence for incomplete AtomicStage/BoundedLoop creation and preservation-versus-visible-authoring.
- 7.2–7.8: authored-v1 compatibility, exact visible blank-v2/all-eight request, real preparation/canonical/Management no-op round trip, intentional-edit digest stabilization, portable export/import, mounted extension sentinel preservation, and blank/core parity.
- 8.1–8.10: focused/full UI and root matrices, typechecks/build/lint/diff/strict validation, auto-decompose byte proof, isolated full-root gate, and implementation report.

## Files added or updated in this relay

- Added `packages/ui/test/fixtures/canvas-v2-authoring.ts`.
  - Dependency-free shared oracle used by both the mounted Canvas journey and root Management integration.
  - Contains exact definition/declaration contracts, one complete declaration body stage, all eight root kinds, complete execution and lifecycle, paired parallel metadata, and the exact production `rasen-apply-change` capability revision.
- Updated `packages/ui/test/canvas/pipeline-canvas-page.test.tsx`.
  - Added authored-v1 duplicate/edit/save/detail compatibility proof.
  - Added a real blank/not-found visible-control journey whose validation/save request equals the shared oracle exactly.
  - Added mounted definition/graph/node/declaration/body/execution/lifecycle sentinel preservation through unrelated controls and mocked reload.
  - Corrected stale comments that described FanOut/Join as read-only rather than paired editable/non-independently-deletable.
- Updated `test/core/management-api/pipelines-api.test.ts`.
  - Added real core preparation plus Management validation/save/detail/canonical-file/no-op/export/import/intentional-edit/stable-reload proof.
  - Uses only Node `path.join`/`path.resolve` for portable package and persistence paths.
- Added `rasen/changes/ecp-canvas-v2-authoring-parity/evidence/implementation-report.md`.
- Updated `rasen/changes/ecp-canvas-v2-authoring-parity/tasks.md` to 61/67.
- Added this handoff.

## Red-to-green notes

- Historical Implementer 1 red: **11 failed / 2 passed** in the pure model boundary.
- Historical Implementer 2 red: **4 expected failures / 55 passed** in the mounted page boundary.
- This relay's first real preparation of the shared fixture returned **12 semantic diagnostics**, rather than accepting a shape-only eight-kind fixture. After fixing reachability, budgets, declared outcomes, and loop exits, one iteration-limit outcome remained undeclared. The following run exposed canonical reordering. The final test now separates exact browser request equality from persisted canonical semantic equality.
- The final tree has no deliberately failing tests.

## Final verification

- Mounted page: **1 file / 64 tests passed**.
- Focused Canvas matrix: **7 files / 139 tests passed**.
- Full UI: **58 files / 638 tests passed**.
- UI typecheck: passed.
- Full Management pipeline API file: **1 file / 48 tests passed**.
- Focused root matrix: **8 files / 249 tests passed**.
- Clean isolated-TEMP full root, normal worker pool: **433 test files/results; 1,788/1,788 suites passed; 6,809 passed, 34 pending, 0 failed, 6,843 total; `success: true`**.
- `pnpm build`: passed.
- Root `tsc --noEmit`: passed.
- `pnpm lint`: exit 0, 0 errors, one existing shared-tree warning at `test/core/change-run/facade-settle-completeness.test.ts:139`.
- `git diff --check`: exit 0, repository LF-to-CRLF notices only.
- Strict Change validation: valid.
- `auto-decompose` hash: `6f306544010a8950508f1223acfca5d62de407f5`; file diff clean.

The authoritative full-root JSON is:

`E:\rasen-ecp6-root-temp-20260802-0833-clean-default-pool\root-suite.json`

## Full-root runner strategy correction

The requested initial serial mode was functionally healthy but too slow for the outer runner:

- `E:\rasen-ecp6-root-temp-20260802-0726`: single worker, outer timeout at 904 seconds, no assertion result.
- `E:\rasen-ecp6-root-temp-20260802-0740-attempt2`: single worker, outer timeout at 1,802 seconds, no assertion result.
- `E:\rasen-ecp6-root-temp-20260802-0810-attempt3`: 60-minute single-worker attempt intentionally interrupted after Lead corrected the strategy.
- `E:\rasen-ecp6-root-temp-20260802-0811-pool`: preserved turn-aborted default-pool attempt state.
- `E:\rasen-ecp6-root-temp-20260802-0813-default-pool`: first default-pool attempt timed out while the interrupted attempt 3 Vitest child tree was still consuming resources.

On Windows, interrupting the outer attempt-3 cell did not terminate its child process tree. The exact worktree-scoped Vitest, tinypool, and CLI PIDs were identified from their command lines and stopped child-to-parent. A subsequent query found no Node command line for this worktree. The final fresh default-pool run in `...0833-clean-default-pool` then finished green in 727.9 seconds. All TEMP directories above remain preserved; none were deleted.

## Boundaries for the next roles

1. Run tasks 9.1–9.4 through a truly independent reviewer/fixer/re-review loop. This handoff is implementation evidence, not independent acceptance.
2. For 9.5, consume the saved loop-plus-parallel Canvas definition in Child 4 without adding a second draft model, serializer, lifecycle policy, or execution projection. Child 4 owns the canonical Run proof.
3. Task 9.6 belongs only to the single parent portfolio PR and must require green Windows, Linux, and macOS CI.
4. Do not migrate `auto-decompose`; it remains byte-identical authored v1. Issue/Dispatch/portfolio semantics remain 0.3.0.
5. Mounted unknown-sentinel proof covers Canvas-side losslessness. Do not overclaim current server acceptance for arbitrary future closed execution/lifecycle fields.
6. Preserve the shared dirty tree, the six retained `E:\rasen-ecp6-root-temp-*` directories, `.tmp-ecp6-defaults/`, `rasen/changes/foo/`, the three original test temp directories, and the safety stash.
