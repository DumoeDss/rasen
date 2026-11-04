# Implementer handoff — native primary round 2

Date: 2026-08-06

## Outcome

Native-primary round-2 findings `NATIVE-B003`, `NATIVE-B004`, and `NATIVE-M005` are implemented and
verified. No commit was created. `tasks.md` remains unchanged at 42/93.

Production files changed:

```text
native/linux-process-authority/src/lifecycle.rs
native/linux-process-authority/src/linux.rs
native/linux-process-authority/src/main.rs
native/linux-process-authority/src/primary.rs
native/linux-process-authority/src/protocol.rs
```

Native tests changed:

```text
native/linux-process-authority/tests/lifecycle_contract.rs
native/linux-process-authority/tests/linux_identity_contract.rs
native/linux-process-authority/tests/linux_primary_contract.rs
native/linux-process-authority/tests/protocol_contract.rs
```

Evidence is in `evidence/review-fix-native-primary-round-2.md`.

## Locked decisions

### Inspection result after guardian loss

The production helper must return exact empty as success even when the root result is unavailable.
The compatible representation is `ExactScopeEmpty (0x88)` plus a valid `RPJ1` journal ending in
`Prepared -> Activated -> ExactScopeEmpty`. The absence of `RootExited` is the explicit event-gap
fact. Do not collapse this result back to a failure frame or add trailing payload bytes that the
current TypeScript consumer rejects.

`AuthorityInspection::KernelExactEmptyRootResultLost` is the native closed result carrying that
journal. `inspect()` still returns exact empty; `inspect_events()` still reports event-gap because it
cannot return an exact root result.

### Namespace proof and destructive authority

Boot/PID/start generation proof alone never authorizes pidfd signalling when `/proc/<pid>/ns/pid`
is inaccessible. `ReopenedAuthority` deliberately retains a generation-only state. It can become
signal-authorized only through:

1. direct kernel namespace device/inode verification; or
2. successful server-first HMAC authentication by the exact guardian, binding the full identity.

Keep the authentication upgrade crate-private and immediately after challenge verification. An
endpoint/connect/challenge/request failure before authentication must leave authority retained and
must not signal.

### Pinned launch

Direct executable identity is an `O_PATH` fd. Interpreter scripts additionally retain a readable
script fd and a separately canonicalized `O_PATH` interpreter fd. Activation revalidates every
pinned object, executes the interpreter fd directly, and passes the script only through
`/proc/self/fd/<fd>`. The script descriptor is the only launch descriptor whose close-on-exec bit is
cleared.

No PATH lookup, `/bin/sh` fallback, pathname reopen at activation, or recursive interpreter is
allowed. `/usr/bin/env` shebang selection is rejected because it delegates interpreter identity to
PATH.

## Eliminated hypotheses and rejected alternatives

- **Forced guardian death is transport loss only:** false. Pidfd completion proves exact namespace
  teardown independently of the lost root result.
- **A new frame kind or journal suffix is harmless:** false. The current TypeScript assembly accepts
  only the frozen frame kinds and exact `RPJ1` length.
- **`EACCES` namespace reopen is safe because PID namespaces are immutable:** incomplete. Immutability
  helps only after the pidfd is tied to the authenticated full identity; otherwise an attacker can
  substitute a nondumpable generation and trigger fallback signalling.
- **Fail every nondumpable reopen immediately:** rejected. It would make the deliberately
  nondumpable authentic guardian uncontrollable. Generation-only observation plus server-first
  upgrade preserves control without optimistic signalling.
- **Signal 0 proves complete identity:** false. It proves only that the pidfd target exists and says
  nothing about the expected namespace device/inode.
- **Execute scripts through the original `O_RDONLY|O_CLOEXEC` fd:** false on Linux; interpreter
  scripts fail `execveat(AT_EMPTY_PATH)` with `ENOENT`.
- **Retry scripts through a shell or PATH:** rejected because it changes executable identity and
  violates the frozen no-lookup contract.
- **Reopen script/interpreter paths at activation:** rejected because path replacement would select
  attacker-controlled objects after prepare.

## Verification state

- GNU WSL locked serial full crate: 85/85 GREEN.
- Static-musl WSL serial matrix: 18 ELFs, 85/85 GREEN.
- Primary 21/21, identity 3/3, lifecycle 5/5, protocol 5/5.
- Windows pinned locked host suite: 52/52 GREEN.
- Linux GNU all-target check: GREEN, no warnings.
- Task-owned and final whole-crate pinned rustfmt: GREEN.

The shared worktree contained concurrent broker changes throughout this pass. A crate-wide rustfmt
command mechanically touched three untracked broker files before the overlap was noticed; there was
no semantic broker edit. After the independent broker work settled, the final whole-crate fmt check
was GREEN. Keep ownership boundaries explicit if those files move again during review.

## Next review focus

Review the three exact seams rather than re-reviewing unrelated broker/TypeScript work:

1. helper forced-death payload remains TypeScript-compatible while retaining root-result loss;
2. every pidfd signal path is dominated by kernel or challenge-authenticated namespace proof;
3. script/interpreter/cwd identities remain descriptor-pinned through the gated activation exec.
