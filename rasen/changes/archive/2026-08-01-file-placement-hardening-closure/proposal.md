## Why

The four implementation children now have clean independent reviews, but the branch is not ready for portfolio delivery: the authoritative Chinese placement design and main specs still describe superseded archive, migration, and root-routing behavior and omit the bounded Windows legacy-lock contention contract discovered by closure; the original PR audit is not yet closed by one traceable acceptance record; the repository-wide test command previously hung without a summary; and native macOS/Linux filesystem evidence has never been run. Closure must reconcile the final contracts and turn those remaining unknowns into explicit, honest release gates.

## What Changes

- Reconcile `docs/zh/file-placement-and-planning-roots.md` with the implemented planning-root, execution-root, migration, session, and source-last archive contracts, removing stale implementation-status and schema examples while preserving the approved seven-class model.
- Reconcile affected main specs by applying the four completed implementation-child deltas in dependency order and resolving overlap once, so main requirements match the final implementation without copying or contradicting child requirements.
- Sweep generated workflow sources, executable consumer examples, CLI/completion/localization metadata, schemas, and parity expectations for stale direct-move, external-sync, post-hash mutation, selector, transaction-flag, and recovery guidance.
- Produce an audit traceability record mapping every original PR finding and coverage gap to its owning child resolution, independent clean review, focused regression, and closure gate.
- Integrate the focused archive, migration, root-routing, session, completion, and generated-consumer suites into one bounded acceptance sequence.
- Diagnose the known repository-wide no-summary hang with deterministic file partitions and direct bounded reruns; accept the local test-result gate only when every discovered test file has a Vitest summary and successful exit within the external bound. Local process-cleanliness remains `NOT EVALUATED` without spawn-time OS lineage capability, and any observed or suspected survivor keeps release blocked without bespoke/manual termination.
- Add a dedicated native Windows/macOS/Linux CI matrix step for the archive fault/recovery suite at the Node 20.19.0 floor. Local path-helper tests remain supporting evidence only; actual remote results are recorded during delivery and cannot be claimed by this change before push.
- Perform a final diff/scope and 0.1.6 compatibility audit, then write release evidence covering build, lint, typecheck, CLI presentation, validation, package/runtime compatibility, focused tests, full-suite completion, and deferred remote CI status.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ci-test-harness`: Require a bounded, summary-producing complete-suite gate and a dedicated native three-OS archive fault/recovery matrix whose remote results are evidenced only after CI actually runs.

## Impact

- Authoritative documentation and main specifications for file placement, migration, session routing, archive CLI/skills/ship, quality capture, delivery-chain stamping, and bounded Windows pipeline-registry lock contention.
- Generated/template/completion/schema parity surfaces and their focused tests when the sweep finds stale derived guidance.
- `.github/workflows/ci.yml`, `vitest.config.ts`, and narrowly related test-harness diagnostics only as required to make the complete gate bounded and truthful; process isolation and cleanup remain CI/orchestration infrastructure rather than locally invented acceptance evidence.
- Closure evidence under this change, plus a durable gate summary in the parent `file-placement-hardening/planning-context.md`.
- No delivery, commit, push, archive operation, historical task rewrite, or new product-placement behavior is part of closure apply.
