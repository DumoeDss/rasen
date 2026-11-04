# LEAD #2 implementation wave — new findings for the unified review wave

Date: 2026-08-07

## Boundary

These are findings discovered during the LEAD #2 implementation wave. None of them is closed here.
The implementation wave does not close findings; the unified review wave does. They are recorded so
the review wave inherits them rather than rediscovering them, and so that no ticked task rests on an
undisclosed caveat.

Pre-existing findings (1 Blocker, 9 Major, 1 Minor) are unchanged and remain open.

## F-L2-01 — `BRK-R2-B06` is probably under-scoped (Major candidate, scope expansion)

`BRK-R2-B06` ("prepare and activation mutation work can continue after the request's absolute
deadline") is filed against the **broker** path — `broker_service.rs:487-516`,
`broker_guardian.rs:482-486`, the detached daemon thread — and its required fix enumerates
"activation, inspection, runtime-open".

The **primary** user-pidns helper CLI had the identical defect on exactly those three verbs:
`activate`, `inspect` and `open-runtime` each validated `--deadline-ms` with `bounded_u32` and then
discarded the parsed value. The finding as written does not cover the primary path at all.

Flagged as a scope-expansion candidate, not a re-ranking. The review wave should decide whether B06
grows to cover both paths or a sibling finding is opened for the primary path.

## F-L2-02 — `after_ms` re-anchors the budget; it is not an absolute deadline (Major candidate)

The `activate` fix in this wave routes the caller's `--deadline-ms` into
`AbsoluteMonotonicDeadline::after_ms(...)`. That bounds the operation, but the clock starts when the
helper child reaches that line. Process spawn, argv validation and the stdin frame read all elapse
beforehand. What crosses the process boundary is therefore a remaining-time **delta that is
re-anchored later**, not an absolute monotonic deadline threaded end to end.

This matters because "absolute monotonic deadline threaded end to end" is what `BRK-R2-B06` is
actually about. The fix is a bounded-operation improvement and must not be read as progress toward
B06's stated requirement.

## F-L2-03 — three of four control verbs still discard their deadline (Major candidate)

`inspect`, `open-runtime` and `terminate` still parse `--deadline-ms` and discard it. They are
**known-defective and deliberately left**, not signed off as correct.

They were not fixed because honouring them requires new `_until` seams threaded through
`control` / `control_on` / `inspect_evidence` — a **second deadline implementation in the control
path** — which this change's invariants forbid ("one construction transaction and one absolute
prepare deadline; M00 adds observations, not a second deadline implementation"). The LEAD decided
against doing that during an implementation freeze, and against doing it piecemeal while B06 is
open, since deadline semantics across the control path should be resolved as one coherent piece.

The TypeScript layer computes and sends a real budget (`remainingBudgetMs()` =
`min(300_000, deadline - now)`), so three of four control operations currently ignore a value the
caller genuinely computed.

## F-L2-04 — historical activation receipts measured a helper that ignored the activation deadline

Because the `activate` defect existed through every prior WSL gate round, any earlier
activation-path receipt on this change was taken against a helper that silently substituted the
internal 2-second `CONTROL_TIMEOUT` for the caller's value. Those receipts are not necessarily
wrong about what they asserted, but they did not exercise caller-supplied activation bounding.

The review wave should decide whether any prior round's activation claims need re-taking.

## F-L2-05 — `design.md:15` is factually wrong about this WSL's cgroup interface (Minor)

`design.md:15` states the WSL instance "exposes no usable controllers, `cgroup.events`, or
`cgroup.kill`". The controllers half is correct. The rest is not: `cgroup.kill` and `cgroup.events`
exist on all 23 non-root cgroups here and are absent only at the cgroup-v2 root, which the kernel
documents as expected for non-root-only files.

## F-L2-06 — design/code divergence on the broker's required controllers (Major candidate)

`design.md:134-136` describes the broker leaf purely in terms of `cgroup.procs`, `cgroup.kill`,
`cgroup.events`, leaf inode identity and root ownership/mode. It never mentions a resource
controller.

`broker_cgroup.rs:16-20` `CgroupRequirements::broker_default()` hard-requires the `pids` controller,
and `FsCgroupKernel::probe` returns `unavailable("required cgroup v2 controller is unavailable")`
before reaching any of the interface files the design names. The installed daemon uses exactly that
default.

Either the design under-specifies the broker's real dependency or the code over-constrains the gate.
Deliberately left unresolved: resolving it by editing `broker_default()` so that a gate passes would
be backwards. This is a product decision.

## F-L2-07 — `linux_primary_contract`'s test count overstates assertion coverage (accounting caveat)

The suite reports 29 passing tests. The honest composition is **21 asserting tests plus 8 gated
fixture entrypoints** that early-return when their gate environment variable is absent and therefore
assert nothing at top level; their real work happens only inside child processes their parents
spawn. Gates: `RPA_ATTACK_RUNTIME_ROOT`, `RPA_GUARDIAN_DEATH_MARKER`, `RPA_BACKPRESSURE_FIXTURE`,
`RPA_NONDUMPABLE_GATE`, `RPA_EXPECT_CLOSED_FD`, `RPA_FINAL_CHILD_GATE`, `RPA_UNAVAILABLE_SELECTOR`,
`RPA_SETPGID_MARKER`.

Not a defect by itself, but "29 passed" must not be read as 29 assertions in any summary.

## F-L2-08 — no compile-time enumeration of `ConstructionCheckpoint` variants (residual, mitigated)

Task 4.7 claims coverage of "every injected failure point". The 18-entry matrix array previously had
no compile-time tie to the enum, so a 19th variant would have escaped silently while 4.7 kept its
claim.

Mitigated this wave: `CONSTRUCTION_CHECKPOINTS: [ConstructionCheckpoint; 18]` plus a wildcard-free
`checkpoint_position()` match, both test-side, verified to produce
`error[E0004]: non-exhaustive patterns` when a 19th variant is introduced. The matrix test also
asserts each entry maps back to its own index, catching duplication and reordering.

Residual: Rust cannot enumerate variants without a derive macro, and adding a dependency to this
pinned minimal crate was out of scope. The compile error is the forcing function.

## F-L2-09 — `FsCgroupKernel` has zero test coverage (Major)

`FsCgroupKernel` is the real kernel-facing cgroup implementation — roughly 580 lines — and it is what
the shipped daemon uses (`src/bin/rasen-linux-process-authority-broker.rs:275`). It has **zero
references anywhere under `native/linux-process-authority/tests/`**.

Every broker cgroup test drives `FixtureKernel` instead, whose `place_guardian` records the pid in a
`Mutex` and whose `probe()` only asserts `required_controllers == ["pids"]` and returns `Ok`. So the
entire suite exercises a stand-in that cannot fail the way the real implementation fails.

This is the "test that cannot fail" defect at module scale, and it is the direct cause of two
separate blind spots on this change: the `place_guardian` Blocker below, and the fact that the broker
structurally cannot run on a hybrid-cgroup host (`F-L2-06`). Neither was visible through any prior
review round because no test ever touched the code that had the problem.

**Demonstrated, not merely argued.** `linux_broker_cgroup_contract` reports `9 passed; 0 failed` both
**before and after** the `F-L2-10` Blocker fix — the suite was run in both states and its output is
identical. A suite that is green whether or not the broker can perform its central operation is not
weak evidence; it is zero evidence for that operation.

Consequence for anyone citing results on this change: **the broker cgroup suite must never be cited
as evidence for `F-L2-10`, or for any behaviour of `FsCgroupKernel`.** What validates that fix is the
new `lib` guard with its mutation proof, plus the real-kernel harness where `place_guardian` moved
`Err(EINVAL)` to `Ok(())` while the fragmented-write reproductions stayed `Err(EINVAL)`.

The review wave should treat "which production types are exercised only by fixtures" as a first-class
audit question on this change, not just this one type.

## F-L2-10 — `place_guardian` could never succeed on a real cgroup filesystem (Blocker, fixed this wave)

`broker_cgroup.rs:662` used `writeln!(procs, "{guardian_pid}")?;` to write `cgroup.procs`.

`writeln!` expands to `Write::write_fmt`, and `File`'s `write_fmt` issues a separate `write(2)` per
format fragment — first the pid, then a bare `"\n"`. Each write to `cgroup.procs` is parsed
independently by the kernel, so the newline-only write is parsed as an empty pid and rejected with
EINVAL. The migration had already succeeded; the function then reported failure.

Demonstrated against the real kernel with a RED/GREEN pair:

```text
E1   writeln!(procs, "{pid}")                 -> Err(kind=InvalidInput errno=22)
E1b  but /proc/<pid>/cgroup                   -> 0::/rasen-broker-gate.slice/lease-b0b0...
E2   write_all(b"<pid>\n") as ONE write       -> Ok(())
E3   the second fragment alone, b"\n"         -> Err(errno=22)
E4   writeln!(file, "{pid}") on a member pid  -> Err(errno=22)
```

Blast radius: `place_guardian` -> `BrokerCgroupAuthority::place_guardian_exact` -> `prepare_leaf`.
**The broker could never prepare a lease against any real cgroup filesystem**, and because the error
was returned after the guardian was already inside the leaf, the failure path ran
`cleanup_partial_exact_leaf` against a populated leaf.

The same defect existed at `broker_cgroup.rs:541` (`writeln!(control, "+{required}")` to
`cgroup.subtree_control`). Those were the only two `writeln!`/`write!` sites in `src/`.

Fixed during this wave rather than deferred, because freezing a broker whose prepare path cannot
succeed on any real kernel would have baked the defect into the frozen digest and into every receipt
bound to it. Recorded here rather than silently closed, because the interesting part is not the fix
but `F-L2-09` — the reason a Blocker of this size was invisible to a mature test suite.

## F-L2-11 — the TypeScript production assembly factory is crossed by zero tests (Major)

The `CgroupKernel` / `FsCgroupKernel` / `FixtureKernel` substitution in `F-L2-09` is broker-only; the
native primary path has no kernel-substitution seam. But the TypeScript side has the same shape, and
it is on the **primary** path:

```text
createLinuxPrimaryNativeAssembly            native-assembly.ts:1061   production factory
  used by                                   provider.ts:1042          the only caller
  test references                           none

createLinuxPrimaryNativeAssemblyForTesting  native-assembly.ts:1066
  used by                                   linux-process-authority-wsl-oracles.test.ts:93
                                            linux-process-authority-wsl-controller.mjs:67
```

Every other TypeScript provider test injects a fake transport. Verified independently: the production
factory has zero references anywhere under `test/`.

The delta between the two factories is narrow and deliberate — the production path resolves its build
identity from the compiled-in `LINUX_PROCESS_AUTHORITY_BUILD_IDENTITIES`, which is
`Object.freeze([])` in-repo by design until packaging generates it, whereas the testing factory takes
the staged package's identity as a parameter. Everything downstream is shared code. So this is a
bounded, by-design gap rather than a hidden one.

It still matters for two reasons. First, **the entire real-helper coverage of the TypeScript primary
path rests on three oracles** — the ones backing 7.8's published-abort row and 7.10 — and those three
were authored and executed by the same worker, so they still owe a non-author review in the unified
wave. Second, it means no test ever crosses the exact code path production uses to resolve a build
identity from a packaged manifest; that resolution is only ever exercised with an
externally-supplied identity.

Same audit question as `F-L2-09`, applied to TypeScript: which production entry points are exercised
only through a testing-only variant or a fake?

## F-L2-12 — unbounded Unix socket paths under `TMPDIR` fail as an unrelated timeout (Minor)

`linux_broker_service_contract` composes Unix socket paths under `TMPDIR` without bounding their
length. A long `TMPDIR` pushes the path past `SUN_LEN` (108), the daemon can never bind, and the
failure then surfaces as a **sibling test timing out** while waiting for a daemon that was never
going to exist. The test that fails is not the test that is wrong.

Reproduced and cleared during this wave by setting a short `TMPDIR`. Not a regression — the suite is
green with `TMPDIR=/tmp/rasen-c`.

This is the shape of defect that gets misdiagnosed as environment flake and then "fixed" by a retry.
A bounded-path assertion at socket construction would make the failure name its own cause.

## F-L2-18 — machine-readable provenance does not record that zig was used as the host linker (Minor)

The build script classifies the host linker by **name**: because the wrapper is called `cc`, it
records `hostLinkerKind: 'cc'` rather than `'zig-cc'`
(`scripts/build-linux-process-authority.mjs:817-819`). `linker.executableSha256` is then the hash of
the 75-byte shell wrapper, **not** of zig.

So every receipt's prose says zig 0.16.0 was the host build-script linker, while the machine-readable
provenance the script emits says only "cc" and fingerprints a shell script. Anyone auditing
provenance programmatically — which is the point of emitting it — cannot tell which toolchain
actually linked the build scripts.

Also unrecorded: the `cc` wrapper's **path** feeds `environmentSha256` via `hostLinkerPath`
(`:1010-1028`, `:817`). Two verifiers with byte-identical wrappers in different directories therefore
compute different `releaseInputSha256` values. That is a legitimate input to record, but nothing warns
a reader that where they put their wrapper changes a recorded hash.

## F-L2-19 — the receipt never verifies the generated `build-authority.js`, which is the file that actually pins authority (Major)

Each build emits `dist/core/session-host/process-authority/linux/build-authority.js` containing that
build's own artifact hashes. That generated file is what pins authority identities into the shipped
program — it is the mechanism the whole build-authority premise rests on.

The Task 7.2 receipt's manifest verification checks the artifact manifest and the provider manifest,
and never checks it. Raised by the clean-room verifier as something a reader ought to know that the
receipt does not mention.

Combined with `F-L2-15`, this is the gap worth the review wave's attention: the file that carries
trust into the shipped program is neither independently reproducible nor independently verified.

### Partially closed: the generated file's internal consistency is now independently verified

The receipt's author added an appendix recording the generated file, and disclosed that it fell
outside the scope of the already-completed non-author verification. That gap has since been closed by
the LEAD — not the author — with a read-only check:

```text
dist/core/session-host/process-authority/linux/build-authority.js
  1106 bytes, mode 0644, regular file, sha256 c89028ecbe5b06d96fc1dc6adb8847987d8ebf6a25d2b3083f2db2ff23e9706c

pinned identities (2):
  …/rasen-linux-process-authority-helper         len 578440  sha256 94002604…  src 087d87a5…  mode user-pidns
  …/rasen-linux-process-authority-broker-client  len 620520  sha256 0be8aaa7…  src 087d87a5…  mode broker-pidns-cgroupv2
```

Both pinned hashes match the values a separate non-author verifier derived first-hand from the
artifacts, and both bind to the frozen source digest `087d87a5`. So the generated file is internally
consistent and correctly bound.

**This does not close the finding.** Internal consistency proves the packaging step recorded what it
built; it says nothing about whether anyone else could derive those hashes from the claimed source —
which `F-L2-15` establishes they cannot. The trust gap is derivability, and it remains open.

## F-L2-20 — "compute before you read" cannot be honoured when the answers are in the same file (process)

The Task 7.2 receipt instructs its reader: *"Do not skip ahead to the results. Do not read a recorded
value before running the step that produces it."* The recorded results are in that same file, with no
sealing mechanism. Anyone told to read the procedure has already read the answers.

The clean-room verifier disclosed this in its first paragraph rather than quietly claiming clean
ordering, and worked around it by deriving every value through a script that prints its own answer
before any comparison, with no expected value typed into a comparison. That is a sound mitigation, but
it depends on the verifier's discipline rather than on the document's structure.

**The discipline is unenforceable as designed.** The mechanical fix is to split recorded results into
a separate file the verifier opens only at the end. Recorded because every future receipt on this
change family will inherit the same flaw otherwise — and because the LEAD's own dispatch instruction
("read the document, then execute it") contradicted the receipt's instruction, which the verifier had
to notice and resolve unaided.

### The fix was then defeated by the LEAD, twice over — and this is the more useful lesson

The receipt's author subsequently split results into a separate file, so ordering became enforced by
file boundary rather than by an honour-system instruction. It worked: the clean-room verifier
confirmed the split "is the right design and it worked".

**Then the LEAD pasted the answers into the next dispatch message.** The `F-L2-15` reproducibility
verification was dispatched with the expected helper hash, the expected length and "surviving randoms:
0" written into the assignment, before the verifier had built anything. The verifier disclosed it
rather than letting the ordering claim stand:

> "Compute before reading theirs was broken — by your GO message, not by me or by them. Their file
> layout had correctly prevented that."

The contamination is inert in that specific case, because knowing a target hash cannot make a
compiler emit it — but the general lesson is not inert:

**A verification protocol enforced in the document can be destroyed by the orchestrator being helpful
in the dispatch.** A LEAD relaying "here is what they got, please confirm" converts an independent
derivation into a confirmation exercise, and does so in the one channel the document's own safeguards
cannot reach. Relay *what to check*, not *what the answer is* — and where an expected value genuinely
must be conveyed, say so explicitly so the verifier can declare the ordering claim weakened, as this
one did.

## F-L2-17 — `workload-non-escape` is undefined at the level either platform can actually achieve (Major, cross-platform, contract-level)

Raised by the Windows provider's planner while designing against the same frozen contract, and it
lands on **this** change as much as on Windows.

A kernel-enforced scope — Linux user+PID namespace, Windows Job Object — contains what the workload
creates **directly or transitively**. Neither contains a process that a privileged out-of-scope
service creates *on the workload's behalf*: on Windows via Task Scheduler, WMI `Win32_Process.Create`,
the SCM, or a DCOM launcher; **on Linux via any reachable service socket that spawns on request**.
The resulting process is parented by the service, not by the authority.

The frozen common contract lists `workload-non-escape` as an indivisible semantic **without defining
it at that level**, and this change's design does not address the proxied-creation case either.

This is not a defect introduced by either provider — it is a gap in the shared semantic that both
providers inherit, and it was invisible while only one platform had been designed. It surfaced only
when a second implementation was written against the same words.

The review wave should decide whether `workload-non-escape` is tightened (in which case the change
lands on **both** platform providers and possibly the frozen contract itself), or whether the
limitation is accepted and must be recorded as demonstrated evidence rather than described as absolute
containment. The Windows change scopes its exact-empty claim to actual Job membership and carries a
task requiring the escape be *demonstrated* on the real kernel; **this change has no equivalent
demonstration**, and adding one would break the freeze.

Flagged, not resolved. It is a Direction-level semantic question, not an implementer's call.

### DEMONSTRATED on Linux, unprivileged — the asymmetry is gone

Receipt: `evidence/f-l2-17-linux-escape-demonstration.md`. Scratch work outside the repository; the
frozen tree was read only and its digest re-verified as `087d87a5` afterwards.

From inside a namespace verified faithful to the real authority (`primary.rs:603` and
`configure_child_namespace()` at `:2072-2101` — `CLONE_NEWUSER|NEWPID|NEWNS`, `mount("/", MS_REC|MS_PRIVATE)`,
proc remount; it does **not** pivot_root and does **not** hide `/run`), an unprivileged uid-1000
workload called `StartTransientUnit` on the host `systemd --user` over `/run/user/1000/bus`. Kernel
facts, read rather than inferred:

```text
authority inner pidns   pid:[4026532340]
escapee pidns           pid:[4026532287]        <- host namespace, different
escapee cgroup          /user.slice/…/user@1000.service/app.slice/rasen-escape-capture.service
escapee PPid            376 (comm=systemd)      <- host user manager, not the guardian
```

**Consequence 1 is the severe one, and it is worse than a leaked process.** The guardian's PID-namespace
roster contains only itself. Task 5.5's oracle is "root exited **plus** `ECHILD`" — but `ECHILD` is
evaluated *in the guardian's namespace*, where the escapee was never a child. So the authority would
report **`exact-scope-empty` while the escapee is still running**: a truthful-looking terminal state
that is false. That is a lie in the one signal this entire design exists to make trustworthy.

The escapee also survives full authority teardown — guardian PID 1 killed, namespace gone, escapee
still alive in the user manager's cgroup — and recursive kill never reaches that tree. No privilege
and no inherited environment were required; it reproduces under `env -i` with the workload
reconstructing the well-known bus path from its own uid.

### The near-miss that would have produced the wrong answer

`systemd-run --user` and `busctl` — both sd-bus clients — **fail** from inside the PID namespace with
"No data available", and the PID namespace was isolated as the trigger. That looks exactly like a
kernel protection, and "Linux closes this hole" would have been the tidy, publishable answer.

It is wrong. Hand-rolled raw D-Bus from inside the full namespace connects, completes `EXTERNAL`
auth with `OK`, and gets a unique name from `Hello` — the channel is fully open through the PID
namespace, and the sd-bus failure is a **client-library artefact, not a boundary**. A first
hand-rolled `StartTransientUnit` also failed, with "connection closed" — but that was a marshalling
bug in the experiment, which presents identically to a real block, so it was not trusted either; a
known-good marshaller completed the escape.

Two separate failures that both look like "blocked", neither of which was. Recorded because the
review wave will meet the same shape: **on this boundary, "my client failed" is not evidence of a
kernel guarantee.**

### Severity

Recorded as Major to match its siblings, but the review wave and Direction should consider ranking it
higher. A contract semantic that can report `exact-scope-empty` while a workload process is alive is
Blocker-shaped in consequence, even though the remedy is a definitional decision rather than a code
fix. The LEAD is deliberately not re-ranking a contract-level finding unilaterally.

### What would and would not close it

Hiding `/run/user/<uid>` behind a minimal-root mount namespace, or running the workload as a uid with
no user manager, would close **the `systemd --user` vector**. It would **not** close `F-L2-17`: the
gap is *any reachable out-of-scope spawner* — system-bus services, socket-activated launchers,
at/cron-shaped daemons. `systemd --user` is one instance of the class.

Both platforms now have a kernel receipt and neither design addresses the class. The finding is
symmetric and the definitional question is unchanged.

## F-L2-16 — `linux_primary_contract` is flaky under parallel execution; every green in this change is serial-conditional (Major)

Measured on the frozen tree `087d87a5`:

```text
parallel, 29 tests                 2 failures / 7 runs   (~29%)
parallel, 28 tests (one removed)   3 failures / 7 runs   (~43%)
serial --test-threads=1            0 failures / 3 runs   (28s each)
single test isolated               0 failures / 5 runs   (0.8s each)
```

At least five distinct tests are affected, all failing with the identical
`Os { code: 11, kind: WouldBlock }` (EAGAIN) on control-socket operations:
`actual_root_signal_is_preserved_inside_the_closed_linux_range`,
`actual_namespace_prepare_is_inert_then_aborts_or_activates_to_exact_empty`,
`final_child_exit_orders_root_status_before_exact_empty`,
`bounded_nonblocking_stdin_cannot_freeze_output_reaping_or_terminate`,
`setpgid_orphan_keeps_scope_live_until_exact_pidfd_force`.

**Root cause: the fixed 2-second `CONTROL_TIMEOUT`** (`primary.rs:30`), applied through
`stream.set_read_timeout` (`:1040-1041`). Under parallel load the control read exceeds two seconds and
returns EAGAIN. Serial and isolated runs never approach it.

**Attribution was checked, not assumed.** Removing the test added during this wave made the flake rate
go *up* (43% vs 29%), so this wave's additions are not the cause; the flake pre-exists them.

### Consequences

1. **Every `linux_primary_contract` green in this change is conditional on serial execution** — this
   wave's receipts, the prior rounds', and the ticks resting on them. "29 passed" is not reproducible
   on demand under parallel execution. This is recorded rather than left to be discovered later.
2. **No tick is withdrawn.** Serial runs pass 3/3, isolated runs 5/5, and the failures are
   environmental read timeouts under load rather than logic failures. But the receipts are only valid
   under a stated execution condition, and the freeze marker now says so.
3. **It empirically corroborates `F-L2-03`.** The hardcoded two-second control timeout was predicted
   to be "a plausible future WSL-flake misdiagnosis"; here it is, live. Note the shape: the CLI
   `activate` path now honours the caller's budget after this wave's fix, but the *library*
   `activate()` / `control()` convenience methods still hardcode two seconds — and that is what these
   tests hit.
4. It is further evidence that `BRK-R2-B06` is aimed at the right thing, and further reason to resolve
   control-path deadline semantics as one coherent piece rather than piecemeal.

### Not remediated here, deliberately

The available fixes are to parameterise or raise `CONTROL_TIMEOUT`, or to force serial execution for
this suite. The first is control-path deadline semantics — the exact work deferred to the review wave
under `F-L2-03` and `BRK-R2-B06`. The second is a test-infrastructure decision. Doing either would
break the freeze and invalidate receipts bound to `087d87a5` that were just established. Route both to
the review wave together with `BRK-R2-B06`.

## F-L2-21 — two rows of this Change's conformance mutation snapshot are non-discriminating on Linux (Major)

Found by the Windows provider's TypeScript implementer while building against the same shared suite,
and verified independently by the LEAD.

The shared conformance suite gates two mutation rows on a fixture-reported count:

```text
test/helpers/process-authority-provider-conformance.ts:556   fixture.externalFacts().destructiveControls === 0   // identityDriftRetained
test/helpers/process-authority-provider-conformance.ts:562   fixture.externalFacts().destructiveControls === 0   // eventGapRetained
```

The Linux fixture supplies that number as an **unconditional literal**:

```text
test/helpers/linux-process-authority-provider-fixture.ts:193      destructiveControls: 0,
```

So on Linux both rows compare `0` against `0` and **cannot fail**, whatever the provider does. For
contrast, the deterministic fixture actually counts
(`test/helpers/deterministic-process-authority-provider.ts:102,106` — `destructiveControls += 1` on
identity-drift and on event-gap), which is what those rows were written to exercise.

The Windows implementation instead counts a destructive control that genuinely reaches the transport
under a mismatched identity, and proved that version discriminates with a real RED.

**Consequence for this Change:** the `identityDriftRetained` and `eventGapRetained` rows of its
conformance mutation snapshot are vacuous. They are recorded as passing and prove nothing. Nothing is
unticked over this — the underlying behaviour is separately covered by
`boot_pid_start_and_namespace_drift_never_target_a_replacement` and
`nondumpable_namespace_drift_with_broken_endpoint_never_signals_replacement`, both of which do real
work — but no summary may cite the conformance snapshot as evidence for those two properties.

Fixing it means changing the Linux fixture, which would break the freeze. Route to the review wave
with the Windows counting implementation as the reference for what it should do.

## F-L2-22 — the frozen shared conformance suite does not catch "activate skips the ledger check" (Major, shared surface)

Also found from the Windows side. A mutation that removes the ledger gate from `activate` — so
activation proceeds without the exact durable record — leaves the **shared conformance suite green**.
Only the provider's own dedicated test went RED.

The shared suite is consumed unchanged by every provider and is the artefact most likely to be cited
as cross-provider assurance. **Anyone citing it as evidence for publish-before-activate is
over-reading it.** That includes this Change: its conformance receipt does not establish that
property, and its own coverage of it must be pointed at instead.

This is `F-L2-09`'s pattern at yet another level — a shared oracle that everyone trusts, exercising
less than its name implies — and it is the third distinct instance in this wave. The review wave
should treat the shared conformance suite itself as an audit target, not as the audit's baseline.

## F-L2-15 — RESOLVED. The build is now byte-reproducible

**Fixed during this wave.** `--remap-path-prefix` is applied inside
`scripts/build-linux-process-authority.mjs` to all three private roots (source snapshot, cargo home,
target), so the embedded strings become stable logical prefixes
(`/rasen-linux-process-authority/{crate,cargo,target}`) while the roots themselves stay `mkdtemp`,
fresh, unguessable and `0700`.

Proof — two builds of frozen source `087d87a5` into roots of deliberately **different name lengths**,
because the old defect was sensitive to path content while length alone was not, so equal-length
roots would have under-tested it:

```text
/home/sayo/.local/share/rasen-build/repro-a
/home/sayo/.local/share/rasen-build/repro-b-with-a-much-longer-root-name

helper sha256   4835b1bbb54be9c7c186a75ad2ee4c190316f0c402f911cf87132245c8eac309   (both, byte-identical)
surviving mkdtemp random suffixes in the artifact: 0
```

**Keep these two lines separate when citing this.** The byte-identical hash across roots of different
name lengths is the **load-bearing oracle** — a direct empirical result that stands alone. The
`strings` sweep is **corroboration for *why* it matches**, not the test for *whether* it matches. If
the review wave disputes the sweep's method (a path could in principle be embedded in a form
`strings` does not surface), the reproducibility claim is unaffected.

The converse caution matters more: **if the Linux artifact ever drifts again, do not assume the path
remap is the culprit.** ELF has non-path nondeterminism sources of its own, and the Windows sibling is
the standing reminder that the obvious cause was not the actual one — there, a deterministic snapshot
directory made the snapshot path identical across two builds and the artifacts *still* differed,
because the real cause was entirely link-time.

Three design choices worth preserving, each of which refused an easier option:

- **Remapping rather than deterministic directory names.** Deterministic names would have
  reintroduced exactly the collision and TOCTOU risk the `mkdtemp` roots exist to prevent, in a repo
  that demonstrably runs concurrent builds. The isolation constraint was honoured, not traded for the
  fix.
- **Set via `CARGO_ENCODED_RUSTFLAGS` inside the script.** `rejectBuildEnvironmentOverrides()` is
  untouched and still refuses caller-supplied `RUSTFLAGS`/`CARGO_ENCODED_RUSTFLAGS`. The encoded form
  was chosen over `RUSTFLAGS` because it is separator-delimited and therefore safe for private roots
  containing spaces — a real case under a Windows `TEMP`.
- **`hostLinkerPath` was deliberately NOT remapped**, so `releaseInputSha256` still varies with where
  the host linker wrapper lives. Provenance should record which linker actually ran; remapping it
  would have traded a real fact for a cosmetic match. Carved out explicitly in the receipt's
  expectations rather than silently absorbed.

The freeze was not touched: `scripts/` is outside `sourceDigest()`, and `087d87a5` was verified
unchanged before and after.

The previously recorded `94002604…` at 578440 bytes **will not reproduce**. That is expected, not a
regression; the new artifact is `4835b1bb…` at 578312, smaller because the logical prefixes are
shorter than the real absolute paths. Behavioural non-regression was checked rather than asserted:
manifest field checks pass, the same-kernel frame is unchanged at status 70 / code 9, and the three
actual-kernel product oracles were re-run green against the reproducible helper.

**Consequence for `F-L2-19`:** that finding is now narrower. The hashes `build-authority.js` pins are
derivable at last, so the residual gap is only that the receipt still does not verify the generated
file itself.

The original finding follows, retained because the diagnosis and the controlled experiment behind it
are the reason the fix was possible.

## F-L2-15 (original) — the Linux helper build was not byte-reproducible (Major)

Two builds from the **identical frozen source** `087d87a5`, identical pinned toolchain, same machine,
same route, minutes apart:

```text
build A  eaab7324…  503624 bytes
build B  d728b105…  503624 bytes
2643 bytes differ
```

Mechanism, demonstrated rather than argued. `build-linux-process-authority.mjs:875-877` copies the
crate into an `fs.mkdtempSync(..., 'rasen-linux-authority-source-snapshot-')` directory, and rustc
embeds that absolute path in panic metadata. `strings` on the two binaries:

```text
build A   rasen-linux-authority-source-snapshot-7st3lN
build B   rasen-linux-authority-source-snapshot-e5oPQb
```

`mkdtemp` always appends exactly six characters, which is why the **length is stable while the
content is not** — the same coincidence trap as `F-L2-14`, from a different cause.

### Independently reproduced and sharpened by a clean-room verifier

A verifier with no prior exposure to this change rediscovered this from first principles and then ran
a controlled experiment across five builds. The result is materially better than the finding as first
written, and **the non-determinism is far narrower than "the build is not reproducible" suggests**:

```text
build root          temp-root name len   length   sha256
cleanroom-v1        16                   578440   db18ca65…
cleanroom-v2        16                   578440   a4538c6e…
cleanroom-v1xy      18                   578440   a01ce890…
cleanroom-v1xyxy    20                   578440   3b90874d…
track-b-pkg-r4      18                   578440   94002604…
```

- Two builds at **identical path lengths** differ by **exactly 14 bytes** — one character at each of
  two path occurrences, plus the two 6-character `mkdtemp` suffixes. Everything else is bit-identical.
- A build whose temp-root name length was deliberately matched to the receipt's differs from it by
  **exactly 40 bytes**, all inside those same two path strings.
- Builds at *different* path lengths differ by ~30k bytes, because the length shift moves merged
  `.rodata` string layout and cascades into `.text` immediates and `.rela.dyn` addends. Section header
  tables stay byte-identical throughout.

So the build is **bit-for-bit deterministic given a fixed build path**. The non-determinism is
localised entirely to two embedded absolute paths: the `mkdtemp` source snapshot directory and the
`mkdtemp` private cargo home. In the verifier's words, that converts *"not reproducible"* into
*"one line away from reproducible"* — `--remap-path-prefix` or a fixed snapshot directory name would
eliminate it. This is the actionable form of the finding and should drive the remediation.

### Correction to this finding's own first draft

An earlier version of this entry said `build-authority.ts` "pins a `sha256` per artifact". **That is
wrong**, and the clean-room verifier caught it. `src/core/session-host/process-authority/linux/build-authority.ts`
declares the *interface* and states the intent, but its
`LINUX_PROCESS_AUTHORITY_BUILD_IDENTITIES` is `Object.freeze([])` — it pins nothing. The actual pinned
hashes exist only in the **generated** `dist/core/session-host/process-authority/linux/build-authority.js`,
which each build emits containing its own hashes. A reader following the original wording finds an
empty array.

Consequences, in severity order:

1. **No shipped Linux artifact can be verified by rebuilding it.** The generated
   `build-authority.js` pins a `sha256` per artifact, and the source file's comment says build-pinned
   authority is "compiled into the shipped program, never loaded from the mutable helper/manifest
   package tree". That pinned hash can therefore only ever come from the single build that ships.
   Nobody — reviewer, auditor, or downstream consumer — can confirm it corresponds to the claimed
   source. This is a real gap in the artifact-resolver's whole build-authority premise, not only in
   `PKG-P5`.
2. **Any "rebuild and compare" check written in future will fail spuriously**, and the tempting fix is
   to relax the check until it agrees — which would silently destroy the guarantee it was written for.
3. It retroactively explains a cross-worker discrepancy: one worker's gnu artifact was 16 bytes under
   another's, exactly consistent with a build-root path 16 characters shorter, not with a different
   target as first supposed.

**Not remediated here, deliberately.** The standard fixes are a deterministic snapshot directory name
or `--remap-path-prefix`. Neither can be applied from outside: `rejectBuildEnvironmentOverrides()`
(`:731-753`) forbids `RUSTFLAGS`, `CARGO_ENCODED_RUSTFLAGS`, `CARGO_BUILD_RUSTFLAGS`,
`CARGO_TARGET_DIR` and `CARGO_TARGET_*_{LINKER,RUNNER,RUSTFLAGS}`. Changing the build script is a
packaging product decision and this wave is frozen. It is emphatically not to be "fixed" by adjusting
an expectation until hashes agree.

Consequence for the Task 7.2 receipt: it binds source digest, compiler, ELF shape, manifest
self-consistency, same-kernel behaviour, and the artifact hash **of that specific invocation** — and
must explicitly disclaim reproducibility rather than imply it.

## F-L2-14 — equal artifact length across a source change is not evidence of an unchanged binary

Measured on this crate across three source digests:

```text
source a568f53b  musl helper  578440 bytes  sha256 05bd7866…
source 087d87a5  musl helper  578440 bytes  sha256 94002604…      <- same length, different bytes
source 137402cb  musl helper  578472 bytes
```

The `a568f53b` and `087d87a5` helpers are **byte-for-byte different builds of exactly the same
length**. Anyone comparing artifact sizes across freeze rounds to decide whether the binary changed
will draw the wrong conclusion. Only the hash carries that information.

Same trap shape as the `29 -> 29` count and, like it, recorded because it is the kind of coincidence
a reviewer would reasonably treat as signal.

Related caution when cross-checking artifacts between workers: a raw cargo output named
`rasen-linux-process-authority` at ~503k is a **gnu** build, while the packaged musl helper is ~578k.
Comparing one against the other is apples-to-oranges and would manufacture a false discrepancy.

## F-L2-13 — on this codebase, an unmutated guard test should be assumed non-discriminating (process)

Not a code defect; a calibration finding for the review wave, supported by four independent instances
in a single implementation wave:

1. `guardian_forced_death_proves_teardown_without_fabricating_root_status` named a behaviour it never
   reached — the helper died at argv validation and the test passed anyway.
2. A worker's first `--deadline-ms` guard test asserted only `!status.success()` and `kind == Failure`
   and **passed against the reverted product**, because a cross-process `activate` always fails on the
   one-use capability; only the failure *code* discriminates.
3. A worker's first mutation assertion for the `write_control_command` fix used
   `writeln!(file, "4242")` — a bare literal with no format argument, which `write_fmt` emits as a
   single write and which therefore does **not** reproduce the defect. The mutation went red on its
   author.
4. `recursive_workload_fixture` had an unconditionally empty body and zero callers.

In every case the defect was invisible until someone mutated the thing the test claimed to guard.
Three of the four were caught only because a worker chose to mutate rather than accept green.

Recommendation for the review wave: treat "was this oracle shown to fail against a broken product?"
as a required question per significant assertion, not as an optional extra. Green is not evidence
here; the RED/GREEN pair is.

### A second required question, from a shape the first one does not catch

Two later instances were **not** vacuous assertions. They were tests that discriminated perfectly
well — against the wrong variable:

5. A mutation harness printed RED while its captured output was `spawnSync npx.cmd EINVAL` — a spawn
   failure, not a test failure. Seventeen receipts would have been banked as fabricated had the author
   not printed the captured output. **A false RED is worse than a false GREEN**, because it
   manufactures confidence in the very check used to detect manufactured confidence.
6. A reproducibility proof built twice into two different **output** roots — but the build compiles
   from a snapshot directory named deterministically from the source digest, so the output root never
   touches compilation. The test **would have passed identically against a completely unfixed build**.
   The discriminating test relocates the *temp* root, which moves snapshot, cargo home and target
   together. Caught by its own author, who wrote: *"that test proved almost nothing."*

Neither is caught by asking "was this shown to fail against a broken product?" — instance 5 *did*
appear to fail, and instance 6 *would* have failed if the right thing had varied. So the review wave
needs a second question alongside the first:

> **Did this test vary the variable that actually matters, and is its RED a real assertion failure
> rather than an infrastructure failure?**

"We built twice and it matched" and "the mutation went red" are both sentences that hide a defect.
Read the captured output, and check what was actually varied.

### The operative question, in the form that actually found these

Both questions above are checklist items. The worker who caught the last two instances stated the
underlying move more usefully, and this is the version to carry forward:

> Three separate times a green result meant nothing: the mutation harness reporting RED on a spawn
> failure, the guard whose two code paths gave the same answer, and the reproducibility test that
> varied the wrong variable. **None of the three was caught by a test. Each was caught by asking what
> the passing result would look like if the thing being tested were broken** — and in every case the
> answer was "exactly like this". That question is cheap and it found more than the suites did.

*"What would this passing result look like if the thing under test were broken?"* — asked of each
significant receipt, not of the code. Where the answer is "the same", the receipt is not evidence,
however green it is and however specific its assertion looks.

That question, asked routinely, is what this wave has instead of trust in its own test counts.

**Deliberate count discrepancy with `section-9-broker-gate-run-lead2.md`.** That file records the
same pattern as `D6` and states **two** instances, not four. This is intentional and neither file is
wrong. Its author recorded only the two they verified first-hand — their own bare-literal mutation
assertion and the `--deadline-ms` guard — and declined to include the `guardian_forced_death`
argv-validation death and the empty `recursive_workload_fixture`, which they knew only by relay from
the LEAD. Relaying an unchecked count into an evidence file is the exact failure mode this change
keeps tripping over, so the narrower first-hand number was the correct choice there.

**This file is the authoritative count at four.** A reviewer who notices the discrepancy should read
it as two records with different evidentiary standards, not as a contradiction.

The count matters to the conclusion: two instances could be coincidence; four inside a single
implementation wave is a property of how this codebase is tested.

## Resolved during this wave — recorded so the review wave does not re-open them

- **`recursive_workload_fixture` had an unconditionally empty body.** Investigated as a possible
  vacuous prop under already-ticked tasks. It had **zero callers** repo-wide. Ticked 7.4 rests on
  `setpgid_orphan_keeps_scope_live_until_exact_pidfd_force` and `setpgid_resistant_descendant_fixture`;
  ticked 5.3 rests on the barrier-based nested-PID-namespace test at
  `tests/linux_primary_contract.rs:556-616`. **No tick was affected.** The fixture was deleted and its
  one real insight relocated to the real test site: `unshare(CLONE_NEWUSER)` returns EINVAL from the
  Rust harness even at `--test-threads=1`, because the harness always carries a second thread, so
  routing through `/usr/bin/unshare` is correct rather than a workaround.
- **The historical `pinnedall`/`pinnedement` `broker_cgroup` test failure does not reproduce.** The
  report was stale; the test passes and was proven non-vacuous by mutating `openat_file` to resolve
  by name through the parent, which turns it RED.
- **The historical `cargo fmt --all --check` failure does not reproduce.** Zero files need
  reformatting. The likely original cause is that there is no workspace `Cargo.toml` at the repo
  root, so `cargo fmt` must be run from the crate directory or with `--manifest-path`.
- **A test that named a behaviour it never exercised.**
  `guardian_forced_death_proves_teardown_without_fabricating_root_status` passed argv missing
  `--deadline-ms`, so the helper exited at argument validation (code 70, frame
  `525041310001ff0000000003000109` = `StateRetained`) and never reached guardian-death
  classification. Fixed by correcting the argv; no assertion was weakened, added or removed. Proven
  load-bearing afterwards by mutating `kernel_exact_empty_evidence` to fabricate a `RootExited`,
  which now fails with `helper fabricated a root result after guardian death`.

## Method failures by the LEAD, recorded deliberately

Two wrong environment verdicts were issued for the Section 9 gate, in opposite directions, both by
generalising from a narrow probe. The first concluded "unavailable" from `sudo -n true` failing,
without enumerating privilege entry points — WSL grants passwordless root via `wsl.exe -u root`. The
second concluded "available" from a root probe of the cgroup interface, by validating against
`design.md` prose instead of the broker's own fail-closed startup probe, which demands things the
design text never mentions. The second error nearly authorised installing a privileged root broker
and a systemd unit on the operator's daily machine to buy a receipt for a gate that provably cannot
complete.

Separately, a LEAD recomputation of `sourceDigest()` disagreed with both workers because it omitted
the trailing `hash.update('\0')` after each file's contents
(`scripts/build-linux-process-authority.mjs:115`). The workers were right.

Recorded because the review wave should weight LEAD-authored environment and accounting claims
accordingly, and because the corrective in each case was the same: read the consuming code, and
enumerate the alternatives, before declaring a verdict.
