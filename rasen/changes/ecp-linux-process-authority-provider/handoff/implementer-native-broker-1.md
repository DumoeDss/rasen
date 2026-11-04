# Native Linux broker core handoff 1

Date: 2026-08-05
Updated: 2026-08-06

## Result

The source-owned broker core is present and fail-closed, but the broker provider is not
terminal. Do not mark tasks 8.5, 8.6, 8.7-8.10, Section 9, or the Change complete from this
handoff. Do not install the current daemon as evidence: it authenticates and probes, while
all workload lifecycle requests intentionally return unavailable until the privileged
guardian/runtime adapter is wired.

No commit was created and no administrative asset was executed.

## Owned files

```text
native/linux-process-authority/Cargo.toml
native/linux-process-authority/Cargo.lock
native/linux-process-authority/THIRD_PARTY.md
native/linux-process-authority/src/lib.rs                 # broker module exports only
native/linux-process-authority/src/broker_admin.rs
native/linux-process-authority/src/broker_cgroup.rs
native/linux-process-authority/src/broker_install.rs
native/linux-process-authority/src/broker_lease.rs
native/linux-process-authority/src/broker_protocol.rs
native/linux-process-authority/src/broker_service.rs
native/linux-process-authority/src/broker_transport.rs
native/linux-process-authority/src/bin/rasen-linux-process-authority-broker.rs
native/linux-process-authority/tests/linux_broker_admin_contract.rs
native/linux-process-authority/tests/linux_broker_cgroup_contract.rs
native/linux-process-authority/tests/linux_broker_install_contract.rs
native/linux-process-authority/tests/linux_broker_lease_contract.rs
native/linux-process-authority/tests/linux_broker_peer_contract.rs
native/linux-process-authority/tests/linux_broker_protocol_contract.rs
native/linux-process-authority/tests/linux_broker_service_contract.rs
native/linux-process-authority/install/README.md
native/linux-process-authority/install/install.sh
native/linux-process-authority/install/uninstall.sh
native/linux-process-authority/install/rasen-linux-process-authority-broker.service
rasen/changes/ecp-linux-process-authority-provider/evidence/implementation-native-broker-1.md
rasen/changes/ecp-linux-process-authority-provider/handoff/implementer-native-broker-1.md
```

## Public native seams

- `broker_protocol`: closed `RPB1` frames; hello/challenge; pinned/signing Ed25519 identities;
  closed operations/responses; OS nonce; peer credential model.
- `broker_transport` (Linux): `SO_PEERCRED`, server authenticated request acceptance, client
  pinned broker authentication.
- `broker_install`: canonical public-key manifest, fixed layout, model and actual Linux
  root-owned ancestor/leaf validation.
- `broker_lease`: closed `RBL1` record, lifecycle/publication binding, Linux root-owned
  atomic durable store.
- `broker_cgroup`: injectable `CgroupKernel`, fail-closed `BrokerCgroupAuthority`, actual
  `FsCgroupKernel`, bounded `cgroup.events` parser and namespace feature probe.
- `broker_service`: injectable `GuardianAuthority`, `BrokerServiceCore`, durable
  prepare/publish/activate/reopen/terminate transaction.
- `broker_admin`: deterministic install/uninstall planning and populated/durable refusal.

## Required next implementation

Implement a production `GuardianAuthority` that is safe for an unprivileged authenticated
caller while the broker remains root:

1. create the user/PID/mount namespace guardian inertly;
2. map/drop workload credentials to the exact peer uid/gid (never run caller workload as
   host root);
3. place the outer guardian in the already-created exact leaf before acknowledging
   prepared;
4. preserve the existing immutable launch digest and publish-before-activate gate;
5. expose the byte-exact duplex runtime bridge;
6. reopen boot/pid/start/pidns identity before guardian observation/control;
7. wire all `BrokerOperation` variants in the installed daemon to `BrokerServiceCore`.

Do not adapt `prepare_primary` by running a root-mapped primary guardian for an unprivileged
caller; that would make workload credentials host root. Either factor a reviewed
caller-mapping primitive under the owning primary work unit or implement a separate broker
guardian with explicit uid/gid mapping and descriptor/mount hardening.

## Resume hardening and final verification

The primary owner corrected the former journal fixture blocker and stabilized its API and
format. No broker `lib.rs` export adaptation was necessary. The resume audit additionally
closed durable activation-pending recovery, atomic no-replace lease creation, bounded
control timeout, closed cgroup-root paths/actual bounded reads, and fail-closed
install/uninstall state and recovery ordering. All original 23 broker tests remain; three
regressions raise the selected totals to 26 on Windows and 27 on Linux including
`SO_PEERCRED`.

Final receipts now pass:

```text
cargo test --locked --manifest-path native/linux-process-authority/Cargo.toml
  40 passed on pinned Windows cargo/rustc 1.88.0; broker subset 26 passed

cargo check --locked --all-targets --target x86_64-unknown-linux-gnu \
  --manifest-path native/linux-process-authority/Cargo.toml

WSL pinned RUSTUP_HOME/CARGO_HOME cargo fmt --check \
  --manifest-path native/linux-process-authority/Cargo.toml

cargo metadata --locked --format-version 1 --no-deps \
  --manifest-path native/linux-process-authority/Cargo.toml

WSL sh -n install/install.sh install/uninstall.sh

rasen validate ecp-linux-process-authority-provider --strict --json
  1/1 valid, 0 issues
```

The WSL format receipt used explicit recorded toolchain roots and reported rustc 1.88.0,
cargo 1.88.0, and rustfmt 1.8.0-stable. Cargo.lock remains
`f7cf36db41d966cf9ea2300c99ee3dca5eb11a58f50ff93caf96ee552fe9dfe0`.
All 25 owned files passed strict UTF-8/no-BOM/no-mojibake/no-trailing-whitespace checks.

The installed daemon remains deliberately authenticated-probe-only. Do not mark 8.5 or
8.6 complete: there is still no production privileged guardian/runtime adapter, and the
daemon returns unavailable for lifecycle operations. Tasks 8.7-8.10, all of Section 9,
real administrative installation, security review, packaging, closure, release, ship and
archive also remain open.

Then run, on the dedicated privileged Linux gate only, the exact install/authentication,
setsid/setpgid/nested namespace, migration denial, broker kill/restart, controller/key/token/
inode drift, natural empty, abort/terminate, `cgroup.kill`, populated convergence, repeated
control, uninstall refusal and unrelated-cgroup survival matrix. Record kernel,
distribution, unified mount, controllers, uid/gid/modes, binary/key digests and commands.

## Evidence

See `evidence/implementation-native-broker-1.md` for RED/GREEN receipts, dependency lock
hash, precise task coverage and open gates.
