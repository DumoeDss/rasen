# Handoff: ecp-linux-process-authority-provider — implementer-native-broker #4

## Original intent

Continue the bounded native Linux broker remediation, resolve every round-1 Blocker and Major finding with source and regression evidence, and do not claim terminal Linux broker support until the dedicated privileged cgroup-v2 acceptance environment is available and passes.

## Position

Pipeline: `small-feature`. Completed stages: `propose`; the broker round-1 implementation/fix pass is complete and has current evidence. Current stage: `review-loop` (fresh non-author broker round-2 review required before LEAD integration). Section 9 and terminal Linux broker support remain open.

## Done / Remaining

Done: implemented production broker client/guardian/daemon lifecycle routing and TypeScript native assembly (`BRK-B01`); durable provisional prepare recovery, cleanup-phase replay, and bounded authenticated cleanup tombstones (`BRK-B02`, `BRK-B03`); fd-pinned and per-lease serialized cgroup control with monotonic deadlines (`BRK-B04`, `BRK-M01`); trusted fail-closed installer and uninstaller behavior plus singleton/stale-socket recovery (`BRK-B05` through `BRK-B07`). The final source digest is `c98040d5b05e9643654bf8109082b0a2e5781699735c5ab59961e7acd85780dd`. The short-path `.rbm` build directory was removed after evidence capture; the older ephemera broker target directory was already absent.

Remaining: LEAD must append the absolute pointer to this handoff to `auto-run.json`; dispatch a fresh non-author broker round-2 reviewer against `BRK-B01` through `BRK-B07` and `BRK-M01`; integrate task checkboxes, findings, evidence, and run-state only after that independent confirmation. Keep Section 9, production-default selection, package release support, and terminal Linux broker support open until the privileged installed-broker matrix is available and passes.

## Key decisions (and why)

- Keep the stabilized primary public boundary unchanged while adding the production broker path behind the Linux provider assembly.
- Bind client requests to an independent, domain-separated SHA-256 capability derived from the exact guardian reference; do not expand the frozen TypeScript private-reference schema.
- Keep the durable lease `install_id` bound to the daemon digest while returning client-pinned attestation artifact/source fields to the provider.
- Route installed lifecycle requests through one production `BrokerServiceCore`; fixture-only or probe-only behavior is not accepted as production closure.
- Preserve `CleanupComplete + ExactEmpty` records as authenticated idempotent tombstones, but bound retention to 1,024 unchanged records.
- Keep Linux control operations pinned to opened cgroup fds and use monotonic absolute deadlines; pathname reacquisition and read-count timeouts are not acceptable authority proofs.
- Treat the current WSL broker results as actual Linux non-privileged runtime evidence, not as a substitute for a root-installed writable unified cgroup-v2 gate.

## Verification receipts

- `cargo test --locked`: PASS, 52 host tests, 0 failed; broker-focused host subset 38/38.
- `cargo check --locked --all-targets --target x86_64-unknown-linux-gnu`: PASS.
- Broker-client locked Linux cross-target check: PASS.
- `node scripts/build-linux-process-authority.mjs --check-only --target x86_64-unknown-linux-gnu`: PASS for the primary helper and broker client. An independent package reviewer reran the final dual-binary check and confirmed the same `c98040...80dd` source digest with no broker-client compilation regression.
- Static musl no-run build with Rust 1.88 and `rust-lld`: PASS after moving the target directory to the short `.rbm` path; the earlier long-path failure was Windows output-path length only.
- Actual WSL execution: PASS, 41 broker tests, 0 failed, including SO_PEERCRED, fd-pinned replacement, codecs, recovery/replay, pruning, root-exit/natural-empty, and deadline oracles.
- Focused TypeScript suites: PASS, 44/44; `tsc --noEmit`: PASS; focused ESLint: PASS.
- Pinned Rust formatting, both installer shell syntax checks, strict Change validation, and strict UTF-8/no-BOM/mojibake/trailing-whitespace audit: PASS.

Primary implementation evidence: `rasen/changes/ecp-linux-process-authority-provider/evidence/review-fix-native-broker-round-1.md`.

## Explicitly unavailable terminal gate

The available WSL environment does not expose an authorized writable unified cgroup-v2 service subtree with the required controllers, `cgroup.events`, and `cgroup.kill`; Docker is unavailable and Hyper-V has no Linux VM. Therefore this pass does not claim root install/uninstall execution, a real populated cgroup leaf, daemon SIGKILL/restart with live authority, real `cgroup.kill` convergence, unrelated-cgroup survival, Section 9 completion, production default selection, package release support, or terminal Linux support.

## Dead ends & gotchas

- Do not use the package reviewer's earlier `b53a...` or the older `4875...` source digest. Only `c98040d5b05e9643654bf8109082b0a2e5781699735c5ab59961e7acd85780dd` matches the final tree.
- The first musl build failure was caused only by an overlong Windows target path; the same locked build passed in `.rbm` and its WSL ELFs produced the 41/41 receipt.
- The worktree contains many unrelated and sibling-change edits. Do not revert, normalize, or include them in this change's integration.
- Host, cross-target, actual WSL, and privileged installed-broker evidence are separate gates; none may be relabeled as another.
- This fixer report and handoff are not independent finding closure. Only the fresh non-author broker round-2 reviewer may resolve the round-1 findings.

## Working set

Primary Rust implementation: `native/linux-process-authority/src/bin/rasen-linux-process-authority-broker-client.rs`, `src/bin/rasen-linux-process-authority-broker.rs`, `src/broker_guardian.rs`, `src/broker_service.rs`, `src/broker_lease.rs`, `src/broker_cgroup.rs`, `src/broker_transport.rs`, `src/broker_protocol.rs`, `src/broker_install.rs`, `src/broker_admin.rs`, and `Cargo.toml`. TypeScript assembly: `src/core/session-host/process-authority/linux/`. Administrative assets: `native/linux-process-authority/install/`. Tests: `native/linux-process-authority/tests/linux_broker_*` plus focused TypeScript Linux authority tests.

## Next action

LEAD should append the absolute pointer to this handoff in `auto-run.json`, then send the live final delta and round-1 evidence to a fresh non-author broker round-2 reviewer. Do not mark Section 8 tasks or terminal Linux support complete solely from the current unprivileged evidence.
