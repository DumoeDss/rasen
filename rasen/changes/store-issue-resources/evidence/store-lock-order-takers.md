# Task 7.5 — who actually takes each `STORE_LOCK_ORDER` key, in shipped code

## Why not `assertStoreLockOrderAgreesWithWorkspace()`

`locks.ts:84-102`'s `assertStoreLockOrderAgreesWithWorkspace()` only compares
two frozen arrays (`STORE_LOCK_ORDER.slice(1)` against `WORKSPACE_LOCK_ORDER`)
for structural agreement. It passes under ANY partial port, including one
where `change`/`integration` are never taken by anything — it proves the two
constants agree with each other, not that ordering is actually enforced
end-to-end in running code. It is cited here only to explain why it is
excluded, not offered as evidence for the claims below.

## Method

For each of the five `STORE_LOCK_ORDER` keys (`locks.ts:63-77`), grepped the
whole of `src/` and `test/` for every call site of that key's constructor
function (`issueLockKey`, `scopeLockKey`, `workspaceLockKey`, `changeLockKey`,
`integrationLockKey`) and read each call site to confirm what it does with
the key (acquire, or merely peek).

## Findings

| Key | Constructor | Taken by (shipped, this branch) | Verified how |
|---|---|---|---|
| `issue` | `issueLockKey` (`issues/locks.ts:118`) | `StoreIssuesModule.{create, setState, publishPlan}` via `withIssueLock` — `issues/module.ts:100, 147, 209` | 3 call sites, all inside the three Issue-mutation methods this child ships |
| `scope` | `scopeLockKey` (`workspace/locks.ts:60`) | (a) `TargetLineModule`'s catalog-write methods (`add` and its code-ref-update sibling), `target-lines.ts:315` / `~379`, via `targetLineWriteLockKey` (a `scopeLockKey` wrapper with `projectId: '*'`) — `target-lines.ts:334, 398`; (b) `WorkspaceModule.apply()`, `workspace/module.ts:161-176`; (c) `WorkspaceModule.applyCleanup()`, `workspace/module.ts:314-361` | 4 acquiring call sites, all `withWorkspaceLocks(...)` |
| `workspace` | `workspaceLockKey` (`workspace/locks.ts:82`) | `WorkspaceModule.apply()` (`module.ts:172-175`) and `WorkspaceModule.applyCleanup()` (`module.ts:356-360`) — always taken TOGETHER with `scope` in the same `withWorkspaceLocks([...])` call, never alone | Same 2 call sites as `scope`'s (b)/(c) |
| `change` | `changeLockKey` (`workspace/locks.ts:105`) | **Nothing in shipped code.** Only call site anywhere in `src/` or `test/` is `test/core/store/workspace-locks.test.ts:153`, the key constructor's own unit test | `grep -rn "changeLockKey("` across `src/` and `test/` returns exactly 2 lines: the export and that one test |
| `integration` | `integrationLockKey` (`workspace/locks.ts:116`) | **Nothing in shipped code.** Only call site anywhere in `src/` or `test/` is `test/core/store/workspace-locks.test.ts:154`, same test as above | Same grep, same file |

## A nuance worth recording: `scope`/`workspace` are also PEEKED, not just acquired

`buildWorkspaceCleanupPlan` (`workspace/cleanup.ts:189-213`, the cleanup
PREVIEW builder, not the apply) constructs the same `scope`+`workspace` key
pair and calls `lockIsHeld(coordination, key)` on each — a read-only peek
used to report a blocker precondition in the preview, never an acquisition.
The actual acquisition of that same pair happens only in
`WorkspaceModule.applyCleanup()`. This matches the general rule stated in
`locks.ts`'s own header comment: "A READ takes no lock at all." Recorded here
so a future reader does not mistake the preview's peek for a sixth taker.

## Disposition for `change` / `integration`

Recorded as **unenforced-by-design** on this branch, exactly as the task
brief anticipated: their real taker is the finalization slice
(`finalization/`), which is explicitly out of scope for this child (see
`proposal.md`'s deferral list and task 6.3's inbound-acceptance-item
bookkeeping). `STORE_LOCK_ORDER` reserves their position in the sequence —
prepended-before by nothing, since `issue` is first — but nothing in this
child's shipped code, nor anywhere else on this branch, ever calls
`changeLockKey` or `integrationLockKey` outside their own unit test. Ordering
discipline for those two keys has zero live enforcement today; it exists
only as an available extension point the next slice must actually wire up
and is expected to prove with its own acquisition-order tests, the same way
`assertIssueAcquisitionOrder` (`locks.ts:166-182`) proves it for `issue`.
