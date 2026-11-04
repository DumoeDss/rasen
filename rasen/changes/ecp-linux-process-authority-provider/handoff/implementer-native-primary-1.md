# Implementer handoff: native Linux primary authority 1

Date: 2026-08-05

## Resume point

Continue from the shared isolated worktree
`OpenSpec-code-wt-ecp-shared-bounded-loop-lifecycle`, branch
`wip/ecp-shared-bounded-loop-lifecycle-resume`. This work unit intentionally did not commit,
ship, archive, edit tasks, or touch other agents' dirty files.

The new crate is `native/linux-process-authority`. Generated Cargo output exists beneath its
crate-local `target/` and is excluded by `native/linux-process-authority/.gitignore`; do not
run a broad clean or add that output.

## Native/TypeScript seam decision

The LEAD resolved generation/capability ownership while this unit was active:

- native `scope_id[16]` **is** the provider/common reference generation;
- there is no second independent generation field on the native wire;
- native creates both `scope_capability[32]` and `control_capability[32]` independently;
- the guardian validates both capabilities and its complete identity on every operation;
- TypeScript must consume and persist those returned bytes verbatim. It must not generate,
  replace, synthesize or merely echo either capability;
- native computes the launch digest and the SHA-256 of the exact running `/proc/self/exe`;
  it compares the latter with the adapter/resolver's expected adjacent artifact SHA;
- the source SHA remains a distinct expected provenance input. Native requires it to be
  nonzero and different from the artifact SHA and returns it verbatim; the source tree /
  artifact-manifest verifier remains the later resolver/build work unit;
- TypeScript verifies preparation operation id, launch digest, helper protocol, artifact
  SHA, source SHA and returned identity, then persists the complete native reference.

This differs from the earlier TS seam that sent generation/scope/control capabilities in
Prepare. The TS implementer acknowledged the native-owned decision and is adapting the
transport.

## Exact wire contracts

All integers are big-endian. Every frame uses:

```text
RPA1[4] | protocolVersion:u16 (=1) | frameKind:u8 | reserved:u8 (=0) |
payloadLength:u32 (<=2 MiB) | payload
```

Closed frame kinds are Prepare/OpenRuntime/Activate/Inspect/Abort/Terminate/Input/
CloseInput and Prepared/RuntimeReady/Activated/Observation/Output/ErrorOutput/Event/
ExactScopeEmpty/Failure. Unknown kind, version, reserved byte, bound, truncation or trailing
payload is rejected.

PreparedAttestation/provider-reference v1 payload order:

```text
providerReferenceVersion:u16 (=1)
helperProtocolVersion:u16 (=1)
scopeId:16                       # provider/common generation
scopeCapability:32              # native random
controlCapability:32            # native random, must differ
preparationOperationId:u16-len + utf8 (1..256)
launchDigest:32                  # native canonical RPL1 SHA-256
artifactDigest:32                # native /proc/self/exe SHA-256
sourceDigest:32                  # distinct expected source SHA-256
bootId:u16-len + ascii hex/dash
outerGuardianPid:u32
guardianStartTicks:u64
pidNamespaceDevice:u64
pidNamespaceInode:u64
```

The payload contains no executable, cwd, runtime directory, socket or caller-selected PID.
The adapter derives `scope-<lowercase scopeId hex>/control.sock` only beneath its configured,
revalidated trusted runtime root.

ControlRequest v1 payload order:

```text
providerReferenceVersion:u16 (=1)
scopeCapability:32
controlCapability:32
complete AuthorityIdentity (same encoding as above)
operationTag:u8 [ + graceMs:u32 for Terminate ]
```

PrepareRequest v1 contains operation id, trusted runtime root and the immutable launch
(absolute executable, absolute cwd, bounded ordered args and lexically sorted env). Native
re-decodes the payload, requires canonical regular executable/cwd filesystem objects, never
uses PATH or a shell, and hashes the canonical `RPL1` launch encoding.

`RPJ1` journal v1 is `magic[4] + version:u16 + count:u16 + 16-byte events`. Events are
Prepared(1), Activated(2), RootExited(3 exact code XOR signal) and ExactScopeEmpty(4), with
sequence exactly 1..N. RootExited and ExactScopeEmpty are two separate atomic/fsynced
records; empty follows only a PID1 `ECHILD` proof. There is deliberately no Published event
or PUBLISH operation.

Failure is not free text. Its exact three-byte payload is protocolVersion u16 + code u8:

| u8 | TS diagnosticCode |
| ---: | --- |
| 1 | `native-unavailable` |
| 2 | `native-uncertain` |
| 3 | `identity-drift` |
| 4 | `event-gap` |
| 5 | `native-operation-timeout` |
| 6 | `native-transport-lost` |
| 7 | `reference-invalid` |
| 8 | `artifact-unavailable` |
| 9 | `native-state-retained` |

## Helper invocation seam

The additive binary is `rasen-linux-process-authority`. It does not search PATH, download,
compile at runtime, launch a shell, or fall back to the legacy helper.

```text
prepare --artifact-sha256 <64 lowercase hex> --source-sha256 <64 lowercase hex>
open-runtime --runtime-root <trusted absolute root>
activate --runtime-root <trusted absolute root>
inspect --runtime-root <trusted absolute root>
abort --runtime-root <trusted absolute root> --timeout-ms <u32>
terminate --runtime-root <trusted absolute root> --grace-ms <u32>
```

Every invocation accepts exactly one first stdin RPA1 frame whose kind matches the command.
Prepare carries PrepareRequest; every other command carries PreparedAttestation. The
attestation/capabilities never appear in argv or env. `open-runtime` returns RuntimeReady and
then remains as a byte-exact duplex RPA1 proxy; Input/CloseInput flow inward and Output/
ErrorOutput/Event/ExactScopeEmpty flow outward. Other commands emit one closed response or
one closed Failure.

## Native lifecycle and authority proof

Prepare binds the private socket before clone, creates user/PID/mount namespaces in one
bounded construction, writes `setgroups=deny` plus `0 <caller-id> 1` maps, makes `/`
recursively private, mounts a new proc view, redirects guardian stdio, closes every
unintended descriptor with `close_range`, and verifies the child sees itself as PID 1.

The parent obtains boot/PID/start/pidns identity, opens the pidfd and namespace fd, rereads
the complete tuple, probes pidfd signal-0/poll, then sends the identity through a private
bootstrap pipe. That internal payload has its own closed `RBI1` + reference-version codec;
it does not fabricate or relax a PreparedAttestation. The guardian verifies the inside view
and only then returns readiness. Any
failure kills/reaps the exact partially constructed namespace init and removes its new scope
directory. Workload code cannot run before a successful later Activate because the root
does not exist during Prepare and a separate child-side exec gate remains closed until the
Activated response.

The guardian is namespace PID 1. It reaps with `waitpid(-1, WNOHANG)` and uses `ECHILD`, not
PID-tree or `/proc` descendant enumeration. Terminate gracefully signals only the still-live
root PID from within the namespace; after the grace bound, the controller signals only the
revalidated guardian pidfd. Linux namespace-init teardown supplies recursive force
containment. Abort never opens activation and acts only on the exact revalidated guardian.

## Files created

```text
native/linux-process-authority/.gitignore
native/linux-process-authority/Cargo.toml
native/linux-process-authority/Cargo.lock
native/linux-process-authority/THIRD_PARTY.md
native/linux-process-authority/src/{lib,main,protocol,authority,runtime,lifecycle,journal,linux,primary}.rs
native/linux-process-authority/tests/{protocol_contract,authority_contract,lifecycle_contract,
  linux_runtime_contract,linux_journal_contract,linux_identity_contract,
  linux_primary_contract}.rs
native/linux-process-authority/tests/support/mod.rs
rasen/changes/ecp-linux-process-authority-provider/evidence/implementation-native-primary-1.md
rasen/changes/ecp-linux-process-authority-provider/handoff/implementer-native-primary-1.md
```

## Verification and remaining gates

Completed here:

- stable rustfmt 1.8.0 format/check: pass;
- pinned Rust 1.88 locked Windows host tests: 14/14 pass;
- pinned Rust 1.88 locked Linux x64 all-target check: pass, no warnings;
- all 23 Linux tests compile, including the non-ignored actual-kernel composite oracle;
- locked metadata/license accounting and crate-local target exclusion: pass.

Not completed here:

- full actual WSL execution of the 23 Linux tests. The first musl run passed four preceding
  test binaries and the standalone recursive fixture, then exposed the now-fixed bootstrap
  codec bug on the first real Prepare. The second native-in-WSL locked Cargo run used
  isolated Zig 0.16 + Rust 1.88, reached the runtime tests after 18 passes, and exposed a
  positive fixture's dependence on an ambient long `TMPDIR`; all filesystem fixtures now
  use atomically-created, verified 0700 short `/tmp/rpa-*` roots while the explicit
  >100-byte negative rejection remains. An identical rebuilt serial rerun is pending;
- pinned-1.88 rustfmt (the active Windows minimal toolchain lacks rustfmt; no installation was
  authorized);
- WSL musl static-PIE crate build, exact artifact length/SHA/source manifest and runtime
  helper CLI receipt;
- broker binary, Ed25519, installed broker/cgroup path;
- TypeScript adapter/ledger/common conformance, build/package/release/default wiring;
- publication tombstone/idempotence for a controller-forced guardian death. A live operation
  has exact held-pidfd kernel teardown proof, but a killed guardian cannot author the normal
  root-status journal terminal; the common publication/tombstone work unit must persist that
  proof rather than inventing a root wait status;
- general supported-kernel/distribution or ECP-8 claims.

Rerun the rebuilt actual WSL suite serially before closing Linux behavior. The strongest
single test is
`actual_namespace_prepare_is_inert_then_aborts_or_activates_to_exact_empty`; it includes
wrong artifact, both capability mismatches, identity drift, nested PID namespace, `setsid`,
root/empty distinction, activation replay, abort, terminate and terminal recovery.

## Superseding review-fix resume update — 2026-08-06

The round-1 independent review's 3 Blocker and 4 Major native-primary findings have now been
implemented and exercised. Read
`../evidence/review-fix-native-primary-round-1.md` as the authoritative continuation of this
handoff; the earlier pending-rerun text above is retained as historical state, not current status.

Current native-primary behavior additionally provides:

- a workload-inaccessible runtime overmount, nondumpable guardian, zero workload capabilities,
  server-first keyed challenge, and scope/launch/identity-bound durable journal/terminal records;
- pidfd-completion and same-boot-absence owner-death recovery without invented root status;
- exact `/proc/self/fd` allowlist fallback for `close_range` `ENOSYS`;
- bounded nonblocking stdin integrated into the guardian poll/reap/control loop;
- prepare-time executable/cwd descriptor pinning with pre-release identity validation, `fchdir`,
  and `execveat(AT_EMPTY_PATH)`;
- abort exit commitment before best-effort response delivery; and
- closed Linux exit-code `0..=255` and signal `1..=64` recovery validation.

Finding-specific actual WSL mutations now include `/proc/net/unix` discovery plus control/journal
attack attempts, forged-server zero-byte pre-auth proof, seccomp-forced `close_range` `ENOSYS` with
fd 4096 above lowered `RLIMIT_NOFILE`, guardian `SIGKILL` plus unrelated-process survival,
non-reading stdin with full stdout/stderr and independent termination, executable/cwd inode
replacement, abort read-half closure, actual signal exit, explicit resistant `setpgid` orphan,
nested user/PID namespace, and boot/start/PID-namespace/PID-replacement drift.

Final receipts:

- WSL pinned Rust/rustfmt 1.88.0 whole-crate fmt check: pass;
- Windows pinned locked host suite: 40 passed, 0 failed;
- pinned Linux x64 locked all-target check: pass, no warnings;
- 17 current static-musl test ELFs executed serially on WSL kernel
  `5.15.167.4-microsoft-standard-WSL2`: 66 passed, 0 failed, 0 ignored;
- focused current primary: 16/16; identity: 3/3.

Final hashes after the test-only coverage addition:

```text
native/linux-process-authority/src/primary.rs
  8a319ecfe1bfbeadfa8d1c72d4a9324c94a1c7b351706fbd42d1b8b04bb4ee9b
native/linux-process-authority/tests/linux_primary_contract.rs
  2db2675db1ccec9e31345e71e5ea05f9efe808a3fc5aa53273b11b0dd960bc81
native/linux-process-authority/tests/linux_identity_contract.rs
  6ef955aa209cc2c8c87f65f3f14602c0871a06ac5507d5c4389ae02c425fd345
```

Still open and not claimed here: TypeScript publication crash windows as an actual WSL gate,
artifact manifest/export and authenticated package/install, real broker/cgroup-v2 Section 9,
general distribution support, closure/default integration, ECP-8, ship, and archive. Tasks and
run-state remain untouched.
