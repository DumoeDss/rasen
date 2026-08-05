# CSO security and contract re-review - round 3

**Change:** `ecp-platform-process-authority-foundation`
**Branch:** `wip/ecp-shared-bounded-loop-lifecycle-resume`
**Date:** 2026-08-05
**Mode:** dispatched, report-only, fresh non-author re-review
**Verdict:** **CLEAN - Blocker: 0, Major: 0, Minor: 0, Trivial: 0**

## Scope and independence

Re-read the latest product authority module, focused tests/helpers, delta spec, design, both round-2 review reports, and `review-fix-round-2.md`. The fix receipt was treated only as a list of claims to disprove or re-establish. The cumulative dirty worktree was preserved and not attributed to this Change.

The review independently rechecked all nine round-2 findings and the affected contract delta: non-forgeable registry provenance, local/recovery generation identity, receipt isolation, exact prepared capability capture, immutable bounded inputs, single-attempt durable publication with retained reconciliation, symmetric monotonic settlement, non-empty root status, strict 1,024-generation concurrency, and real prepared/published abort conformance.

No network, credentials, external system, actual-OS provider, product/test/spec/task/runstate/Direction/portfolio, stash, retained temp output, commit, ship, or archive state was touched.

## Validation evidence

- Exact task-9.1 focused command: **exit 0; 12 files, 186 tests passed**.
- `pnpm exec tsc --noEmit --pretty false`: **exit 0**.
- A fresh inline probe against the current built module replayed the prior B-001, B-002, B-005, M-002, M-005, M-006, M-007, and M-008 failure shapes. Every old exploit/failure path was rejected or settled correctly.
- B-004 was independently rechecked from both direct shared-suite assertions and the measured mutation snapshot, then exercised by the passing conformance test.
- No probe file or output was retained.

## Nine-finding recheck

| Prior finding | Round-3 result | Independent evidence |
| --- | --- | --- |
| B-001 forgeable registry provenance | **CLOSED** | `registry.ts:17`, `:192`, `:225-253` brands authentic registries privately, captures the base selector, and requires the exact base prototype. Coordinator and recovery resolution use only that selector. Fresh subclass replay returned `authority-unavailable`; overridden selector and provider prepare counts stayed zero. The focused test also covers subclass, proxy, and structural lookalike. |
| B-002 recovery reference outside lifecycle ledger | **CLOSED** | `coordinator.ts:706-787`, `:1187-1218`, and `:1221-1261` place every valid recovered reference into the shared active/retired ledger before provider dispatch. Fresh recovered exact-empty A produced one authentic cached receipt; a later local prepare reusing A returned `authority-unavailable`, and the provider was not re-inspected. In-flight recovery/local collision and recovery-capacity tests are present. |
| B-004 abort-incapable provider can pass conformance | **CLOSED** | `process-authority-provider-conformance.ts:237-285` directly requires authentic exact empty for prepared and published abort while retaining negative abort cases. `:405-440` and `:467-478` make both positive facts part of the exact measured snapshot. `broken-abort` is a named mutation and the deterministic provider returns uncertainty only for that mutation. |
| B-005 mutable prepared reference controls the wrong authority | **CLOSED** | `coordinator.ts:327-340` no longer fingerprints the provider value; `:465-491` reads reference and activate once into a frozen snapshot; `:1027-1041`, `:1086-1100`, and `:1151-1167` use only the captured fields. Fresh alternating accessors were each read once, provider abort received A, and the authentic receipt named A. |
| M-002 null/null root exit accepted | **CLOSED** | `types.ts:99-120` models a non-empty root status union; `coordinator.ts:493-520` rejects two nulls. Fresh null/null inspect settled as retained `control-loss`, and observation/control/adapter/shared-suite discriminators cover the delta. |
| M-005 mutable input validation/dispatch split | **CLOSED** | `coordinator.ts:365-454` guarded-reads each top-level prepare/termination field once, captures each array/environment entry once, validates the captured values, then freezes the dispatch snapshot. Fresh alternating command input was read once and the provider received only the validated safe value. Tests cover every top-level prepare and termination field. |
| M-006 post-deadline rejection misclassified | **CLOSED** | `coordinator.ts:890-960` routes fulfillment and rejection through the same monotonic `settleObserved` guard. Fresh inspect rejection at monotonic 11 for deadline 10 returned `timeout`. Tests cover delayed rejection for all seven phases. |
| M-007 concurrent prepare exceeds 1,024 generations | **CLOSED** | `coordinator.ts:708`, `:766-787`, and `:984-1059` synchronously reserve capacity before prepare dispatch and include reservations in recovery capacity. With 1,023 retained generations, two concurrent prepares yielded exactly one `prepared-inert`, one `authority-unavailable`, and exactly 1,024 total provider prepares. Failure, timeout, collision, and recovered-ledger cases are tested. |
| M-008 mismatched acknowledgement permits publisher retry | **CLOSED** | `coordinator.ts:1112-1175` consumes publication capability before invoking the publisher and enters internal `publication-uncertain` after timeout, loss, or mismatch. Fresh mismatch returned publish `control-loss`; retry returned `ordering-conflict`; publisher count remained one; activation stayed unavailable; bounded abort returned an authentic exact-empty receipt. |

## Security invariant result

| Invariant | Result |
| --- | --- |
| Closed local manifest/provider provenance | PASS |
| Local/recovery generation non-reuse and receipt isolation | PASS |
| Exact-reference prepare/activate/abort binding | PASS |
| Publish-before-activate and single publication attempt | PASS |
| Retained authority after publication/activation ambiguity | PASS |
| Fulfillment/rejection monotonic deadline symmetry | PASS |
| Immutable bounded operational inputs | PASS |
| Non-replayable diagnostic reference view | PASS |
| Strict bounded concurrency at 1,024 generations | PASS |
| Authentic prepared and published abort conformance | PASS |

## Prior security finding status

| Security finding | Round-3 status |
| --- | --- |
| SEC-PA-001 stale exact-empty replay | **CLOSED** - local and recovered generations share one non-evicting lifecycle ledger, and captured exact-reference control prevents cross-generation receipts. |
| SEC-PA-002 bridge failure after activation | **CLOSED** - the adapter acquires/validates the runtime bridge while published-inert, aborts before activation on bridge failure, and performs exact-reference termination after ambiguous activation. |
| SEC-PA-003 manifest bypass | **CLOSED** - direct raw paths and subclass/proxy/lookalike/override paths all fail before selector or provider dispatch. |
| SEC-PA-004 replayable diagnostic view | **CLOSED** - `reference-codec.ts:310-336` exposes only redacted tuple metadata plus a one-way digest, never the sensitive reference or reversible provider bytes. |

## Additional affected-delta review

- Publication ambiguity is retained without inventing a public lifecycle truth: the prepared capability reports the bounded publish failure, forbids activation and republishing, and still permits exact captured-reference abort. External coordinator inspect/terminate reconciliation also remains available from the durable reference.
- Recovery registration occurs after canonical reference and exact manifest-bound provider resolution but before any provider observation/control call. Invalid, future, tampered, or mismatched references therefore consume no lifecycle slot and invoke no provider.
- Capacity reservation is single-thread-safe under the JavaScript coordinator execution model: reservation and recovered registration contain no await boundary, and both count the same ledger plus outstanding reservations.
- The shared conformance suite now proves provider behavior rather than merely coordinator retention for abort: two successful exact-empty receipts are measured, while the broken provider mutation makes the unchanged expected snapshot RED.
- The production registry remains empty. No Linux, Windows, macOS, ProcessCapsule protocol/manifest integration, PID/PGID fallback, native control field, Action/signer/Run authority, packaging, or support claim entered this foundation.

## False-positive filtering

No new reportable finding survived the confidence gate. Three candidates were discarded: the intentionally unauthenticated SHA-256 corruption digest, provider-native late prepare effects that expose no durable reference or workload activation in the common contract, and generic resource-exhaustion speculation beyond the now-enforced fixed ledgers.

## Canonical counts and final gate

- **Blocker:** 0
- **Major:** 0
- **Minor:** 0
- **Trivial:** 0
- **Total reported:** 0

**Final verdict: CLEAN.** The security/contract gate for this round is 0 Blocker and 0 Major. This report does not itself authorize or perform task completion, commit, ship, archive, provider unblocking, or any platform/release support claim.

This AI-assisted review is not a substitute for a professional security audit or platform-specific penetration testing. Actual Linux, Windows, and any future macOS provider still require independent real-OS authority, escape, recovery, kill, unavailable, packaging, and authentication review.
