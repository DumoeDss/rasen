# Apply handoff — implementer 3

## Status

HANDOFF at the requested soft-budget boundary. The actual task ledger is **41/60 complete, 19 remaining**. No remaining checkbox was inferred from interrupted claims, and no new implementation section was started in this revival.

Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-wt-store-coordinator-migration-017`

Branch: `feat/store-owned-coordinator-migration-0.1.7`

Change: `migrate-cross-project-coordinators-to-store-issues` (schema `spec-driven`, repo-local planning home)

Do not commit, push, open a PR, or edit `.rasen/**` from this handoff. Preserve every existing shared-worktree edit.

## Safe boundary reverified in this revival

The prior interrupted edit had changed receipt-v2 mapping provenance to a Store-relative path but left `receipt.ts` calling `storeRelative(...)` without importing it. This revival added only the missing import:

```ts
import { storeRelative } from './flat-source.js';
```

After that repair:

- `pnpm run build` passed.
- `pnpm exec vitest run test/core/store/layout-migration-apply-recovery.test.ts test/core/store/store-issue-locks.test.ts --reporter=dot` passed **61/61** in 225.53s.
- `pnpm exec vitest run test/core/store/layout-migration-catalog-receipt.test.ts test/core/store/store-issue-layout.test.ts test/core/store/store-aggregate-query.test.ts test/commands/store-issue-cli.test.ts test/commands/store-references.test.ts --reporter=dot` passed **93/93** in 221.64s.
- `git diff --check` returned exit 0. Git emitted the existing `LF will be replaced by CRLF` working-copy warnings; it reported no whitespace error.
- A strict UTF-8 scan of 38 changed/untracked text files (excluding `.rasen/**`) found **0 invalid UTF-8 files and 0 BOMs**. Its raw sentinel scan intentionally matched one replacement-character rejection assertion and the new mojibake-rejection regex literals in `apply.ts`, `mapping.ts`, `plan-input.ts`, and `receipt.ts`; these are test/validation literals, not decoding corruption.

An earlier attempt to run four large Vitest groups concurrently with 240s per command timed out at the orchestration boundary and returned no trustworthy group results. It was not an assertion failure. The two single-process commands above are the authoritative reruns; retain their 600s timeout because both took about 225s.

## Interrupted work now present but deliberately unchecked

Tasks 5.8, 6.5, and 6.7 have substantial candidate implementation and tests in the tree, and the focused 61-case suite passes, but their exact requirement matrices have not been fully audited. Keep them unchecked until that audit closes the remaining seams.

Present candidate work includes:

- deterministic semantic publication checkpoints, with a no-op production implementation;
- per-key Issue-batch acquisition observation;
- barriers/checkpoints for plan-input read, generated-file write/digest verification, each Issue lock, migration-run lock, generated destination precondition, prepared/completed manifest persistence, rename, receipt/layout flip, source removal, and final manifest persistence;
- ordinary explicit-Store Issue writes acquiring the canonical Issue key before layout-v2 scope validation;
- recovery ownership preflight for prepared/completed operations before resume or rollback mutation;
- stable recovery codes `migration_recovery_ambiguous`, `migration_recovery_digest_mismatch`, and `migration_recovery_unrecorded_destination`;
- strict raw-byte UTF-8/BOM/U+FFFD/mojibake checks for mappings and receipts, mojibake checks for generated trees, and Store-relative receipt-v2 mapping provenance.

Known coverage gaps to audit before checking those tasks:

- 5.8: the seven ordinary create/state/plan publication barriers, create-first case, same-ref contention, canonical batch order/dedup/reverse release, and overlapping/disjoint lock batches are present. Confirm the requirement's **real different-ref migration** matrix is satisfied rather than only the lower-level batch-lock proxy.
- 6.5: injected pre-publication and publication faults mostly prove lock release and fresh-process resume. Confirm every named fault proves the required complete-flat/complete-v2 state and the appropriate **resume, rollback, or retire** continuation, not resume alone.
- 6.7: fresh-process resume covers target-line, item, Issue, and receipt after-rename crashes; rollback is explicitly covered after Issue rename, and absent/both-present/unrecorded/digest-mismatch are checked for both resume and rollback. Confirm whether rollback must also be exercised for every other after-rename operation kind and add those vectors if so.

The latest encoding hardening is also only implementation scaffolding for 9.3/9.4. Add strict vectors before treating it as complete. In particular, review whether the broad U+00C3/U+00E2 mojibake sentinel rejection can reject legitimate non-ASCII text and refine it to the intended typical sequences if the vectors expose false positives.

## Exact remaining 19 tasks

1. **5.8** — Add deterministic barrier-driven interleaving tests, without timing sleeps, for ordinary `create`, `setState`, and `publishPlan` at generated-destination precondition, prepared-manifest, rename, completion-mark, receipt, layout-flip, and final-manifest boundaries: prove a create that owns the key first makes migration revalidation refuse unchanged, held-window mutations write nothing, post-release create sees existing while state/plan read the canonical live tree, and generated bytes/digests equal the frozen plan and receipt before release; also prove canonical multi-key order, duplicate collapse, later-key acquisition failure and callback exception reverse-release, and two same/different-ref migrations with overlapping/disjoint Issue sets plus ordinary commands complete or return bounded contention/semantic refusals without deadlock.
2. **6.5** — Add fault injection at plan-input read, generated-file write, generated-tree digest verification, each Issue-batch acquisition, migration-run acquisition, prepared-operation manifest write, immediately after Issue-root/project-tree/receipt rename but before completion marking, completion-mark write, layout flip, source removal, and final manifest write; assert acquired locks release in the specified reverse order and each failure leaves either the complete flat state or complete v2 state with a working resume/rollback/retire path.
3. **6.7** — Add real process-restart recovery cases for each after-rename/before-completion crash: reload the durable manifest in a fresh module instance, prove matching output ownership from prepared run identity plus digest, exercise both resume and rollback, and prove absent, both-present, unrecorded, and digest-mismatched destinations are blocked without deletion.
4. **8.1** — Add stable migration diagnostics and human/JSON rendering for every new mapping, plan-input, source-safety, compilation, destination, verification, provenance, and recovery failure, plus the non-blocking `no plan supplied; no nodes invented` continuation using the existing Issue plan command.
5. **9.1** — Extend `layout-migration-windows-paths.test.ts` with `path.win32` and native-Windows cases for mixed-case drive letters, slash/backslash aliases, UNC/long paths, case-fold Issue collisions, junction containment, and Store-relative receipt paths.
6. **9.2** — Add `path.posix` and macOS/Linux cases for case-sensitive siblings, case-insensitive collision simulation, symlink containment/escape, long paths, and identical multi-ref behavior without hardcoded separators.
7. **9.3** — Add non-ASCII Store/mapping/plan/source filenames and Chinese Issue titles to mapping, compiler, staging, receipt, recovery, archive diagnostic, and Git-restore tests; assert exact bytes and paths without sanitization.
8. **9.4** — Add strict text vectors for UTF-8 without BOM, UTF-8 BOM, invalid byte sequences, U+FFFD, and typical mojibake sentinels across mapping, plan input, generated YAML, and receipt JSON; generated artifacts must round-trip cleanly on Windows, macOS, and Linux.
9. **9.5** — Add or extend Windows CI execution for the focused migration/Issue/archive suites and ensure macOS/Linux CI runs the native symlink, case-sensitivity, and Git-ref cases with platform-specific skips limited to unavailable filesystem primitives.
10. **10.1** — Build a committed test fixture from the real scene-bridge shape with active `time-qualified-preview-render-job-and-reference-video` and archived `2026-08-01-core-project-and-scene-lifecycle`, `2026-08-01-protocol-spine-and-live-cube`, and `2026-08-03-named-camera-shot-camera-path-and-timeline`, preserving representative bytes without depending on the external checkout at test time.
11. **10.2** — Author a v2 fixture mapping that explicitly imports the active coordinator open and explicitly declares each archived coordinator's legal state and reason; include project Changes plus at least one clean plan input using `sourceChange`, and leave one Issue without a plan.
12. **10.3** — Add an end-to-end CLI journey covering inventory, mapping preview, human/JSON parity, immutable token apply, project identity minting, generated Issue reads, canonical revision/reference verification, no-plan continuation, receipt inspection, publication commit suggestion, and separate retirement.
13. **10.4** — Extend the journey with a second flat ref and same-named content, destination conflicts, injected interrupted publication/resume, rollback before retirement, retirement retry, post-retirement Git source restore/digest verification, and proof that member code repositories never change.
14. **10.5** — After retirement, exercise ordinary direct-selector `rasen archive` against the converted active alias with no outcome and assert `legacy_coordinator_became_issue`; assert token-owned apply/abort never query receipts, the three archived-source aliases do not redirect, and a real v2 Change without an outcome still returns `finalization_outcome_required` before normal finalization can proceed.
15. **11.1** — Update Store migration and command documentation with mapping v2 examples, v1 compatibility, plan-input tracking rules, active/archive state semantics, Store-source provenance, no-plan follow-up, archive diagnostic, rollback/retirement recovery, and the explicit 0.1.7 compatibility-only version boundary.
16. **11.2** — Add regression assertions that no new command/completion, public Issue import method, coordinator index, second receipt authority, automatic acceptance, Change back-reference, member-repository write, or legacy-tree copy was introduced.
17. **11.3** — Run the focused mapping, plan-gate, provenance, catalog/receipt, apply/recovery, doctor, Issue resource/CLI/query, archive, Windows-path, and end-to-end suites; fix root causes and retain fault evidence for any platform-specific failure.
18. **11.4** — Run `pnpm lint`, `pnpm test`, and `pnpm build`, then run the repository's release-contract checks that apply to 0.1.7 and verify no unrelated generated or main-spec files changed.
19. **11.5** — Run strict Change validation, inspect human and JSON status as apply-ready, check `git diff --check`, and strictly decode every changed source/spec/doc/test file as UTF-8 while rejecting BOM, U+FFFD, mojibake, unintended line-ending rewrites, and out-of-scope diffs.

## Recommended continuation order

1. Audit and close 5.8, 6.5, and 6.7 from the exact gaps above; rerun the 61-case command and only then mark each proven task complete.
2. Complete 8.1 as an explicit human/JSON diagnostic matrix. Do not infer parity from codes existing in production types.
3. Complete 9.1–9.5. Add the encoding vectors before trusting the latest strict-decoding implementation; run native Windows junction/UNC/long-path cases here and design POSIX/macOS tests with narrow platform skips.
4. Build the committed scene-bridge fixture and one coherent E2E journey for 10.1–10.5. Do not depend on the external scene-bridge checkout at test time.
5. Complete docs and negative-surface regressions, then run the full focused/full/lint/build/release/validation/encoding/scope audit for 11.1–11.5.

## Working-tree cautions

- The shared diff is large (about 4.2k added lines before this handoff). Do not revert or reformat unrelated edits.
- `.rasen/` is untracked process ephemera and must not be committed. The repo-local `rasen/changes/migrate-cross-project-coordinators-to-store-issues/` tree is the intended Change artifact tree.
- `pnpm run build` updates ignored `dist/`; it is not part of the source diff.
- Git currently warns that many LF files would become CRLF if rewritten. Continue using `apply_patch`; avoid whole-file PowerShell rewrites and audit line endings at task 11.5.
- The full suite, lint, release-contract checks, native macOS/Linux vectors, and strict Change validation have not been run at this boundary.
- Do not mark a task complete merely because a checkpoint, diagnostic code, or test name exists. Match every clause in `tasks.md`, then check the box immediately after the focused evidence passes.
