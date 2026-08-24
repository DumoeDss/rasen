# Production-browser evidence

## Reproduction

Build the UI, confirm Chrome remote-debugging permission with the installed
`rasen-chrome-use` dependency check, then run:

```text
pnpm --filter @atelierai/rasen-ui build
node rasen/changes/issue-board-cutover/evidence/browser-receipt-runner-self-test.mjs
node rasen/changes/issue-board-cutover/evidence/browser-capture-runner.mjs
node rasen/changes/issue-board-cutover/evidence/browser-persistent-capture-runner.mjs
```

Both runners use the sticky CDP proxy at `http://localhost:3456`; every proxy call is made by
`curl --noproxy '*'`, and every run owns and closes one dedicated target. Each observation begins
with `/network/clear`, proves the returned buffer and sequence are empty, and retains every event
from the management origin, including completion/failure state. Tokens, cookies, request headers,
URL fragments, external browser traffic, fixture logs, and temporary metadata are never written to
either receipt. The sticky proxy is deliberately left running.

Before a receipt can acquire `status: ok`, the shared guards reject any unfinished, failed,
unsuccessful, stale, non-GET, or invalidation request. Projection and narrowed-attention captures
must each occur exactly once after their reset, return 200, carry the exact Store selector and Issue
query, decode to the expected Issue identity, and reproduce the stored canonical digest. Receipt
verification then re-derives every freshness, GET-only, mutation-inventory, no-invalidation,
storage, semantic, response-correspondence, and cleanup verdict from the recorded facts.

## Fail-closed runner self-tests

The deterministic self-test passed 14 negative cases without opening the persistent Store: pending
POST, completed POST, failed status, wrong Store selector, wrong Issue query, stale pre-reset
response, payload identity mismatch, unsupported storage clear, failed storage clear, invalidation
call, tampered raw body, tampered canonical preimage, tampered digest, and cleanup failure. Every case
was required to throw before a successful receipt could be emitted.

## Disposable production-browser receipt

- Receipt: `browser-disposable-receipt.json`, schema 3, `status: ok`, captured at
  `2026-08-24T09:03:36.755Z`. The production bundle was `assets/index-Bijj_6AB.js`; the disposable
  real-Git Store uid was `2147b049-0f95-4463-b0a7-175829002f43`, its exact selector was
  `store:2147b049-0f95-4463-b0a7-175829002f43`, and the Issue was `browser-proof`.
- Six independently reset observation windows retained 71 management-origin requests. All 71 were
  observed after an empty reset, completed without a failure, had successful status when present,
  used GET, and avoided invalidation; the derived mutation inventory is empty.
- The provenance map has seven source-distinct entries. Nine independently derived semantic
  assertions prove exact fragment cardinality/kind, Issue/phase/health/progress inputs, execution
  root, runtime-attention locators, and delivery facts.
- Both browser-storage clears proved support for localStorage, sessionStorage, Cache Storage,
  `indexedDB.databases()`, and service-worker registrations; every clear completed without error and
  all five post-clear counts were zero.
- Canonical JSON v1 recursively sorts object keys, preserves array order, emits compact JSON, and
  hashes its UTF-8 bytes with SHA-256. Before clearing, DOM SHA-256 was
  `208a8c2d047b84e9d69b12f9de312f6141493d7ab2e70236e794fdd274c2431b` and response SHA-256 was
  `4d21a7c7d6d05b36bf1ef97c46bf20c4bd9cc6efc496d4e76a945a56e4625409`. The exact raw projection
  and attention bodies decode to the stored canonical preimage and digest, and both freshness flags
  derive true from reset generation 2.
- The cache-cleared remount reproduced both digests exactly. The disposable control then committed
  acceptance revision `0002` at `b6019ea8fc98866059ffbbb4937da109bb3d77a7`; the next cleared
  rebuild changed DOM SHA-256 to
  `abddf390bec522289c5f0dc45b66baa0d237afe2c27a71ae3a00b614645061df` and response SHA-256 to
  `829f4c5fc1cf5979d5e308e24f1c656e31d3639282d8350c9824a899d8adf334`, with no management-origin
  invalidation call.
- Final verification proved the dedicated browser target closed, fixture process exited, fixture
  root disappeared, token metadata and logs were removed, and the sticky proxy remained healthy.

## Persistent `issue-registry` read-only dogfood

- Receipt: `browser-persistent-readonly-receipt.json`, schema 3, `status: ok`, captured at
  `2026-08-24T09:07:32.408Z`. The runner discovered the registered Store with
  `rasen store list --json`; the exact selector was `store:issue-registry` and no mutable registry
  location was hard-coded.
- Store `issue-registry` (`f76edc31-229a-42bc-a5c7-848021eeb2da`) remained at HEAD
  `f295abce308297dd09eb34a81287c614a8c489c5` with empty porcelain status.
- Before and after the production-browser smoke, the deterministic tracked-byte manifest contained
  311 entries and SHA-256
  `333900dfb4dfd6740907b93c91054ed963c5a9375044409d5b48abcd67e9fba6`. HEAD, status, count,
  aggregate digest, and every path/byte/hash entry were exactly equal.
- Five independently reset windows retained 63 management-origin requests across the storage
  bootstrap and Issues → Detail → Operations → Unlinked Changes traversal. All 63 were fresh,
  completed, successful, GET-only, and free of invalidation; the derived mutation inventory is
  empty. The storage clear also proved all five APIs supported and empty without errors.
- The detail projection and attention requests returned 200 with the exact
  `store:issue-registry`/`issue-level-review-delivery` query and decoded identity. Raw-body/canonical
  correspondence recomputed true with response SHA-256
  `815372540ab23e82c244ea02e7b1551058cf8aebd092edfbb92f316b2c2462d1`. Five independently derived
  semantic assertions prove the resolved/accepted state, exact healthy/progress node inputs,
  delivery targets, and one-to-one evidence fragments.
- No Issue was created, attached, accepted, closed, or updated, and no Change, plan, Run, Session,
  Store, or project mutation was issued. The dedicated target and server exited, metadata/logs were
  removed, and the shared sticky proxy remained healthy.
