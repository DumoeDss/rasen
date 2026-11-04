# Handoff: ecp-linux-process-authority-provider — package/CI fixer #2

## Intent and position

This work unit fixed the package/CI findings from `evidence/review-report-package-ci-round-1.md` without crossing into native broker/primary, TypeScript runtime/provider, task accounting, or pipeline run-state ownership.

The five package/CI source files are remediated and locally verified. Detailed finding-to-fix mapping, exact hashes, receipts, and stable rerun commands are in `evidence/review-fix-package-ci-round-1.md`.

## Done

- S1: release input is externally pinned; length/hash, canonical provenance, ELF class/endianness/machine, and target are verified before staged assembly.
- S2: native build inputs are immutable and digest-bound; Cargo configuration/toolchain/linker authority is isolated, exact, and recorded.
- S3: the privileged job uses immutable checkout code and no mutable action after sudo/key authority is available.
- P1: provider manifests are architecture-specific.
- P2: Windows authoritative assembly fails closed instead of claiming an unprovable `0755` mode.
- P3: package/export outputs are private, closed-inventory, transactional replacements; real npm packlist auditing excludes privileged and stale assets.
- P4: an open namespace policy makes the named actual runtime gate fail rather than appear green.
- Native musl integration: a RED/GREEN regression closes the bundled `rust-lld` generic-driver version-probe defect by using explicit GNU flavor.

Windows package/CI tests are 10/10 green; the combined resolver/package/legacy suite is 47/47 green; the exact-current pre-freeze WSL package suite is 10/10 green; exact-current WSL focused hardening tests are green; TypeScript, ESLint, Node syntax, JSON/YAML parse, and strict Change validation pass.

## Remaining broker-dependent holds

- P5 final integrated source digest and artifact hashes.
- Final frozen-tree `--check-only` receipt. A pre-freeze run passed with source digest `9d33671c63184dbfa2280a090bfbd2e512e9a6c625a93de2fb395d2ffeb21843`.
- Final frozen-tree WSL package suite. The exact-current pre-freeze suite passed 10/10.
- Final native musl package/export receipt. The package script now clears the `rust-lld` version seam, but this WSL installation has no `cc`, `gcc`, or `clang` for dependency host build scripts; the retry failed closed with `linker cc not found`.

The broker source is compile-clean but not source-frozen while round-2 fixes continue. The earlier `c98040d5b05e9643654bf8109082b0a2e5781699735c5ab59961e7acd85780dd` digest and the current pre-freeze `9d33671c63184dbfa2280a090bfbd2e512e9a6c625a93de2fb395d2ffeb21843` digest must not be relabelled as final. Re-run the commands recorded in `evidence/review-fix-package-ci-round-1.md` after source freeze, using a native environment with an exact host compiler driver for the musl receipt.

## Ownership and safety

No native broker/primary file, TypeScript provider/runtime file, `tasks.md`, `.rasen/**`, or unrelated concurrent file was edited. No commit, push, PR, workflow dispatch, broker installation, sudo/cgroup operation, or external state change was performed.

## Next action for LEAD

Record S1-S3/P1-P4 and the `rust-lld` probe defect as source-remediated, retain P5 and the three final receipts as explicit holds, and release this package/CI execution slot. After broker source freeze and host-linker availability, assign a short integration-evidence rerun rather than reopening the source remediation.
