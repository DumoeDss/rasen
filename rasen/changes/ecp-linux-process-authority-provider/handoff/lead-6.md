# Handoff: ECP-7 — LEAD #6 (post-freeze fix wave)

Date: 2026-08-07

## Read order

`lead-2.md` and `lead-3.md` remain authoritative except where corrected. `lead-4.md` is a wave
record whose session-handoff framing was **withdrawn** (it was written on a context probe that
divided a 1M window by 200k — see Gotchas). `lead-5.md` records the re-tiering wave. **This
document supersedes lead-5's "Next action" list entirely.**

Read lead-3, then lead-2, then lead-5, then this.

## Original intent

The operator's words, in order, because the second one changed the shape of the session:

1. *"继续使用auto流程推进后续所有工作"* — drive lead-3's next-action list to completion under the
   auto pipeline.
2. *"1. 修复 2. 现在正在开发为什么要冻结？把任务推进全部完成啊"* — fix the `router.ts`
   entanglement, and **stop treating the crate freezes as untouchable while development is still
   happening.**

The second instruction was correct and reframed everything after it. **A freeze is
receipt-binding discipline, not a release gate.** Its only purpose is "do not take expensive
receipts against a moving target". Holding it while known defects accumulate is the failure mode,
not the discipline. The operating rule became: **break it ONCE, fix everything known, re-freeze
ONCE, re-bind ONCE.**

The session was paused by the operator after the Windows assembly unit returned.

## Position

Portfolio `ecp-session-execution-and-self-hosting`, 11 children, Tier A, gate policy `off`.
**32 commits this session**, all on `wip/ecp-shared-bounded-loop-lifecycle-resume`.

| Child | State |
| --- | --- |
| `ecp-linux-process-authority-provider` | Re-frozen **`89f6c1d5`** (non-author confirmed). Section 12 done. Production wiring layers 1-2 receipted, layer 3 blocked |
| `ecp-windows-process-authority-provider` | Re-frozen **`fc49a7c2`**, helper `367666f6`. Section 8 16/17, Section 9 9/10. **Native assembly now exists** |
| `ecp-macos-process-authority-provider` | propose + apply + verify done; 3 Majors fixed and re-reviewed. NON-TERMINAL (Section 7 needs a real macOS host) |
| `process-authority-scope-semantics-wording` | propose + apply + verify done. Array 10 -> 8. Blocked only on 5.4 |
| `ecp-native-process-capsule-closure` | `escalated`; findings re-graded in the prior wave |
| `ecp-durable-agent-session-host` | `escalated`, untouched |
| executor / policy-parity / self-hosting | not started; executor's planning context is seeded |

## The one finding to read first

**Both platforms' cancel paths are known-broken, each for a different reason, and neither was
visible to any passing suite.** Two workers, two platforms, no contact between them, arrived at
the same conclusion independently.

- **Linux — `D4`.** `main.rs:141` parses `open-runtime --deadline-ms` and **discards it**;
  `open_runtime` routes through `self.control` -> `CONTROL_TIMEOUT` (2 s, `primary.rs:30`), which
  `control_on_until` sets as the socket **read** timeout. Measured: the bridge dies with
  `Failure(timeout)` **exactly 2.0 s** after activation on a silent workload. So `rootExited` and
  `exactScopeEmpty` are **unreachable for any workload quiet for two seconds**. That is the cancel
  path. **Invisible because every native test that opens a bridge uses `/usr/bin/true` or
  `sleep 0.2`** — workloads that finish inside the window.
- **Windows.** The crate has **no frame-preserving `open-runtime` verb at all**.
  `control --verb run` de-multiplexes the workload's output onto the helper's own stdout mixed
  with its receipt lines, so **a workload printing `RWA1-OBSERVATION 0404…` could forge an
  exact-scope-empty receipt.** The assembly worker refused to build a bridge over it and reported
  the crate change instead of making it. That refusal was correct: a CLI multiplexing a protocol
  onto stdout is not a transport, and filtering it would be a forgery surface dressed as progress.

## The deepest defect: `S10-F1`

`provider.ts:digestWindowsAuthorityLaunch` prefixed its preimage with `RPW1`;
`launch.rs:canonical_bytes` prefixes with `RWL1`, and `guardian.rs:524` digests the launch with
that. `createPreparedReference` requires equality — so **no attestation any real helper could
produce would ever have been accepted.** Production `prepare` would have thrown
"attestation identity binding differs" on **every healthy host, forever**. Every field after the
four magic bytes already agreed.

**No test could find it.** Every existing assertion computes its expected digest with the same
function it tests, so both sides moved together and the suite stayed green. Fixed by aligning
TypeScript to the frozen crate (the only possible direction).

**The rule, and it generalises past this repo: compare producers, not a producer against itself.**

## What was delivered

- **Both crates broken once and re-frozen once**, with full cross-change re-bind sweeps. The
  Windows sweep found **12 files across four changes plus portfolio run-state** — far wider than
  its own change directory, confirming that a directory-scoped enumeration reports a complete
  sweep that is not one.
- **`S8-F1` re-characterised and fixed.** Section 8 recorded it as deterministic ordering; measured,
  it is a **race** between `deliver_root_exit`'s broadcast and the terminate handler on the shared
  session writer. Driven as a caller actually drives it, **the receipt was lost 19 times in 20**,
  and the authority had converged every time. Two explanations for the 19/20-versus-1-in-7 gap were
  tested and **refuted**; the remainder is unexplained and reported rather than reconciled.
- **Task 4.8 implemented**; two of its own implementation defects were caught by its new tests
  rather than by review (one revalidation was unreachable dead code; the other turned "the helper
  omitted a value" into "this host cannot run the authority").
- **macOS honesty path fixed.** `BackendTermination` was `{closed, cancelledBeforeWork}` — a
  boolean-only **structural information sink**, so the honesty vocabulary existed at the
  ProcessScope seam and was destroyed one layer up. Widening it made all three Majors wireable
  rather than separately patchable.
- **Semantics contract narrowed 10 -> 8**, verified by a non-author from primary sources.
- **Section 12** (daemon-death teardown) built and receipted with a targeted mutant.
- **Durability sweep** — nine of nine byte-hash pins were unpinned for line endings; all nine now
  pinned and **verified by an actual `autocrlf=true` clone, 9/9 byte-exact**.

## Key decisions (and why)

- **Both crates broken deliberately, once each.** The operator's reframing. Breaking twice is the
  failure mode; never breaking is the other one.
- **Committed `router.ts` and `wire-types.ts` despite entanglement** with this branch's other
  workstream, with the ride-along stated in each commit message. On a WIP branch that is honest;
  leaving the macOS wiring uncommitted in a shared worktree was the larger risk.
- **Refused to fix the Windows runtime bridge.** Reported the crate change instead. See above.
- **Section 12's "not claimed" item 1 narrowed, not struck.** The endpoint reaches the guardian and
  the guardian answers its closure — but the end-to-end property waits on `activate`, so the claim
  shrank to exactly what the evidence supports.
- **`testFiles` map completed to 16/16 and its two non-crate entries pinned.** It was 5 of 16 and
  **read as complete**. Pinned rather than dropped: dropping would trade a reproducibility defect
  for a coverage gap.
- **Task 10.7 reworded, not repointed.** Files under the Linux crate *did* change legitimately, so
  "nothing changed" became false; a bare constant swap would have made the test green while its
  stated meaning went stale.
- **Left the stale `2b3fabd9` in lead-2/3/5 alone.** They are dated records of what was true when
  written. Rewriting history is not this repo's convention.

## Dead ends & gotchas

- **`rasen agent context` needs `--limit 1000000` on a 1M session.** It reports `limit: 200000`,
  so `pct` and `shouldHandoff` are both wrong. This cost the session a **spurious handoff**: a
  0.855 reading that was actually 0.227.
- **`vitest.setup.ts:setup()` calls `ensureCliBuilt()` UNCONDITIONALLY** on every vitest run. It
  early-returns only because `dist/cli/index.js` happens to exist. When absent, `build.js:17-19`
  runs `rmSync('dist')` and wipes `dist/native/**`. **Every vitest run in this repo is one missing
  file away from destroying packaged artifacts**, and nothing about the command tells you. Observed
  twice today. Run in an external tree.
- **A bare `tsc --outDir dist` does not clear, but it overwrites
  `dist/core/.../build-authority.js`** from the `src` placeholder that exports `[]`. Real values
  come only from the packaging script — which honours a build-root env var and emits a **complete
  package root outside the repo**. A package root is needed; a repo `dist` emission is not.
- **Node's `stdio` cannot hold an fd past its child's exit** — measured twice. A `'pipe'` slot for
  daemon lifetime would have torn down **every scope at birth**. Use a FIFO with a raw fd.
- **A held extra stdio pipe blocks `'close'` forever** (exit at 3 ms, no close after 3 s), and
  `invoke()` awaits `'close'` — the first cut would have hung the daemon on every prepare.
- **`publish` never contacts the guardian on user-pidns** (`provider.ts:489-510` reaches
  `recordPublication` only in broker mode). It **can report success over a dead scope**, and is
  useless as a liveness probe.
- **`git status` was unusable** — three `.cargo-target-*` roots held 5534 untracked files, several
  with paths git cannot read. Now ignored; untracked entries went **5534+ -> 75**. This is *why* an
  untracked receipt stayed invisible: the detector was buried in build output.
- **Trailing whitespace in `.rs` files**: the generic markdown fixer appends a backslash to
  non-empty trailing-whitespace lines. In Rust that is a **line continuation**. Use a strip-only
  fixer on code.

## Eliminated hypotheses

- *"`activate -> reference-invalid` is caused by the Section 12 wiring."* **No.** With the wiring
  completely disabled the failure is **byte-identical**. Control run before any conclusion.
- *"Code 7 points at `validate_control_socket` or the server challenge."* **No** — falsified by
  measurement. Both run on **every** control verb, so the hypothesis predicts `inspect` fails
  identically. Relaxing the socket to 0666 made `validate_control_socket` genuinely fire: its
  signature is **every verb fails**, while the real failure is **activate-only**.
- *"Code 7 implies a local `PermissionDenied` or `InvalidData`."* **No** — a third route exists at
  `protocol.rs:163-175`.
- *"The guardian is dead when activate fails."* **No** — proven alive by `kill(pid,0)` before and
  after, read from the kernel rather than from the system under test.
- **Actual cause of the activate RED: a TEST defect.** The fixture did
  `prepare -> publish -> activate` with **no runtime bridge**; the guardian refuses activate unless
  it is open (`primary.rs:1283-1289`), and production does `publish -> openRuntime -> activate`.

## Working set

- Frozen: Linux `89f6c1d5` (26 files), Windows `fc49a7c2` / helper `367666f6`.
- Evidence added this session: `section-12-daemon-lifetime-teardown.md`,
  `section-12-production-wiring.md`, `activate-reference-invalid-investigation.md` (Linux);
  `section-9-oracle-discrimination.md`, `windows-native-assembly.md`, `durability-sweep.md`,
  `ffi-coverage-instrument.mjs`, `ffi-coverage-census.mjs` (Windows); `review-report.md`,
  `review-round-2.md`, `fix-round-1.md` (macOS).
- WSL roots retained for re-check: `/home/sayo/.local/share/rasen-build/s12-*`,
  `ts-oracles-tree`, `ts-oracles-nm`.

## What is green but NOT a receipt

**The two oracle cases in `activate-reference-invalid-investigation.md` are green and
undiscriminating** — the departing worker flagged this itself as *"the state most likely to be
mistaken for done by whoever picks this up next."* Four consecutive passing runs is a passing run.
The two owed mutations (release-too-early RED, never-pass-the-flag RED) were **not taken** for
those cases. **Section 12's not-claimed item 1 stands: no production Linux scope has been SHOWN to
carry the daemon-lifetime property.**

## Next action

1. **Decide the second post-freeze wave.** `D4` (Blocker — cancel path dead after 2 s) and `D2`
   (every activate failure relabelled `reference-invalid`) on Linux; the missing frame-preserving
   `open-runtime` verb on Windows. **Batch them: one break and one re-bind per crate.** Doing them
   separately pays the re-bind cost per defect — this session proved the batched form works.
2. **Take the two owed mutations** for the daemon-lifetime oracle cases, then strike Section 12's
   not-claimed item 1 — not before.
3. **Ten win32 early-returns** in the Linux TypeScript suite (six in `package-ci` alone), each
   reporting as a passing test having asserted nothing. Needs a decision per site.
4. **Operator decision, not a worker's:** three changes from this branch's *other* workstream have
   **no ledger in git at all** (56 files including proposals and tasks), and
   `ecp-shared-bounded-loop-lifecycle` is tracked while three of its receipts are not.
5. Then Windows Section 11, then closure -> host -> **executor** -> policy-parity -> self-hosting.
   The executor is still ECP-7's actual user result and its planning context is seeded.
6. **macOS Section 7 needs a real macOS host.** It is the only item that is physically impossible
   here, and no WSL receipt may stand in for it.

## Honest state

The cancel path — the operation this entire subsystem exists to perform — **does not work
end-to-end on any platform today**, and that is now established by measurement rather than
suspected. Everything else in this wave is scaffolding around that fact.

Almost nothing moved to done, and that remains the correct outcome: what moved is what is *known
to be true*. A defect that would have made Windows `prepare` fail on every healthy host was
invisible to 300+ passing tests. Four separate things a guard depends on were not in git. The
honest reading of this session is that the suite's green was worth less than it appeared, and it is
worth somewhat more now.
