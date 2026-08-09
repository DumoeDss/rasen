## Context

The report covers three seams that currently disagree with their callers:

1. Archive planning freezes `decisions.timing.override`, but every generated consumer deliberately supplies `--yes` only to `--apply-plan`. A saved plan without the override therefore contains a timing blocker that apply cannot satisfy.
2. `buildUpdatedSpec()` owns the authoritative `MODIFIED` replacement and scenario-preservation logic, while `Validator.validateChangeDeltaSpecs()` validates only delta shape. Archive sees canonical-spec drift; author-time validation does not. The builder also throws on the first stale requirement, so planning cannot report the full set.
3. The archive engine validates reserved ship-log content only while transforming the stage. At that point a plan and journal exist, but every apply failure is classified as recoverable even when replaying immutable input must fail identically.

A fourth, independent seam is project registry self-healing. `touchProjectRegistry()` is invoked by root resolution and calls the state-creating `registerProject()` even for a previously unknown path. A copied config can therefore enroll a throwaway root during `validate` and make later project-owner resolution ambiguous.

The design must retain immutable mutation plans, no-clobber archive publication, source-last deletion, strict path containment, Store v2 finalization locks, and cross-platform path identity. The existing `withOwnerAwareFileLock()` primitive and `FileSystemUtils` canonicalization remain the concurrency and path foundations.

## Goals / Non-Goals

**Goals:**

- Make generated saved-plan/apply invocations work as documented without allowing `--yes` to bypass validation, task, spec, identity, or publication blockers.
- Give validate and archive one structured view of canonical-spec reconciliation, including every omitted scenario.
- Detect reserved ship-log content before issuing an applicable token and classify apply failures by whether exact-token replay can progress.
- Provide a narrow, idempotent abort path for a token-owned transaction that has not crossed a durable mutation boundary.
- Keep read-only root resolution mutation-free for unknown paths and make existing registry ambiguity actionable.
- Keep human and JSON diagnostics deterministic and structurally equivalent.

**Non-Goals:**

- Changing merge-state verification, weakening the recorded-fact merge gate, or allowing an override of a closed-unmerged PR in generated workflows.
- Changing delta replacement semantics, automatically restoring omitted scenarios, or inventing scenario rename inference.
- Reversing canonical-spec writes, publication, cleaner deletion, association finalization, or active-source removal.
- Automatically editing a copied root's `projectId`, choosing one live duplicate root, or deleting registry entries without an explicit prune operation.
- General transaction rollback or recovery from unverified/manual integrity failures.

## Decisions

### 1. Keep operator assertions outside the immutable mutation plan

Introduce an apply options interface at the archive engine seam:

```ts
interface ArchiveApplyAssertions {
  mergeConfirmed?: boolean;
}

interface ArchiveApplyOptions {
  adapters?: ArchiveEngineAdapters;
  assertions?: ArchiveApplyAssertions;
}
```

`applyArchive(plan, options)` will derive effective blockers from the hashed plan plus the invocation assertions. `mergeConfirmed` may satisfy only the typed `archive_merge_confirmation_required` blocker whose recorded timing facts are `on-merge` plus `pr`; it cannot remove any other `timing` blocker or any blocker from another operation. New plans record that stable blocker code. Existing version-1 plans are supported through an exact legacy-code/message compatibility lookup so already-issued B1 tokens can be applied; no plan bytes or hash are rewritten.

`ArchiveCommand.applyStoredPlan()` passes `mergeConfirmed: options.yes === true`. Direct unsaved apply passes the same assertion from its planning invocation. Store finalization outcome, successor, spec actions, paths, and fingerprints remain plan-owned and cannot be supplied or changed at apply time.

Alternative A was to add `--yes` to every save-plan command. That would leave already-saved plans trapped and would continue modeling an outside-world assertion as mutation content. Alternative B was to clone and re-hash the plan at apply time. That would make the reviewed token cease to identify the applied plan. The chosen interface preserves token identity while narrowly satisfying a typed runtime gate.

### 2. Add one structured spec-reconciliation analysis seam

Deepen `src/core/specs-apply.ts` around a structured analysis result rather than parsing thrown prose:

```ts
interface SpecReconciliationIssue {
  code: string;
  source: string;
  capability: string;
  requirement?: string;
  missingScenarios?: string[];
  message: string;
}

interface SpecReconciliationAnalysis {
  prepared: BuiltSpecUpdate[];
  issues: SpecReconciliationIssue[];
}
```

The analysis reads each delta and its resolved canonical target, validates every `MODIFIED` requirement against the current block, and returns deterministic issues sorted by source, requirement, and code. A structurally unreadable spec produces one root issue for that spec; independent specs and requirements continue to be analyzed. No target is written during analysis.

`Validator.validateChangeDeltaSpecs(changeDir, canonicalSpecsDir)` maps scenario-preservation issues to `WARNING`; the validator's existing strict policy promotes warnings to a failing report. `ValidateCommand` supplies the selected root's `specsDir` for direct and bulk validation. Archive preparation consumes the same analysis, maps every issue to a typed spec blocker, and creates actions only from clean prepared results. `applySpecs()` fails before its write phase when analysis contains issues.

Alternative A was to duplicate the missing-scenario comparison inside `Validator`. It is initially smaller but creates two definitions that can drift again. Alternative B was to catch `buildUpdatedSpec()` exceptions and parse their English messages. That makes diagnostics an unstable interface and still stops at the first throw. The structured seam gives callers leverage while keeping reconciliation knowledge local.

### 3. Inspect ship evidence once during planning

Replace separate delivery-mode and plan-projection reads with one ship-log inspection that returns the selected sticky-legacy path, digest, recorded commit, delivery mode, and reserved-section issue. The exact engine-owned heading is tracked by a named constant and matched as a level-two Markdown heading; callers do not search arbitrary English prose.

A pre-existing `## Archive` heading always produces an `archive_ship_log_reserved_section` planning blocker naming the selected ship log and instructing the operator to remove or rename the section before saving a new plan. No blocker-free token is issued. The apply-time guard remains as defense in depth for legacy tokens and races.

Workflow templates interpolate the same named heading contract: ship must never author it, and archive/bulk archive must check it before planning. This check belongs in the CLI as well as the workflows so direct command and management callers cannot bypass it.

### 4. Classify exact-token recovery from typed failures

Add an apply outcome for a deterministic, early, plan-bound conflict:

```ts
type ArchiveApplyStatus =
  | 'complete'
  | 'blocked'
  | 'recoverable'
  | 'abort-required';
```

The staged ship-log collision throws a typed conflict carrying `abort-required`; catch logic does not infer classification from message text. `recoverable` is reserved for failures where replay can advance after a transient/external repair without changing hashed source. Integrity failures continue to expose their verified manual action and never receive a fabricated replay command. `abort-required` returns an `abortCommand`, not a recovery command.

This is intentionally not a general error classifier in this change. Unknown errors remain recoverable unless an existing integrity path supplies manual recovery; only proven deterministic conflicts get the terminal outcome.

### 5. Retire only early, token-owned transaction state

Add `rasen archive --abort-plan <token> --yes` (and localized completion metadata). It is mutually exclusive with change names, planning options, and `--apply-plan`; JSON/non-interactive use requires `--yes`. Both stored-plan apply and abort acquire one owner-aware lock derived from the transaction-store directory, preventing apply/abort races.

The transaction store gains an abort record beside `plan.json`. Abort writes intent first, performs guarded cleanup, then records completion and retires `plan.json` last. Re-running abort resumes an in-progress abort or reports the completed tombstone; applying a token with an abort record fails closed.

Abort is allowed only when all of these are proved from the token, plan, journal, and on-disk identities:

- the plan envelope hash and transaction id are valid;
- no published destination or published journal exists;
- the journal is absent or belongs to the same plan and its effective phase is no later than `evidence-finalized`;
- every spec, cleaner, association, and source-removal progress entry remains pending;
- any stage to remove is the plan-derived sibling path and its journal/fingerprint proves transaction ownership.

An unapplied token retires only its transaction-store record. An owned early stage and journal are removed with the existing guarded tree-deletion primitives. Missing or mismatched ownership, any canonical-spec progress, publication, cleaner progress, association progress, or source progress blocks abort and points back to exact-token resume or existing manual recovery. Windows and POSIX containment use `path.resolve`/`path.join` plus existing path-flavor helpers; no slash parsing or case-sensitive path assumption is introduced.

Alternative A was to let apply discard and re-plan automatically. That breaks the reviewed-token contract and can race a second operator. Alternative B was to document manual stage/journal deletion. That bypasses ownership and fingerprint checks. The phase-limited command is a small interface over the necessary state machine.

### 6. Emit archive-intent issues per constraint

Keep the current strict accepted shape, but replace the compound root predicate with an ordered issue collector. It reports unexpected keys at the root, `handoff`, decision, or probe object; wrong schema version; change mismatch; incomplete handoff; wrong collection types; and existing path/outcome/commit constraints separately. Unexpected-key diagnostics include the exact key and structured location. The projection remains invalid when any issue exists, and all issues remain archive blockers.

Using the existing explicit allowed-key lists is preferred over adding a second schema dependency or matching serialized error prose. Issue ordering is stable for human/JSON parity.

### 7. Make project self-healing update-only for unknown live roots

Extract a registration-disposition lookup shared by self-heal and registration. For a root carrying a `projectId`, it distinguishes exact refresh, verified worktree sharing, moved-root rebind (the prior path is gone), fresh identity, and a live independent path claiming an existing identity.

`touchProjectRegistry()` may perform only exact refresh, verified worktree sharing, or moved-root rebind. With no existing claim, or with a live non-worktree claim, it returns without writing; first registration remains owned by explicit state-requiring paths such as init/project-home ensure. This preserves move and worktree recovery while a read-only `validate` in a copied root cannot enroll it.

Owner ambiguity diagnostics enumerate sorted canonical paths and whether each still exists. If a claimant is missing, the fix names `rasen home prune` followed by the original command. When all claimants are live, the diagnostic refuses to choose and names identity repair rather than falsely claiming prune will remove a live root. No automatic id rewrite or arbitrary winner is permitted.

## Risks / Trade-offs

- [Risk] Apply-time `--yes` accidentally suppresses unrelated blockers. → Match one stable blocker code plus recorded timing facts; regression-test tasks, validation, generic timing failures, and Store v2 outcome immutability.
- [Risk] Canonical-spec-aware validation becomes slower in bulk mode. → Read each selected delta/target once through the shared analysis and preserve existing bounded command concurrency; no extra full-tree scan.
- [Risk] Abort deletes a stage while apply is active. → Require the shared owner-aware transaction lock and phase/identity revalidation immediately before guarded deletion.
- [Risk] A crash during abort strands new control state. → Persist abort intent before cleanup, make the operation idempotent, and retire `plan.json` only after completion.
- [Risk] Legacy B6 tokens lack typed failure metadata. → Keep the apply-time heading guard typed at execution and allow abort only after reading the legacy journal under the same ownership checks.
- [Risk] Update-only self-heal stops silently enrolling a legitimate fresh clone. → Explicit state-requiring commands retain registration; read-only commands remain read-only, matching their user-facing contract.
- [Risk] New diagnostics alter snapshots and localized output. → Add stable codes/values, update English/Japanese/Simplified Chinese catalogs together, and test JSON separately from rendered prose.

## Migration Plan

1. Add structured issue/assertion/status types and migrate all internal callers in one cutover; retain version-1 stored plan decoding.
2. Land shared reconciliation analysis and route validate/archive/apply through it before changing user guidance.
3. Add plan-time ship-log inspection and typed apply fallback, then add the transaction lock and abort state machine.
4. Make project self-heal disposition-aware and update ambiguity diagnostics without rewriting existing registry data.
5. Update workflow templates, schema rules, completions, locale catalogs, and generated consumers after the command contracts are executable.
6. Existing B1 tokens become applicable with `--apply-plan <token> --yes`. Existing B6 tokens report `abort-required`; after `--abort-plan <token> --yes`, the operator removes or renames the reserved heading and creates a new plan. Existing duplicate registry entries are not deleted automatically; missing-path entries are repaired with `rasen home prune --apply`.

Rollback is code-only for validation, diagnostics, and self-heal. Completed abort tombstones deliberately leave no `plan.json`, so an older binary fails safely rather than replaying a retired token. No canonical spec or project config migration is required.

## Open Questions

None. The change deliberately limits abort to pre-spec, pre-publication phases and limits apply-time assertions to the recorded PR merge-confirmation gate.
