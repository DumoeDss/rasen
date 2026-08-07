# Implementation baseline - ecp-hosted-best-effort-cutover

Role: IMPLEMENTER. Recorded before any product code was edited.

## Implementation-start commit

```
git rev-parse HEAD
b3edf5bc9254499f28ef4d81dbe0c93426c45219
```

Branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`. Worktree is SHARED and
carries a second workstream's untracked directories; every digest below is taken
from the COMMIT (`git show <commit>:<path>` piped to `sha256sum`), never from the
working tree. A rebaselined-in-a-dirty-worktree hash would be locally green and
globally false; the commit is the only truth here.

## Task 1.1 - byte-pin baselines from the commit

### Pin list A: `test/core/session-host/linux-process-authority-boundary-guards.test.ts:14-29`

`LEGACY_PROCESS_CAPSULE_INPUTS`, seven files. Column 1 is the constant in the
test source; column 2 is the digest computed from commit `b3edf5bc`.

| File | Pinned digest | Digest at b3edf5bc | Match |
| --- | --- | --- | --- |
| `native/process-capsule/src/main.rs` | `79dc1ad0f19e5f1d087083707c5307d8523002c557995a6658146c64f0f41c8d` | `79dc1ad0f19e5f1d087083707c5307d8523002c557995a6658146c64f0f41c8d` | yes |
| `native/process-capsule/Cargo.lock` | `f00e64114e06f06b623880947c4ec4d33953218d901abdba3b2b2f1d32db8793` | `f00e64114e06f06b623880947c4ec4d33953218d901abdba3b2b2f1d32db8793` | yes |
| `scripts/build-process-capsule.mjs` | `4117b109bbe524ccd9423e9e4ef1da8f52cfc1a27e818871ae71c653f599ef92` | `4117b109bbe524ccd9423e9e4ef1da8f52cfc1a27e818871ae71c653f599ef92` | yes |
| `src/core/session-host/process-capsule/resolver.ts` | `a1df4e2ed63167231c0207dbd4d5a5d8c8aa5bb4e44665e7b4cbe3d5624bbf91` | `a1df4e2ed63167231c0207dbd4d5a5d8c8aa5bb4e44665e7b4cbe3d5624bbf91` | yes |
| `src/core/session-host/process-capsule/native-process-scope.ts` | `0848c77b55d405afdf02b43c797986cb15193cca453b61fa7aa03d07209588fa` | `0848c77b55d405afdf02b43c797986cb15193cca453b61fa7aa03d07209588fa` | yes |
| `test/core/session-host/process-capsule-package.test.ts` | `3ed5945c5b17b711c783534281c4288242ab9b680e498135db3f344528a759e1` | `3ed5945c5b17b711c783534281c4288242ab9b680e498135db3f344528a759e1` | yes |
| `test/core/session-host/process-capsule-posix-replacement.test.ts` | `894a5119e480f4f904f6a5265adb82c48e83f2a31bc79f1b27b14f2f0e64e047` | `894a5119e480f4f904f6a5265adb82c48e83f2a31bc79f1b27b14f2f0e64e047` | yes |

### Pin list B: `test/core/session-host/windows-process-authority-package-ci.test.ts:36-47`

`LEGACY_PROCESS_CAPSULE_INPUTS`, five files - the first five of pin list A, with
byte-identical constants. Verified digest-by-digest against the same commit
output above; all five match.

### Frozen common inputs (both files, not this change's target but recorded)

| File | Pinned digest | Digest at b3edf5bc | Match |
| --- | --- | --- | --- |
| `rasen/specs/process-authority-provider/spec.md` | `05257eb1860aa40ce06a2289b63348e21a81187f4df4fd4aff346e7e8ac57d5a` | `05257eb1860aa40ce06a2289b63348e21a81187f4df4fd4aff346e7e8ac57d5a` | yes |
| `test/helpers/process-authority-provider-conformance.ts` | `b9d8bd4fb63910ed1626c0d9f2bda258803a8f3a191f98c57509e837cc58d2f0` | `b9d8bd4fb63910ed1626c0d9f2bda258803a8f3a191f98c57509e837cc58d2f0` | yes |

Baseline result: every pinned file is already byte-identical to its constant at
the implementation-start commit. Section 5 re-runs this exact computation against
the post-implementation commit; the expected outcome is that both tables are
unchanged.

## Task 1.2 - seam facts re-verified with file:line anchors

Checked against the working tree at `b3edf5bc` (no local modifications to any
file named below).

| design.md claim | Anchor found | Verdict |
| --- | --- | --- |
| Three `createHostedProcessScope()` construction sites | `src/core/management-api/router.ts:639`, `src/core/session-host/host.ts:306`, `src/core/session-host/claude-backend.ts:423` | confirmed, all three lines exact |
| Single platform selection point | `src/core/session-host/process-capsule/hosted-process-scope.ts:17-23`; `:21` returns `createDarwinBestEffortProcessScope()` for darwin, `:22` returns `createNativeProcessScope(nativeOptions)` for every other platform | confirmed |
| Declaration persisted at prepare time, keys `tier`/`exactCancel`/`scopeEmptyProof` only | `src/core/session-host/host.ts:455-464` | confirmed; no other key is written into `process.declaration` |
| Activation gate fails typed if the declaration did not land | `src/core/session-host/host.ts:471-479` (`authority-persist-failed`, `'Best-effort scope limits were not recorded before activation.'`) | confirmed |
| `closeDurableProcess` has TWO release paths | `src/core/session-host/host.ts:696-731`; observation path `:711-714`, receipt path `:715-720` | confirmed. Planner cited the receipt path as `:716-720`; the `if (observation.controllable)` guard that opens it is `:715` and the `receiptAuthorizesRelease` call is `:717`. Same two paths, no behavioural drift. |
| Three prepared-abort release gates | `src/core/session-host/host.ts:490`, `:573`, `:1446` - each `receiptAuthorizesRelease(..., prepared.declaration !== undefined)` | confirmed |
| Terminal persistence is itself declaration-gated | `src/core/session-host/host.ts:766` (`if (terminal && current.process?.declaration)`) | confirmed - a fourth declaration gate the design did not enumerate; it needs no edit either |
| Seam vocabulary already complete | `src/core/session-host/process-scope.ts`: `BEST_EFFORT_SCOPE_SEMANTICS:67-74`, `BestEffortScopeDeclaration:83-88`, `DeclaredUnprovenReceipt:98-106`, `declaredUnprovenTerminalLabel:114-116`, `receiptAuthorizesRelease:204-210` | confirmed |
| Legacy capsule Windows side is a Job implementation | `native/process-capsule/src/main.rs` `CreateJobObjectW:672`, `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE:677`, `TerminateJobObject` code 137 `:592` | confirmed (planner's anchors; not re-derived here, file is byte-identical to its pin) |
| Two source-scan guards read the module source directly | `test/core/session-host/darwin-best-effort-scope.test.ts:392-404` (no `state: 'closed'`, no `'scope-empty'`, no `emptiness: 'proven`) and `:484-491` (no reattach/revalidate) | confirmed - both `readFileSync` the module path literally, which is why D2 forbids a shim |
| Platform-selection guard currently asserts linux and win32 reach the exact tier | `test/core/session-host/darwin-best-effort-scope.test.ts:497-516` | confirmed; task 2.5 inverts it |

Drift found: none that changes any design decision. The one line-number
correction (receipt path opens at `:715`, not `:716`) is recorded above and was
reported to the LEAD rather than silently absorbed.

## Task 1.3 - no edits required to host/router/backend/registry

| File | Edit required? | Why not |
| --- | --- | --- |
| `src/core/session-host/host.ts` | no | Every decision it makes keys on `declaration !== undefined` / `facts.declaration !== undefined`, never on platform or tier identity. A win32 or linux scope that attaches `declaration` at prepare gets the identical persistence (`:455-464`), activation gate (`:471-479`), both release paths (`:711-720`), the three prepared-abort gates (`:490`/`:573`/`:1446`), and terminal persistence (`:766`) that darwin gets today. |
| `src/core/management-api/router.ts` | no | `:639` constructs through `createHostedProcessScope()` and never names a platform. |
| `src/core/session-host/claude-backend.ts` | no | `:423` same, and it forwards `prepared.declaration` through unchanged. |
| session-host registry record shape | no | The declaration sub-record already exists with exactly the three keys the host writes. This change adds no persisted key, which matters because the registry enforces a strict key allowlist that rejects unknown fields outright. |

Task 1.3 gate is therefore OPEN for implementation with zero edits to these four
surfaces. Section 3.6 re-verifies the win32 declaration actually traverses this
unmodified plumbing end to end rather than assuming it from the table above.
