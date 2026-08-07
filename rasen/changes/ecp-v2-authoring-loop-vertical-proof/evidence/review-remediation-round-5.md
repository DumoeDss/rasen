# Review remediation round 5 — full-root regression repair

Date: 2026-08-04  
Role: implementer / review-loop fixer  
Scope: repair and classify every failure in the independent Round 4 full-root
run. This round does not perform the independent re-review, ship, archive, or
mark tasks 9.8–9.10 complete.

## Input evidence and classification

The authoritative input was:

```text
E:\rasen-ecp6-r4-rereview-root-full-20260803\root-vitest.json
SHA-256 AC4A13AD45525B16C2EFA28640EA7F5885CC630988A71885CFC8D9504F92852E
```

It recorded 439 test files, 1,801 suites, and 6,903 tests:

- 35 failed suites;
- 29 failed tests;
- 6,840 passed tests;
- 34 pending tests.

The 29 failures split into two reproducible groups. Sixteen were deterministic
ECP fixture/contract regressions:

| File | Failed tests | Classification |
| --- | ---: | --- |
| `test/vocabulary-sweep.test.ts` | 1 | the intentional workspace identity error token was absent from the exception ledger |
| `test/core/change-run/ecp-composite-dogfood.test.ts` | 2 | stale hand-authored runtime profile and missing trusted completion authority |
| `test/core/change-run/ecp-composite-parity.test.ts` | 2 | stale hand-authored runtime profile and missing authority |
| `test/core/change-run/lowerer-composite.test.ts` | 2 | stale output-shaped profile fixture and missing authority |
| `test/core/pipeline-registry/session-contract-fidelity.test.ts` | 5 | public capability fixtures omitted the now-required authority |
| `test/commands/pipeline-bugfix-e2e.test.ts` | 1 | fresh CLI child submitted unsigned completion evidence |
| `test/commands/pipeline-complex-e2e.test.ts` | 3 | fresh CLI children submitted unsigned review completions |

The remaining thirteen were Windows cold-start/cleanup candidates:

| File | Failed tests | Full-root symptom / independent result |
| --- | ---: | --- |
| `test/commands/daemon-lifecycle.test.ts` | 2 | reproduced readiness timeout, then test-budget and cleanup-lock failures |
| `test/commands/pipeline.test.ts` | 1 | reproduced command-budget timeout followed by temp-root cleanup lock |
| `test/commands/store-membership-cli.test.ts` | 2 | cleanup-sensitive; both pass independently |
| `test/commands/store-remote.test.ts` | 4 | cleanup-sensitive; all four pass independently |
| `test/core/archive-engine.test.ts` | 2 | cleanup-sensitive; both pass independently |
| `test/scripts/local-version-runtime.test.ts` | 1 | cleanup-sensitive; passes independently |
| `test/core/token-audit/management.test.ts` | 1 | reproduced 30-second budget exhaustion; passes under bounded slow-host budget |

This classification accounts for all 29 failed tests. No full-root test was run
by this implementer; a fresh full-root run remains an independent reviewer gate.

## Deterministic fixes

### Canonical profiles and plan-bound public authority

`test/fixtures/trusted-completion.ts` now supplies two test-only seams:

- `withTestAttestationAuthority(...)` adds the public authority descriptor to a
  test binding;
- `provisionTestTrustedExecutionAdaptersForPipeline(...)` prepares the real
  pipeline, resolves its discovery profile, and provisions only the exact
  public descriptors required by that profile into isolated host state.

The module-local private test key remains inside the parent test process. It is
not written to the project, host catalog, Action, Record, EvidenceStore, argv,
environment, or child CLI process.

The lowerer/composite/parity/dogfood fixtures now use
`createRuntimeExecutionProfile(...)` rather than maintaining hand-authored
copies of a profile's output shape. Their capabilities carry the same public
test authority that is sealed into the execution plan. The dogfood Action is
built by the production `buildAgentAction(...)` path, so it contains the
plan-bound completion authority without adding unrecognized capability fields.

### Real signed fresh-process completions

The bug-fix and complex E2E drivers no longer submit the old unsigned
`EvidenceRefV1` placeholder or a `{"signed":true}` body. They now:

1. prepare the production pipeline and provision its exact public catalog;
2. resolve the profile against that catalog;
3. read the exact persisted Action;
4. create a canonical actor claim and Ed25519 attestation for that Action;
5. send the resulting completion envelope through a fresh CLI process.

Each E2E uses a unique `.rasen-e2e-*` git-backed root. This preserves the real
workspace-revision precondition without sharing or deleting a fixed repository
directory.

### Vocabulary exception

`workspace_identity_unavailable` is now an explicit vocabulary-ledger entry.
The entry records why this security error is deliberately retained: a launch
must fail closed when the workspace identity/revision cannot be proven.

## Windows reliability fixes

The independent reruns demonstrated that several failures were real bounded
budget or cleanup-race defects on this host, not semantic ECP regressions.
Repairs are deliberately bounded:

- daemon local-start readiness remains polled every 250 ms but permits 60
  attempts (15 seconds instead of 5 seconds), accommodating cold Windows
  loader/antivirus work without permitting an unbounded wait;
- the two slow real-daemon tests use a 60-second budget, and their cleanup uses
  bounded 60 × 250 ms retries;
- `pipeline.test.ts` allocates a unique `.rasen-pipeline-command-*` root for
  each test instead of sharing `test-pipeline-command-tmp`, uses the existing
  asynchronous retrying cleanup helper, and gives the reproduced ownership
  test a 120-second budget;
- store membership, store remote, archive, and local-version tests use the
  retrying asynchronous cleanup helper rather than single-attempt recursive
  removal;
- the reproduced token-audit upload test has a 120-second slow-host budget.

These changes do not retry assertions, suppress failures, relax cryptographic
validation, or alter execution semantics.

## RED / GREEN evidence

### Deterministic RED

Before the repairs:

```text
pnpm exec vitest run \
  test/vocabulary-sweep.test.ts \
  test/core/change-run/ecp-composite-dogfood.test.ts \
  test/core/change-run/ecp-composite-parity.test.ts \
  test/core/change-run/lowerer-composite.test.ts \
  test/core/pipeline-registry/session-contract-fidelity.test.ts \
  --reporter=dot --maxWorkers=1
```

Result: **5 files failed, 12 failed / 16 passed**. The four fresh-process E2E
failures were also present in the immutable full-root JSON above, completing
the 16-failure deterministic set.

### Deterministic GREEN

```text
$env:VITEST_MAX_WORKERS='1'
pnpm exec vitest run \
  test/vocabulary-sweep.test.ts \
  test/core/change-run/ecp-composite-dogfood.test.ts \
  test/core/change-run/ecp-composite-parity.test.ts \
  test/core/change-run/lowerer-composite.test.ts \
  test/core/pipeline-registry/session-contract-fidelity.test.ts \
  test/commands/pipeline-bugfix-e2e.test.ts \
  test/commands/pipeline-complex-e2e.test.ts \
  --reporter=dot --maxWorkers=1
```

Result: **7 files, 33/33 passed**, 877.79 seconds. This aggregate covers every
deterministic failure from the full-root report. The critical bug-fix drive
also passed independently (1/1, 30.331 seconds), as did the complex blocking
drive (1/1, 33.615 seconds).

### Environment-candidate GREEN

Each of the thirteen originally failing test cases was rerun independently:

- daemon lifecycle: **1 file, 4/4 passed**, 124.25 seconds total;
- pipeline content ownership target: **1 passed, 103 skipped**, 53.41 seconds;
- store membership targets: **2 passed, 9 skipped**, 31.56 seconds;
- store remote targets: **4 passed, 15 skipped**, 51.84 seconds;
- archive crash-reconciliation targets: **2 passed, 19 skipped**, 13.54 seconds;
- local-version runtime target: **1 passed, 6 skipped**, 14.28 seconds;
- token-audit upload target: **1 passed, 8 skipped**, 8.05 seconds.

The first daemon, pipeline, and token-audit reruns reproduced their original
timeout/lock behavior before the bounded reliability changes. Therefore the
final passing results are remediation evidence, not an assumption that every
failure in the full-root report was random noise.

## Security and static regression gates

The final focused security/runtime suite was:

```text
pnpm exec vitest run \
  test/core/change-run/attestation.test.ts \
  test/core/change-run/evidence-store-fs.test.ts \
  test/core/change-run/runtime-context.test.ts \
  test/core/change-run/execution-plan.test.ts \
  test/core/change-run/lowerer.test.ts \
  test/core/change-run/lowerer-native-v2.test.ts \
  test/core/change-run/facade-settle-completeness.test.ts \
  test/core/change-run/actions.test.ts \
  test/core/change-run/contracts.test.ts \
  test/core/change-run/cli-complete.test.ts \
  test/core/pipeline-registry/profile-resolver.test.ts \
  --reporter=dot --maxWorkers=1
```

Result: **11 files, 121/121 passed**, 52.63 seconds. Ed25519 authenticity,
canonical evidence, complete-set publication, plan-bound authority, persisted
runtime plans, and crash recovery remain fail-closed.

Final gates:

- `pnpm run build`: passed after the daemon source change;
- `pnpm exec tsc --noEmit`: passed, 108.7 seconds;
- `pnpm --dir packages/ui run typecheck`: passed, 68.4 seconds;
- `pnpm run lint`: passed with zero errors, 37.4 seconds;
- strict Change validation: 1/1 valid, zero issues;
- `git -c core.safecrlf=false diff --check`: passed;
- `git hash-object pipelines/auto-decompose/pipeline.yaml`:
  `6f306544010a8950508f1223acfca5d62de407f5`;
- `git diff --exit-code -- pipelines/auto-decompose/pipeline.yaml`: no diff.

An initial parallel static-gate attempt exhausted its 120-second outer command
budget while the cold host was running several compilers concurrently. It
emitted no usable result and is not counted above; every gate was then rerun
separately to a conclusive pass.

## Landing boundary

Round 5 repairs every deterministic failure and independently exercises every
environment candidate from the Round 4 full-root report. It does **not** claim
that the root suite is globally green. An independent reviewer must still run
the complete root suite, the required UI/vertical gates, inspect this delta,
and decide tasks 9.8–9.10.

The ECP-7 boundary from Round 4 is unchanged: the current vertical proves a
public-only manually trusted-host path, while a real trusted execution
Adapter/Session worker that observes work/effects and invokes the private
`TrustedCompletionProducer` remains separate work. No Issue/portfolio scope or
`auto-decompose` migration is introduced here.
