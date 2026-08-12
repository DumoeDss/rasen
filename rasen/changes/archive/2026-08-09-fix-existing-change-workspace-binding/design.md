## Context

`buildWorkspacePlan()` already treats `intent: 'existing-change'` as a distinct, verified path: it reads the Change's committed v2 identity, rejects Store/project/target-line disagreement, and stores the verified `changeInstanceId` in the immutable plan. `applyWorkspacePlan()` then creates or reuses both worktrees, writes the planning marker and execution association, and records that Change instance in the workspace index. Its final record does not derive a `workspacePairId`, however, so it returns `prepared` even though all inputs needed to finish the pair now exist.

The codebase already has one authority for this transition. `completeChangeBinding()` surveys the live planning and execution worktrees, checks the planning marker against the committed Change scope, derives the pair identity from the Change and both worktree instance identities, and records either `bound` or the safe incomplete `prepared` state. The apply orchestration should reuse that function rather than add a second derivation path.

Workspace apply already runs beneath the scope lock and the prepared pair's provisional workspace lock. The immutable plan and its token remain the source of destinations and scope; completion must not re-resolve selectors or the invoking directory.

## Goals / Non-Goals

**Goals:**

- Finish an existing-Change binding during the same apply operation, after both worktrees and local binding documents have been written.
- Return and persist the canonical completion result, including a re-verifiable pair identity when both live worktree identities exist.
- Preserve fail-closed behavior for missing execution state, stale plans, marker/target-line conflicts, and worktree identity drift.
- Preserve retry idempotence and cleanup behavior for the newly bound pair.
- Cover the observable path from apply through workspace inspection and archive dry-run preflight.

**Non-Goals:**

- Changing the two-phase behavior for the default new-Change intent; it remains prepared until Change creation mints an instance identity.
- Changing plan/token schemas, identity derivation algorithms, workspace marker formats, index formats, or path canonicalization rules.
- Deriving a pair identity inside apply or introducing an alternative binding completion API.
- Changing archive merge-confirmation blocker display or `--yes` handling. Research places that concern in archive/finalization plan inspection, outside this workspace binding defect.

## Decisions

### Complete at the `StoreWorkspace.apply()` orchestration boundary

After `applyWorkspacePlan()` returns, the worktree actions, both binding documents, and the prepared index entry have completed. While still inside the existing scope and provisional workspace locks, `StoreWorkspace.apply()` will check whether the loaded immutable plan carries `changeInstanceId`. If it does, it will invoke `completeChangeBinding()` with the plan's frozen Store/project/target-line/change facts, planning root, path flavor, and coordination directory, then project the canonical completion state and pair identity into the returned `PreparedChangeWorkspace`.

Calling from the orchestration boundary keeps the ordering explicit and avoids a circular ownership dependency from the low-level apply implementation back to the module that owns `completeChangeBinding()`. Copying pair derivation or marker verification into `applyWorkspacePlan()` was rejected because it would create a second authority for binding completion.

### Gate completion on the verified identity carried by the plan

The completion branch will depend on `plan.changeInstanceId`, not merely the intent label and not a fresh Change lookup. The existing-change planner is already responsible for verifying committed identity and freezing it into the stored plan. The new-Change path carries no instance identity and therefore keeps its current result.

This preserves the token-only apply contract: the stored plan supplies the verified identity and all scope inputs, and the current directory or command selectors remain irrelevant.

### Preserve canonical incomplete and conflict outcomes

`completeChangeBinding()` remains responsible for surveying live worktree identities, checking the marker's Store/project/target-line facts, deriving the pair, and deciding whether the result is `bound`, `prepared`, or refused. In particular, an execution side whose identity cannot be re-derived produces no pair identity, and disagreements are surfaced rather than rewritten into agreement. Apply must propagate that result rather than synthesizing `bound` from the presence of `changeInstanceId`.

Existing apply revalidation remains in front of all writes. For reused worktrees, it must compare the plan's frozen `worktreeInstanceId` as well as its ref and HEAD; the plan type already carries that identity, so disagreement can use the existing stale-plan refusal rather than a new detector. The completion call adds no selector resolution and runs before the locks are released, so target-line/catalog/ref drift and recorded worktree drift fail closed.

### Exercise the full existing-change lifecycle in regression tests

Focused module coverage will assert that an existing-change plan applies as `bound`, returns the same pair identity recorded in the index, remains stable on retry, and retains safe incomplete/conflict behavior. CLI or Store v2 journey coverage will assert that `workspace show` reports the bound pair, archive dry-run no longer carries `workspace_pair_unavailable`, and cleanup removes the completed pair and its index entry. All path assertions will use `node:path` helpers so the matrix remains valid on Windows, macOS, and Linux.

The archive assertion is a consumer check for the completed pair, not a change to finalization logic. Existing canonical binding tests for absent execution sides and marker/target-line conflicts should be reused or extended rather than recreating those mechanisms in apply.

## Risks / Trade-offs

- [Risk] Re-applying a stored plan replays the prepared record before canonical completion. → Keep both steps inside the existing scope/workspace lock set and assert that the final pair identity, worktree count, and index entry are stable across retries.
- [Risk] Returning the pre-completion apply result could leave CLI output inconsistent with the index. → Rebuild the returned binding fields from `completeChangeBinding()` and test result/index/show parity.
- [Risk] A convenience implementation could derive a pair from frozen-looking strings even when a worktree disappeared or drifted. → Delegate all completion to `completeChangeBinding()` and retain live identity/conflict regression cases.
- [Risk] End-to-end Store v2 and archive tests are comparatively expensive. → Put derivation and idempotence assertions in the focused workspace suites and retain one bounded CLI journey for consumer wiring.
