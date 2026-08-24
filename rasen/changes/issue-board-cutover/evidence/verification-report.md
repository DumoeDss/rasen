# Independent Delta Re-verification Report: issue-board-cutover

## Independence and scope

This is the independent, delta-only re-verification of the fixes made after the prior verdict:

`VERIFY VERDICT: BLOCKED — Blocker:0 Major:2 Minor:0 Trivial:1`

The verifier did not implement, stage, commit, ship, mutate run-state, or mutate any Issue. The only
write made by this pass is this report. The production-browser runners were therefore not invoked
again because their exact commands overwrite committed receipts; instead, their complete source,
receipts, canonical preimages, raw management response bodies, cleanup records, and persistent
Store manifest were independently checked read-only.

Baseline identity:

- HEAD: `1423fc29b089a98ff89977bbd933121ccac59f27`
- `HEAD^{tree}`: `81ca61f7b8ea8c2e81c46e4dc51e13446aceebb3`

Exact uncommitted fix identity (the verifier report itself is excluded to avoid self-reference):

- SHA-256 of raw `git diff --binary --no-ext-diff 1423fc29` for all tracked paths except this
  report: `28c2aefbe031cc80e495bc9a5a64fe53ce3c6eb87eb99985f00af350cb1ca0a1`
- SHA-256 of the compact, path-sorted four-file untracked manifest below:
  `81f3901a5e9145008747b6508bd1847eb366526155324982c71a63940ec02de6`
- SHA-256 of the compact identity object containing baseline HEAD/tree, both hashes, and the full
  manifest: `e43d157cfe0c5f7ce9f464c0d9f8e18ddbf397ff27a1dbe4a6340a59242fbaed`

| Untracked attributable file | Bytes | SHA-256 |
| --- | ---: | --- |
| `packages/ui/test/components/issue-provenance.test.ts` | 10151 | `5af6f588c7fd5f90775d244ca0c32c639b1f9ab49b824a1b1a078f2f6f187421` |
| `rasen/changes/issue-board-cutover/evidence/browser-capture-runner.mjs` | 30922 | `3bd01dcda0e323e2007d91ad98bb5568e152d9c73d64f9b83eca570135a0884d` |
| `rasen/changes/issue-board-cutover/evidence/browser-persistent-capture-runner.mjs` | 20761 | `c04f7c951b95a3a0c35fb2a93b676104199b0931c320b03121a41dea489e7d36` |
| `rasen/changes/issue-board-cutover/evidence/browser-ts-loader.mjs` | 789 | `e2a7e8e1dcff9be4f38d755bfbd9fd9261f897f3d06abae41b5948ce40c2c97e` |

## Summary

| Dimension | Status |
| --- | --- |
| Completeness | CLEAN — 32/32 tasks remain checked; all 15 requirements and 59 scenarios remain covered, including the previously deficient provenance and browser-evidence tasks |
| Correctness | CLEAN — every representative state/attention/delivery link resolves exactly once to the existing payload inputs that support it, with Git/runtime typing preserved |
| Coherence | CLEAN — the fix remains presentation-only, adds no endpoint/status derivation/cache/persistence/second truth, and the reproducible evidence runners preserve the disposable/persistent safety boundaries |

VERIFY VERDICT: CLEAN — Blocker:0 Major:0 Minor:0 Trivial:0

## Prior-finding closure

### Major 1 — state-to-provenance semantics: CLOSED

The fixed presentation index is source-distinct and copies the relevant payload inputs rather than
merely linking to a unique id:

- `issue-provenance.ts:82-111` maps already-projected phase/health/attention values to one of seven
  closed families without recomputing an axis. Git attention and runtime attention now have
  separate anchors and source kinds.
- `issue-provenance.ts:134-159` copies node kind/project/target/lifecycle/reason/observation,
  diagnostic, run-state path, locator, evidence locator, and blocker inputs.
- `issue-provenance.ts:179-233` puts phase, health, progress, Issue state, node completion inputs,
  resolution facts, and Git/readability problems in the plan/projection target.
- `issue-provenance.ts:235-286` puts resolved/open Issue state, acceptance record hashes/gate
  snapshot, node inputs, status problems, and review inputs in the acceptance target.
- `issue-provenance.ts:288-353` preserves runtime locators and delivery state/ref/path/hash/missing
  and invalid-archive diagnostics.
- `issue-provenance.ts:355-442` types each attention item from its existing problem/item kind and
  copies its exact item plus supporting Git or runtime facts.
- `IssueCard.tsx:53-128` and `IssueDetailPage.tsx:358-385,820-861,982-1000` use these mappings for
  every displayed axis, top-attention item, runtime visibility, and delivery state. Every target id
  is unique in the rendered seven-entry map.

Representative cases were checked in source, focused tests, and browser receipts:

| Case | Exact target evidence | Result |
| --- | --- | --- |
| `done` | `acceptance-review`: resolved `issue.record.state` plus accepted-record content/conditions SHA-256 | PASS |
| `review` / `waiting-human` | `acceptance-review`: open Issue, absent accepted record/gate facts, and terminal required-node lifecycle/observation inputs | PASS |
| `healthy` | `plan-projection`: projected health plus every wanted node lifecycle/observation; persistent real payload proves healthy `3/3` from three finalized required nodes | PASS |
| `failed` / runtime failure | `attention-runtime`: failure kind/diagnostic plus exact failed node lifecycle/observation/run-state/evidence locator | PASS |
| Partial progress | `plan-projection`: exact `completed`/`total` plus required-node lifecycle/observation completion inputs; disposable real payload proves `1/2` | PASS |
| Git/readability problem | `attention-git`: exact problem kind/ref/reason plus Issue refs and plan diagnostic; never labeled runtime | PASS |
| Unreadable delivery | `delivery`: exact delivery state plus invalid-archive ref/reason, classified as Git evidence | PASS |

The six focused semantic cases live at `issue-provenance.test.ts:104-282`; the production component
coverage additionally verifies seven unique entries and exact DOM targets. No Issue-page mutation,
status derivation, API, browser storage, or persisted provenance graph was added.

### Major 2 — reproducible browser evidence: CLOSED

The new runners and regenerated schema-2 receipts close the reproducibility and cleanup gap:

- The exact documented invocations are:
  `node rasen/changes/issue-board-cutover/evidence/browser-capture-runner.mjs` and
  `node rasen/changes/issue-board-cutover/evidence/browser-persistent-capture-runner.mjs`, after
  `pnpm --filter @atelierai/rasen-ui build`.
- The disposable runner starts `browser-fixture.ts` with Node's built-in TypeScript transform and
  the checked-in `.js` to `.ts` loader, then drives the production bundle
  `assets/index-Bijj_6AB.js` through Issues, Detail, Operations, and Unlinked Changes.
- It records exact raw 200/GET response bodies for projection and narrowed attention at baseline,
  after storage clearing, and after the controlled committed mutation. The associated canonical
  response preimages exactly equal recursive key-sorted compact JSON of those parsed bodies.
- Eight stored SHA-256 records were independently recomputed from their complete UTF-8 preimages;
  every value matches. Baseline and post-clear DOM/response hashes are equal; post-mutation
  DOM/response hashes differ.
- localStorage, sessionStorage, Cache Storage, IndexedDB database inventory, and service-worker
  registrations were all supported and recorded at zero after both clears. Fresh projection and
  attention GETs are present after each rebuild, and no invalidation or management-origin mutation
  appears.
- `browser-capture-runner.mjs:525-584` and
  `browser-persistent-capture-runner.mjs:358-407` provide idempotent cleanup used on both normal/error
  completion and SIGINT/SIGTERM. Receipts confirm only each dedicated target was closed, fixture or
  server exited, metadata/logs/fixture root were removed, and the shared CDP proxy remained healthy.
- Tokens, cookies, headers, URL fragments, and external events are redacted. Independent scans found
  no `#token=`, Authorization/Bearer value, Cookie value, or committed credential in either receipt.

The persistent runner is GET-only at the management origin and its current independent byte audit
matches the receipt exactly:

- HEAD `f295abce308297dd09eb34a81287c614a8c489c5`;
- clean porcelain status;
- 311 tracked files;
- manifest digest `333900dfb4dfd6740907b93c91054ed963c5a9375044409d5b48abcd67e9fba6`;
- zero path/byte/SHA mismatch across all 311 files;
- before/after HEAD, status, count, digest, and every manifest entry equal; and
- empty `mutationOperationsIssued` with every captured management-origin request GET.

### Trivial — stale shell comments: CLOSED

`app.tsx:73-81` and `Layout.tsx:9-17` now say Store execution lives in Operations, project live
work remains on Board/Task Detail, and the old header summary is gone. No stale claim that a header
running summary still exists remains.

## Findings

### Blocker

None.

### Major

None.

### Minor

None.

### Trivial

None.

## Gates and integrity

- `node --check` on both capture runners and the TypeScript loader — PASS.
- `pnpm --filter @atelierai/rasen-ui test -- test/components/issue-provenance.test.ts test/components/issue-detail-page.test.tsx`
  — PASS, 2 files / 23 tests.
- `pnpm --filter @atelierai/rasen-ui test` — PASS, full UI package (74 files / 1001 tests); known
  jsdom navigation/`scrollTo` diagnostics remained non-failing.
- `pnpm --filter @atelierai/rasen-ui build` — PASS, 566 modules; receipt bundle name reproduced.
- `pnpm run build` — PASS, TypeScript plus Windows ProcessCapsule release helper.
- `node bin/rasen.js validate issue-board-cutover` — PASS.
- Independent receipt verification — PASS: all eight digest/preimage pairs, all six raw-response to
  canonical-response relationships, storage clearing, fresh GETs, controlled change, cleanup, and
  redaction assertions.
- Fresh persistent Store audit — PASS: exact HEAD, clean status, 311-file byte manifest, aggregate
  digest, and zero mutation.
- Strict UTF-8 decode of all 11 changed tracked and four attributable untracked text files — PASS;
  no BOM, U+FFFD, known mojibake marker, or trailing whitespace. Both changed JSON receipts parse.
- `git diff --check 1423fc29 -- .` — PASS.
- Version/dependency manifests and `src/core/pipeline-registry/` — unchanged.
- Unrelated `.rasen/**` debris and parent planning files — untouched.

TEST EVIDENCE
- scope: complete uncommitted fix delta; focused provenance/Detail semantics; full UI package; UI/root production builds; change validation; runner syntax and source audit; receipt preimage/digest/response/storage/cleanup checks; persistent Store 311-file byte audit; UTF-8/JSON/diff/fence checks
- rationale: this directly covers the two previously open Major findings, their representative semantic cases, the prior Trivial comment issue, and all changed runtime/build surfaces
- command: `node --check rasen/changes/issue-board-cutover/evidence/browser-capture-runner.mjs`; `node --check rasen/changes/issue-board-cutover/evidence/browser-persistent-capture-runner.mjs`; `node --check rasen/changes/issue-board-cutover/evidence/browser-ts-loader.mjs`; `pnpm --filter @atelierai/rasen-ui test -- test/components/issue-provenance.test.ts test/components/issue-detail-page.test.tsx`; `pnpm --filter @atelierai/rasen-ui test`; `pnpm --filter @atelierai/rasen-ui build`; `pnpm run build`; `node bin/rasen.js validate issue-board-cutover`; independent read-only receipt/manifest/integrity scripts; `git diff --check 1423fc29 -- .`
- result: pass
- tree: 81ca61f7b8ea8c2e81c46e4dc51e13446aceebb3

## Final assessment

Both prior Major findings and the Trivial comment issue are closed. The state links now lead to the
actual payload inputs and locators supporting their displayed values, the browser evidence is
reproducible and independently hash-verifiable with controlled cleanup, and the persistent Store
remains byte-identical and mutation-free. The delta is clean for the LEAD's merge/ship decision.
