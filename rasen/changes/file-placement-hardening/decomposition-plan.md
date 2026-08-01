# Decomposition plan — file-placement-hardening

## Child DAG

```text
file-placement-hardening-migration-safety
    ├── file-placement-hardening-archive-engine ───────────────┐
    └── file-placement-hardening-root-routing ─────────────────┤
file-placement-hardening-windows-lock-contention ──────────────┤
                                                               │
                              file-placement-hardening-closure ◄┘
```

The Windows-lock child is implementation-independent of the three placement
children. Closure's P4 gate discovered it, and closure acceptance depends on
its reviewed correction and reconciled contract.

## Children

### 1. file-placement-hardening-migration-safety

Pipeline: `small-feature`

Owns:

- malformed/future/source-tree-safe ephemera classification;
- pure migration plan versus apply;
- preview/apply equivalence;
- scoped `--change` behavior;
- no-clobber file/directory moves and narrow cross-device fallback;
- archived run-state deletion and idempotency;
- fail-closed filesystem error reporting.

Primary implementation surface:

- `src/core/ephemera-cleaner.ts`
- `src/core/work-migration.ts`
- migration/cleaner tests

Dependencies: none.

### 2. file-placement-hardening-archive-engine

Pipeline: `small-feature`

Owns:

- one authoritative archive engine for CLI, single skill, bulk skill, and
  in-ship bookkeeping;
- complete archive dry-run;
- validated sidecar and fail-closed archive accounting;
- recoverable ordering/staging and finalized evidence hashes;
- quality capture from `evidence/`.

Primary implementation surface:

- `src/core/archive.ts`
- `src/core/archive-accounting.ts`
- archive workflow templates
- archive/accounting/template tests

Dependencies:

- `file-placement-hardening-migration-safety`

### 3. file-placement-hardening-root-routing

Pipeline: `small-feature`

Owns:

- explicit planning/execution root context through `work migrate`;
- Store-selected migration routing;
- Sessions API lookup from the recorded execution root;
- Store plus member-worktree integration coverage.

Primary implementation surface:

- `src/commands/work.ts`
- root-context portions of `src/core/work-migration.ts`
- `src/core/management-api/sessions.ts`
- Store/session integration tests

Dependencies:

- `file-placement-hardening-migration-safety`

### 4. file-placement-hardening-windows-lock-contention

Pipeline: `small-feature`

Owns:

- bounded Windows-only retry for legacy registry-lock open results `EPERM`,
  `EACCES`, and `EBUSY`;
- preservation of the existing semantic winner/`pipeline_already_exists`,
  busy/timeout, genuine create-failed, and non-Windows contracts;
- deterministic lock-seam coverage and focused P4 remediation evidence.

Primary implementation surface:

- `src/core/file-state.ts`
- `test/core/file-state.test.ts`
- focused pipeline-library and closure P4 evidence

Dependencies: none. This child was discovered by closure's stronger P4 gate.

### 5. file-placement-hardening-closure

Pipeline: `small-feature`

Owns:

- authoritative design/schema/example reconciliation;
- archived-child history note without falsifying old task completion;
- generated-template/completion staleness sweep;
- build, lint, focused regressions, full suite, and Windows path verification;
- final cross-child acceptance evidence.

Primary surface:

- `docs/zh/file-placement-and-planning-roots.md`
- affected main specs and generated-template expectations
- verification evidence

Dependencies:

- `file-placement-hardening-archive-engine`
- `file-placement-hardening-root-routing`
- `file-placement-hardening-windows-lock-contention`

## Independence audit

- The two original middle children share no intended implementation files:
  Archive owns archive/accounting/templates; root routing owns work
  command/migration context/sessions.
- Both depend on migration-safety so neither races its foundational
  `work-migration.ts` and cleaner changes.
- The discovered Windows-lock child is disjoint from those placement surfaces
  and owns only the legacy lock seam and its focused regression/evidence.
- Closure is strictly last because it reconciles all four implementation-child
  contracts and runs the complete gate.
- If any implementation child discovers an unavoidable overlap, serialize the
  affected children and record the new dependency rather than editing
  overlapping files concurrently.
