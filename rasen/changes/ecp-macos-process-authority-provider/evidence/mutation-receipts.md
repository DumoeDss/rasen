# Deterministic mutation receipts (task 5.4, extended)

## NON-ACCEPTANCE EVIDENCE

These are deterministic, any-OS receipts. They prove the guards discriminate;
they are **not** macOS evidence. Real-kernel receipts are in
`posix-preflight-oracles.md` (Linux, also non-acceptance) and, once a macOS host
exists, in Section 7 of `tasks.md`.

## Why every guard here has a mutation

The working premise on this codebase is that **an unmutated guard test is
non-discriminating** until proven otherwise. So no guard in this change is
presented as green without a demonstrated failing counterpart. Nine defects were
injected one at a time into the real source, the affected suite was run, and the
source was restored. Every injection produced RED, and each names the guard that
caught it.

Task 5.4 asked for four (a-d). Five more (e-i) were added after (d) revealed
that the declaration-gated release rule has **two independent code paths** - the
terminate-receipt path and the already-terminal-observation path - and mutating
one left the other's guard green. A guard that survives its neighbour's mutation
has not been shown to discriminate.

## How to reproduce

Each row is a single textual substitution in the named file. Apply it, run the
named test file, observe RED, restore the file.

## Receipts

### (a) escalation keyed to leader exit instead of whole-group emptiness

File `src/core/session-host/process-capsule/darwin-best-effort-scope.ts`:

```
-      groupObservedEmpty = await pollGroupEmpty(groupId, intent.graceMs);
+      groupObservedEmpty = (await pollGroupEmpty(groupId, intent.graceMs)) || Boolean(state.rootExit);
```

```
   x cancel escalation is keyed off whole-group emptiness, never leader exit > keeps the grace running and forces at expiry when the leader exits instantly
   x the tier never reports a clean cancel or a proven-empty scope > reports the exact root exit distinctly from any emptiness statement
      Tests  2 failed | 14 passed (16)
```

### (b) leader-only kill instead of group kill

Same file:

```
-      kill(-groupId, signal);
+      kill(groupId, signal);
```

```
   x cancel escalation is keyed off whole-group emptiness, never leader exit > keeps the grace running and forces at expiry when the leader exits instantly
   x cancel escalation is keyed off whole-group emptiness, never leader exit > does not force when the whole group is gone before grace expiry
   x cancel escalation is keyed off whole-group emptiness, never leader exit > addresses the whole group, never the leader alone
   x the tier never reports a clean cancel or a proven-empty scope > reports the exact root exit distinctly from any emptiness statement
      Tests  4 failed | 12 passed (16)
```

### (c) forged cleanly-cancelled receipt

Same file, in `terminationFrom`:

```
-    state: 'declared-unproven',
+    state: receipt.groupObservedEmpty ? 'closed' : 'declared-unproven',
```

```
   x cancel escalation is keyed off whole-group emptiness, never leader exit > keeps the grace running and forces at expiry when the leader exits instantly
   x the tier never reports a clean cancel or a proven-empty scope > reports emptiness-unproven even when the group is observed empty
      Tests  2 failed | 14 passed (16)
```

### (d) release without declaration (terminate-receipt path)

File `src/core/session-host/process-scope.ts`, in `receiptAuthorizesRelease`:

```
-  return declared && receipt.state === 'declared-unproven';
+  return receipt.state === 'declared-unproven';
```

```
   x declaration-gated release from a declared-unproven terminal > refuses release when the record carries no pre-start declaration
      Tests  1 failed | 7 passed (8)
```

### (e) release without declaration (already-terminal observation path)

File `src/core/session-host/host.ts`, in `closeDurableProcess`:

```
     if (observation.state === 'declared-unproven') {
-      if (!declared) return 'live-or-uncertain';
       noteProcessTerminal(record.sessionId, observation.terminal);
```

```
   x declaration-gated release from a declared-unproven terminal > refuses an unproven observation presented by an undeclared record
      Tests  1 failed | 7 passed (8)
```

### (f) declaration omitted from the hosted-session record

File `src/core/session-host/host.ts`: delete the `declaration` spread from the
`current.process = { ... }` assignment written before activation.

```
   x the declaration is in the Record before any workload code runs > records the limits at prepare time, before the workload is spawned
      Tests  1 failed | 7 passed (8)
```

### (g) darwin no longer selects the best-effort tier

File `src/core/session-host/process-capsule/hosted-process-scope.ts`:

```
-  if (platform === 'darwin') return createDarwinBestEffortProcessScope();
+  if (platform === 'sunos') return createDarwinBestEffortProcessScope();
```

```
   x darwin selection at hosted-session ProcessScope construction > selects the best-effort tier only on darwin
      Tests  1 failed | 15 passed (16)
```

### (h) one construction site bypasses the selection helper

File `src/core/session-host/claude-backend.ts`: restore the direct
`createNativeProcessScope` import and call (this still compiles, so the guard is
the only thing standing between the codebase and a silently exact-tier darwin
backend).

```
   x darwin selection at hosted-session ProcessScope construction > routes every hosted-session construction site through the selection helper
      Tests  1 failed | 15 passed (16)
```

### (i) non-absolute command accepted

File `src/core/session-host/process-capsule/darwin-best-effort-scope.ts`:

```
-      if (!path.isAbsolute(input.command)) {
+      if (false && !path.isAbsolute(input.command)) {
```

```
   x macOS best-effort scope declares its limits before anything starts > refuses a non-absolute command before any process is created
      Tests  1 failed | 15 passed (16)
```

## Guards deliberately left without an injected mutation

Two guards are source scans rather than behavioural assertions:

- "has no source path that emits closed or scope-empty on this tier"
- "contains no reattach or identity revalidation anywhere in the module"

Their discrimination is definitional (they fail the instant the forbidden text
appears), and mutation (c) already demonstrates the first one's sibling
behavioural guard going RED. They are recorded here as scans, not as behavioural
proof, so no downstream reader mistakes them for one.
