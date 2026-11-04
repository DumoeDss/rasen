# Linux Process-Authority TypeScript Review - Round 3

STATUS: DONE

Verdict: **CLEAN - no Blocker, Major, Minor, or Trivial findings.** Round-2 M-003 through M-006 are closed in the current TypeScript boundary, and B-001, B-002, M-001, and M-002 remain closed.

## Scope and review basis

- Fresh report-only review of `src/core/session-host/process-authority/linux/**`, the six Linux TypeScript suites, and `test/helpers/linux-process-authority-provider-fixture.ts`.
- Contract basis: this Change's proposal, design, Linux provider delta spec, tasks, round-2 report/fix evidence, and TypeScript reviewer/implementer handoffs.
- `test/AGENTS.md` was applied. The concurrent dirty worktree was preserved; no product code, tests, tasks, run-state, or commit was changed.
- The only files authored by this review are this report and `handoff/reviewer-ts-3.md`.

## Round-2 finding disposition

| Finding | Disposition | Fresh evidence |
|---|---|---|
| M-003 build trust can be self-signed by helper + manifest + trust | **CLOSED** | Production resolution consumes only `LINUX_PROCESS_AUTHORITY_BUILD_IDENTITIES`, which is a frozen compile-time table and is intentionally empty until authenticated packaging generates it (`build-authority.ts:16-23`, `artifact-resolver.ts:211-295`). The direct-module test seam snapshots a separately supplied identity and is absent from `linux/index.ts`. Rewriting helper, companion manifest, and the former package trust as one mutually consistent alternate set is rejected by the unchanged build identity (`linux-process-authority-artifact-resolver.test.ts:224-250`). Production inspection and provider preparation fail closed as build-pinned/typed unavailable while the table is empty (`artifact-resolver.test.ts:137-150`, `provider.ts:617-623`). |
| M-004 ledger ancestry/workload isolation and total publication-evidence loss | **CLOSED** | The production state leaf requires exact full `0700`; every real ancestor rejects special bits and group/world write (`provider.ts:503-539`). The ledger is nested below `runtimeRoot` (`provider.ts:610-616`), and the native guardian overmounts that exact root with mode-000 tmpfs before readiness/workload activation (`native/linux-process-authority/src/primary.rs:456-485`, `:1295-1318`). Durable prepared/published phase records are identity-bound and fsynced (`publication-ledger.ts:663-737`). Missing phase, entry, or head remains retained; it cannot reconstruct `prepared-inert` after evidence loss (`publication-ledger.ts:874-943`). The regression deletes entry + head and then the phase journal, reopening after each mutation and receiving `authority-uncertain/ledger-missing` (`linux-process-authority-publication-ledger.test.ts:192-224`). |
| M-005 production provider cannot reopen one state root | **CLOSED** | Exact child directories use create-or-open semantics, accept only `EEXIST`, then revalidate directory type, symlink status, full mode, owner, real parent, and real path (`provider.ts:542-564`). The production test constructs twice in one process and once in a fresh Node process against the identical `stateRoot`; all reopen successfully, while structural dependency injection remains rejected (`linux-process-authority-provider.test.ts:195-234`). |
| M-006 Ready then clean/truncated early exit hangs runtime facts | **CLOSED** | Runtime settlement tracks ready/root/empty/failure plus pending bytes (`native-assembly.ts:360-415`). Any close lacking exact terminal proof, including code 0 or buffered truncation, calls `fail`, rejects every unsettled promise, destroys the exposed input/output/error streams, and destroys child stdin (`native-assembly.ts:469-480`, `:393-415`). Deterministic regressions cover Ready -> clean close and Ready -> truncated trailing frame -> clean close (`linux-process-authority-provider.test.ts:257-335`). |

## Prior finding regression check

| Finding | Disposition | Fresh evidence |
|---|---|---|
| B-001 ledger subclass/prototype forgery | **REMAINS CLOSED** | Exact constructor, module WeakSet provenance, exact prototype/frozen checks, frozen prototype, and non-virtual `Reflect.apply` dispatch remain present (`publication-ledger.ts:587-612`, `:1016-1069`). The hostile subclass construction remains rejected (`linux-process-authority-publication-ledger.test.ts:87-100`). |
| B-002 caller-injected structural production truth | **REMAINS CLOSED** | The public Linux index exposes production factories whose options are exact `{ stateRoot }`; extra transport/runtime keys are rejected before assembly (`index.ts:35-41`, `provider.ts:598-635`). `ForTesting` provider, resolver, and runtime seams are not re-exported from the public Linux index. |
| M-001 reordered private-reference alias | **REMAINS CLOSED** | Decode validates the fixed-order canonical body, recomputes the fixed-order digest, and compares the exact serialized bytes (`private-reference.ts:237-285`). A reversed-key alias with a recomputed digest remains rejected (`linux-process-authority-contract.test.ts:193-210`). |
| M-002 published entry deletion rolls back to prepared | **REMAINS CLOSED** | Published phase plus independent head prevents one-record loss from becoming prepared; deleting the entry returns retained `ledger-missing` (`publication-ledger.ts:913-937`, `linux-process-authority-publication-ledger.test.ts:171-190`). Total entry/head/phase loss is also retained as covered under M-004. |

## Fresh delta sanity and coverage

```text
CODE PATH COVERAGE
==================
[M-003] build identity -> manifest/helper comparison -> production fail-closed
         [TESTED] valid self-signed alternate helper + manifest + trust is rejected
[M-004] record prepared -> commit head/entry/published phase -> replacement lookup
         [TESTED] entry-only loss and entry+head+phase loss remain retained
[M-005] validate state root -> create-or-open children -> reopen ledger/provider
         [TESTED] same process and fresh Node process reopen one stateRoot
[M-006] Ready -> frame parsing -> early close settlement
         [TESTED] clean premature close and truncated clean close reject and destroy streams

REGRESSION COVERAGE
===================
[B-001/B-002/M-001/M-002] 4/4 named chains re-read and exercised by focused suites
```

- No new enum/value, conditional-side-effect, trust-boundary, concurrency, type-boundary, resource-liveness, or completeness defect was found in the reviewed delta.
- Production artifact authority remains intentionally empty/fail-closed until authenticated package generation supplies the compiled identity table. That is an explicit packaging gate, not a TypeScript trust bypass or a claim of production availability.
- The runtime-root mount exclusion was source-verified but not executed on this Windows host. Actual Linux kernel acceptance remains a separate named gate and is not relabelled by this review.

## Verification gates

- Linux TypeScript aggregate: **6 files, 87/87 passed**.
- Common conformance plus typed prepare-unavailability: **2 files, 51/51 passed**.
- `pnpm exec tsc --noEmit --pretty false`: passed with no diagnostics.
- Explicit scoped ESLint over nine Linux product files, six Linux suites, and the fixture: passed with no diagnostics.
- `pnpm exec rasen validate ecp-linux-process-authority-provider --strict --no-interactive`: `Change 'ecp-linux-process-authority-provider' is valid`.

## Disposition

The TypeScript round-3 re-review is clean. This closes the requested TypeScript review loop only; it does not mark the overall Change terminal and does not replace authenticated build-identity generation, actual-Linux kernel, installed broker/cgroup-v2, package, closure, or release gates.
