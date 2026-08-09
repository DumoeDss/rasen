# Native Linux broker review-fix evidence — round 1

Date: 2026-08-06
Role: original broker implementer / fixer; this report is implementation evidence, not independent closure
Source review: `review-report-native-broker-round-1.md` (`BRK-B01` through `BRK-B07`, `BRK-M01`)

## Disposition

All eight round-1 source findings now have focused regression evidence and are ready for a fresh non-author delta review. This report does **not** claim Section 9, a root-installed broker pass, or terminal Linux support. The available WSL kernel still lacks the authorized writable unified cgroup-v2 service environment required for those gates.

## Finding-by-finding fix map

### BRK-B01 — production lifecycle routing

- Added the installed `rasen-linux-process-authority-broker-client` binary and Cargo target. It validates its pinned adjacent artifact digest, authenticates the root broker through the root-owned public-key manifest, binds the authenticated peer request, and routes prepare, publication, activate, open-runtime, inspect, abort, and terminate.
- Added the exact bounded `BrokerPreparePayload`, `GuardianClientReference`, and `BrokerClientReference` codecs. The request capability is SHA-256 over the domain separator plus the exact guardian reference; it is independent of the lease token without changing the frozen TypeScript private-reference schema.
- Added `PrimaryGuardianAuthority`: the broker forks a caller-mapped worker, closes inherited descriptors, applies exact supplementary group/gid/uid state, clears ambient environment, constructs the primary guardian, and returns only the bounded reference. The durable lease install identity remains the daemon digest; the attestation artifact/source fields are rewritten to the pinned client artifact/source expected by the selected provider.
- The daemon now constructs one production `BrokerServiceCore`, routes every non-runtime request through `handle`, routes runtime through `open_runtime`, encodes every response, and proxies the byte-exact runtime duplex.
- Added TypeScript `createLinuxBrokerNativeAssembly`, exact `BCR1`/`BGR1` codecs, broker-reference control frames, pinned broker-client artifact resolution, runtime bridging, and production bundle selection.
- Added codec drift tests, production route/caller-mapping source contract tests, and a service journey that durably orders exact signal root exit, natural exact empty, cleanup tombstone, and duplicate replay.

### BRK-B02 — durable failed-prepare recovery

- Preparation now writes a bounded provisional recovery intent before authority can become unprovably live, advances it through guardian and leaf phases, and removes it only after the committed lease exists or exact cleanup is proven.
- Ambiguous guardian/cgroup cleanup retains the recovery record and causes startup/prepare to fail closed. A fresh `BrokerServiceCore` reconciliation test proves the retained record survives and is removed only after the same authority is proven empty.

### BRK-B03 — crash-safe exact-empty replay

- `ExactScopeEmpty` and `CleanupComplete` are separate durable phases. Startup handles crashes before terminal fsync, after terminal fsync, and after leaf removal without requiring a live pathname first.
- `CleanupComplete` remains an authenticated idempotent tombstone, so duplicate abort/terminate/inspect after acknowledgement loss returns exact empty.
- Added bounded tombstone pruning: the store retains at most 1,024 cleanup tombstones, prunes only unchanged `CleanupComplete + ExactEmpty` records by oldest file time with token tie-break, fsyncs the directory, and rejects zero/unbounded retention.

### BRK-B04 — fd-pinned cgroup control

- Linux destructive operations pin the leaf directory fd, compare `fstat` identity, open controls relative to that fd with no-follow behavior, write through the already-open control fd, serialize per lease, and revalidate the pinned handle.
- The actual Linux replacement oracle swaps the pathname and proves the pinned operation never writes to the replacement.

### BRK-B05 — privileged installer input trust

- `install.sh` pins `/usr/sbin:/usr/bin:/sbin:/bin`, requires absolute root-owned non-group/other-writable staging files and ancestors, snapshots source device/inode/size plus SHA-256, verifies identity/digest before and after copy, verifies the staged destination digest, then atomically replaces the fixed target.
- Ambient PATH, user-owned source trees, symlinks, writable ancestors, source identity drift, source digest drift, and staged-byte drift now fail before installation.

### BRK-B06 — uninstall stop/race proof

- `uninstall.sh` no longer ignores `systemctl stop` failure. It proves inactive state, acquires the same root-owned `broker.lock`, proves `MainPID=0`, and holds the singleton through lease/cgroup validation and asset removal.
- A stop, active-state, PID, lock, lease, cgroup, ownership, or shape failure leaves recovery assets unchanged. The lock is removed only after service identity, binary, and key recovery assets are gone.

### BRK-B07 — restart after stale pathname socket

- The daemon opens `broker.lock` with `O_NOFOLLOW|O_CLOEXEC`, takes nonblocking exclusive `flock`, and never replaces an endpoint while another singleton or listener is live.
- With the lock held, it validates an existing socket's exact root/group/mode policy, attempts a connection, and removes the socket only for `ConnectionRefused`. Normal cleanup unlinks only the device/inode it bound.
- The systemd unit owns a preserved mode-0750 runtime directory, so restart and uninstall share one stable lock domain. Endpoint spoof, live listener, wrong type/owner/mode, and identity replacement remain fail-closed.

### BRK-M01 — monotonic timeout

- Authenticated `timeout_ms` is converted once to a monotonic absolute deadline and carried through guardian reopen and cgroup kill/population convergence.
- Poll-backed waits, bounded wakeups, abort/expiry checks, and pinned-handle revalidation replace read-count semantics. Virtual-clock and delayed population tests prove elapsed-time behavior.

## Verification receipts

All commands used the current source tree. The package check reports source digest:

```text
c98040d5b05e9643654bf8109082b0a2e5781699735c5ab59961e7acd85780dd
```

### Rust host and Linux target

```text
cargo test --locked
  PASS — 52 host tests, 0 failed; broker-focused host subset 38/38

cargo check --locked --all-targets --target x86_64-unknown-linux-gnu
  PASS — every Linux production, binary, library-unit, and integration-test target compiled

cargo check --locked --bin rasen-linux-process-authority-broker-client \
  --target x86_64-unknown-linux-gnu
  PASS — the newly added pinned client compiles

node scripts/build-linux-process-authority.mjs --check-only \
  --target x86_64-unknown-linux-gnu
  PASS — primary helper and broker client; cross-build-non-runtime only
```

The first isolated musl no-run build used an overlong ephemera target path and Windows `link.exe` could not create deep build-script outputs. Retrying the identical locked build in the short worktree-local `.rbm` target directory passed; this was an output-path failure, not a source failure.

```text
RUSTFLAGS='-C linker=rust-lld' cargo test --locked \
  --target x86_64-unknown-linux-musl --no-run
  PASS — static Linux test ELFs produced with Rust 1.88

WSL execution of broker library/admin/cgroup/install/lease/peer/protocol/service ELFs \
  --test-threads=1
  PASS — 41 broker tests, 0 failed
  Includes actual Linux SO_PEERCRED, fd-pinned pathname replacement, guardian codecs,
  cleanup pruning, recovery/replay, root-exit/natural-empty, and deadline oracles.
```

### TypeScript and administrative assets

```text
pnpm exec vitest run \
  test/core/session-host/linux-process-authority-provider.test.ts \
  test/core/session-host/linux-process-authority-artifact-resolver.test.ts \
  test/core/session-host/linux-process-authority-boundary-guards.test.ts \
  test/core/session-host/linux-process-authority-package-ci.test.ts
  PASS — 44/44

pnpm exec tsc --noEmit
  PASS

pnpm exec eslint \
  src/core/session-host/process-authority/linux/native-assembly.ts \
  src/core/session-host/process-authority/linux/provider.ts \
  test/core/session-host/linux-process-authority-provider.test.ts
  PASS

WSL pinned Rust 1.88 cargo fmt --manifest-path \
  native/linux-process-authority/Cargo.toml --all -- --check
  PASS

sh -n native/linux-process-authority/install/install.sh
sh -n native/linux-process-authority/install/uninstall.sh
  PASS; neither privileged script was executed

node bin/rasen.js validate ecp-linux-process-authority-provider --strict --json
  PASS — 1/1 valid, 0 issues

strict UTF-8 / no BOM / no mojibake marker / no trailing whitespace
  PASS — 45 owned source, test, asset, and evidence-input files
```

## Explicitly unavailable terminal gate

The ordinary WSL environment is hybrid cgroup and its v2 mount does not provide the writable controllers, `cgroup.events`, or `cgroup.kill` needed by the installed broker matrix. Docker is unavailable and Hyper-V has no Linux VM. Therefore none of the following is claimed here: root install/uninstall execution, real populated leaf migration denial, daemon SIGKILL/restart with a live cgroup, real `cgroup.kill` convergence, unrelated-cgroup survival, Section 9 completion, production default selection, package release support, or terminal Linux support.

## Re-review request

A fresh non-author reviewer should compare the live delta against `BRK-B01`–`BRK-B07` and `BRK-M01`, independently run risk-proportionate gates, and leave a new broker round-2 report. Only that reviewer may mark the findings resolved. Section 9 remains open even if the source delta is review-clean.
