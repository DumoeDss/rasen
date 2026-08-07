# Mutation receipts - ecp-hosted-best-effort-cutover

Task 4.5. Provenance: this Windows host (Windows 11 Pro 10.0.26200.8875,
Node v24.14.0, vitest 3.2.6), worktree
`OpenSpec-code-wt-ecp-shared-bounded-loop-lifecycle`, branch
`wip/ecp-shared-bounded-loop-lifecycle-resume`, guards as committed at
`b33a4f84`.

## Why these exist

Four consecutive greens is a passing run, not a receipt. A guard that never
failed against the defect it names has not been shown to detect anything - and
this repository has caught guards that were structurally incapable of failing.
Each mutation below introduces the exact defect its guard claims to prevent,
records which named tests turn RED, is reverted byte-exactly, and is followed by
a GREEN run.

## Method

Mutations are applied and reverted by a script that (1) refuses to run unless its
anchor matches exactly once in the target file, and (2) reverts from a byte-exact
backup taken at apply time.

Reverting with `git checkout -- <file>` was tried first and **rejected**:
`core.autocrlf` is `true` in this repository, so a checkout rewrites the working
tree with CRLF. The restored file then differs from the committed blob in 330
bytes while `git diff` reports nothing, and the next mutation's LF anchor misses
and reports a false "0 hits". Byte-exact backup/restore avoids both failure
modes. This is recorded because it is a trap any later mutation wave here will
hit.

## Receipts

### (a) The wrapper forges a clean-cancel receipt

Defect: `translateTermination` passes the capsule's exact `closed` receipt
straight through to the hosted seam instead of minting a declared-unproven
terminal - the tier re-asserting a proof it does not have.

Mutation in `src/core/session-host/process-capsule/win32-best-effort-scope.ts`:

```diff
-    state.settleTerminal(unproven);
-    return terminationFrom(unproven);
+    return receipt;
```

RED - `npx vitest run test/core/session-host/win32-best-effort-scope.test.ts`:

```
 FAIL  win32 terminals are declared-unproven, never the capsule exact claim > translates an acknowledged capsule cancel into cancelled / emptiness-unproven
 FAIL  win32 terminals are declared-unproven, never the capsule exact claim > reports a scope aborted before activation as never-activated, having run nothing
 FAIL  win32 terminals are declared-unproven, never the capsule exact claim > yields no clean-cancel or proven-empty result on ANY reachable outcome path
      Tests  3 failed | 15 passed (18)
```

GREEN unmutated: 18 passed (18).

### (b) The wrapper promotes transport loss to a declared-unproven terminal

Defect: the exact SEC-001 shape - "transport loss can become a clean host
detach". `uncertainReceipt` mints a releasing terminal from a lost control
channel.

Mutation in `win32-best-effort-scope.ts`: the body of `uncertainReceipt` is
replaced with `terminationFrom(unprovenReceipt('cancelled', { jobObservedEmpty:
true, forced: true, ... }))`.

RED:

```
 FAIL  transport and controller loss are retained uncertainty, never a terminal > returns typed uncertainty when the controller dies before acknowledging
 FAIL  transport and controller loss are retained uncertainty, never a terminal > returns typed uncertainty when the cancel exceeds its control bound
 FAIL  transport and controller loss are retained uncertainty, never a terminal > returns typed uncertainty on a capsule protocol violation
      Tests  3 failed | 15 passed (18)
```

GREEN unmutated: 18 passed (18).

Honest limitation of this receipt: the fourth guard in that describe block,
"leaves the hosted terminal unsettled after transport loss", stayed GREEN under
this mutation. That is correct rather than broken - the mutation changes the
receipt `terminate()` returns, not whether the live `closed` promise settles - but
it means that guard's own discrimination is not proven by mutation (b). It is a
second, independent property; no mutation in this wave targets it.

### (c) Selection regression routes linux back to the legacy capsule

Defect: the cutover's central routing edit is reverted for linux, so Linux hosted
sessions resume constructing the exact tier whose POSIX claim review disproved.

Mutation in `src/core/session-host/process-capsule/hosted-process-scope.ts`:

```diff
-  if (platform === 'darwin' || platform === 'linux') {
+  if (platform === 'darwin') {
```

RED - `npx vitest run test/core/session-host/darwin-best-effort-scope.test.ts`:

```
 FAIL  POSIX selection at hosted-session ProcessScope construction > selects the shared POSIX best-effort tier on darwin AND on linux
      Tests  1 failed | 16 passed (17)
```

GREEN unmutated: 17 passed (17). Note the darwin arm of that same test stays
satisfied under the mutation, so the failure is attributable to linux
specifically rather than to the assertion collapsing wholesale.

### (d) Per-path discrimination on the two `closeDurableProcess` release paths

This is the receipt the task singles out: a guard that only exercises one release
path stays green while the other regresses. Two mutations, each breaking exactly
one path, prove the guards separate them.

#### (d1) The OBSERVATION path stops checking the declaration

Mutation in `src/core/session-host/host.ts` (`closeDurableProcess`, the
observation path):

```diff
     if (observation.state === 'declared-unproven') {
-      if (!declared) return 'live-or-uncertain';
       noteProcessTerminal(record.sessionId, observation.terminal);
     }
```

RED - `npx vitest run test/core/session-host/cutover-declaration-gated-release.test.ts`:

```
 FAIL  'linux (POSIX tier)' releases a declared scope on BOTH host release paths > refuses the observation path when the Record carries no pre-start declaration
 FAIL  'win32 (Job tier)' releases a declared scope on BOTH host release paths > refuses the observation path when the Record carries no pre-start declaration
      Tests  2 failed | 8 passed (10)
```

The two RECEIPT-path refusal guards stayed GREEN.

#### (d2) The RECEIPT path stops checking the declaration

Mutation in `src/core/session-host/host.ts` (same function, the receipt path):

```diff
-      if (!receiptAuthorizesRelease(receipt, declared)) return 'live-or-uncertain';
+      if (!receiptAuthorizesRelease(receipt, true)) return 'live-or-uncertain';
```

RED:

```
 FAIL  'linux (POSIX tier)' releases a declared scope on BOTH host release paths > refuses the receipt path when the Record carries no pre-start declaration
 FAIL  'win32 (Job tier)' releases a declared scope on BOTH host release paths > refuses the receipt path when the Record carries no pre-start declaration
      Tests  2 failed | 8 passed (10)
```

The two OBSERVATION-path refusal guards stayed GREEN.

The two results are complementary and disjoint: breaking either path fails
exactly its own two guards on both tiers and leaves the other path's guards
passing. A single-path suite could not have produced this pair. GREEN unmutated:
10 passed (10).

Note on where these mutations land: `host.ts` is NOT edited by this change. It
was mutated only transiently to prove the guards discriminate, and restored
byte-exactly; the integrity check below confirms it.

### (e) The POSIX module emits a proven-emptiness claim

Defect: the moved module states proven emptiness - the dishonesty the whole tier
exists to avoid. This receipt does double duty: it also proves the *repointed*
source-scan guard (task 2.3) still reads a real implementation, which is the
failure mode design D2's no-shim decision was made to avoid.

Mutation in `src/core/session-host/process-capsule/posix-best-effort-scope.ts`:

```diff
-    emptiness: 'unproven',
+    emptiness: 'proven-empty' as unknown as 'unproven',
```

RED - `npx vitest run darwin-best-effort-scope.test.ts darwin-live-close-terminal.test.ts`:

```
 FAIL  macOS best-effort scope declares its limits before anything starts > aborts a prepared scope without signalling anything and reports no workload ran
 FAIL  cancel escalation is keyed off whole-group emptiness, never leader exit > keeps the grace running and forces at expiry when the leader exits instantly
 FAIL  cancel escalation is keyed off whole-group emptiness, never leader exit > does not force when the whole group is gone before grace expiry
 FAIL  the tier never reports a clean cancel or a proven-empty scope > reports emptiness-unproven even when the group is observed empty
 FAIL  the tier never reports a clean cancel or a proven-empty scope > has no source path that emits closed or scope-empty on this tier
 FAIL  the tier never reports a clean cancel or a proven-empty scope > reports the exact root exit distinctly from any emptiness statement
 FAIL  the tier never reports a clean cancel or a proven-empty scope > records natural completion with the same unproven honesty
 FAIL  the live-close route persists the declared-unproven terminal > records completed / emptiness-unproven when a declared session ends naturally
      Tests  8 failed | 14 passed (22)
```

The fifth failure is the repointed source-scan guard, which is the specific
claim task 2.3 needed proven. GREEN unmutated: 22 passed (22).

### (f) The win32 module emits a proven scope-empty claim

Added after the Windows receipts forced a change to the win32 source-scan guard.
The transport-loss fix introduced `failure: { code: 'process-control-lost',
phase: 'scope-empty' }` - a control-PHASE label, which the capsule adapter uses
for the same failure - and the original guard's bare `/'scope-empty'/` assertion
turned RED on it. The guard was narrowed to forbid `state: 'scope-empty'` and to
strip only `phase: 'scope-empty'` occurrences before re-asserting the token is
absent. Narrowing a guard demands re-proving it, so:

Mutation in `win32-best-effort-scope.ts` (inside `unprovenReceipt`):

```diff
   return Object.freeze({
-    state: 'declared-unproven',
+    state: 'scope-empty' as unknown as 'declared-unproven',
     outcome,
```

RED:

```
 FAIL  win32 terminals are declared-unproven, never the capsule exact claim > settles the live closed promise with an honest terminal, never a scope-empty receipt
 FAIL  win32 terminals are declared-unproven, never the capsule exact claim > has no source path that emits closed or scope-empty on this tier
      Tests  2 failed | 17 passed (19)
```

GREEN unmutated: 19 passed (19). The narrowed guard still catches a real
emission of the token it polices; only the phase-label spelling is tolerated.

## Integrity after the wave

Every mutated file was restored from its byte-exact backup and the working tree
was checked against the commit:

```
$ git diff --numstat -- src/ test/
(no output)
```

Full guard re-run after all reverts:

```
 ✓ test/core/session-host/darwin-best-effort-scope.test.ts (17 tests)
 ✓ test/core/session-host/win32-best-effort-scope.test.ts (18 tests)
 ✓ test/core/session-host/darwin-live-close-terminal.test.ts (5 tests)
 ✓ test/core/session-host/darwin-declaration-gated-release.test.ts (8 tests)
 ✓ test/core/session-host/cutover-declaration-gated-release.test.ts (10 tests)

 Test Files  5 passed (5)
      Tests  58 passed (58)
```

`dist/cli/index.js` was confirmed present before every vitest invocation in this
wave.

## Scope of what these receipts do and do not establish

They establish that each named guard fails against the defect it names, so its
green state carries information. They are deterministic, fixture-mediated
evidence and are therefore **non-acceptance** per the change's Section 4 heading
and the spec's acceptance requirement. Acceptance needs the real Linux (Section
6) and real Windows (Section 7) receipts on the production hosted path.
