# CSO reviewer 1 handoff

## Verdict

**CSO VERDICT: NOT CLEAN — Blocker: 1, Major: 3, Minor: 0, Trivial: 0**

Fresh report-only security review completed on branch `wip/ecp-shared-bounded-loop-lifecycle-resume`. No product, test, task, runstate, Direction, portfolio, native/OS, Mac, retained temp, delivery, ship, archive, stash, commit, or push mutation was made.

## Open findings

1. **SEC-PA-001 — Blocker:** an authentic cached exact-empty receipt is replayed for a newly activated lifecycle when a provider reference is reused; inspect/terminate skip the provider and falsely authorize release.
2. **SEC-PA-002 — Major:** `openRuntime` failure after successful activation leaves a live workload while the prepared cleanup capability is permanently rejected from `live`.
3. **SEC-PA-003 — Major:** every nonempty provider can bypass the closed manifest through the public raw `providers` constructor path.
4. **SEC-PA-004 — Major:** the exported “log-safe” view contains the full control reference, and provider-native bytes are reversibly recoverable from its base64url envelope.

Exact file:line failure paths, exploit sequences, impact, recommendations, confidence, false-positive filtering, and the required disclaimer are in `evidence/cso-report-round-1.md`.

## Evidence

- Focused target suite: exit 0; **9 files, 96 tests passed**.
- Fresh read-only probes independently reproduced all four uncovered failure paths.
- Probe/temp root: `E:\rasen-ecp-pa-cso-r1-20260805` (not deleted or adopted).

## Next owner

LEAD must triage to a non-author fixer, resolve every Blocker/Major, then dispatch a fresh non-author security re-review. Do not mark task 9.9 clean from the passing existing suite or this handoff. No actual-OS provider/native-capsule/Mac/release claim follows from this review.

## Paths

- `rasen/changes/ecp-platform-process-authority-foundation/evidence/cso-report-round-1.md`
- `rasen/changes/ecp-platform-process-authority-foundation/handoff/cso-reviewer-1.md`
