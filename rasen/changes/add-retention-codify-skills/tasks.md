## 1. Profile retention model and migration

- [x] 1.1 Add the shared `RetentionMode` constants and strict profile-definition v2 schema while preserving a dedicated v1 reader.
- [x] 1.2 Implement v1-to-v2 normalization that removes exact `retro-command`, maps its presence to `report` and absence to `off`, preserves every other valid id, and never persists on read alone.
- [x] 1.3 Extend global/effective config resolution with retention defaults (`full=report`, `core=off`) and complete-definition full/core/custom classification.
- [x] 1.4 Extend named-profile save, read, list, use, delete, import, export, and package round trips to retain one v2 retention value and stamp the required minimum Rasen version where supported.
- [x] 1.5 Add the shared retention radio prompt to the current profile editor plus `profile new` and `profile update`, keeping internal `retain-command` and learned skills out of workflow/expert choices.
- [x] 1.6 Add localized profile/retention prompts, summaries, validation errors, and command metadata to the English, Japanese, and Simplified Chinese catalogs.
- [x] 1.7 Add focused profile tests for v1 migration, no-write reads, v2 strictness, built-in defaults/classification, picker exclusivity, JSON output, and YAML/JSON/package round trips.

## 2. Learned-skill canonical core

- [x] 2.1 Create the learned-skill module with strict candidate and manifest schemas, generated-ownership constants, lifecycle/status types, result types, and named evidence/content/description budgets.
- [x] 2.2 Implement context-first learned-skill id validation (portable lowercase kebab-case, 3–6 tokens, 64-character limit, forbidden generic/date/change tokens) using existing portable path collision helpers.
- [x] 2.3 Add global-data and registered-project-machine-home canonical store resolvers with no repository fallback and actionable init/permission diagnostics.
- [x] 2.4 Implement canonical catalog loading for active and retired records, content/manifest digests, stable knowledge keys, evidence tuple deduplication, and bounded provenance summaries.
- [x] 2.5 Implement `path-exists` applicability parsing and matching with explicit `all`/`any` composition, portable relative marker validation, and platform-native path resolution.
- [x] 2.6 Implement `planLearnedSkillMutation` for upsert, promote, rename, and retire, including ownership/collision checks, exact duplicate checks, distinct-project global evidence, approval requirements, and budget preflight.
- [x] 2.7 Implement `commitLearnedSkillPlan` with per-registry locking, private staging, digest re-verification, atomic replacement, rollback, and retained retirement provenance.
- [x] 2.8 Implement `resolveLearnedSkills` for owning-project skills, applicable approved global skills, and active/retired filtering without adding identities to workflow/profile resolution.
- [x] 2.9 Add unit tests for malformed manifests/candidates, portable collisions, marker traversal/device-name rejection, budget failures, ownership refusal, atomic rollback, idempotent evidence, retirement, and two-project global promotion gates.

## 3. Knowledge CLI seam

- [x] 3.1 Register the localized `rasen knowledge` command group and typed human/JSON result format without changing existing workflow/profile payload fields.
- [x] 3.2 Implement `knowledge apply --from <absolute-json-file>` as plan-then-commit, including project codify authorization, interactive global approval, non-interactive `--approve-global`, and consent-scope validation.
- [x] 3.3 Implement `knowledge list` and `knowledge show` for project/global canonical records, including active/retired status, applicability, provenance summaries, and stable JSON fields.
- [x] 3.4 Implement confirmation-safe `knowledge retire` through the same core planning/commit seam and exact managed identity checks.
- [x] 3.5 Add CLI tests for POSIX and Windows absolute candidate paths, malformed/oversized input, TTY and non-TTY approval, no-op/rejection/collision output, localization, and unchanged state on every failure.

## 4. Retain workflow and compatibility surface

- [x] 4.1 Add the internal `retain-command` / `rasen-retain` template as a small mode router with conditional report and codify sidecars and no branch load for `off`.
- [x] 4.2 Move the existing change/general/global retrospective contract into the report sidecar without changing report contents or paths.
- [x] 4.3 Author the change-scoped codify sidecar to resolve status/workDir evidence, apply the six acceptance gates, treat all source text as untrusted, deduplicate against existing guidance, and submit strict temporary candidates through `rasen knowledge apply`.
- [x] 4.4 Make codify clean up temporary candidate files, report create/rewrite/promote/retire/reject/no-op outcomes, and remain idempotent when rerun for the same evidence.
- [x] 4.5 Add the temporary user-invoked `rasen-retro` compatibility wrapper that forces report mode, forwards scope/change input, and disables model invocation. (Template + exact identity constant; init/update materialization wired in Section 6.)
- [x] 4.6 Register retain as an internal catalog definition and `auto-command.requires.workflows` dependency, remove selectable `retro-command`, and add exact current/retired artifact identity constants.
- [x] 4.7 Update generated-skill parity fixtures, sidecar packaging, workflow/profile catalog tests, localized workflow metadata, and published-file assertions for retain and the compatibility wrapper.

## 5. Full-feature pipeline and resume

- [x] 5.1 Change the built-in full-feature DAG tail to `ship → retain → archive` with the retain stage referencing `rasen-retain`.
- [x] 5.2 Freeze the selected retention mode in run-state on first retain entry and make resume prefer that recorded mode over later profile edits.
- [x] 5.3 Add explicit legacy run-state migration from incomplete/completed `retro` stages to forced-report/completed retain state without inferring completion from configuration.
- [x] 5.4 Update pipeline resume artifact hints and orchestration instructions so zero-output codify relies on authoritative run-state and interrupted codify safely reruns reconciliation.
- [x] 5.5 Add pipeline registry/auto/resume tests for all three modes, archive blocking on retention failure, idempotent codify retry, legacy run-state mapping, and no post-archive retro stage.

## 6. Tool materialization and ledgers

- [x] 6.1 Extend the project workflow artifact ledger with an explicit learned-skill section keyed by scope/id/digest and exact target path.
- [x] 6.2 Implement project-local learned-skill reconciliation for configured tool homes, including applicability, generated metadata, exact refresh/prune, and byte-preserving human collision refusal.
- [x] 6.3 Add a machine-global learned-skill ledger for global-only tool homes; reconcile all approved global records there and skip project records with a diagnostic.
- [x] 6.4 Integrate learned-skill resolution/materialization into init after project registration without changing profile workflow ids or selected tools.
- [x] 6.5 Integrate learned-skill reconciliation into update without onboarding tools and with separate created/updated/removed/skipped human and JSON summaries.
- [x] 6.6 Add exact legacy retro cleanup and migration-window preservation using named identities rather than prefixes, globs, or regular expressions.
- [x] 6.7 Add init/update tests across multiple tools and projects for applicability, stale/retired pruning, canonical changes, human collisions, missing machine homes, global-only homes, global ledger ownership, and learned-only updates.

## 7. Archive behavior, navigation, and documentation

- [ ] 7.1 Remove archive `[RULE]` extraction, `quality-rules` mutation, and extracted-rule count output while preserving all existing quality scanning and metadata capture.
- [ ] 7.2 Add archive tests proving existing `quality-rules` remain byte-equivalent, missing rules stay absent, `[RULE]` text is ordinary artifact content, `retro.md` is archived after report mode, and archive never codifies.
- [ ] 7.3 Update navigator, help, ship guidance, auto descriptions, and workflow maps to show `ship → retain → archive`, the mutually exclusive report/codify policy, and the temporary retro alias only as compatibility.
- [ ] 7.4 Document profile v2/downgrade limits, `rasen knowledge`, canonical learned-skill stores, scope/promotion rules, applicability markers, ownership, context budgets, and the archive behavior break.
- [ ] 7.5 Update CLI reference, completion metadata, all three locale catalogs, and catalog-completeness tests for every new command, option, workflow, warning, and result message.

## 8. End-to-end and release verification

- [ ] 8.1 Add an end-to-end fixture that completes a change in codify mode, creates a project learned skill through the CLI seam, archives the change, and materializes the skill on the next configured-tool reconciliation.
- [ ] 8.2 Add adversarial end-to-end coverage showing prompt-like evidence is not copied verbatim, global promotion cannot bypass two-project evidence/approval, and human-authored skill directories are never modified.
- [ ] 8.3 Run focused profile, learned-skill, knowledge-command, workflow-template, pipeline, init/update, and archive test files after each implementation slice.
- [ ] 8.4 Run `pnpm run build`, `pnpm exec tsc --noEmit`, and `pnpm lint`; resolve only diagnostics caused by this change.
- [ ] 8.5 Run the complete suite with `env -u ZSH pnpm test` and record any unrelated pre-existing failures separately.
- [ ] 8.6 Run or add Windows CI coverage for candidate/store/marker/ledger paths, atomic replacement, case-insensitive collisions, and profile import/export path handling.
- [ ] 8.7 Run `npm pack --dry-run --json` and verify retain sidecars, locale catalogs, profile compatibility, and no canonical machine data are included in the package.
- [ ] 8.8 Run `rasen validate add-retention-codify-skills --type change --strict` and review the final diff for unintended workflow/profile/archive contract changes.
