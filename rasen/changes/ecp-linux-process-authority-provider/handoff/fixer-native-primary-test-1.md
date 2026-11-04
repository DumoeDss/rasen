# Handoff — native primary test-evidence fixer 1

Date: 2026-08-06\
Disposition: **DONE — `NATIVE-B005` closed**

## What changed

Only `native/linux-process-authority/tests/linux_primary_contract.rs` changed in source. The
guardian helper-CLI oracle no longer uses the build-host-expanded `CARGO_BIN_EXE_*` absolute path.
It resolves `deps/../rasen-linux-process-authority` from the running Linux test executable and
rejects wrong layout, name, file type, symlink, execute mode, canonical parent, ELF identity, or
machine architecture. A mutation test covers directory, non-ELF, and symlink rejection. No
product semantics or no-PATH product constraint changed.

Full evidence:

`E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-wt-ecp-shared-bounded-loop-lifecycle\rasen\changes\ecp-linux-process-authority-provider\evidence\review-fix-native-primary-round-3.md`

## Receipts

- RED fresh musl ELF: 0/1, exact embedded Windows helper path, WSL `ENOENT`.
- GREEN fresh musl build: Cargo reported exactly 18 `profile.test=true` ELFs.
- Exact WSL serial matrix: 86 passed, 0 failed, 0 ignored; primary 22/22.
- Focused locator rejection: 1/1.
- Focused guardian forced-death oracle: 1/1.
- Windows pinned locked host: 52/52.
- Linux GNU all-target cross-check: pass, no warnings.
- Windows stable fmt and WSL pinned Rust 1.88 fmt: pass.
- Source SHA-256:
  `227b1f32f9fcb75ce650cd935222ab772db865f006577e5363718921a8d3b565`.

Exact runtime helper:

```text
/mnt/e/tmp/rpa-b005-green-20260806-1/x86_64-unknown-linux-musl/debug/rasen-linux-process-authority
SHA-256 6c7018cae4a9292eb12b0d4ee06fdfe1809e424770f64aa0bff5398297be5dda
```

## Reviewer contract

Run a fresh non-author delta review of the test-only locator and the exact retained GREEN target.
Do not reopen `NATIVE-B003`, `NATIVE-B004`, or `NATIVE-M005` unless review finds that this test-only
change altered a product seam. Do not mark broker/cgroup-v2, packaging, closure, or ECP-8 gates
closed from this receipt.

No commit was created. Tasks and run-state remain LEAD-owned and unchanged.
