# Bounded runner safety review

## Verdict

**NOT CLEAN — 2 Blockers and 3 Majors.**

This was a report-only static review of:

- `evidence/bounded-vitest-runner.mjs`;
- `test/support/process-ownership.mjs`;
- the ownership coverage in `test/ci-workflow-contract.test.ts`.

No bounded-runner, timeout, or termination self-test was run because static review found paths that can target an unrelated process. The only executed check was the non-destructive contract file:

```text
pnpm exec vitest run test/ci-workflow-contract.test.ts
Test Files  1 passed (1)
Tests       6 passed (6)
```

That result does not exercise the runner itself (Major 3).

## Findings

### Blocker 1 — the first root bind can grant kill capability to a reused, unrelated PID

**Location:** `bounded-vitest-runner.mjs:105-114`, seeded by `:283-291`; downstream capability at `:125-134` and `:163-188`.

The root is initially stored as `{ pid: child.pid, created: null }`. `discoverOwned` then replaces that placeholder with whichever process the snapshot currently reports at the same PID when `child.exitCode` and `child.signalCode` are still `null`. The bind does not check `liveRoot.parentPid === process.pid`, executable/name, command line, or any identity obtained from the original spawn.

`ChildProcess.exitCode`/`signalCode` are asynchronous status fields, not a live-process capability. The original child can exit, its PID can be reused, and the replacement can appear in the CIM snapshot before Node has updated those fields. Lines 113 and 125 then treat the replacement's creation time as the invocation root's exact identity, lines 130-134 can adopt its descendants, and `terminateOwned` can kill that wrongly admitted process after successfully rechecking the *replacement's* creation time. The kill-time check therefore cannot repair the unsafe admission.

This is directly material to the recorded incidents: `full-suite-report.md:25` says an earlier attempt adopted and terminated two pre-existing Vite processes after Windows PID/ancestor reuse. The current special root-bind branch is not covered by the helper regression cited there.

**Required remediation:** do not derive the root's kill capability from a later PID-only lookup. Capture a non-reusable identity/capability from the original spawn (on Windows, preferably assign the child to a Job Object using the original process handle) and make an unproven root permanently audit-only. If snapshot binding remains as defense in depth, parent PID plus executable/command identity and plausible creation are necessary checks, but parent PID alone is insufficient: this runner itself spawns PowerShell snapshot children, and arbitrary explicit commands can have the same executable. The final kill guard must validate an exact identity, not merely the current code's sub-millisecond (`< 10000` ticks) proximity at `:175`.

### Blocker 2 — the advertised POSIX path cannot audit, terminate, or bound the invocation

**Location:** `bounded-vitest-runner.mjs:53`, `:63-77`, `:163-164`, `:321-338`, and `:365-376`.

The runner explicitly selects `pnpm test` on non-Windows hosts, but `snapshotProcesses()` unconditionally returns `[]` there and `terminateOwned()` unconditionally returns without action. Consequently:

- even a successful POSIX child can never replace the root's `created: null` placeholder, so lines 336-338 add an ownership error and the runner exits nonzero;
- on timeout, both survivor arrays can be empty even while the spawned command or descendants remain alive, because `liveKnown` has no POSIX observations;
- no timeout cleanup occurs, and the referenced child/stdio handles can keep the runner alive beyond its declared bound.

This violates the closure contract at `specs/ci-test-harness/spec.md:33-41` and `:56-60`, which requires terminating evidence and identification of every owned leak. Quietly returning an empty inventory is especially unsafe because the structured report asserts no known survivors without saying process observation is unsupported.

**Required remediation:** implement native POSIX ownership and termination using a spawn-time process-group/session capability plus exact `/proc`/platform identity checks, or fail closed before spawning with a structured unsupported-platform error. Do not emit empty survivor arrays as if an audit occurred.

### Major 1 — ownership/snapshot uncertainty does not latch a permanent no-more-kills state

**Location:** `bounded-vitest-runner.mjs:139-160`, `:190-207`, and `:310-326`.

Snapshot failures are appended to `runnerErrors`, but no monotonic cleanup-disabled state is set. A later timeout or completion snapshot can therefore proceed to `terminateOwned`. In particular, completion cleanup at lines 321-324 is gated only on `terminationErrors.length === 0`; it ignores prior `runnerErrors` and `ownershipErrors`. A termination-command exception breaks only the current loop and happens to suppress the later completion attempt through `terminationErrors`, but snapshot/identity uncertainty receives no equivalent protection.

The final exit condition correctly makes the run nonzero, but nonzero reporting after the fact is not a safety boundary for kills already attempted.

**Required remediation:** add a monotonic `cleanupDisabled`/audit-only state. Set it on every snapshot, ownership, creation-time, termination, or recheck uncertainty before any later kill can begin; make every kill site check it; record the first disabling reason and all skipped cleanup in the structured report. After it is set, perform observation-only reporting and no further termination attempts.

### Major 2 — polling and PID-only history can miss owned descendants and falsely report no leak

**Location:** `bounded-vitest-runner.mjs:116-136`, `:228-235`, `:260-262`, and `:317-326`.

The exact-identity queue at lines 123-134 is conservative for an owner represented in one successful snapshot: an exited or creation-mismatched known owner cannot expand descendants. It is not, however, complete process-tree ownership:

1. Polling occurs every two seconds. If a correctly bound owner spawns a long-lived child and exits before the next snapshot, that child was never admitted and cannot later be reached because expansion requires the owner to remain live in the current snapshot.
2. Cleanup snapshots the current known identities and then calls `Process.Kill()` one PID at a time. A process can spawn a child between that snapshot and its kill; once the parent exits, the unknown child is outside the known-only final audit.
3. `if (known.has(entry.pid)) continue` at line 130 keys history only by PID. A legitimate owned descendant that reuses the PID of an exited known descendant can never be admitted, even when its current parent has an exact live identity and its creation time is plausible.

In each case, `survivingOwnedProcesses` and `survivingOwnedProcessesAfterCleanup` are derived only from `known`, so an unobserved owned process can survive while both arrays are empty and no error forces failure. Previous PID reuse in this run makes the third case concrete rather than merely hypothetical.

**Required remediation:** use an OS ownership container established at spawn (Windows Job Object; POSIX process group/session with platform-appropriate descendant accounting) as the authoritative inventory and cleanup boundary. If snapshots remain supplemental, key identities by `(pid, creation time)`, preserve generations, and prove quiescence after cleanup; never equate “not in `known`” with “not owned.”

### Major 3 — the passing tests cover predicates, not composed admission or cleanup behavior

**Location:** `test/ci-workflow-contract.test.ts:6-7` and `:85-135`; absence confirmed by repository search for `bounded-vitest-runner`, `discoverOwned`, and `terminateOwned` under `test/`.

The test imports only `isPlausibleDescendant`, `isSameLiveProcess`, and `canAdoptProcess`. The “unbound invocation root” case at lines 125-135 proves that those helpers reject `{ created: null }`, but the runner bypasses that guarantee with its special mutation at `bounded-vitest-runner.mjs:105-114`. No test composes snapshots through `discoverOwned`, invokes the runner as a child, observes a root-exit/PID-reuse first-bind race, verifies the no-more-kills rule after uncertainty, exercises cleanup/report failures, checks POSIX fail-closed behavior, or proves descendant adoption and survivor reporting end to end.

The six-test pass therefore coexists with both Blockers above and is not regression evidence for either recorded PID-reuse incident.

**Required remediation:** extract the runner state machine behind injectable snapshot/kill/report adapters and add deterministic composed tests for every transition above. Add controlled platform integration tests only after kill authority is capability-bound; every integration fixture must target exclusively processes it spawned and must assert both the killed set and the never-killed set.

## Other required checks

- **Stale/exited known owner expansion:** locally sound but incomplete. `isSameLiveProcess` requires exact PID and non-empty exact creation time (`process-ownership.mjs:21-29`), and `canAdoptProcess` also requires current parentage and plausible creation (`:32-37`). The runner's queue applies those predicates at `bounded-vitest-runner.mjs:123-134`. This does not protect the special root bind or observation gaps described above.
- **Kill-time creation recheck:** present at `bounded-vitest-runner.mjs:170-188`, including `WaitForExit(5000)`, but it protects only the identity previously admitted and accepts a `< 10000` tick difference. It cannot distinguish a wrongly bound replacement from the intended root.
- **Structured failure evidence/nonzero:** caught snapshot, ownership, termination/recheck, terminal, and report-write failures are represented in schema version 2 (`:243-267`) and included in the nonzero decision (`:365-376`). A report-write failure rebuilds the report and prints it to stdout (`:350-363`). This reporting is fail-closed for caught errors, but Major 1 still permits kills after uncertainty and Major 2/POSIX can omit processes the runner never observed.
- **Timeout timer clearing:** correct. `raceWithTimeout` clears its timer in `finally` at `:214-225`, addressing the stale timer described in `full-suite-report.md:39`.
- **PowerShell invocation semantics:** `execFile` uses `-NoProfile`, `-NonInteractive`, and argument arrays for both snapshots and termination. Termination reopens by PID and checks start time before `Kill`; however, the root-admission race and non-atomic snapshot/individual-kill model remain unsafe.

## Closure condition

Do not use the current runner to claim bounded, leak-free evidence or to perform timeout cleanup. Re-review after both Blockers and all Majors are fixed and after composed deterministic tests demonstrate: an exited-before-bind root never gains kill capability; uncertainty permanently disables later kills; every owned descendant is accounted for; unrelated replacements are never killed; POSIX either works safely or fails before spawn; and every failure produces structured nonzero evidence.

## Retirement re-review

### Verdict

**NOT CLEAN — the executable kill surface is retired, but 2 Major evidence/protocol findings remain.**

Static inspection confirms that `evidence/bounded-vitest-runner.mjs` and `test/support/process-ownership.mjs` are absent. A repository search finds no remaining executable references to either file or to the retired `discoverOwned`/`terminateOwned` helpers; their only remaining detailed references are the intentionally historical findings earlier in this review. `test/ci-workflow-contract.test.ts` now imports only `resolveTestInclude` and contains three read-only workflow/partition contract tests. Its eight-partition exact/disjoint manifest test passed:

```text
pnpm exec vitest run test/ci-workflow-contract.test.ts
Test Files  1 passed (1)
Tests       3 passed (3)
```

No partition, timeout, ownership, or termination test was run. No observed external process was targeted or modified.

### Major 1 — exact-worktree command-line snapshots are non-destructive but not a fail-closed descendant audit

**Location:** `full-suite-report.md:11`; required contract at `specs/ci-test-harness/spec.md:35-41` and `:56-60`.

The replacement protocol is non-destructive in the reviewed tree: it invokes partitions directly, describes read-only before/after observations, and prohibits custom/manual termination. It also blocks on timeout, nonzero exit, missing summary, and an observed exact-worktree survivor.

It is not sufficient to prove that no invocation-owned process survives. A process command line is not required to contain its current working directory or its ancestor's command line. For example, an owned descendant launched as `node -e ...`, through a globally installed executable, or with rewritten arguments can remain in the worktree while omitting the worktree path and therefore evade the stated filter. Conversely, a pre-existing process from the same worktree can match, which is conservative but shows that the predicate is location text rather than lineage. The prose also does not state that snapshot acquisition, permission, parsing, or truncation failure blocks the gate, nor how the after-snapshot is guaranteed to run after the orchestration shell enforces its timeout. An empty/failed observation can therefore be mistaken for zero survivors.

This protocol safely avoids another unrelated-process kill, but it can still false-green the spec's stronger requirement that no process spawned by the invocation remains alive and that any leak be identified.

**Required remediation:** make every before/after observation failure an explicit blocking result and persist its command, status, and raw/parsed evidence. Do not infer ancestry from worktree text. Establish a read-only, spawn-time identity/lineage observer (without termination authority), or explicitly keep the process-leak portion of the final gate pending when complete ownership cannot be proven. The timeout controller must guarantee the after-observation in its own `finally` path even when the partition shell is stopped.

### Major 2 — the incident-only report still labels invalidated runner outputs as counted/valid acceptance evidence

**Location:** `full-suite-report.md:7-15`, `:27`, `:31-47`, and `:63`.

Lines 7-11 and 63 correctly say that the runner is retired, none of its outputs count, and no aggregate pass is claimed. The middle of the same document contradicts that status:

- line 15 says a historical partition “counts”;
- line 27 asserts that six terminated processes were “exact invocation-owned,” although this review invalidated that ownership premise;
- line 31 calls the later partition 1 output “valid” and cites a now-deleted ownership regression;
- line 33 titles the table “Counted partition results,” rows 37-40 label results `PASS`, and lines 45/47 call fields “acceptance fields.”

Those labels can be quoted independently of the surrounding disclaimer and falsely present unsafe runner output as accepted release evidence. The report may preserve the incident facts, but it cannot continue to assert exact ownership or acceptance after retiring the mechanism that supplied those claims.

**Required remediation:** rename the section and criteria as the retired runner's former, untrusted classifications; label every table row `SUPERSEDED`/`UNTRUSTED` rather than `PASS`; replace “exact invocation-owned” with the factual statement that the retired runner classified and terminated six PIDs, whose ownership is not relied upon; and remove “valid,” “counted,” and “acceptance” language from all historical JSON descriptions.

### Retirement closure condition

The original two Blockers and three Majors are retired as executable risks because the kill-capable runner and helper are deleted. Retirement can be reviewed CLEAN after the two findings above are resolved: historical artifacts are consistently incident-only, and the direct-partition protocol either provides fail-closed lineage evidence with no kill authority or explicitly leaves the no-survivor gate pending.

## Final retirement re-review

### Verdict

**CLEAN — both Retirement re-review Majors are resolved.**

The final pass inspected `full-suite-report.md`, closure `proposal.md`, `design.md`, `tasks.md`, the closure delta and main `ci-test-harness` specifications, `contract-reconciliation.md`, `changed-path-inventory.md`, and `test/ci-workflow-contract.test.ts`.

### Major 1 resolution — local process cleanliness is no longer inferred

- `full-suite-report.md:14-21` defines only an exact/disjoint, summary-and-exit local test-result gate. It explicitly says read-only observations are diagnostic, not lineage or no-survivor filters; acquisition/parse failure leaves process cleanliness `NOT EVALUATED`; any observed or suspected survivor blocks release; and closure-owned/manual termination is prohibited.
- The same boundary is normative and consistent in `proposal.md:12`, `design.md:72-81`, `tasks.md:39-44`, the closure delta spec at `specs/ci-test-harness/spec.md:33-69`, the main spec at `rasen/specs/ci-test-harness/spec.md:110-146`, and the closure row in `contract-reconciliation.md:64`.
- The main spec's separate whole-tree termination requirements apply to the established `runCLI` test helper and its registered child capability. They do not grant the retired closure aggregate a bespoke/manual ownership or kill claim, and the new local-gate requirement expressly forbids one.

The direct-partition protocol is therefore fail-closed for what it claims—test manifest, summary, counts, exit, and external time bound—while honestly leaving unprovable local process cleanliness unevaluated. It does not convert command-line matching or any other read-only diagnostic into lineage evidence.

### Major 2 resolution — historical runner evidence is consistently untrusted

- `full-suite-report.md:9-12` says the runner/helper are deleted and every runner-produced result is `SUPERSEDED` and excluded from the final aggregate.
- The former criteria are titled an untrusted classification (`:23-29`); every historical table row is `SUPERSEDED` (`:31-38`); the numbers are expressly not aggregated (`:40`); and final status remains `PENDING` with process cleanliness `NOT EVALUATED` (`:61-63`).
- The six-PID monolithic incident is now described only as a retired/manual procedure's classification, with ownership expressly not relied upon (`:42-44`). The incident section records actual unrelated-process impact and uncertainty without presenting any cleanup as successful (`:46-51`).

No runner output is presented as a counted, valid, accepted, exact-owned, or passing final result.

### Executable and contract checks

- `evidence/bounded-vitest-runner.mjs` and `test/support/process-ownership.mjs` remain absent. Repository search found only their intentional deletion tombstones in `changed-path-inventory.md` and historical discussion in this review, not executable references.
- `test/ci-workflow-contract.test.ts` contains three read-only workflow/manifest tests and imports no process-ownership or termination helper. Its current contract result is recorded as 3/3 passing by the implementer; it was not rerun in this final pass per the review checkpoint.
- The implementer-reported strict validations were likewise not repeated; this final pass independently checked the resulting retirement contract text for consistency.

The original runner findings and both retirement findings are closed by deletion plus honest evidence/spec scoping. No partition, timeout, process-observation, or termination action was performed during this final re-review.
