# Handoff: ECP-7 — LEAD #5 (auto wave: re-tier, re-freeze, Section 8, macOS, contract narrowing)

Date: 2026-08-07

## Read order

`lead-2.md` and `lead-3.md` remain authoritative except where corrected below. **`lead-4.md` is a
wave record, not a session handoff** — it was written mid-session on a false context reading and its
session-handoff framing is withdrawn in run-state. Its content is still correct; read it for the
re-tier detail. This document supersedes its "Next action" list entirely.

Read lead-3, then lead-2, then lead-4, then this.

## What this session was

An auto-pipeline LEAD session that ran lead-3's next-action list to completion, plus three items
lead-3 did not anticipate. Seven role-isolated workers, nine commits. **Zero product tasks were
ticked by the LEAD**; every artifact was authored by a dispatched worker and checked by a
non-author.

## Position at handoff

| Child | State |
| --- | --- |
| `ecp-linux-process-authority-provider` | 75/96, implementation-frozen, NON-TERMINAL. Ledger re-tiered; Section 12 added; archive hazard closed |
| `ecp-windows-process-authority-provider` | Section 8 done 16/17; crate re-frozen `2b3fabd9`; 8.12 open |
| `ecp-macos-process-authority-provider` | propose + apply done, 29/36, NON-TERMINAL (needs a real macOS host) |
| `process-authority-scope-semantics-wording` | **new child**, propose done, apply not started |
| `ecp-native-process-capsule-closure` | `escalated`, findings re-graded — residual is far smaller than the status implies |
| `ecp-durable-agent-session-host` | `escalated`, untouched |
| executor / policy-parity / self-hosting | not started; executor's planning context is seeded |

## The one thing to read if you read nothing else

**The cancel path is the reason this subsystem exists, and it is the least-verified path in it on
every platform.** Three workers reached this independently, hours apart, without comparing notes:

- **Linux** — `activate(success)`, `terminate` and `open-runtime` are crossed by **zero** tests
  end-to-end, in either language. No `CARGO_BIN_EXE` in crate tests; the only CLI spawns are
  `inspect` and activate-rejection; the TypeScript side only fakes.
- **Windows** — the TypeScript production factory is **inert by construction**: real state-root
  validation, real ledger, then `unavailableNativeAssembly()` with placeholder digests
  (`'e'.repeat(64)`/`'f'.repeat(64)`), and zero callers. **No receipt anywhere describes anything
  that factory can do.**
- **macOS** — its real-kernel mutant proves a **lying record**, not a leak: `groupObservedEmpty:
  true` printed beside a live descendant. No deterministic assertion phrased as "did we leak?"
  would have surfaced it.

Each child looked reasonable on its own task count. **The gap only appears when the three are read
together**, which is an argument for reading the portfolio as one thing at least once per wave.

## Corrections to lead-3 and lead-2 (each file-anchored)

1. **`RC-001` (Blocker) was missing** from lead-3's closure list. Eight open findings, not seven. It
   supersedes by the 2026-08-04 replan — a third reason, independent of both 2026-08-07 decisions.
2. **Reopen-and-revalidate does NOT move wholesale.** On Linux every control verb is a fresh helper
   process, so that machinery is simultaneously criterion-4 reattach and per-operation
   destructive-target safety. **Independently spot-checked and it holds in code** (`primary.rs:88-102`,
   `:146-186`). A mechanical "remove reattach" would delete the safety property.
3. **Section 8 leaves with the broker too**, not only Section 9.
4. **The NATIVE-SEAM findings move on broker-only consumership**, not on same-boot recovery state.
5. **`PKG-P5` is not closed** by the implementation wave. It is now *closable* — a non-author
   re-derived the digest byte-exact — but closing is the review wave's act.
6. **"7 findings leave" is imprecise**: 6 move whole, 1 splits, 2 narrow, 2 stay.
7. **`SEC-002` is not literally a race** (junction pre-placed, not raced). Verdict unchanged.
8. **Severity drift is real**: `architecture-replan.md` recaps two Majors as Blockers. **Grade from
   originating reports.**
9. **lead-3's rationale for the macOS child is wrong.** It said macOS "implements the same
   `ProcessAuthorityProvider` contract as Linux/Windows". It cannot — `registry.ts:104-116` and
   `manifest.ts:119` reject subset providers index-exact. macOS integrates at the **ProcessScope
   seam**. The child still stands on its other grounds.
10. **`lead2-apply-wave-accounting.md` self-contradicts** on the Section 8 split (6/15 vs 5/16).
    Measured: **5**.

## What was delivered

**Ledgers re-tiered.** Linux 93 tasks + 11 findings; closure 96 tasks + 13 findings. **36 tasks
across the two changes were still being treated as 0.2.0 acceptance and are not.**

**Both crates LF-pinned; Windows re-frozen `b44c5e25` -> `2b3fabd9`**, demonstrated with a failing
counterpart (scratch-repo double checkout: `dbc9e58e` without the rule, `2b3fabd9` with it). This
closed a live CI landmine: `windows-process-authority-package-ci.test.ts:295` asserts `=== 087d87a5`
on a `windows-latest` workflow that has **never executed**; it would have failed on first run looking
like tampering with a frozen tree.

**Windows Section 8 executed**, 16/17, freeze verified held by falsification.

**macOS best-effort tier proposed and applied**, 29 tasks, 9 mutation receipts all RED.

**The semantics contract narrowing proposed** — `RECURSIVE_PROCESS_SCOPE_SEMANTICS` 10 -> 8.

**Step 1's orphaned obligations tasked** as Section 12, and the 11.9 gate hole closed.

**The archive-projection hazard closed** (see below).

## Three structural defects of one shape

**Things this repository's guards and receipts depend on were routinely not in git.**

- `native/linux-process-authority` had no `.gitattributes` pin — its frozen digest reproduced on no
  fresh checkout anywhere.
- `scripts/build-windows-process-authority.mjs` was untracked — the authoritative build route every
  Section 8 receipt names.
- `scripts/build-process-capsule.mjs` was untracked — one of **seven** files byte-hash-pinned by
  `LEGACY_PROCESS_CAPSULE_INPUTS`, so that guard could not pass a fresh checkout.

All three are fixed. **Each would have surfaced on someone's first clean clone as a digest mismatch
or guard failure against a tree nobody had touched — i.e. as tampering rather than as absence.**
When a guard fails on a fresh clone here, suspect absence before suspecting corruption.

## The archive-projection hazard, and how to check it in future

The delta spec carried unmarked upgrade-path and broker requirements. **Archiving would have created
a main spec asserting durable publication, replacement recovery and the full broker authority as
delivered 0.2.0 surface.**

It was invisible by construction: `rasen validate` **never applies a delta**, and `archive --dry-run`
reports only create/update per capability, not the projected text.

**The check, which takes seconds and is zero-risk:** call `buildUpdatedSpec` (with `findSpecUpdates`)
from `dist/core/specs-apply.js` directly, in memory, and diff the rendered projection against the
intended surface. **Put this in the pre-archive routine.** `--dry-run` alone is not enough.

**Marker convention, which is load-bearing:** a `**Scope**:` line goes **inside the requirement body,
after the SHALL prose and before the first scenario**. Only `### Requirement:` blocks project;
`**Name**:` metadata lines are skipped by the extractor, and heading edits are renames, which this
repo treats as implicit deletes. Verified: all nine markers survive projection; a preamble legend
does not.

**Task 11.8 is not a sufficient guard** — it writes a handoff document while archive projects a spec,
nothing orders them mechanically, and validate does not apply the delta.

## Owed, and not yet written anywhere

- **The daemon-lifetime requirement does not exist in any spec.** Section 12 has tasks; the 0.2.0
  contract does not state the property those tasks establish. Zero occurrences of daemon-lifetime,
  daemon-death or `execution-lost` in the delta spec.
- **`rasen/specs/process-authority-provider/spec.md:4` already ships `TBD - created by archiving`**,
  from the archived foundation. Not a future risk — an existing defect in a shipped main spec.
- **Task 4.8 is unimplemented and assigned to nobody**, while `design.md:202/204` promises typed
  `authority-unavailable` that no probe produces. An unimplemented task with no owner is how a
  promise quietly becomes a lie.

## Open decisions for the operator

1. **`router.ts` entanglement.** It carries the macOS `createHostedProcessScope` wiring **and** ~234
   uncommitted lines of this branch's planning-space work. Six modified `session-host/` files (290
   insertions) are in the same position. Commit together (sweeps in the other workstream), commit the
   six only (selector unwired), or leave all seven. **Not decided by the LEAD.**
2. **The post-freeze fix wave.** Both crates owe source fixes after being frozen: Linux Section 12,
   Windows `S8-F1` and possibly 4.8. Each break costs a re-freeze plus a full receipt re-bind. **One
   planned wave per crate pays that once; discovering them piecemeal pays per defect.**
3. **`S8-F1`'s gate.** Wiring the Windows provider into production must not land until it is fixed.
   Today it is Major only because nothing reaches it.

## Splitting the Linux child: withdrawn

lead-4 raised it because `sessionHandoff.n` hit the relay cap. **That was a false alarm** — the probe
divided a 1M window by 200k. On evidence the surviving findings are 5 Majors, all coverage-shaped,
none requiring a split. Do not act on lead-4's recommendation.

## Method notes worth keeping

- **Relay what to check, never what to expect.** Every dispatch framed prior conclusions as claims to
  verify. That produced ten corrections; dispatches that paste the expected answer produce ten
  confirmations.
- **Enumerate; do not sample.** Full enumeration beat a plausible summary three separate times today,
  including two archive verdicts a prefix read would have got wrong.
- **A real-kernel mutant beats a deterministic one** when the failure mode is a lying record rather
  than a crash.
- **`rasen agent context` needs `--limit 1000000`** on a 1M-window session. Its `shouldHandoff` is
  untrustworthy by default here; it cost this session a spurious handoff.
- **Check the file, not the notification.** A worker "going idle" with no file change usually means
  the write had not landed yet, not that your message was lost. This cost two unnecessary resends.

## Next action

1. Resolve the `router.ts` entanglement — it blocks nothing else, but the macOS wiring is
   uncommitted while the worktree is demonstrably shared.
2. Apply `process-authority-scope-semantics-wording` (propose is done and committed). It edits
   `types.ts`/`registry.ts`/`manifest.ts`; nothing else in flight touches those.
3. Write the daemon-lifetime requirement, then decide the post-freeze wave's shape.
4. Windows: 8.12 after `S8-F1`, then Section 9's own gate; the 17-mutation matrix still owes a
   non-author review.
5. Closure — its residual is now `SEC-001` (Blocker), `RC-002` (narrowed), `RC-005` (minor). It
   unblocks five downstream children.
6. Then host -> executor -> policy-parity -> self-hosting. **These are still ECP-7's actual user
   result and three of them have not started.**

## Honest state

Closer than lead-3, and still not close. This wave removed 36 tasks of wasted scope, closed an
archive trap that would have shipped a false contract, fixed three guards that could not survive a
clean clone, and established that the subsystem's central operation is unverified on every platform.
**It moved almost nothing to done, and that was the correct outcome** — most of what looked done was
resting on receipts nobody had checked.
