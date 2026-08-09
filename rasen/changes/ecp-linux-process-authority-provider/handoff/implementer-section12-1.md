# Handoff: Section 12 implementer - production wiring of daemon-lifetime teardown

Date: 2026-08-07\
Author: implementer (Section 12), leaf worker.\
Reason: context exhaustion mid-unit. Section 12 itself (12.1-12.3) is COMPLETE and ticked; this
document covers the follow-on unit, "wire production", which is implemented but not receipted.

## Original intent

Close the gap Section 12 honestly reported: the crate has daemon-lifetime teardown and its receipts
prove it, but `native-assembly.ts` spawned `prepare` without `--daemon-lifetime-fd`, so no scope
created by the Node daemon carried the property. The LEAD's receipt bar was explicitly not "the flag
is passed" but a demonstration that a scope survives everything it should and dies only when the
daemon's endpoint actually closes, with an early-release mutation visibly RED.

## Position

| Item | State |
| --- | --- |
| 12.1 / 12.2 / 12.3 | DONE, ticked, receipted in `evidence/section-12-daemon-lifetime-teardown.md`, committed `8438eca0` |
| New frozen digest `89f6c1d5...` | Holds. Verified again this session after further test edits |
| Production wiring in `native-assembly.ts` | IMPLEMENTED, `tsc --noEmit` clean, **NOT receipted** |
| Production end-to-end oracle | Written; blocked by a pre-existing defect that is not this wiring |

## The finding that matters most

**`activate` does not reach `live` through the TypeScript coordinator path, and this has nothing to
do with Section 12.**

Measured, with the daemon-lifetime wiring **completely disabled** in the run tree
(`bindsDaemonLifetime = false`, single-line patch, control run `s12-nowire.log`):

```text
prepare   -> prepared-inert      OK
publish   -> published-inert     OK
activate  -> authority-unavailable, "Linux process authority is retained (reference-invalid)."
```

Byte-identical failure with the wiring on and with it off. Two tests, both runs. So the wiring is
not the cause, and no conclusion about the wiring can be drawn from this oracle until the activate
path works.

This is `lead-5.md`'s central finding reproduced empirically rather than by inspection: *"the cancel
path is the reason this subsystem exists, and it is the least-verified path in it on every
platform - `activate(success)`, `terminate` and `open-runtime` are crossed by zero tests
end-to-end, in either language."* They are crossed by one now, and it is RED. Whoever picks this up
should treat it as a real product defect on the primary path, not as test scaffolding trouble.

**Do not conclude that the wiring works, and do not conclude that it does not.** It is unreceipted.

## The two Node facts that shaped the implementation, both measured

These cost most of the unit and are not written down anywhere else in this repository.

1. **Node's `stdio` cannot carry a daemon lifetime.** Node ties the streams it creates for a child
   to that child's lifetime and destroys its own end when the child exits. Probe
   (`scratchpad/probe-eof.mjs`): a grandchild holding the far end of `stdio[4]` saw end-of-file
   immediately after the direct child left, and the parent's `Socket.destroyed` read `true` while
   the parent was still running and had called `unref()`. Since the prepare helper always exits
   while the guardian lives on, a `stdio: 'pipe'` slot signals "the daemon is gone" the instant
   prepare returns and would tear down every scope at birth. **This is why the implementation uses
   a FIFO, not a stdio pipe.**
2. **A held extra stdio pipe blocks `ChildProcess` `'close'` indefinitely.** Probe
   (`scratchpad/probe-close.mjs`): `exit` fired at 3 ms, `close` had still not fired after 3 s.
   `invoke()` awaits `'close'`, so the first implementation would have hung the daemon on every
   prepare. This constraint disappeared with the FIFO (a raw fd creates no stream), and the `'close'`
   wait was restored unchanged - but anyone reintroducing a stdio slot here will hit it again.

## What is implemented

All in `src/core/session-host/process-authority/linux/native-assembly.ts`:

- `openDaemonLifetimeChannel()` - `mkfifo -m 600` in a fresh `mkdtemp` directory, opened `O_RDWR` by
  the daemon (making it the sole writer) and `O_RDONLY` for the child; the path is unlinked at once,
  so no later process can open a second writer and keep a dead daemon's scope alive.
- `spawnPinned` places the child's read-only descriptor at stdio slot 4 as a **raw fd**, so Node
  creates no stream for it and cannot destroy it.
- `prepare` appends `--daemon-lifetime-fd 4` for `mode === 'user-pidns'` only. The broker owns its
  scope lifetime through the root-owned lease, so it does not bind one.
- Retention keyed by the reference `generation`, released **only** on a positively proven
  `exact-scope-empty` from `inspect` / `terminate` / `abort` - never on typed uncertainty, which may
  be transient while the scope is still running. Every non-frame return path releases the holder,
  so a failed prepare cannot leave a guardian alive that nothing can address.

`npx tsc --noEmit -p tsconfig.json` is clean. Nothing was emitted into `dist`.

## Test assets written, not yet green

- `test/core/session-host/linux-process-authority-daemon-lifetime.test.ts` - two cases: the daemon is
  killed and the scope must die; the daemon is left alone and the workload must run to completion.
  Gated `process.platform === 'linux' && RASEN_ACTUAL_WSL_ORACLE === '1'`.
- `test/fixtures/linux-process-authority-daemon-lifetime-daemon.mjs` - a real separate Node daemon
  driving `coordinator.prepare -> publish -> activate`.
- `test/fixtures/linux-process-authority-daemon-lifetime-workload.mjs` - resistant workload
  (`setsid` via `detached`, plus a double fork). The nested-PID-namespace shape is deliberately
  **not** repeated here: it is already receipted natively, and it tests the kernel, not the wiring.

## Dead ends and gotchas

- **No `dist` emission is needed anywhere.** `scripts/build-linux-process-authority.mjs` honours
  `RASEN_LINUX_PROCESS_AUTHORITY_BUILD_ROOT` and emits a complete package root - native artifacts
  **and** the generated `build-authority.js` - outside the repository.
  `/home/sayo/.local/share/rasen-build/s12-refreeze-a` is one, bound to `89f6c1d5`, already
  mode-correct for `validateOwnedPath`.
- **Never run vitest in the repo for this work.** `vitest.setup.ts:setup()` calls `ensureCliBuilt()`
  **unconditionally**; it returns early only because `dist/cli/index.js` happens to exist. Use the
  ext4 run tree `/home/sayo/.local/share/rasen-build/ts-oracles-tree` (own `dist`, symlinked
  `ts-oracles-nm/node_modules`), where the worst case wipes that tree, not the repo.
- `activate()` lives on the **published** authority, not the prepared one:
  `prepared.publish(bundle.publishAuthority)` then `published.activate()`.
- The native helper's `inspect` reports `inert`, not `prepared-inert`; the ledger maps it above that
  seam.
- **`pkill -f <pattern>` from `bash -c` matches its own command line and kills the shell** (exit 9).
  Bracket a character: `linux_daemon_life[t]ime_contract`.
- PowerShell expands `$VAR` inside `wsl -e bash -c "..."`. Put multi-step shell work in a script file
  and run the file.
- The run tree is currently patched with `bindsDaemonLifetime = false` from the control run.
  `s12-sync-tree.sh` overwrites it from the repo, so re-sync before any further run.

## Eliminated hypotheses

- *"The extra stdio pipe survives the child, so `stdio` can carry the endpoint."* **No** - measured
  false, twice (destroyed on child exit; grandchild sees EOF at once).
- *"The wiring caused the activate failure."* **No** - the control run with the wiring disabled fails
  identically, same state and same diagnostic string.
- *"A packaged `dist` in the repo is required to verify any of this."* **No** - my own earlier
  wording was over-broad. A package *root* is required and it can live anywhere.
- *"`unref()` keeps Node from closing an stdio stream."* **No** - `unref` only removes it from the
  event loop; it does not prevent destruction.
- *"The workload can create a nested PID namespace directly."* **No** - `drop_workload_privileges`
  drops the bounding set, `capset`s empty and sets `NO_NEW_PRIVS`, so `unshare(CLONE_NEWPID)` is
  `EPERM`; only an unprivileged user namespace works, and inside it the process is unmapped and
  cannot create files (open descriptors before unsharing).

## Next action

1. **Root-cause `activate -> reference-invalid` on the primary TypeScript path.** It blocks this
   receipt and it is a product defect in its own right. Start from `NativeFailureCode::from_control_error`
   in the crate and the control-socket connect in `AuthorityClient`, with the daemon fixture's stderr.
   The native crate's own `activate` works (Section 12's oracle and 29 `linux_primary_contract` tests
   pass), so the divergence is in the TypeScript control path or in what it passes.
2. Once activate works, re-run `s12-prod-oracle.sh` and take the two mutations the LEAD asked for:
   early release must be RED, and never-passing the flag must be RED on the death case.
3. Only then may the "not claimed" item 1 in `evidence/section-12-daemon-lifetime-teardown.md` be
   struck. **Until then it stands as written: no production Linux scope has the property.**

## Honest state

Section 12 is genuinely done and its receipts are sound. The production wiring is written and
type-correct but proves nothing yet, and I would not let anyone tick it. The unit produced one
finding worth more than the wiring itself: the primary activate path is broken end-to-end, and it
took building the first end-to-end test of it to see that.
