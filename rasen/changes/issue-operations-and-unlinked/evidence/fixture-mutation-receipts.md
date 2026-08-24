# Disposable Store mutation receipts

Date: 2026-08-24
Scope: `test/core/management-api/change-issue-links.test.ts`
Command: `pnpm test -- test/core/management-api/change-issue-links.test.ts`

The suite creates and removes its own real-Git temporary Store fixture. It never resolves or mutates
the persistent `issue-registry` Store.

## Attach success and fresh association

- The fixture begins with `unlinked-change` reported as `unlinked / attachable`.
- A new open Issue is created, then a plan containing the exact Store/project/target-line/instance
  identity is published.
- A fresh identical link read reports the same Change as `linked / already-linked`; no invalidation,
  cache write, or persisted reverse index is involved.

## Stale conditional publication

- Issue `api-plan` publishes `0001` from `expectedRevisionId:null`, then `0002` from expected
  revision `0001`; all admitted node fields round-trip verbatim.
- A second request still based on `0001` receives HTTP 409 with
  `execution_plan_revision_conflict`.
- The plan-directory listing is byte-for-byte unchanged around the stale request. An omitted
  expectation remains backward compatible and subsequently publishes `0003`.

## Honest partial-create recovery

- Issue `partial-create` is created open. Its expected-null first-plan request intentionally names an
  absent Change instance and is refused with `issue_reference_unresolved`.
- The Issue record remains present, the plans directory remains empty, and the real
  `unlinked-change` remains `unlinked / attachable`; no compensating delete or false atomic success
  occurs.
- Recovery publishes the correct complete-scope node with `expectedRevisionId:null`, producing
  revision `0001` with `supersedes:null`. The fresh link payload then reports
  `linked / already-linked` with Issue `partial-create`, revision `0001`, node
  `unlinked-change`.

## Result

`7/7` tests passed. Test-body time was 180,683 ms and total Vitest duration was 205.32 s. The
measured file remains within the configured 241,000 ms slow-test weight.
