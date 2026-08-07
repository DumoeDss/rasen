# Real Linux receipts [WSL-EXTERNAL] - ecp-hosted-best-effort-cutover

Tasks 6.1, 6.2, 6.3, 6.4.

## Task 6.1 - run-tree provenance and isolation statement

**These receipts were NOT taken in the repository checkout.** The repo's
`node_modules` is a Windows install and cannot run under WSL
(`@rollup/rollup-linux-x64-gnu` is absent from it), and a vitest run in the
checkout can wipe `dist/` and with it the packaged native artifacts.

| Field | Value |
| --- | --- |
| Run tree | `/home/sayo/.local/share/rasen-build/ecp-cutover-linux` |
| Filesystem | ext4 (`stat -f -c %T` reports the ext2/ext3/ext4 family) |
| Distro | Ubuntu 24.04.1 LTS |
| Kernel | 5.15.167.4-microsoft-standard-WSL2 |
| Node | v22.21.0 (Linux-native; the Windows host runs v24.14.0) |
| vitest | 3.2.6 |
| Source | `git archive HEAD` of `wip/ecp-shared-bounded-loop-lifecycle-resume` at commit `0346ba29`, extracted into the tree; the Section 6 suite copied in separately because it was not yet committed |
| node_modules | symlink to the pre-existing Linux-native install at `/home/sayo/.local/share/rasen-build/ts-oracles-nm/node_modules` |

Two deliberate choices in the tree setup:

- `dist/cli/index.js` is created as a one-line stub. `ensureCliBuilt()`
  (`test/helpers/run-cli.ts:136`) only checks that the path EXISTS, so the stub
  short-circuits it and `build.js` - which `rmSync`s `dist/` - never runs.
- The Windows checkout is only ever read from (`cp` of two files); nothing in
  the repo was written, and the repo's `node_modules` was never touched.

Setup script: `scratchpad/wsl-setup.sh` (reproduced in the commit message trail);
the tree is disposable and can be rebuilt from any commit.

## Gate discipline

The suite is `describe.skipIf(!GATE)` where
`GATE = process.platform === 'linux' && process.env.RASEN_POSIX_REAL_KERNEL === '1'`.
Running it without the gate skips silently and proves nothing, so a negative
control is recorded alongside the real run:

```
=== WITH GATE ===
 ✓ POSIX best-effort tier on a real Linux kernel > 6.2 cancels a real hosted session and records cancelled / emptiness-unproven 100ms
 ✓ POSIX best-effort tier on a real Linux kernel > 6.3 stays emptiness-unproven when a setsid descendant survives a completed cancel 139ms
 ✓ POSIX best-effort tier on a real Linux kernel > 6.4 reports an exact root exit code and, separately, an exact terminating signal 32ms
 Test Files  1 passed (1)
      Tests  3 passed (3)

=== WITHOUT GATE (negative control) ===
 Test Files  1 skipped (1)
      Tests  3 skipped (3)
```

Three tests asserted; they did not merely exit 0.

## Task 6.2 - production-path cancel on a real kernel

`createHostedProcessScope()` is called with no platform override, so the
production selection runs and returns the POSIX tier on linux. Asserted:

- the declaration (`tier: best-effort`, `exactCancel: false`,
  `scopeEmptyProof: false`) is present on the prepared scope BEFORE activation;
- `setsid()` really happened - `ps -o pgid= -p <leader>` equals the leader pid,
  so the workload leads its own process group;
- the workload process is really alive after activation;
- `host.reconcileOnStart()` releases the session (`recovered === 1`);
- the Record reads `cancelled / emptiness-unproven`;
- the leader pid is really gone afterwards (`kill -0` -> ESRCH);
- the scope's OWN receipt (`live.closed`) is
  `declared-unproven / cancelled / unproven`.

## Task 6.3 - setsid escape is a declared limitation, not a defect

The flagship honesty case, on a real kernel rather than a modelled one. The
workload spawns a `detached: true` child, which is `setsid(2)`: the descendant
leaves the workload's process group entirely. Asserted:

- the escapee's `pgid` really differs from the leader's - it left the group,
  which is stronger than merely observing that it survived;
- the cancel completes, `groupObservedEmpty` is `true`, and the leader is gone;
- the session is released (`recovered === 1`) with the Record reading
  `cancelled / emptiness-unproven`;
- **the escapee is still alive afterwards**;
- the Record contains no `scope-empty` and no `"proven"`, and the scope's own
  receipt says `emptiness: 'unproven'`.

This is precisely the declared limitation: the group was observed empty, a
process from that workload survived anyway, and nothing anywhere claimed the
scope was empty. Under an exact tier this would be a false Record; under this
tier it is the declaration doing its job.

## Task 6.4 - exact root exit code and exact terminating signal, separately

- exit path: workload `process.exit(23)` ->
  `rootExited === { state: 'root-exited', code: 23, signal: null }`, and the
  terminal is `completed / emptiness-unproven` carrying
  `rootExit: { code: 23, signal: null }`.
- signal path: the leader is sent `SIGTERM` ->
  `rootExited === { state: 'root-exited', code: null, signal: 'SIGTERM' }`, and
  the terminal carries `rootExit: { code: null, signal: 'SIGTERM' }`.

Exactly one of `code`/`signal` is populated in each case, and both are reported
distinctly from the emptiness statement, which stays `unproven` in both.

## Mutation receipt on the real kernel - and a finding about the first attempt

Mutation applied in the run tree only (the tree is disposable, so no revert
bookkeeping is needed; the file was restored by re-copying from the repo):

```diff
-    emptiness: 'unproven',
+    emptiness: "proven-empty" as unknown as "unproven",
```

**First attempt - only ONE of three tests failed:**

```
 FAIL  ... > 6.4 reports an exact root exit code and, separately, an exact terminating signal
      Tests  1 failed | 2 passed (3)
```

6.2 and 6.3 stayed GREEN against a scope that was claiming proven emptiness.
Cause: they asserted the honesty on `record.processTerminal`, and
`toHostedProcessTerminal` (`src/core/session-host/host.ts:655`) writes
`emptiness: 'unproven'` as a **hardcoded literal**. The Record therefore cannot
express a proof claim no matter what the scope says - which is good for the
"Record must not lie" invariant, but it means any assertion on that field is
about the host's projection, not about the tier's claim. 6.4 caught the mutation
only because it asserts `live.closed`, the scope's own receipt.

Fix: 6.2 and 6.3 now additionally assert the scope's own receipt via
`live.closed`. Re-run against the same mutation:

```
 FAIL  ... > 6.2 cancels a real hosted session and records cancelled / emptiness-unproven
 FAIL  ... > 6.3 stays emptiness-unproven when a setsid descendant survives a completed cancel
 FAIL  ... > 6.4 reports an exact root exit code and, separately, an exact terminating signal
      Tests  3 failed (3)
```

Unmutated, after restoring the module: 3 passed (3).

Worth carrying to review: the same weakness applies to any test in this
repository that checks tier honesty through `record.processTerminal.emptiness`,
including the pre-existing darwin declaration-gated-release suite. Those
assertions are not wrong, but they do not discriminate a lying scope; the
discriminating assertions are the ones on the scope's own receipt, and on
win32 those live in `win32-best-effort-scope.test.ts` (proven by mutations (a)
and (f)).
