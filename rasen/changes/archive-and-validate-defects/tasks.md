## 1. Shared Spec Reconciliation

- [x] 1.1 Define structured spec-reconciliation issue and analysis types in `src/core/specs-apply.ts`, including stable codes, capability, source, requirement, and missing-scenario fields.
- [x] 1.2 Refactor `MODIFIED` preparation to inspect every requirement before failing, preserving deterministic source/requirement/code ordering and leaving target files untouched.
- [x] 1.3 Add a change-level analysis function that continues across independently parseable capability deltas and returns clean prepared results plus every issue.
- [x] 1.4 Route `buildUpdatedSpec()` and `applySpecs()` through the shared analysis so mutation is refused before the first write when any issue exists.
- [x] 1.5 Replace archive's throw-first spec preparation with the shared analysis and map every issue to a typed archive spec blocker while retaining actions only for clean results.
- [x] 1.6 Add focused reconciliation tests covering multiple stale requirements in one capability, failures across capabilities, unreadable-plus-readable deltas, stable issue ordering, and zero target mutation.

## 2. Canonical-Spec-Aware Validate

- [x] 2.1 Change `Validator.validateChangeDeltaSpecs()` to accept the resolved canonical specs directory and merge preservation warnings from the shared analysis with existing delta-shape issues.
- [x] 2.2 Migrate direct validation, bulk validation, and archive validation callers to pass the selected root's `specsDir` without cwd fallback.
- [x] 2.3 Update human validation rendering to display warning-only issues while preserving exit zero in plain mode; keep JSON issue severity and strict-mode non-zero behavior aligned.
- [x] 2.4 Add command tests for plain warning, strict failure, complete multi-requirement reporting, new requirements without a baseline, and repo/store/project baseline selection.
- [x] 2.5 Add a regression fixture equivalent to B2 and prove `rasen validate --strict` fails before archive while plain validation visibly warns.

## 3. Archive Assertions and Ship-Log Preflight

- [x] 3.1 Add the stable merge-confirmation blocker code and `ArchiveApplyAssertions`/`ArchiveApplyOptions` interfaces; migrate all `applyArchive` callers in one cutover.
- [x] 3.2 Resolve effective apply blockers so `mergeConfirmed` satisfies only the recorded `on-merge` plus `pr` gate and cannot clear tasks, validation, spec, target, identity, or other timing blockers.
- [x] 3.3 Support already-issued version-1 B1 tokens through an exact legacy merge-gate compatibility lookup without changing their plan bytes or hashes.
- [x] 3.4 Pass apply-time confirmation from `ArchiveCommand.applyStoredPlan()` and direct apply while keeping Store v2 outcome, successor, actions, and fingerprints plan-owned.
- [x] 3.5 Consolidate sticky-legacy ship-log reads into one inspection result containing source, digest, recorded commit, delivery mode, and reserved-heading findings.
- [x] 3.6 Track the engine-owned level-two Archive heading in a named constant and add the typed `archive_ship_log_reserved_section` planning blocker before an applicable token is returned.
- [x] 3.7 Keep the staged ship-log collision guard as a typed defense for legacy tokens and source races rather than matching thrown message text.
- [x] 3.8 Add archive command/engine tests proving B1's saved-preview then `--apply-plan --yes` sequence succeeds unchanged, unrelated blockers survive `--yes`, and a reserved heading blocks planning without mutation.

## 4. Recovery Classification and Plan Abort

- [x] 4.1 Extend archive apply results with `abort-required` and an `abortCommand`, and centralize output rules so replay commands appear only for genuinely replayable results.
- [x] 4.2 Classify the typed staged ship-log collision as `abort-required`; preserve existing verified manual-integrity actions and default unknown failures to the established recoverable path.
- [x] 4.3 Add an owner-aware transaction lock derived from the stored transaction directory and acquire it around both stored-plan apply and abort.
- [x] 4.4 Define and strictly validate an abort record beside `plan.json`, with durable `aborting` and `aborted` states bound to transaction id and plan hash.
- [x] 4.5 Implement abort eligibility checks for token/envelope identity, plan-derived containment, absent publication, effective phase no later than `evidence-finalized`, and pending spec/cleaner/association/source progress.
- [x] 4.6 Implement guarded cleanup for a proved-owned early stage and journal, retire `plan.json` last, and make interrupted/completed abort retries idempotent.
- [x] 4.7 Add `--abort-plan <token>` command routing, option conflicts, explicit `--yes` confirmation, human/JSON results, and refusal diagnostics for disputed or durable state.
- [x] 4.8 Thread the same abort and lock contract through Store v2 finalization without permitting outcome, record, target-line, spec, or association rollback.
- [x] 4.9 Add engine and CLI tests for unapplied abort, B6 early-stage abort, interrupted abort resume, completed tombstone replay, apply/abort serialization, identity mismatch, and every non-abortable phase boundary.
- [x] 4.10 Add Windows-sensitive containment tests using `path.join`/`path.resolve`, case aliases, separator variants, and traversal attempts for transaction and stage paths.

## 5. Archive Intent Diagnostics

- [x] 5.1 Replace the compound archive-intent root predicate with an ordered issue collector using explicit allowed-key lists at the root, handoff, decision, and probe objects.
- [x] 5.2 Emit distinct stable diagnostics for unexpected keys, schema version, change binding, handoff completeness/types, decision fields, and probe fields while retaining all existing containment and Git checks.
- [x] 5.3 Add human/JSON tests proving an unexpected `mergeConfirmed` key is named and multiple independent intent failures are returned in deterministic order.

## 6. Read-Only Project Registry Safety

- [x] 6.1 Extract a registration-disposition lookup that distinguishes exact refresh, verified worktree share, moved-root rebind, fresh identity, and live independent duplicate claims under canonical path rules.
- [x] 6.2 Restrict `touchProjectRegistry()` to exact refresh, worktree share, or moved-root rebind; leave first registration to explicit state-requiring operations.
- [x] 6.3 Add project-home/root-selection tests proving `rasen validate` in a copied planning root does not write the registry while legitimate move and worktree self-heal still converge.
- [x] 6.4 Add a shared ambiguity diagnostic that lists sorted canonical claimants with live/missing state, recommends `rasen home prune` only for missing entries, and refuses to choose between live entries.
- [x] 6.5 Route learned-skill project-owner ambiguity through the shared diagnostic and add stale-copy, two-live-copy, case-alias, and Windows path tests.

## 7. Workflow, Instructions, Completion, and Localization

- [x] 7.1 Update spec-driven specs instructions to state whole-requirement replacement, complete surviving scenario inventory, verbatim unchanged scenarios, and stable scenario headings for behavior edits.
- [x] 7.2 Correct the sync-specs workflow so it never describes partial `MODIFIED` blocks as additive merges and stops on shared reconciliation issues.
- [x] 7.3 Update single/bulk archive workflow templates to preflight the reserved heading and branch exactly on `recoverable`, `abort-required`, or verified manual recovery.
- [x] 7.4 Update ship workflow templates so generated logs omit the reserved section and existing collisions fail during preflight before delivery evidence changes.
- [x] 7.5 Add `abort-plan` to Commander help, the completion registry, generated command examples where applicable, and command/registry parity tests.
- [x] 7.6 Add every new structured human message and option description to `src/locales/en.json`, `ja.json`, and `zh-cn.json` with identical keys and interpolation placeholders.
- [x] 7.7 Update workflow golden/parity tests to cover the merge assertion order, reserved heading ownership, recovery disposition, and complete-scenario guidance.
- [x] 7.8 Reconcile single and bulk archive PR handling with the canonical timing contract: independent verification precedes sync/preview/apply, known-open override and unavailable-verification fallback remain interactive and item-specific, and dispatched/non-interactive runs refuse.
- [x] 7.9 Render human abort refusals in durable-state order — blocker messages, effective phase, retained paths, then the localized exact recovery or manual disposition — with no generic replay advice for ownership or integrity disputes.
- [x] 7.10 Extend the canonical management finalization API artifacts and focused contract tests for the explicit `mergeConfirmed` request assertion and nested structured error disposition.

## 8. Verification

- [x] 8.1 Run the focused reconciliation and validation suites, including `test/core/validation.test.ts`, `test/commands/validate.test.ts`, and the new B2 regression cases.
- [x] 8.2 Run the focused archive suites, including `test/core/archive.test.ts`, `test/core/archive-engine.test.ts`, `test/core/archive-consumer-integration.test.ts`, `test/core/templates/archive-engine-consumers.test.ts`, and new B1/B3/B4/B6 cases.
- [x] 8.3 Run `test/core/project-registry.test.ts`, `test/core/project-home.test.ts`, `test/core/root-selection.test.ts`, and `test/core/learned-skills/context.test.ts` for B5 and owner diagnostics.
- [x] 8.4 Run locale catalog parity, completion parity, and workflow-template tests after all generated surface updates.
- [x] 8.5 Build the CLI, then smoke-test the real saved-plan/apply-confirmation path and reserved-heading plan/abort/re-plan path against temporary isolated roots.
- [x] 8.6 Run `pnpm exec tsc --noEmit`, `pnpm lint`, and `env -u ZSH pnpm test`; investigate any failure rather than narrowing the claimed verification scope.
- [x] 8.7 Confirm the repository's Windows CI job executes the new path-sensitive archive and registry regressions, and record the passing job as cross-platform evidence.
  - Evidence: GitHub Actions run [31355525652](https://github.com/DumoeDss/rasen/actions/runs/31355525652) passed at exact head `21e9c0a75a36f0845dcf4771f53759e9fceb519d`; [Windows shard 1](https://github.com/DumoeDss/rasen/actions/runs/31355525652/job/93354366692), [shard 2](https://github.com/DumoeDss/rasen/actions/runs/31355525652/job/93354366688), and [shard 3](https://github.com/DumoeDss/rasen/actions/runs/31355525652/job/93354366683) completed the disjoint `143 + 142 + 142 = 427`-file manifest with 7,473 passed, 47 skipped, and 0 failed tests, including the path-sensitive archive/finalization and project-registry regressions. The [PR aggregate](https://github.com/DumoeDss/rasen/actions/runs/31355525652/job/93356944247) passed.
- [x] 8.8 Run `npm pack --dry-run --json` and verify the published schemas, skills, completion metadata, and all three locale catalogs contain the updated contracts.
