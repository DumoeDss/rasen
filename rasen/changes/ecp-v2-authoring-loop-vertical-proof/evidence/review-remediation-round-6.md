# Review remediation round 6 - bounded cleanup lifecycle repair

Date: 2026-08-04\
Role: implementer / review-loop fixer\
Scope: repair the sole failure in the independent Round 5 full-root run. This
round does not perform the independent re-review, run the complete root suite,
ship, archive, or mark tasks 9.8-9.10 complete.

## Authoritative input and root cause

The authoritative input was retained unchanged:

```text
E:\rasen-ecp6-r5-review-root-full-20260804-022035\root-vitest.json
SHA-256 A77CEDC89627CE3290D9B84AEAD62D38967AF87D220E6B4D5D307053CA6847C7
```

It records 439 files, 1,801 suites (1,798 passed / 3 failed), and 6,903
tests (6,868 passed / 1 failed / 34 pending). The only failed assertion entry
is `store-membership-cli.test.ts`, and its two failure messages are:

1. Vitest's `STACK_TRACE_ERROR` from the test task/declaration; and
2. the `afterEach` EPERM rethrown by `cleanupTempPathAsync` after 15 x 200 ms.

The failed assertion duration is 34,398.9967 ms. That timing is the global
30-second Vitest test budget followed by the helper's approximately 3-second
manual retry window and hook bookkeeping. The test performs five sequential,
individually bounded fresh CLI invocations. Under the 84-minute cold serial
root run, their aggregate crossed the test budget before the final CLI owner
had closed. Vitest then entered `afterEach` while that child still owned a
directory beneath `tempDir` as its Windows cwd. Recursive deletion raced the
live owner, partially retried the same tree, and surfaced EPERM.

This explains both parts of the failure without classifying either as random:

- the primary lifecycle defect was an aggregate test budget shorter than the
  legitimate bounded fresh-process sequence;
- the cleanup failure was secondary and correct to remain visible while the
  owner was still active.

An isolated pre-change file run passed 11/11 in 110.2 seconds, with the same
case completing in 13.30 seconds. This reproduces Round 5's misleading
focused-green / long-root-red distinction and is not used as a substitute for
the failed full-root gate. Its retained JSON is:

```text
E:\rasen-ecp6-r6-red-store-membership\store-membership-red.json
```

## Repair

`test/commands/store-membership-cli.test.ts` now gives only the five-process
doctor-parity case a 120-second test budget. Every underlying `runCLI` call
retains its own 30-second timeout. The change therefore does not retry an
assertion or create an unbounded wait; it lets the resource-owning child reach
the existing `close` boundary before `afterEach` starts deleting its cwd.

`test/helpers/temp-cleanup.ts` remains bounded at 15 retries x 200 ms by
default. Its algorithm is made deterministic and complete rather than merely
given a larger number:

- finite non-negative safe-integer validation prevents `Infinity`/`NaN` from
  creating an unbounded retry loop;
- the retryable set now matches recursive `fs.rm` transient conditions:
  EPERM, EBUSY, ENOTEMPTY, EMFILE, and ENFILE;
- injected remove/wait operations let tests prove release ordering and exact
  attempt counts without an OS timing race;
- every retry receives the exact original target; no parent, sibling, glob,
  or fallback path is derived;
- non-transient errors surface on the first attempt, and a permanent EPERM
  surfaces after exactly `maxRetries + 1` removal attempts.

The helper explicitly documents that retries cover only the bounded OS or
antivirus release tail after the resource owner closes. They are not a
substitute for owner lifecycle management.

## RED / GREEN discriminator

The new `test/helpers/temp-cleanup.test.ts` was run before implementing the
helper changes:

```text
pnpm exec vitest run test/helpers/temp-cleanup.test.ts --reporter=dot --maxWorkers=1
```

RED result: **1 file failed, 8/8 tests failed**, 937 ms. The old helper ignored
the injected held-EPERM owner/release boundary, did not retry EMFILE, did not
validate unbounded options, and could not prove the permanent-lock or exact-
target properties.

After the helper repair, the same command passed **1 file, 8/8 tests**, 755 ms.
The cases prove:

- held EPERM -> awaited owner release -> exact-target retry -> success;
- transient EMFILE -> bounded retry -> success;
- permanent EPERM -> three attempts for `maxRetries: 2` -> original error;
- EACCES -> one attempt, no wait, no alternate path;
- infinite, negative, and NaN retry budgets -> fail before removal.

## Stress and consumer coverage

Three independent Vitest processes then ran the helper and the complete Store-
membership CLI file with isolated TEMP/TMP roots:

```text
test/helpers/temp-cleanup.test.ts
test/commands/store-membership-cli.test.ts
```

Result: **19/19 passed in every round (57/57 total), zero failures**. Retained
machine-readable results:

```text
E:\rasen-ecp6-r6-store-stress\round-1\results.json
E:\rasen-ecp6-r6-store-stress\round-2\results.json
E:\rasen-ecp6-r6-store-stress\round-3\results.json
```

The shared-helper consumer aggregate covered:

- CLI E2E basic;
- daemon lifecycle;
- the complete pipeline command suite;
- Store membership and remote Store commands;
- archive recovery;
- execution-binding temporary state;
- token-audit management;
- local-version runtime;
- the helper discriminator itself.

Result: **10 files / 43 suites / 223 tests = 222 passed + 1 pending, zero
failures**, 700.7 seconds. The pending case is the suite's pre-existing
platform/condition skip, not a cleanup error. Retained JSON:

```text
E:\rasen-ecp6-r6-cleanup-consumers\cleanup-consumers.json
```

No temporary output was copied into the worktree or source manifest.

## ECP and static regression gates

The exact Round 5 deterministic aggregate passed again:

```text
test/vocabulary-sweep.test.ts
test/core/change-run/ecp-composite-dogfood.test.ts
test/core/change-run/ecp-composite-parity.test.ts
test/core/change-run/lowerer-composite.test.ts
test/core/pipeline-registry/session-contract-fidelity.test.ts
test/commands/pipeline-bugfix-e2e.test.ts
test/commands/pipeline-complex-e2e.test.ts
```

Result: **7 files / 33/33 passed**, zero pending/failures. Retained JSON:

```text
E:\rasen-ecp6-r6-deterministic-33\deterministic-33.json
```

The exact Round 4/5 security-runtime aggregate also passed:

```text
test/core/change-run/attestation.test.ts
test/core/change-run/evidence-store-fs.test.ts
test/core/change-run/runtime-context.test.ts
test/core/change-run/execution-plan.test.ts
test/core/change-run/lowerer.test.ts
test/core/change-run/lowerer-native-v2.test.ts
test/core/change-run/facade-settle-completeness.test.ts
test/core/change-run/actions.test.ts
test/core/change-run/contracts.test.ts
test/core/change-run/cli-complete.test.ts
test/core/pipeline-registry/profile-resolver.test.ts
```

Result: **11 files / 121/121 passed**, zero pending/failures. Retained JSON:

```text
E:\rasen-ecp6-r6-security-121\security-121.json
```

Retained JSON SHA-256 values, in the path order used above:

```text
store-membership-red.json  DB8EDD27ED337699A1DA8CA8358FE84D96D278FA84655A6AC9E87A4FBCB34260
stress round 1             A39D03FA197573E24C9AA13224E12B67479F27D9FDC551CE3AA2C3842BA0AA73
stress round 2             DD48201E42529551A055169584B6F984ECE9DE50459E4143302AF3697723B22A
stress round 3             F4BD16491DBF38E4BAE5DCF55C59A99B8FF1009AFDD512A27D36C914ECF850B2
cleanup-consumers.json     E4E25FC448DFBB0736C06EC8877CD1F82CB97A8B5C62582C9D700246AA002321
deterministic-33.json      E295B581DEC3B4A08566CAB3C826527E5EA723DC261EBBE00B40404AFC62C2AA
security-121.json          36BF5A2B25EE3DFEE6F71D9822B412388A8FBFA17B6E434180FADFBADA2C4615
```

Static gates on the final Round 6 source:

- `pnpm exec tsc --noEmit --pretty false`: passed;
- `pnpm run build`: passed;
- `pnpm run lint`: passed with zero errors;
- strict Change validation: 1/1 valid, zero issues;
- `git -c core.safecrlf=false diff --check`: passed;
- `pipelines/auto-decompose/pipeline.yaml`: empty scoped diff and unchanged
  blob hash `6f306544010a8950508f1223acfca5d62de407f5`.

## Landing boundary

This fixer did not run the complete root suite; the mandatory single full-root
JSON belongs to a new non-author reviewer. That reviewer must also rerun the
fresh built vertical and complete UI gate before a CLEAN verdict. Tasks 9.8,
9.9, and parent-owned 9.10 remain unchecked.

No commit, push, ship, archive, machine run-state update, portfolio update, or
protected temporary-tree deletion/inclusion was performed. ECP-7's real
trusted Adapter/Session producer boundary and the 0.3.0 Issue/portfolio scope
remain unchanged.
