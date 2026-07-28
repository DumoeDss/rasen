## 1. Compose Selective Playbook Bundles

- [x] 1.1 Refactor `_orchestration.ts` into canonical semantic modules plus a typed feature-set composer while preserving every included module's relative order.
- [x] 1.2 Split mixed shared/optional clauses in the header, keepalive, run-state, and handoff sections into feature-aware fragments so narrow bundles retain core rules without referencing excluded steps.
- [x] 1.3 Export explicit auto, goal, and review-cycle playbook constants with the capability matrix defined in the design, and keep the complete auto rendering semantically unchanged.

## 2. Connect Workflow Consumers

- [x] 2.1 Update the auto, goal-command, and review-cycle templates to import and inline their corresponding named playbook bundles.
- [x] 2.2 Update direct playbook test imports, including handoff assertions, to exercise the applicable named bundles or shared bundle invariants.

## 3. Lock Composition and Regression Budgets

- [x] 3.1 Add tests for each bundle's required and excluded step markers, canonical module order, shared core rules, and absence of references to omitted optional step identifiers.
- [x] 3.2 Add full generated `SKILL.md` UTF-8 byte-size assertions for auto (106 KB), goal (70 KB), and review-cycle (60 KB).

  Measured after feature-aware clause filtering (2026-07-24): auto
  106,152 bytes (103.66 KiB), goal 66,429 bytes (64.87 KiB), and
  review-cycle 55,395 bytes (54.10 KiB).

- [x] 3.3 Run the existing auto, goal, review-cycle, and handoff template tests; update only the affected function-payload and generated-content parity hashes.

## 4. Verify the Change

- [x] 4.1 Run focused workflow-template tests, TypeScript type checking, and the broader relevant unit suite on the supported Node.js toolchain.
- [x] 4.2 Inspect the final diff and generated outputs to confirm no sidecar, digest, init/update, runtime rule, or unrelated template changes were introduced.
- [x] 4.3 Before integration with concurrent orchestration work, reconcile the latest Step B.4 source text and rerun composition, reference-closure, parity, and size tests.

> Reconciliation result (2026-07-24): the original worktree's
> `_orchestration.ts` matches the branch base, so there is no Step B.4 source
> delta to integrate. Composition, reference-closure, parity, size, build,
> lint, and focused workflow tests were rerun against that source state.
