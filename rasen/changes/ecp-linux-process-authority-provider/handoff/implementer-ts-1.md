# Implementer handoff: Linux process-authority TypeScript boundary

## Delivered

- Product code: `src/core/session-host/process-authority/linux/**`
- Tests: six `test/core/session-host/linux-process-authority-*.test.ts` files
- Shared-suite fixture: `test/helpers/linux-process-authority-provider-fixture.ts`
- Detailed evidence: `evidence/implementation-ts-1.md`

The provider is not registered as the ProcessScope production default. The public primary factory is now source-owned and accepts only a private host `stateRoot`; the structural transport/runtime/artifact constructor is internal test-only and is absent from the Linux index. Detailed first-review fix evidence is in `evidence/review-fix-ts-round-1.md`.

## Architecture decisions to preserve

1. Native owns and generates `generation`, `scopeCapability`, and `controlCapability`; the guardian holds/verifies them. TypeScript never generates or backfills them.
2. The private-reference SHA-256 is canonical corruption identity only, never signer/authority proof.
3. Exact helper artifact SHA-256 is carried independently from source SHA-256 and both are bound in the native attestation/reference.
4. Native reports only `inert`; TypeScript derives `prepared-inert` vs `published-inert` solely from the trusted ledger.
5. Publication is the existing common publisher callback. Activation only calls `requirePublished`; it never commits or acknowledges publication.
6. The ledger commits an independent durable publication head followed by a sibling temporary entry, fsyncs file/entry/root, then acknowledges. Once published, missing/corrupt phase data cannot roll back to prepared. The exact ledger instance/prototype and Linux directory fd are pinned; bounded UUID-shaped partials are reconciled.
7. Primary unavailability is typed and never probes or contacts the broker. Broker use requires exact prior tuple selection.
8. The provider-neutral Linux conformance fixture intentionally uses the internal injected adapter to exercise common semantics deterministically. It is not actual-Linux evidence. Production construction is separately covered by the closed public factory and requires package/native/Linux acceptance receipts.
9. Package trust lives outside the adjacent companion manifest. Actual Linux resolution hashes, re-stats, and executes the same pinned helper descriptor; a path-only inspected helper is not execution authority.

## Candidate task evidence for LEAD review

The files and receipts materially cover 1.2/1.4, 2.1-2.7, the TypeScript portion of 3.5/4.6, 6.1, the native-owned interpretation of 6.2, and 6.8-6.11. LEAD should mark only after cross-checking native, packaging, accepted common hashes, and architecture wording. Do not treat these receipts as closing 3.x native construction, 4.x kernel authority, 5.x guardian lifecycle, 6.3-6.7 native reopen/control, 7.x WSL, 8.x broker service, or 9.x privileged broker gates.

## Remaining finalization

1. LEAD supplied final accepted main-spec/shared-suite hashes after the supporting Change was review-clean and archived; the Linux boundary guard now freezes those exact inputs.
2. Post-round-2-review-fix aggregate verification: Linux 87/87; common conformance/prepare-unavailable 51/51; TypeScript noEmit passed; focused ESLint passed; strict Rasen validation passed.
3. When checking Task 6.2, read its capability wording as native creation plus TypeScript exact validation/preservation; TypeScript generation/backfill is prohibited by the architecture decision.

No commit was created by this implementer work unit.

## First review disposition

- `B-001`: closed by exact non-subclassable/frozen ledger capability and module-private non-virtual calls.
- `B-002`: closed for the primary path by the source-owned resolver, pinned helper, RPA1 transport/runtime bridge, and injection-free production factory.
- `M-001..M-004`: canonical reference order, monotonic publication head, external package trust plus fd-pinned execution, and fd-pinned ledger root are implemented with regressions.
- `m-001..m-002`: closed Linux exit vocabulary and Rust-matching launch bounds/canonical digest are implemented.
- Fresh independent re-review remains the next action. Broker installation/cgroup evidence, packaging, host closure, actual Linux, and release acceptance remain separate gates and are not claimed by this TypeScript unit.

## Second review disposition

- `M-003`: mutable package trust was removed from production authority. Production consumes only a compile-time build identity table, which is intentionally empty until authenticated packaging generates it; helper+manifest+package-trust self-signing is rejected.
- `M-004`: exact preparation/published phase journal added; recovery absence is retained, and the production ledger is nested below the native-overmounted runtime root after full state-root ancestor validation.
- `M-005`: exact production directories now reopen idempotently in the same process and a fresh Node process.
- `M-006`: Ready-then-clean-close and truncated-close reject all unsettled terminal promises and close streams.
- Detailed receipts and truth limits: `evidence/review-fix-ts-round-2.md`.
