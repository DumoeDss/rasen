# Strategy Fixer 1 Handoff

## Scope

Fixed only the Round-3 completed-archive corruption Major. The change uses an isolated terminal-integrity contract: once a completed published archive fails verification, that transaction is manual-recovery-only and is never presented as an ordinary same-token resume.

No canonical review report, task state, run state, root-routing/foundation implementation, commit, push, or archive operation was changed.

## Exact implementation delta

- `src/core/archive-engine.ts:290-406`
  - Added journal-v2 `ArchiveIntegrityFailure` metadata with `detectedAt`, typed `operation`, `path`, optional `code`, `message`, and a structured manual-only `safeAction`.
  - Added `manualRecoveryAction` to `ArchiveApplyResult`; this is mutually exclusive in practice with the ordinary `recoveryCommand` for terminal integrity failures.
- `src/core/archive-engine.ts:1962-1982`
  - Added runtime validation for optional journal-v2 integrity metadata while retaining compatibility with historical journals that do not contain it.
- `src/core/archive-engine.ts:2045-2047`
  - Preserved durable integrity metadata through journal projections.
- `src/core/archive-engine.ts:3661-3686,3726-3779`
  - Before completed verification can throw, recovery state is initialized from the real published journal: `resumed`, `published`, `finalReserved`, and `ownsRecoveryState` are true; the published journal path, historical phase, snapshot, disposed paths, and spec totals are authoritative.
  - A verification failure is classified as the exact accounting/evidence blocker, stamped once, and atomically written to the published journal without changing its historical `phase: complete`.
  - A later invocation short-circuits on the durable integrity alert and returns the same manual-only result without modifying the archived payload or journal.
- `src/core/archive.ts:301-331,692-703`
  - Saved-plan apply no longer synthesizes a same-token `recoveryCommand` when the engine returns `manualRecoveryAction`.
  - Human apply paths print the explicit manual guidance; JSON preserves the structured action.
- `test/core/archive-fault-matrix.test.ts:1095-1144`
  - Extended completed-corruption coverage to assert recoverable status, the exact blocker, `resumed: true`, the published existing journal, absent stage journal, durable `integrityFailure`, retained `phase: complete`, no recovery command, explicit safe manual action, byte-identical repeat result/journal, and preserved corrupt bytes.
- `test/core/archive.test.ts:86-169`
  - Extended the real saved-token CLI round trip to prove consumer output does not reintroduce an automatic retry command and that the published terminal journal remains complete with durable integrity metadata.

The published journal and marker remain archive control files excluded by `ARCHIVE_CONTROL_FILENAMES`, so writing terminal metadata does not perturb the completed payload fingerprint.

## Verification evidence

- Focused terminal-integrity regression: PASS, 1/1.
- Full fault matrix: PASS, 31/31.
- Exact archive suite, split to remain bounded:
  - `archive-engine`, `archive-consumer-integration`, `archive-fault-matrix`: PASS, 58/58 with 1 POSIX-only skip on Windows.
  - Remaining seven archive/accounting/ephemera/template files: PASS, 111/111.
  - Combined: PASS, 10/10 files, 169/169 tests, 1 expected skip.
- Adjacent work/completion tests:
  - `test/commands/work.test.ts`: PASS, 20/20.
  - `test/core/completions/command-registry.test.ts`: PASS, 7/7.
- `pnpm build`: PASS.
- `pnpm lint`: PASS.
- `pnpm exec tsc --noEmit`: PASS.
- `node bin/rasen.js --help`: PASS (exit 0).
- `node bin/rasen.js archive --help`: PASS (exit 0; `--save-plan`, `--apply-plan`, `--intent-template`, and `--intent-file` present).
- `node bin/rasen.js work migrate --help`: PASS (exit 0).
- `node bin/rasen.js validate file-placement-hardening-archive-engine --json`: PASS, 1/1 valid.
- `git diff --check`: PASS; repository CRLF conversion warnings only.

## Reviewer focus

Re-review the terminal branch around `src/core/archive-engine.ts:3717-3779` independently. In particular, confirm that the durable alert is authoritative on repeat, the journal phase stays `complete`, `recoveryCommand` stays absent through the CLI adapter, and manual guidance is explicit enough for operator triage.
