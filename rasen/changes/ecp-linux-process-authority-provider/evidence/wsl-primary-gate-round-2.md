# WSL primary actual-kernel gate — round 2

Date: 2026-08-05

## Fix under test

Round 1 exposed an internal bootstrap defect: guardian identity bootstrap fabricated a complete prepared attestation with conflated placeholder artifact/source digests, so the real distinct-digest validator rejected construction. The native implementation replaced that misuse with a dedicated closed `RBI1` identity codec and added round-trip plus trailing-byte rejection coverage without weakening zero/conflated identity checks.

## Build and execution

- Pinned Windows Rust/cargo: 1.88.0.
- Target: `x86_64-unknown-linux-musl`, locked, `rust-lld`, `cargo test --no-run`.
- Runtime: every produced static-PIE test ELF executed serially as a Linux process under WSL2 `Ubuntu-24.04`.
- Test result: 23 passed, 0 failed, 0 ignored.

Per-binary counts:

- authority contract: 4/4
- lifecycle contract: 5/5
- Linux identity: 2/2
- Linux journal: 1/1
- Linux primary actual-kernel composite: 2/2
- Linux runtime: 3/3
- protocol: 5/5
- library/main unit binaries: 1/1

The composite actual-kernel test proves wrong-artifact fail-closed cleanup, prepare-before-workload, independent scope/control capability rejection, start-identity drift rejection, inert abort, namespace-correct `/usr/bin/true` natural empty, exact code-zero root status before `ECHILD` empty, nested PID namespace plus detached `setsid` descendant survival, terminal reopen, exactly-once activation, and terminate-to-empty.

## Gate status

- The implemented composite actual-kernel oracle is GREEN and the round-1 defect is closed.
- This receipt does not yet close the complete Section 7 matrix: explicit `setpgid`, forced guardian death/unrelated-process survival, every boot/PID/namespace drift, exact signal-exit, publication crash-window process replacement, and native-in-WSL locked build remain separately open until dedicated receipts exist.
- Broker/cgroup-v2, packaging, closure, and ECP-8 gates remain open.
