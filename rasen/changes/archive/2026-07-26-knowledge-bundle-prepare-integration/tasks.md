## 1. Re-verify landed seams

- [x] 1.1 Re-verify F3's final `importKnowledgeBundle`, result/error/plan types, `changed: "unknown"` rollback arm, `staging_cleanup_deferred` warning, project-selector requirements, and injectable boundaries. Call this core seam directly; do not invoke the CLI or recreate validation, classification, conflict, owner, source, evidence, lock, or transaction policy.
- [x] 1.2 Re-verify the final project-first and Store-first `buildBootstrapReport` flows, `BootstrapReport.knowledge`, `BootstrapConsent` / `BootstrapConsentRequest`, `confirmAction`, obtain/register ordering, and `computeBootstrapEndState`; preserve directory hydration as a different result from bundle import.
- [x] 1.3 Re-verify `ProjectConfigSchema` plus its resilient field parser, strict `StoreProjectRecord` parse/serialize/equality paths, `StoreMembershipRecord` projection, and the post-obtain membership re-read before choosing the declaration representation.
- [x] 1.4 Confirm F3 and E2 dependencies are present, F4 owns exactly one disjoint ADDED requirement, and doctor/E4 readiness, Store mutation/publication, import redesign, Phase E implementation, interactive conflict reconciliation, and portable checkpoints remain outside the edit set.

## 2. Durable declarations and safe path resolution

- [x] 2.1 Add optional non-empty `knowledgeBundle: string` parsing to project configuration, with a field-local diagnostic that preserves valid siblings; resolve it only relative to the project root and never create or rewrite the config while reading it.
- [x] 2.2 Extend the strict version-1 Store project-record schema, interface, named serializer, parser, equality/write paths, and `StoreMembershipRecord` projection with optional `knowledgeBundle`; preserve old records byte-identically and keep the value a locator only.
- [x] 2.3 Add one `resolveDeclaredKnowledgeBundle(ownerRoot, locator)` seam shared by both sources. Reject Windows drive-letter, Windows network-share, and POSIX absolute forms on every host; reject lexical parent escape and existing-target symlink escape; return structured usable, missing, unreadable, or unsafe facts with the declaration path and repair.
- [x] 2.4 Build deterministic declaration entries per permanent project identity, de-duplicate the same canonical path while retaining every source, give a duplicate project-config source project trust, keep different paths as separate actions, and sort without locale-dependent order.

## 3. Distinct preparation action and both bootstrap origins

- [x] 3.1 Add a distinct optional `bundleImports` action/result collection to `BootstrapReport`, with stable action key, project identity/root, locator/resolved path, source list, trust, availability/outcome, F3 plan/result/refusal facts, repairs, warnings, retained paths, and changed state. Do not overload `knowledge`, Store/project entries, or durable-declaration outcome.
- [x] 3.2 In project-first check/preview, collect the project's config declaration and every currently readable Store membership-record declaration. In apply, collect again after register/obtain/re-verification and knowledge hydration so a Store made available in this run may reveal its declaration.
- [x] 3.3 In Store-first preparation, carry each Store project record's locator into its target project action and add the local project's committed-config locator when the checkout is present or has just been explicitly obtained. List a Store locator for an absent project with its existing obtain repair, but do not attempt import until that permanent project resolves locally.
- [x] 3.4 Extend end-state computation so any declared action left missing, unreadable, unsafe, unconfirmed, conflicting, refused, or rollback-unknown degrades without blocking; successful/already-present actions do not degrade, and no declaration leaves the existing report and filesystem unchanged.

## 4. Consent and direct F3 import

- [x] 4.1 Extend `BootstrapConsentRequest` with a localized `import-bundle` action. Blanket `--yes` covers an action whose sources include project config, but never an action named only by Store records; keep these branches explicit rather than collapsing them behind a generic truthy declaration predicate.
- [x] 4.2 For each usable, locally targetable action, call `importKnowledgeBundle(..., dryRun: true)` directly to obtain the complete plan/refusal immediately before consent. Unsafe/missing declarations never reach F3, and the declaration source is never passed as owner, source, evidence, membership, or publication input.
- [x] 4.3 Only after confirmation call the same F3 seam in apply mode. Preserve conflict details, added/already-present arrays, warnings, `changed`, retained paths, and rollback honesty; treat `staging_cleanup_deferred` as successful-with-warning and `changed: "unknown"` as degraded without claiming no knowledge landed.
- [x] 4.4 Continue every unrelated bootstrap step and report every declared action when one action is unavailable, unconfirmed, invalid, conflicting, or fails. Prove Store catalogs, project records, metadata, membership, Git index, commits, and remotes are unchanged by bundle import.

## 5. Command output, help, and locales

- [x] 5.1 Replace the provisional content-free `knowledgeBundleStep` rendering with the real distinct action list. Keep human and JSON facts aligned for source/trust, project, path, availability/outcome, plan counts/conflicts, warnings, refusal, repair, retained paths, and changed state.
- [x] 5.2 Add every prompt, trust label, state, refusal, repair, warning, and help phrase through `src/commands/bootstrap-messages.ts` and `src/locales/{en,zh-cn,ja}.json`, with no inline command English and no English fallback in Chinese or Japanese.
- [x] 5.3 Update bootstrap apply/`--yes` descriptions in Commander and `src/core/completions/command-registry.ts` to state the declared-bundle step and Store-only asymmetry; add no new flag, and keep existing mode/flag parsing behavior intact.

## 6. Focused acceptance and cross-platform coverage

- [x] 6.1 Test no declaration in both bootstrap origins: no action listed, no F3 call, no imported record, and existing report/filesystem behavior unchanged.
- [x] 6.2 Test a project-config declaration is listed separately, imports nothing without confirmation, and imports through F3 under project-first blanket `--yes`; assert the on-disk project owner, empty transport sources, unchanged evidence, and no Store mutation.
- [x] 6.3 Test a Store-record-only declaration is listed under `--yes` with the explicit import choice but F3 apply is never called; then explicitly confirm it and prove the same action imports. Cover a locally present project and a Store-first project made available by explicit obtain.
- [x] 6.4 Test duplicate and divergent declarations: the same canonical path becomes one action with both sources and project trust; different paths remain separate actions; two Store records naming one path do not cause two prompts or imports.
- [x] 6.5 Test missing, unreadable, unsafe, wrong-project, malformed, and conflicting declarations: each degrades with its repair, conflict carries F3's complete plan, no refused action writes knowledge, and unrelated registration/obtain/hydration/declaration work still completes.
- [x] 6.6 Add Windows-aware tests using `path.join()` / `path.resolve()` expectations for project-root and Store-root resolution, drive-letter/network-share/POSIX absolute rejection on every host, `..` escape, symlink escape where supported, separator/case-equivalent de-duplication, and confirm Windows CI covers every path-sensitive file.

## 7. Documentation and release contract

- [x] 7.1 Update `docs/cli.md` with both declaration locations and relative-root rules, the distinct bundle action/result, no-declaration behavior, confirmation asymmetry, degraded repairs, and human/JSON examples for project-trusted, Store-only, missing, and conflicting bundles.
- [x] 7.2 Update `docs/retention-and-learned-skills.md` and `docs/migration-guide.md` with the three-way knowledge distinction, how to commit a safe declaration, what `--yes` does and does not trust, and how to repair or explicitly import a Store-declared bundle.
- [x] 7.3 Update the `0.1.5` `CHANGELOG.md` to state that declared bundle import is now part of machine preparation while doctor integration, automatic synchronization, interactive conflict reconciliation, and portable run checkpoints remain absent; do not change `package.json` version.

## 8. Verification and archive gate

- [x] 8.1 Run focused project-config, Store project-record/membership, declared-path, bootstrap core/command, F3 composition, completion, locale, ownership, and Windows-path Vitest files in small serial batches; never run concurrent Vitest or an unnecessary full suite.
- [x] 8.2 Run `pnpm lint` and `pnpm build`; expand testing only to the smallest relevant serial batch if focused evidence exposes a wider regression, and record why.
- [x] 8.3 Run `node bin/rasen.js validate knowledge-bundle-prepare-integration --changes --strict --json` and require this change's item to be valid with exactly one ADDED requirement, seven scenarios, and zero MODIFIED requirements.
- [x] 8.4 Re-run the active-change title/capability collision sweep and confirm this child is the sole owner of `Preparing a machine imports a declared bundle only as a separate, confirmed step`.
- [x] 8.5 Before ship, rehearse `rasen archive knowledge-bundle-prepare-integration --json --yes` from a temporary root containing only copied `rasen/config.yaml`, `rasen/specs/`, and this change. Require a clean one-ADD merge, exact original Purpose and requirement block, zero `TBD - created by archiving`, unchanged real/shared worktrees, and unchanged `package.json` version.
