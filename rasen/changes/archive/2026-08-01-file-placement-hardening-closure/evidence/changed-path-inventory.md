# Changed-path inventory

Date: 2026-08-01
Saved PR-head baseline:
`04cea87ae5bea9af2d90f526455b6ea513cd57e8`.
Current code/test delivery head:
`4a07e3f508fcd6e24f62a5acb83eb5ef387c4863`.
Working branch: `fix/pr121-file-placement-hardening`.

The inventory is relative to the saved baseline. It is refreshed at closure
handoff; closure-created evidence/spec/CI files are listed in the final section.

## Migration-safety implementation

```text
src/core/ephemera-cleaner.ts
src/core/path-identity.ts
src/core/work-migration.ts
test/core/archive-ephemera.test.ts
test/core/ephemera-cleaner.test.ts
test/core/work-migration.test.ts
rasen/changes/file-placement-hardening-migration-safety/.openspec.yaml
rasen/changes/file-placement-hardening-migration-safety/README.md
rasen/changes/file-placement-hardening-migration-safety/design.md
rasen/changes/file-placement-hardening-migration-safety/evidence/review-cycle-report.md
rasen/changes/file-placement-hardening-migration-safety/evidence/review-report.md
rasen/changes/file-placement-hardening-migration-safety/handoff/fixer-1.md
rasen/changes/file-placement-hardening-migration-safety/handoff/fixer-2.md
rasen/changes/file-placement-hardening-migration-safety/handoff/implementer-1.md
rasen/changes/file-placement-hardening-migration-safety/proposal.md
rasen/changes/file-placement-hardening-migration-safety/specs/file-placement/spec.md
rasen/changes/file-placement-hardening-migration-safety/specs/work-migration/spec.md
rasen/changes/file-placement-hardening-migration-safety/tasks.md
```

## Archive-engine implementation

```text
src/cli/index.ts
src/core/archive-accounting.ts
src/core/archive-consumer-invocation.ts
src/core/archive-engine.ts
src/core/archive.ts
src/core/templates/workflows/archive-change.ts
src/core/templates/workflows/bulk-archive-change.ts
src/core/templates/workflows/ship.ts
test/commands/store-root-selection.test.ts
test/core/archive-consumer-integration.test.ts
test/core/archive-engine.test.ts
test/core/archive-fault-matrix.test.ts
test/core/archive-path-semantics.test.ts
test/core/archive.test.ts
test/core/templates/archive-engine-consumers.test.ts
test/core/templates/skill-templates-parity.test.ts
rasen/changes/file-placement-hardening-archive-engine/.openspec.yaml
rasen/changes/file-placement-hardening-archive-engine/README.md
rasen/changes/file-placement-hardening-archive-engine/design.md
rasen/changes/file-placement-hardening-archive-engine/evidence/implementation-verification.md
rasen/changes/file-placement-hardening-archive-engine/evidence/review-report.md
rasen/changes/file-placement-hardening-archive-engine/handoff/fixer-1.md
rasen/changes/file-placement-hardening-archive-engine/handoff/fixer-2.md
rasen/changes/file-placement-hardening-archive-engine/handoff/implementer-1.md
rasen/changes/file-placement-hardening-archive-engine/handoff/review-remediation-1.md
rasen/changes/file-placement-hardening-archive-engine/handoff/strategy-fixer-1.md
rasen/changes/file-placement-hardening-archive-engine/handoff/strategy-fixer-2.md
rasen/changes/file-placement-hardening-archive-engine/proposal.md
rasen/changes/file-placement-hardening-archive-engine/specs/archive-quality-capture/spec.md
rasen/changes/file-placement-hardening-archive-engine/specs/cli-archive/spec.md
rasen/changes/file-placement-hardening-archive-engine/specs/file-placement/spec.md
rasen/changes/file-placement-hardening-archive-engine/specs/opsx-archive-skill/spec.md
rasen/changes/file-placement-hardening-archive-engine/specs/opsx-ship-command/spec.md
rasen/changes/file-placement-hardening-archive-engine/specs/sha-cross-stamping/spec.md
rasen/changes/file-placement-hardening-archive-engine/tasks.md
```

`test/core/templates/skill-templates-parity.test.ts` has shared, explicitly
bounded ownership. The archive-engine child owns the archive/bulk consumer
goldens already recorded in that file. Closure owns only the later derived
parity refresh for `getShipCommandSkillTemplate` and `rasen-ship`: the reviewed
engine-owned ship wording changed the generated payload, so closure replaced
those two stale expected SHA-256 values after independently recomputing both
64-hex digests. No other parity expectation changed in that refresh.

## Root-routing implementation and shared presentation integration

```text
src/commands/work.ts
src/core/completions/command-registry.ts
src/core/management-api/sessions.ts
src/locales/en.json
src/locales/ja.json
src/locales/zh-cn.json
test/commands/work.test.ts
test/core/completions/cli-presentation.test.ts
test/core/completions/command-registry.test.ts
test/core/management-api/sessions-api.test.ts
test/core/management-api/sessions-space.test.ts
rasen/changes/file-placement-hardening-root-routing/.openspec.yaml
rasen/changes/file-placement-hardening-root-routing/README.md
rasen/changes/file-placement-hardening-root-routing/design.md
rasen/changes/file-placement-hardening-root-routing/evidence/implementation-gates.md
rasen/changes/file-placement-hardening-root-routing/evidence/review-report.md
rasen/changes/file-placement-hardening-root-routing/handoff/fixer-1.md
rasen/changes/file-placement-hardening-root-routing/handoff/implementer-1.md
rasen/changes/file-placement-hardening-root-routing/proposal.md
rasen/changes/file-placement-hardening-root-routing/specs/file-placement/spec.md
rasen/changes/file-placement-hardening-root-routing/specs/session-supervision/spec.md
rasen/changes/file-placement-hardening-root-routing/specs/work-migration/spec.md
rasen/changes/file-placement-hardening-root-routing/tasks.md
```

## Windows legacy-lock contention correction

```text
src/core/file-state.ts
test/core/file-state.test.ts
rasen/changes/file-placement-hardening-windows-lock-contention/.openspec.yaml
rasen/changes/file-placement-hardening-windows-lock-contention/proposal.md
rasen/changes/file-placement-hardening-windows-lock-contention/design.md
rasen/changes/file-placement-hardening-windows-lock-contention/tasks.md
rasen/changes/file-placement-hardening-windows-lock-contention/specs/opsx-pipeline-registry/spec.md
rasen/changes/file-placement-hardening-windows-lock-contention/evidence/implementation-and-verification.md
rasen/changes/file-placement-hardening-windows-lock-contention/evidence/review-report.md
rasen/changes/file-placement-hardening-windows-lock-contention/evidence/partition-4-after-fix-vitest.json
```

## Parent planning and immutable audit input

```text
docs/audits/pr-121-file-placement-0.1.6-review-2026-07-31.md
rasen/changes/file-placement-hardening/.openspec.yaml
rasen/changes/file-placement-hardening/README.md
rasen/changes/file-placement-hardening/decomposition-plan.md
rasen/changes/file-placement-hardening/planning-context.md
```

## Closure-owned paths

```text
.github/workflows/ci.yml
docs/zh/file-placement-and-planning-roots.md
rasen/specs/archive-quality-capture/spec.md
rasen/specs/ci-test-harness/spec.md
rasen/specs/cli-archive/spec.md
rasen/specs/file-placement/spec.md
rasen/specs/opsx-archive-skill/spec.md
rasen/specs/opsx-pipeline-registry/spec.md
rasen/specs/opsx-ship-command/spec.md
rasen/specs/session-supervision/spec.md
rasen/specs/sha-cross-stamping/spec.md
rasen/specs/work-migration/spec.md
test/ci-workflow-contract.test.ts
test/core/token-audit/zed/audit.test.ts
rasen/changes/file-placement-hardening-closure/.openspec.yaml
rasen/changes/file-placement-hardening-closure/README.md
rasen/changes/file-placement-hardening-closure/design.md
rasen/changes/file-placement-hardening-closure/proposal.md
rasen/changes/file-placement-hardening-closure/specs/ci-test-harness/spec.md
rasen/changes/file-placement-hardening-closure/tasks.md
rasen/changes/file-placement-hardening-closure/evidence/audit-traceability.md
rasen/changes/file-placement-hardening-closure/evidence/changed-path-inventory.md
rasen/changes/file-placement-hardening-closure/evidence/contract-reconciliation.md
rasen/changes/file-placement-hardening-closure/evidence/direct-partition-2-vitest.json
rasen/changes/file-placement-hardening-closure/evidence/direct-partition-3-vitest.json
rasen/changes/file-placement-hardening-closure/evidence/direct-partition-4-vitest.json
rasen/changes/file-placement-hardening-closure/evidence/direct-partition-5-vitest.json
rasen/changes/file-placement-hardening-closure/evidence/direct-partition-6-after-fix-vitest.json
rasen/changes/file-placement-hardening-closure/evidence/direct-partition-6-vitest.json
rasen/changes/file-placement-hardening-closure/evidence/direct-partition-7-vitest.json
rasen/changes/file-placement-hardening-closure/evidence/direct-partition-8-after-fix-vitest.json
rasen/changes/file-placement-hardening-closure/evidence/direct-partition-8-vitest.json
rasen/changes/file-placement-hardening-closure/evidence/direct-partition-results.md
rasen/changes/file-placement-hardening-closure/evidence/fresh-final-partition-1-vitest.json
rasen/changes/file-placement-hardening-closure/evidence/fresh-final-partition-2-vitest.json
rasen/changes/file-placement-hardening-closure/evidence/fresh-final-partition-3-vitest.json
rasen/changes/file-placement-hardening-closure/evidence/fresh-final-partition-4-vitest.json
rasen/changes/file-placement-hardening-closure/evidence/fresh-final-partition-5-vitest.json
rasen/changes/file-placement-hardening-closure/evidence/fresh-final-partition-6-vitest.json
rasen/changes/file-placement-hardening-closure/evidence/fresh-final-partition-7-vitest.json
rasen/changes/file-placement-hardening-closure/evidence/fresh-final-partition-8-vitest.json
rasen/changes/file-placement-hardening-closure/evidence/fresh-final-test-snapshot.json
rasen/changes/file-placement-hardening-closure/evidence/full-suite-report.md
rasen/changes/file-placement-hardening-closure/evidence/partition-1-of-8-final.json
rasen/changes/file-placement-hardening-closure/evidence/partition-2-of-8.json
rasen/changes/file-placement-hardening-closure/evidence/partition-3-of-8.json
rasen/changes/file-placement-hardening-closure/evidence/partition-4-of-8.json
rasen/changes/file-placement-hardening-closure/evidence/partition-5-of-8.json
rasen/changes/file-placement-hardening-closure/evidence/release-evidence.md
rasen/changes/file-placement-hardening-closure/evidence/review-report.md
rasen/changes/file-placement-hardening-closure/evidence/runner-safety-review.md
rasen/changes/file-placement-hardening-closure/evidence/test-manifest.txt
rasen/changes/file-placement-hardening-closure/evidence/test-partitions.md
rasen/changes/file-placement-hardening-closure/handoff/delivery.md
```

The direct-partition reports retain the P4/P6/P8 initial failures and reviewed
fix results. They are historical only. The final accepted gate uses the frozen
snapshot plus exactly the eight `fresh-final-partition-*-vitest.json` reports;
their exact union is all 341 snapshot paths, pairwise intersections are empty,
and no frozen file length or SHA changed during the sequence. The pre-freeze
`6,050` aggregate is explicitly invalid/superseded because that older sequence
had 62 duplicated and 62 missing paths.

The independently reviewed Windows legacy-lock child is the fourth
implementation child in the closure union. Its delta requirement and three
scenarios are reconciled into the closure-owned main
`rasen/specs/opsx-pipeline-registry/spec.md`; the child implementation and
evidence paths remain classified in their dedicated section above.

## Delivery-time CI corrections

The first delivery run exposed PR-wide `git diff --check` failures in eleven
pre-existing main specs. Commit `827e4101c32295817d27808e034bd1408ca1db8b`
removed only their trailing blank lines:

```text
rasen/specs/archive-destination/spec.md
rasen/specs/archive-relocate/spec.md
rasen/specs/change-work-dir/spec.md
rasen/specs/cli-artifact-workflow/spec.md
rasen/specs/config-key-registry/spec.md
rasen/specs/expert-dispatch-contract/spec.md
rasen/specs/goal-loop-workflow/spec.md
rasen/specs/management-http-api/spec.md
rasen/specs/session-relay/spec.md
rasen/specs/store-adopt/spec.md
rasen/specs/verify-ship-evidence/spec.md
```

The second delivery run exposed three test-fixture portability assumptions.
Commit `4a07e3f508fcd6e24f62a5acb83eb5ef387c4863` keeps the already-classified
archive tests under archive-engine ownership and adds this root-routing test
path to the inventory:

```text
test/core/file-placement.test.ts
```

The delivery-time test corrections canonicalize an existing temporary
directory before comparing it with product-canonicalized paths, use a
platform-native absolute bare root, and inject the same-byte replacement only
after the fingerprint file handle closes. They do not change product code or
weaken the `source-remove` / `ESTALE` assertion.

The closure evidence glob includes `evidence/runner-safety-review.md` and the
superseded runner JSON incident artifacts. The unsafe transient runner and its
ownership helper were reviewed and then deleted; they are intentionally absent
from the final-tree inventory:

```text
rasen/changes/file-placement-hardening-closure/evidence/bounded-vitest-runner.mjs
test/support/process-ownership.mjs
```

## Explicitly excluded untracked execution state

These invocation/run-state files are not product or closure deliverables and
are not modified, staged, or claimed by closure:

```text
.rasen/changes/file-placement-hardening/ephemera/auto-run.json
.rasen/changes/file-placement-hardening/ephemera/portfolio-run.json
.rasen/changes/file-placement-hardening-archive-engine/ephemera/auto-run.json
.rasen/changes/file-placement-hardening-closure/ephemera/auto-run.json
.rasen/changes/file-placement-hardening-migration-safety/ephemera/auto-run.json
.rasen/changes/file-placement-hardening-root-routing/ephemera/auto-run.json
.rasen/changes/file-placement-hardening-windows-lock-contention/ephemera/auto-run.json
```

Final reconciliation against the saved PR-head baseline contains 157 changed
tracked deliverable paths. All 157 are classified above. The seven untracked
`.rasen/.../ephemera/*.json` invocation-state paths remain excluded, and no
`.rasen` path is tracked.
