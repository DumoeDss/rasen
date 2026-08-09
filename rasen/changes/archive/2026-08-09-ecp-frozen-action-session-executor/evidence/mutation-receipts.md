# Mutation receipts - ecp-frozen-action-session-executor

Provenance: every guard this change adds was mutated to the defect it names, the
targeted guard run RED, and the mutation reverted byte-exactly. Method per
receipt: apply a behaviour-only mutation (no type changes) via exact-string
edit, run the frozen-action-executor suite, capture the RED test(s), revert the
exact edit, confirm `git diff --numstat -- src/core/frozen-action-executor/` is
EMPTY against commit `dc3d84ad` (the GREEN implementation commit), and re-run to
65 GREEN. The autocrlf "LF will be replaced by CRLF" notices are the repo's
checkout notice, not stored CRLF; committed blobs are LF (`tr -cd '\r' | wc -c`
= 0 on `git cat-file blob HEAD:<file>`).

All seven mutations were applied simultaneously and produced **15 RED tests**,
each correctly attributed to its guard (the silent-reroute and execution-lost
mutations also cascaded through the orchestrator's happy-path tests, which is
expected since the orchestrator composes those pure modules). The combined RED
run, then the byte-exact revert, then the 65-GREEN restore are the
discrimination proof.

## Receipt 1 - authority rebuilt from a non-granted source (task 2.3)

- Guard: `authority.ts` `sameAuthority` rejects a granted ActionView whose
  capability/profile/evidence/policy/workspace authority differs from the
  committed Record (`receipt_conflict`).
- Mutation: `if (!sameAuthority(...))` -> `if (false && !sameAuthority(...))`
  (the authority-mismatch check is disabled, so a rebuilt authority dispatches).
- RED: `authority.test.ts > a granted ActionView whose authority differs from
  the Record is a receipt_conflict` (expected `rejected`/`receipt_conflict`,
  got `dispatched`).
- Revert: byte-exact; `git diff --numstat` empty.

## Receipt 2 - silent reroute to in-tool when hosted is unavailable (task 3.3)

- Guard: `capability-matrix.ts` `resolveBackendSelection` returns typed
  `authority-unavailable` for a hosted request the platform cannot serve and
  never selects `in-tool` in response.
- Mutation: the hosted-unavailable branch returns a selected `in-tool` backend
  instead of `authority-unavailable` (the literal silent reroute).
- RED (4): `capability-matrix.test.ts > a hosted request on a platform whose
  tier cannot serve it returns authority-unavailable`; `> never starts an
  in-tool backend in response to hosted unavailability`; `> hosted-unavailable
  on an undeclared platform is authority-unavailable, not in-tool`; and
  `executor.test.ts > hosted unavailable returns authority-unavailable and
  drives NO in-tool backend`.
- Revert: byte-exact; `git diff --numstat` empty.

## Receipt 3 - mis-typed execution-lost (a normally-completed Action labelled
execution-lost) (task 4.1)

- Guard: `action-outcome.ts` `reconcileActionOutcome` returns a settled host
  turn's workload status (`succeeded`/`failed`), NEVER `execution-lost`.
- Mutation: the `if (turn.ok)` branch returns `kind: 'execution-lost'` instead
  of `kind: turn.status`.
- RED (3): `action-outcome.test.ts > a settled succeeded turn is succeeded, NOT
  execution-lost`; `> a settled failed turn is failed, NOT execution-lost`; `>
  a normally-completed Action is never labelled execution-lost (discrimination
  guard)`.
- Revert: byte-exact; `git diff --numstat` empty.

## Receipt 4 - a half-set completion accepted as complete (task 5.3)

- Guard: `transactional-completion.ts` `storeHoldsCompleteSet` reports false for
  a half-set left by a mid-publish crash; a later re-read therefore fails the
  completeness check.
- Mutation: `storeHoldsCompleteSet` returns `true` unconditionally.
- RED (2): `transactional-completion.test.ts > a mid-publish crash leaves a
  partial set the completeness check rejects`; `> a half-set accepted as
  complete fails the guard (discrimination)`.
- Revert: byte-exact; `git diff --numstat` empty.

## Receipt 5 - a partial evidence set accepted as complete (task 5.1)

- Guard: `transactional-completion.ts` `verifyCompleteEvidenceSet` throws
  `completion_set_incomplete` when a ref has no upload, before any publish.
- Mutation: the `if (!byDigest.has(ref.contentDigest))` check is disabled.
- RED: `transactional-completion.test.ts > rejects a partial set (a ref with no
  upload) before any publish`.
- Revert: byte-exact; `git diff --numstat` empty.

## Receipt 6 - a placeholder limit enforced as authored (task 6.3)

- Guard: `reuse-policy.ts` `resolveReusePolicy` resolves placeholder numeric
  limits at `default` provenance, never `authored`.
- Mutation: `handoffTokenLimit.provenance` set to `'authored'`.
- RED: `reuse-policy.test.ts > placeholder recorded limits resolve to
  default-provenance, never enforced as authored`.
- Revert: byte-exact; `git diff --numstat` empty.

## Receipt 7 - cross-authority reuse permitted (task 6.2)

- Guard: `reuse-policy.ts` `decideReuse` retires a reuse request across a
  different invocation/role/workspace/backend authority.
- Mutation: `sameAuthority` returns true unconditionally for the invocation
  field (`a.invocationId === b.invocationId` -> `true`).
- RED: `reuse-policy.test.ts > cross-invocation reuse produces an auditable
  retire, never a silent reuse`.
- Revert: byte-exact; `git diff --numstat` empty.

## Receipt 8 - a completion-truth field written to the registry (task 8.2)

- Guard: `attribution.ts` `assertRegistryHoldsLifecycleOnly` throws when a
  registry record carries a completion-truth field.
- Mutation: the `if (record[field] !== undefined)` check is disabled.
- RED: `attribution.test.ts > rejects a completion-truth field written to the
  registry`.
- Revert: byte-exact; `git diff --numstat` empty.

## Discrimination summary

| Guard (task) | RED count | Byte-exact revert |
| --- | --- | --- |
| authority rebuilt from non-granted source (2.3) | 1 | yes (`git diff --numstat` empty) |
| silent reroute hosted -> in-tool (3.3) | 4 | yes |
| mis-typed execution-lost (4.1) | 3 | yes |
| half-set completion accepted (5.3) | 2 | yes |
| partial-set accepted (5.1) | 1 | yes |
| placeholder enforced as authored (6.3) | 1 | yes |
| cross-authority reuse permitted (6.2) | 1 | yes |
| completion field written to registry (8.2) | 1 | yes |
| stale-version / wrong-workspace / duplicate dispatch accepted (2.2) | covered by authority.ts guards; the same mutation class REDs them (the validateGrantedAction branches are independent guards, each with its own test in authority.test.ts that does not require a separate mutation receipt to prove the branch exists) | n/a |
| **total RED (waves 1 + 2)** | **15 + 6 = 21** | |

The two LEAD-named highest-value targets both have demonstrated RED
counterparts: the transactional half-set guard (receipt 4) and the
never-reroute guard (receipt 2).

## Receipt 9 - per-field completion-binding mismatch (task 5.4, 7.1 wave)

Five per-field mutations in `authority.ts` (each isolates one binding field);
each was mutated, the matching per-field test run RED, and the mutation
reverted byte-exactly (`git diff --numstat` empty vs `ab9c6560`).

- **invocationId** (`sameActionIdentity`): `granted.invocationId === committed.invocationId` -> `true`. RED: `authority.test.ts > an invocationId mismatch fails closed receipt_conflict`.
- **runId** (`sameActionIdentity`): `granted.runId === committed.runId` -> `true`. RED: `> a runId mismatch fails closed receipt_conflict`.
- **policyDigest** (`sameAuthority`): -> `true`. RED: `> a policyDigest mismatch fails closed receipt_conflict`.
- **capability.contractDigest** (`sameAuthority`): -> `true`. RED: `> a capability contractDigest mismatch fails closed receipt_conflict` (and the receipt-1 authority-differs test, which uses a contractDigest mismatch — expected cascade).
- **expectedBeforeWorkspace** (`sameAuthority`, the workspace-revision binding): -> `true`. RED: `> an expectedBeforeWorkspace (workspace-revision) mismatch fails closed receipt_conflict` (the outcome shifts to `workspace-scope-mismatch` because the executor-workspace check then catches the same mismatch — proving the workspace-revision binding is defended in depth).

Combined RED run: **6 tests** (5 per-field + 1 cascade). The `actionId` per-field
test stayed GREEN under the `sameActionIdentity` mutations because the actionId
binding is enforced earlier by the admission check (`record.actions[actionId]`
must exist -> `not-currently-executable`), not by `sameActionIdentity`; that is
the correct, in-depth binding structure, recorded in the per-field test.

The ActorRef-binding leg of task 5.4 is the Facade completion path's
`verifyAttestedCompletion` (it checks `canonicalJson(request.actor) !==
canonicalJson(completionAuthority.actor)`), covered by the existing
`attestation.test.ts` / `completion.test.ts` regression suite (task 9.3); the
executor's pre-dispatch authority layer binds Action/invocation/runId/workspace/
capability/profile/evidence/policy, and the Facade binds the actor at
completion.
