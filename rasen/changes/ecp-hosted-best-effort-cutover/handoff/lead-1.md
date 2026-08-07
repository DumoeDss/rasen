# Handoff: ecp-hosted-best-effort-cutover — LEAD #1 (session-limit interruption)

Date: 2026-08-08 (00:0x, written minutes after the account session limit fired; limit
resets 00:30 Asia/Shanghai)

## Read order

Authority: Target State locked decision 13; slice plan.md Architecture Replan 6; this
change's proposal/design/tasks (commit `b3edf5bc`) and `handoff/planner-1.md`. Portfolio
truth: `.rasen/changes/ecp-session-execution-and-self-hosting/ephemera/portfolio-run.json`
(replan entry 5 + per-child notes, updated through this session).

## What happened

The operator approved the all-platform best-effort cutover and ordered the LEAD to drive
ECP to completion. One LEAD session then landed, in order: the Direction replan
(`951f8d04`), ledger/preservation commits (`a7ed8b01`/`d638f87d`/`b4acde43`), semantics
residue reconcile (`753edc7d`), cutover propose (`b3edf5bc`, 33 tasks, validate clean),
closure+host findings re-grade (`5ad3873e`), win32 early-return triage (`e4893286`),
main-spec Purpose fix (`2961848b`). Then BOTH in-flight workers were killed mid-wave by
the ACCOUNT session limit (not by task failure): the cutover implementer and the skipIf
converter. Their torn state was preservation-committed as **`88ffc08b` — NOT receipted,
nothing ticked, may not even compile.** (Cosmetic: that commit message starts with a
stray UTF-8 BOM from `Out-File -Encoding utf8`; use ASCII msgfiles next time.)

## Exact state of the two interrupted waves

### Implementer wave (0/33 tasks ticked)

Preserved in `88ffc08b`:
- `darwin-best-effort-scope.ts` -> `posix-best-effort-scope.ts` (git sees 94% rename);
  `win32-best-effort-scope.ts` NEW; `hosted-process-scope.ts` selection edit;
  additive semantics in `process-scope.ts`; three `darwin-*.test.ts` files touched;
  `evidence/implementation-baseline.md` started.
- NO implementer handoff exists (the limit hit before one could be written). The resumer
  must treat `88ffc08b`'s cutover files as a probably-incomplete draft: re-derive intent
  from design.md D1-D8, diff the preserved files against it, and finish or redo. Do NOT
  assume any preserved line has been tested.

### skipIf conversion wave

The four `linux-process-authority-*.test.ts` files in `88ffc08b` are MID-CONVERSION
(triage + fix shape in `evidence/win32-early-return-triage.md`, commit `e4893286`).
No before/after counts were taken. Resume = re-check each of the 10 sites against the
triage table, finish the conversion (incl. the S1 split), then take the before/after
receipt the dispatch demanded.

## Resume protocol (next session, after 00:30)

1. Respawn the implementer on `rasen/changes/ecp-hosted-best-effort-cutover/tasks.md`
   with the original dispatch discipline (in the LEAD session's records) PLUS: start from
   `88ffc08b`, audit the preserved draft against design.md before writing anything new,
   and re-run every safety check (dist/cli/index.js existence before vitest; WSL external
   tree per lead-2 recipe).
2. Respawn the skipIf converter (small unit) or fold it into the implementer's tail.
3. Then the review wave (a worker with the re-grade context is ideal). The review
   checklist is already assembled in the portfolio run-state closure/host child notes:
   - SEC-001 discriminator: transport/controller loss on BOTH shipped scopes ->
     retained typed uncertainty, never a release-authorising terminal;
   - **D4 <-> RC-004 CONFLICT (must reconcile, highest priority)**: design D4 translates
     the win32 one-shot probe outcome (implies `oneShotProbe` at
     `native-process-scope.ts:329` is REACHABLE from the shipped win32 path) while the
     re-grade parks RC-004 conditional on it being UNREACHABLE. If reachable, RC-004
     resurfaces as 0.2.0 acceptance;
   - RC-002 residual: POSIX natural-exit reaches a bounded declared-unproven terminal,
     never an unbounded zombie-pinned wait;
   - S2: POSIX root-exit mints declared-unproven only; win32 never mints the capsule's
     proven scope-empty; Job teardown at release receipted;
   - S4 (LIVE): enumerate every reachable control phase on the win32 delegation; each
     bounded with typed phase-specific uncertainty;
   - Both `closeDurableProcess` release paths (host.ts ~:711-714 and ~:716-720) need
     PER-PATH mutation receipts.
4. After review-clean: closure resumes (dependsOn = this change; residual = SEC-001
   verdict, RC-005/12.8, PGID-exact-claim deletion, ProcessScope/host integration,
   fresh bounded budget without resetting counters) -> host fresh review (S2/S4 ride
   this review; S1/S3 parked) -> executor propose (DO-NOT-PROPOSE-YET dissolved; owns
   two tiers now) -> policy-parity -> self-hosting -> ECP-8.

## Standing decisions the resumer must not relitigate

- Locked decision 13 (all-platform best-effort; crates parked with D4/D2/verb recorded).
- Win32 = thin wrapper over the UNMODIFIED legacy capsule; zero guard rebaseline planned;
  byte-pin receipts against the COMMIT; touching a pinned file = STOP and escalate.
- POSIX generalisation = module move, no shim (source-scan guards read module source).
- No persisted-record keys added (registry allowlist rejects unknown fields).
- Design open decision D4 is implement-as-designed; the REVIEWER owns tightening it
  (see the conflict above).

## Session-limit facts

Both workers failed with "You've hit your session limit / resets 12:30am
(Asia/Shanghai)". Model assignment per project memory: planner/reviewer=fable,
implementer/fixer=opus. Workers idling as "available" before the limit (regrader) had
finished and reported; their results are committed and verified.
