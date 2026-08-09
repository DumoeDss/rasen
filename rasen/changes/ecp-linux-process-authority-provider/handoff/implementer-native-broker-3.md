# Handoff: ecp-linux-process-authority-provider — implementer-native-broker #3

## Original intent

Continue the bounded native Linux broker remediation, resolve every round-1 Blocker and Major finding with RED/GREEN evidence, and do not claim terminal Linux broker support until the dedicated privileged cgroup-v2 acceptance environment is available and passes.

## Position

Pipeline: `small-feature`. Completed stages: `propose`; TypeScript provider review is clean, native-primary remediation is independently tracked, and broker round 1 remains open. Current stage: `review-loop` (broker round-1 remediation inside the still-in-progress `apply` stage).

## Done / Remaining

Done: closed the implementation slice for `BRK-B04` and `BRK-M01` with per-lease serialization, monotonic deadlines, fd-pinned Linux `openat` control, poll waits, and a replacement-race oracle; implemented the `BRK-B02` provisional recovery transaction and fresh-process reconciliation with ambiguous-cleanup injection; implemented `BRK-B03` durable cleanup phases, `CleanupComplete` tombstones, crash-window recovery, and duplicate control replay; added production guardian codecs and caller uid/gid mapping, service inspection/runtime seams, daemon routing through one `BrokerServiceCore`, and a broker-client binary target.

Remaining: compile the newly added broker client first; fix compiler/test defects without changing stabilized primary public APIs; add and run `BRK-B01` codec, daemon-routing, caller-mapping, pinned-client, runtime, root-exit, and exact-empty RED/GREEN tests; implement the TypeScript `createLinuxBrokerNativeAssembly` and production bundle selection; implement `BRK-B05`, `BRK-B06`, and `BRK-B07` installer, uninstaller, singleton, and stale-socket hardening with mutations; add bounded tombstone pruning; run scoped and all-target Cargo checks, pinned formatting, shell syntax, strict UTF-8, and strict Change validation; then leave implementation evidence for independent broker round-2 review.

## Key decisions (and why)

- Derive the request capability as SHA-256 over a domain separator plus the exact `GuardianClientReference` — this gives the broker an independent request capability from the guardian's random secret reference without changing the frozen TypeScript private-reference schema.
- `prepare_primary` verifies the installed daemon executable, then the broker guardian rewrites attestation artifact/source fields to the pinned client artifact/source expected by the TypeScript provider — the lease `install_id` remains the daemon digest, preserving the administrative identity boundary.
- Keep the stabilized primary public boundary unchanged — the only `primary.rs` edit is the mechanical `&authority` to `&mut authority` borrow required by an already-mutating receiver.
- Route every installed lifecycle operation through one production `BrokerServiceCore` — fixture-only behavior and a probe-only daemon do not close `BRK-B01`.
- Keep the privileged Section 9 matrix open — ordinary WSL lacks the writable unified cgroup-v2 controllers, `cgroup.events`, and `cgroup.kill` required for terminal evidence.

## Dead ends & gotchas

- The broker-client source and Cargo target were the final edits before compaction and have never been compiled; do not trust their signatures or codec use until `cargo check` runs.
- The worktree contains many unrelated and sibling-change edits. Do not revert or normalize them; confine changes to the Linux broker/provider slice, its focused tests/assets, and this change's evidence.
- Host checks do not substitute for Linux behavior. Keep Windows-host test results, Linux cross-target checks, WSL runtime results, and privileged cgroup-v2 evidence separately labeled.
- Do not mark Section 9 or terminal broker support complete merely because fixture, cross-target, or unprivileged WSL checks pass.

## Eliminated hypotheses (MANDATORY for fixer/debugger roles)

- "The probe-only installed daemon can be closed by adding more service-core fixture tests" — ruled out by `BRK-B01`; production daemon/client/runtime routing is required. Current best hypothesis: compile and exercise the pinned client plus daemon codecs, then connect the TypeScript broker assembly.
- "Changing the frozen TypeScript private-reference schema is necessary for a request capability" — ruled out by the guardian's existing random secret reference. Current best hypothesis: derive the independent request capability with a domain-separated SHA-256 digest.
- "The lease install identity should be rewritten to the client artifact digest" — ruled out by the broker administrative identity contract. Current best hypothesis: keep `install_id` bound to the daemon digest while rewriting only attestation artifact/source fields for the client-facing provider check.
- "Fixture and cross-target evidence can close the real broker gate" — ruled out by the absent writable unified cgroup-v2 environment. Current best hypothesis: close deterministic source/contracts now and retain the privileged matrix as an explicit unavailable gate.

## Working set

Primary implementation: `native/linux-process-authority/src/bin/rasen-linux-process-authority-broker-client.rs`, `src/bin/rasen-linux-process-authority-broker.rs`, `src/broker_guardian.rs`, `src/broker_service.rs`, `src/broker_lease.rs`, `src/broker_cgroup.rs`, `src/broker_transport.rs`, `src/broker_protocol.rs`, `src/broker_install.rs`, `src/broker_admin.rs`, and `Cargo.toml`. TypeScript assembly: `src/core/session-host/process-authority/linux/`. Tests: `native/linux-process-authority/tests/linux_broker_*` plus focused TypeScript Linux authority tests. Review source: `rasen/changes/ecp-linux-process-authority-provider/evidence/review-report-native-broker-round-1.md`.

## Next action

Run the smallest locked Cargo check that compiles the new `rasen-linux-process-authority-broker-client` target, fix the concrete compiler errors, and only then add the missing production-routing RED/GREEN coverage.
