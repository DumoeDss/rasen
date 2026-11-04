# Section 12 follow-on - wiring daemon-lifetime teardown into the shipped transport

Date: 2026-08-07\
Author: implementer (Section 12 follow-on), leaf worker.\
Scope: closes the gap `evidence/section-12-daemon-lifetime-teardown.md` reported under "Not
claimed" item 1 - the crate had the teardown, the Node daemon did not pass an endpoint. This is
follow-on work; it ticks no task and does not alter Section 12's receipts.

Crate source digest unchanged by this unit: `89f6c1d5...` over 26 files. Only
`src/core/session-host/process-authority/linux/native-assembly.ts` and test assets changed.

## Evidence layers, and what each claim rests on

The LEAD required each closed claim to name the layer that establishes it, because "production has
the property" means something very different when it comes from reading arguments than from a
daemon actually dying.

| Layer | What it establishes | Strength |
| --- | --- | --- |
| 1 - argument shape | the prepare invocation carries `--daemon-lifetime-fd 4`; control verbs do not | weakest; inspection-adjacent |
| 2 - lifecycle, real kernel | an endpoint is created, survives the prepare helper's exit, is held for the scope's life, and is released only on proven-empty | strong; measured against a live guardian |
| 3 - end-to-end, real kernel | a real Node daemon dies and its scope's resistant workload dies with it | strongest; **NOT TAKEN - blocked, see below** |

**Layers 1 and 2 are taken. Layer 3 is blocked by a defect that predates this work.** Nothing here
claims the layer-3 property.

## The blocker, established by control rather than assumed

`activate` does not reach `live` through the TypeScript coordinator path. Measured with the
daemon-lifetime wiring **completely disabled** (`bindsDaemonLifetime = false`, one line, run tree
only):

```text
prepare   -> prepared-inert     OK
publish   -> published-inert    OK
activate  -> authority-unavailable, "Linux process authority is retained (reference-invalid)."
```

Byte-identical to the wired run, both tests, both runs. So the wiring is not the cause and no
layer-3 conclusion can be drawn until activate works. Narrowed for whoever picks it up:
`reference-invalid` is native failure code 7, which `NativeFailureCode::from_control_error`
(`src/protocol.rs:152-179`) produces from `io::ErrorKind::PermissionDenied` or `InvalidData` -
pointing at `validate_control_socket` or the server-challenge verification in the control path,
not at the guardian being dead. The guardian is demonstrably alive at that moment (below).

This is `lead-5.md`'s central claim reproduced by measurement rather than inspection: *"`activate`,
`terminate` and `open-runtime` are crossed by zero tests end-to-end, in either language."* They are
crossed by one now, and it is RED.

## What was built

`openDaemonLifetimeChannel()` in `native-assembly.ts`: `mkfifo -m 600` inside a fresh `mkdtemp`
directory; the daemon opens it `O_RDWR` (making it the sole writer) and opens a separate `O_RDONLY`
descriptor for the child; the path is unlinked immediately, so no later process can open a second
writer and keep a dead daemon's scope alive. The child descriptor goes to stdio slot 4 as a **raw
fd**, and `prepare` appends `--daemon-lifetime-fd 4` for `mode === 'user-pidns'` only - the broker
owns its scope lifetime through the root-owned lease. Retention is keyed by the reference
`generation` and released only on a positively proven `exact-scope-empty`.

### Why a FIFO and not `stdio: 'pipe'` - the measurement that forced it

**Node destroys its end of a child's stdio stream when that child exits.** Probe: a grandchild
holding the far end of `stdio[4]` observed end-of-file *immediately* after the direct child left,
while the parent was still running and had called `unref()`; the parent's `Socket.destroyed` read
`true`. Since the prepare helper always exits while the guardian lives on, a `'pipe'` slot would
announce "the daemon is gone" the instant prepare returned and **tear down every scope at birth**.

A second Node fact, no longer load-bearing but recorded so it is not rediscovered: a *held* extra
stdio pipe blocks `ChildProcess` `'close'` indefinitely - `exit` fired at 3 ms, `close` had still
not fired after 3 s. `invoke()` awaits `'close'`, so the first implementation would have hung the
daemon on every prepare. A raw fd creates no stream, so the original `'close'` wait was restored
unchanged.

## Layer 1 and 2 receipts, on the WSL2 kernel

Gate: these ran in the isolated ext4 run tree
`/home/sayo/.local/share/rasen-build/ts-oracles-tree` against package root
`/home/sayo/.local/share/rasen-build/s12-refreeze-a` (bound to `89f6c1d5`). **No vitest ran in the
repository and no `dist` was emitted there**, because `vitest.setup.ts:setup()` calls
`ensureCliBuilt()` unconditionally and that wipes `dist/` whenever `dist/cli/index.js` is absent.

Layer 1 is established behaviourally rather than by reading argv: the helper refuses a
`--daemon-lifetime-fd` that is below 3 or not open (`exact_inherited_fd`,
`validate_daemon_lifetime_endpoint`), so a successful prepare proves descriptor 4 was present and
valid in the helper.

```text
BASELINE prepare=prepared-inert endpointsHeld=0->1
BASELINE publish=published-inert (scope addressable after helper exit)
BASELINE guardian after delay: alive(pid 52124)
BASELINE endpointsHeldAfterDelay=1 abort=exact-scope-empty
BASELINE endpointsAfterAbort=0
```

Read in order: exactly one endpoint appears at prepare and is still held 1.5 s later; the scope is
still addressable after the prepare helper exited; the guardian is alive at that moment, read from
the kernel by signalling its PID rather than from any state this code reports; and the endpoint is
released precisely when `abort` returns proven `exact-scope-empty`, not before.

### Mutation 1 - release-too-early (the failure mode this wiring risks)

The daemon lets go of its endpoint while the scope is meant to be live.

```text
MUTATION prepare=prepared-inert endpointsHeld=1
MUTATION released the endpoint early
MUTATION guardian after release: GONE(pid 52128, ESRCH)
```

RED, and discriminating against the baseline's `alive(pid 52124)` under identical conditions. The
scope dies exactly when the daemon lets go - which is why the release rule is "proven-empty only,
never typed uncertainty".

### Mutation 2 - never pass the flag (today's shipped behaviour before this change)

```text
no-wire  prepare=prepared-inert endpointsHeld=0->0
no-wire  guardian after "release": alive(pid 52181)
```

RED, and discriminating in the opposite direction: with no endpoint, releasing nothing changes
nothing and the guardian survives. Together the two mutations bracket the claim - the wiring is
neither inert nor over-eager.

| Run | endpoints held after prepare | guardian after early release |
| --- | --- | --- |
| wired (baseline) | 1 | GONE (ESRCH) |
| no-wire mutant | 0 | alive |

## Incidental finding, recorded not fixed

After the guardian was gone, `publish` still returned `published-inert`. Publication is a pure
ledger operation that never contacts the guardian, so it can report success over a scope that no
longer exists. Not caused by this wiring and not in this unit's scope, but it is the same
"the Record must not lie" shape the portfolio keeps hitting, and it is worth a finding.

## Not claimed

1. **Layer 3 is not taken.** No receipt here shows a real daemon dying and a resistant workload
   dying with it through the shipped transport. Section 12's "Not claimed" item 1 is narrowed, not
   struck: the endpoint now reaches the guardian in production, and the guardian answers its
   closure - but the full production property waits on `activate`.
2. **`activate`, `terminate` and `open-runtime` remain unverified end-to-end** on this path.
3. The oracle at `test/core/session-host/linux-process-authority-daemon-lifetime.test.ts` and its
   two fixtures are written and currently RED for the blocker above, not for the wiring.
4. Everything ran through `createLinuxPrimaryNativeAssemblyForTesting`. The production
   `createLinuxPrimaryNativeAssembly` still resolves against a `build-authority.js` that the
   committed source stubs to `[]`; the transport code exercised is the same, the constructor is not.
5. Author == verifier throughout. Nothing reproduced by anyone else.
