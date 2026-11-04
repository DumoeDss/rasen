# Implementation baseline - ecp-macos-process-authority-provider

Recorded at the start of the apply stage, 2026-08-07.

## Provenance

- Implementation-start HEAD: `09aae5d9ff674980b7e4c51a570c802088e44c72`
- Branch: `feat/add-task-loop-pipeline`
- Worktree: `OpenSpec-code-wt-ecp-shared-bounded-loop-lifecycle`
- Implementation host: Windows 11 Pro 10.0.26200, Node from the repo toolchain.
- **No macOS host exists in this environment.** Section 7 of `tasks.md` is
  therefore untouched and the change stays non-terminal.

## Verbatim `RECURSIVE_PROCESS_SCOPE_SEMANTICS` at implementation start

From `src/core/session-host/process-authority/types.ts:25-36`:

```ts
export const RECURSIVE_PROCESS_SCOPE_SEMANTICS = Object.freeze([
  'workload-non-escape',
  'publish-before-activate',
  'root-exit-distinct',
  'natural-exact-empty',
  'recursive-terminate',
  'recursive-abort',
  'replacement-recovery',
  'bounded-controls',
  'identity-drift-detection',
  'event-completeness',
] as const);
```

Both pending contract edits are still unlanded at this HEAD:

- the `workload-non-escape` wording narrow (to "descendants the workload itself
  forks cannot escape"), and
- the `replacement-recovery` re-tier (criterion 4, moved to the upgrade path).

`replacement-recovery` is still present in the array, so neither edit has
landed. Design decision D2 was written to hold under both the current and the
narrowed wording; nothing in this change reads this array.

## Files this change does NOT touch

Verified by inspection of the final diff: this change makes **no edit** to any
of the three files the concurrent `process-authority-scope-semantics-wording`
change targets:

- `src/core/session-host/process-authority/types.ts`
- `src/core/session-host/process-authority/registry.ts`
- `src/core/session-host/process-authority/manifest.ts`

## Seam facts re-verified against this HEAD (task 1.2)

| Claim in design.md | Verified location at this HEAD | Result |
| --- | --- | --- |
| The frozen registry rejects subset providers | `process-authority/registry.ts:105-107` (exact `capabilityId` equality against `RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID`) and `:108-116` (ordered, complete ten-semantics equality) | Confirmed. design.md cites `105-112`; the semantics check actually spans `108-116`. Same guard, wider span - no substantive drift. |
| The manifest hard-requires the same tuple | `process-authority/manifest.ts:59-63` (`exactSemantics`) and `:118-121` (capability id + semantics) | Confirmed. design.md cites `:61-62,:119`, inside these ranges. |
| `closeDurableProcess` releases only from a `closed` receipt | `session-host/host.ts:614-638` before this change | Confirmed verbatim: `if (receipt.state !== 'closed') return 'live-or-uncertain';`, and `observation.state === 'foreign' \| 'uncertain'` also returns `live-or-uncertain`. This is the wedge the declaration-gated rule fixes. |
| Three `createNativeProcessScope` construction sites | `management-api/router.ts:639`, `session-host/host.ts:299`, `session-host/claude-backend.ts:395` | Confirmed - exactly three, matching the propose-stage finding, not the older single-site claim. |
| `createSessionHost` is constructed in `src/` only at the router | `management-api/router.ts:642` | Confirmed - the only `src/` call site. |
| Host-native Tier A dispatch never enters ProcessScope | No `ProcessScope`/`createNativeProcessScope` reference outside `session-host/` and `management-api/router.ts` | Confirmed by repository-wide search. |

No drift requiring a design change was found.

## Registry record-shape gate found during implementation (not in design.md)

`session-host/registry.ts` validates persisted records against strict key
allowlists (`SESSION_KEYS`, `PROCESS_KEYS`) and throws on any unknown field.
Recording the declaration and the honest terminal therefore required adding
`declaration` to `PROCESS_KEYS`, `processTerminal` to `SESSION_KEYS`, and typed
validation for both. Design.md did not mention this gate; without it the
declaration would have been rejected on read-back rather than silently dropped.
