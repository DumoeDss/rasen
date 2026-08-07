# Handoff: ecp-hosted-best-effort-cutover — IMPLEMENTER #1

Role: IMPLEMENTER. Resumed from the session-limit interruption per
`handoff/lead-1.md`, starting from preservation commit `88ffc08b`.

Tasks ticked: **29 of 33**. Unticked: Section 6 only (6.1-6.4, the WSL Linux
receipts).

## Read order for the next worker

1. This file.
2. `evidence/win32-real-host-receipts.md` — contains the one finding that
   changes how you should read everything else.
3. `evidence/mutation-receipts.md` — what the guards are actually worth.
4. `evidence/legacy-freeze-integrity.md` — the escalated RED pin.

## Reconciliation of the preserved draft (done first, before any new code)

`88ffc08b` was audited rather than trusted:

- The POSIX module move was re-proved rename-only by applying the four agreed
  substitutions to `git show b3edf5bc:.../darwin-best-effort-scope.ts` and
  diffing: one hunk, the added header comment. Recorded in
  `evidence/posix-move-equivalence.md`.
- `tsc --noEmit` exit 0; the three repointed darwin suites 30/30.
- Every design claim in D1-D8 was re-verified against the tree with file:line
  anchors (`evidence/implementation-baseline.md`).

Nothing preserved had to be redone. Two line-number corrections were reported
rather than absorbed (below).

## What was built

| Area | File | Note |
| --- | --- | --- |
| POSIX generalisation | `src/core/session-host/process-capsule/posix-best-effort-scope.ts` | rename-only move of the darwin module; `darwin-best-effort-scope.ts` deleted, no shim |
| win32 tier | `src/core/session-host/process-capsule/win32-best-effort-scope.ts` | NEW; delegates all four verbs to an unmodified `createNativeProcessScope()` |
| Selection | `src/core/session-host/process-capsule/hosted-process-scope.ts` | darwin+linux -> POSIX, win32 -> win32 wrapper, everything else unchanged |
| Vocabulary | `src/core/session-host/process-scope.ts` | additive `WIN32_BEST_EFFORT_SCOPE_SEMANTICS`; POSIX list and the frozen recursive list untouched |
| Guards | `test/core/session-host/win32-best-effort-scope.test.ts` (19), `cutover-declaration-gated-release.test.ts` (10), `win32-real-capsule-receipts.test.ts` (3, gated) | |
| Shared seam | `test/helpers/fake-process-capsule.ts` | scripted capsule controller PROCESS, so the byte-pinned adapter stays in the loop |

Zero edits to `host.ts`, `router.ts`, `claude-backend.ts`, the registry, and any
byte-pinned file. Zero bytes to `native/**`.

## Receipts index

| Evidence file | Proves |
| --- | --- |
| `evidence/implementation-baseline.md` | Tasks 1.1-1.3. Commit-based pin digests at `b3edf5bc`; 12 seam anchors; the four no-edit surfaces |
| `evidence/posix-move-equivalence.md` | Tasks 2.1-2.3. Mechanical rename-only diff; no shim; guards repointed |
| `evidence/mutation-receipts.md` | Task 4.5. Six mutations (a,b,c,d1,d2,e) plus (f); per-path discrimination on both release paths |
| `evidence/legacy-freeze-integrity.md` | Tasks 5.1-5.2. Pin digests at `af21ba8d`; **plus the escalated RED pin** |
| `evidence/win32-real-host-receipts.md` | Tasks 7.1-7.4. Real Job teardown; production-path cancel; transport loss; **plus the D3 finding** |
| `evidence/win32-daemon-death-probe.mjs` + `-driver.mjs` | Reproducible KILL_ON_JOB_CLOSE chain probe |

## Findings the LEAD/reviewer must act on

### 1. A real D3 violation existed and shipped past every deterministic guard

The 7.3 real-host receipt **failed on its first run**: after killing only the
capsule controller, the session was RELEASED (`recovered === 1`). That is
literally SEC-001's shape — transport loss became a clean host detach.

Cause: killing the controller triggers KILL_ON_JOB_CLOSE (the property 7.2 had
just proved), so the Job really dies; the capsule then falls through to its
one-shot probe, which answers "gone"; and the wrapper applied design D4's
probe translation — written for refs from a PREVIOUS daemon lifetime — to a ref
this daemon had prepared, minting a terminal.

Fixed in `win32-best-effort-scope.ts` with a `transportLost` latch (no design
change; D3 already forbade this). A regression guard was added.

**Why this matters beyond the bug:** the deterministic transport-loss guards were
green throughout. They checked what `terminate()` returns and never asked what
`inspect()` says afterwards — and `closeDurableProcess` calls `inspect` first.
Treat that as evidence about how much weight fixture-based guards carry here.

### 2. D4 <-> RC-004 is confirmed live, not hypothetical

`lead-1.md` flagged that D4 implies `oneShotProbe`
(`native-process-scope.ts:329`) is REACHABLE from the shipped win32 path, while
the re-grade parks RC-004 conditional on it being UNREACHABLE. **It is
reachable, and now demonstrably so on a real host** (7.2b, and the 7.3 failure
above went through it). RC-004 should be treated as resurfaced for 0.2.0
acceptance unless the reviewer decides otherwise.

### 3. A frozen-common byte pin is RED, from someone else's commit

Both pin suites fail on `FROZEN_COMMON_INPUTS`' pin of
`rasen/specs/process-authority-provider/spec.md` (`05257eb1…` ->
`359db6d9…`), moved by LEAD commit `2961848b` (Purpose-placeholder fix), not by
this change. Run: 2 failed / 19 passed (21). The
`LEGACY_PROCESS_CAPSULE_INPUTS` assertion this change owns passes on all twelve
files.

Deliberately not fixed — a rebaseline is a LEAD decision with lineage. Likely
resolution: authorised rebaseline of the two `FROZEN_COMMON_INPUTS` constants,
not a revert of the docs fix.

### 4. Two small corrections to design.md's anchors (no decision changed)

- The `closeDurableProcess` receipt release path opens at `host.ts:715`, not
  `:716`. Same path.
- There is a FOURTH declaration gate the design did not enumerate: terminal
  persistence at `host.ts:766` (`if (terminal && current.process?.declaration)`).
  It also needs no edit.

## Dead ends and traps (do not re-walk)

- **`git checkout -- <file>` cannot revert a mutation in this repo.**
  `core.autocrlf` is `true`, so the checkout rewrites the file with CRLF: 330
  bytes differ from the blob, `git diff` reports nothing, and the next LF anchor
  silently misses and reports "0 hits". Use byte-exact backup/restore.
- The win32 source-scan guard cannot use a bare `/'scope-empty'/` assertion:
  `scope-empty` is also a legitimate `ProcessControlPhase` label on a failure.
  The guard now forbids `state: 'scope-empty'` and strips only
  `phase: 'scope-empty'` before re-asserting. Re-proved by mutation (f).
- Do NOT seam the win32 tests by substituting a fake `ProcessScope`: that
  bypasses the byte-pinned adapter entirely and the guards would prove nothing
  about the real delegation. Seam at the controller PROCESS
  (`test/helpers/fake-process-capsule.ts`).
- `test/core/session-host/linux-process-authority-*.test.ts` belong to the
  concurrent skipIf worker. Not touched, not committed by this wave.

## Exact state of every unticked task

All four are Section 6, `[WSL-EXTERNAL]`. **Not started.** No WSL run tree was
created, no Linux process was spawned, and no partial Linux evidence exists —
there is nothing half-done to clean up.

- **6.1** Prepare the external ext4 run tree. Not started. Recipe is in
  `rasen/changes/ecp-linux-process-authority-provider/handoff/lead-2.md`
  ("Dead ends & gotchas"); known-good roots exist under
  `/home/sayo/.local/share/rasen-build/` (e.g. `ts-oracles-tree`,
  `ts-oracles-nm`). Never use the repo's Windows `node_modules` under WSL.
- **6.2** Production-path cancel receipt on Linux. Not started. The Windows
  analogue is `win32-real-capsule-receipts.test.ts` 7.1 — the Linux version
  should mirror its structure but drive `createPosixBestEffortProcessScope`
  through `createHostedProcessScope()` with `platform` left to
  `process.platform`.
- **6.3** setsid escape-honesty receipt on a real kernel. Not started. This is
  the one that cannot be faked on Windows: a descendant calls `setsid()`,
  survives a completed cancel, and the Record must still read
  `cancelled / emptiness-unproven`. The deterministic analogue already exists
  (`darwin-best-effort-scope.test.ts` "reports emptiness-unproven even when the
  group is observed empty") but models the kernel; 6.3 must use the real one.
- **6.4** Natural-completion receipt: exact root exit code and, separately,
  exact terminating signal. Not started.

Reason not done: context budget. Sections 1-5, 7 and 8 were completed and
receipted first because Section 7 needed this specific Windows host, whereas
Section 6 needs only WSL and is fully portable to a fresh worker.

**Do not tick 6.x from a Windows run.** The suite would need a
`process.platform === 'linux'` gate plus an env gate; running it from Windows
skips silently and proves nothing. Any Section 6 receipt must quote the asserted
test count, not an exit code.

## Commits from this wave

| Commit | Contents |
| --- | --- |
| `1576b264` | Tasks 1.1-1.3, 2.1-2.3 receipts; baseline + POSIX move equivalence evidence |
| `b33a4f84` | win32 wrapper guards + both-paths release guards + shared capsule seam; tasks 2.4-2.5, 3.1-3.6, 4.1-4.4 |
| `af21ba8d` | Mutation receipts (task 4.5) |
| `b00dc64e` | Legacy freeze integrity + the escalated RED pin (tasks 5.1-5.2) |
| (this commit) | Real Windows receipts, the D3 transport-loss fix, tasks 7.1-7.4 and 8.1-8.4 |

The code itself was preserved earlier in `88ffc08b`; commits here add the
receipts that make it defensible, plus the D3 fix.
