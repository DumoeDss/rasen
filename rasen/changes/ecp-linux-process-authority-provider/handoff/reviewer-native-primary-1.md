# Reviewer handoff — native Linux primary round 1

Date: 2026-08-05\
Status: **DONE_WITH_CONCERNS / GATE FAIL**

## Delivered

- Full report: `evidence/review-report-native-primary-round-1.md`
- Findings: **3 Blocker, 4 Major, 0 Minor, 0 Trivial**
- Product edits: none
- Tasks/runstate/commits: none
- Broker files and Cargo dependency delta: excluded as instructed

## Fix order

1. **B1 — isolate/authenticate provider state.** The mapped workload UID can discover the pathname
   via `/proc/net/unix`, replace the socket or forge `terminal.bin`, and make a live scope inspect as
   exact-empty. Fix mount-view isolation, server-first capability authentication, terminal binding,
   and pidfd-completion checks together.
2. **B2 — make FD closure exact.** The ENOSYS fallback stops at `_SC_OPEN_MAX`; a high inherited
   non-CLOEXEC fd can survive into workload exec on close_range-less kernels. Fail unavailable or
   enumerate the actual fd table, then test high-fd/lowered-rlimit.
3. **B3 — implement unexpected guardian-death recovery and close the complete Section 7 gate.**
   Current replacement recovery cannot turn the authentic same-boot absent-PID teardown proof into
   exact empty. Round 2 also explicitly leaves setpgid, unrelated-process survival, full drift,
   signal-exit, publication-window, and native-in-WSL build receipts open.
4. **M1 — remove blocking stdin writes from the guardian event loop.** Use nonblocking bounded
   buffering/poll so inspect/terminate/reap remain live under backpressure.
5. **M2 — pin command/cwd descriptors at prepare.** Current pathname checks are TOCTOU across the
   publication/activation window.
6. **M3 — make abort exit independent of response delivery.** A failed exact-empty response leaves
   an immortal guardian and terminal-shortcut abort returns without pidfd completion.
7. **M4 — close persisted root-status numeric domains.** Reject impossible exit codes/signals.

## Verification notes

- Exact reviewed source hashes were stable during the pass; `primary.rs`:
  `873c7d26cc67914aaa3d714470e1f88b369b8bba22db0f5d937a5a7cde33683f`.
- Exact eight-file `rustfmt --check`: pass.
- Fresh WSL source test attempt: stopped before tests because host `cc` is absent; no new green claim.
- Existing WSL round 2: 23/23 only for its composite coverage; its explicitly named missing
  Section 7 oracles remain blockers.

The next implementation pass should add adversarial tests for B1 and M1 first: they exercise the
trust and liveness boundaries most likely to invalidate otherwise green lifecycle results.
