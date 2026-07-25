## 1. Effective Store and Catalog Planning

- [ ] 1.1 Add pure effective-plan/result types carrying resolved items, effective scope, sorted typed source identities, canonical/resolution digests, conflicts, unavailable stores, and deferred actions.
- [ ] 1.2 Reverse-discover every eligible member store for the resolved project by consuming the scope child's typed registry/membership/catalog APIs; do not parse references or re-resolve knowledge owners in this child.
- [ ] 1.3 Make discovery and diagnostics stable by typed store ID and cover zero/one/many stores, planning-store divergence, config-pointer non-exclusivity, transitive exclusion, same bare IDs across namespaces, and registry-order permutations.
- [ ] 1.4 Model unavailable store facts separately from empty/retired catalogs and carry prior/pointer/frozen relevance into the plan for cleanup safety.

## 2. Applicability, Precedence, and Conflicts

- [ ] 2.1 Filter active canonical project/store/global records through the existing applicability evaluator before resolving each ID with `project > store > global`.
- [ ] 2.2 Deduplicate effective store records only when stable knowledge key and verified canonical digest/bytes match, preserving every sorted typed store source without naming a winner.
- [ ] 2.3 Produce complete order-independent conflicts for divergent effective store groups and block the whole learned plan before learned file or ledger writes; report shadowed lower-store divergence as latent when a project winner exists.
- [ ] 2.4 Enforce `LEARNED_SKILL_ACTIVE_DESCRIPTION_BUDGET` after applicability, precedence, and equivalent-store deduplication, counting each effective item once.
- [ ] 2.5 Add matrix/adversarial tests for applicability fallback, all precedence combinations, retired records, equivalent stores, key/content disagreement, three-way conflicts, order permutations, shadowed conflicts, and post-resolution budget behavior.

## 3. Effective Rendering and Typed Ledgers

- [ ] 3.1 Render managed `SKILL.md` metadata with learned ID, effective scope, all sorted typed sources, and a stable resolution digest while preserving declarative-only content and existing generated-ownership markers.
- [ ] 3.2 Add a named strict versioned project learned-materialization ledger separate from `.workflow-artifacts.json`, recording typed sources, effective scope, resolution digest, exact target path/digest, and store membership/degraded facts needed for safe follow-up.
- [ ] 3.3 Implement write-new-before-clear migration from legacy workflow-ledger learned entries, normalizing project/global sources, preserving workflow version/entries, treating the new ledger as authoritative on retry, and never claiming modified legacy files.
- [ ] 3.4 Extend the machine-global learned ledger with strict backward reading and explicit typed global source/resolution identity; reject project/store sources in that ledger.
- [ ] 3.5 Add ledger tests for legacy project/global migration, interrupted dual representations, workflow preservation, invalid/tampered entries, atomic writes, older-client-safe absence of legacy ownership, and Windows relative/absolute path forms.

## 4. Safe Project-Local and Global-Only Reconciliation

- [ ] 4.1 Refactor project-local reconciliation to consume one preflight effective plan shared by every configured tool and use the resolution digest as the refresh/provenance key.
- [ ] 4.2 Preserve exact ownership behavior for untracked, symlinked, non-regular, missing, and user-modified occupants; remove only unchanged typed-ledger files whose sources are authoritatively no longer effective.
- [ ] 4.3 Implement degraded reconciliation so unavailable prior/pointer/frozen stores defer destructive same-layer changes, project winners can replace unknown lower sources, and unrelated unavailable stores do not block unaffected IDs.
- [ ] 4.4 Refactor global-only reconciliation to independently load active approved global records, write only typed global sources through the machine-global ledger, and exclude all project/store records regardless of applicability or membership.
- [ ] 4.5 Add filesystem tests for conflict no-write guarantees across several tools, provenance-only refresh, precedence transitions, exact removal, user edits, unavailable prior sources, unaffected degraded additions, Hermes global-only behavior, and one project's inability to prune shared global copies.

## 5. Init and Update Integration

- [ ] 5.1 Make init resolve one authoritative project effective plan before learned materialization, keep workflow installation results separate, and refuse to choose a member project when invoked only as a store owner.
- [ ] 5.2 Make update use the same planner for additions, refreshes, exact pruning, ledger migration, deferred cleanup, and no-op detection across configured project-local and global-only tools.
- [ ] 5.3 Extend human/JSON result models and localized messages for typed sources, effective scope, deduplication, latent/effective conflicts, unavailable stores, deferred actions, provenance transitions, budgets, and repair guidance.
- [ ] 5.4 Update learned-skills, init/update, Hermes, compatibility, and troubleshooting documentation with the many-to-many effective-set and conflict model.
- [ ] 5.5 Add init/update command tests for effective mixed-scope installs, conflict blocking, workflow/learned result separation, direct-store refusal, legacy migration, degraded stores, deterministic result ordering, locale parity, and already-reconciled no-op output.

## 6. Portfolio Boundary and Release Verification

- [ ] 6.1 Verify implementation consumes the context child's typed execution owner and the scope child's canonical store/membership APIs without changing selector resolution, run-state freezing, schemas, canonical storage, evidence gates, approval, or mutation policy.
- [ ] 6.2 Run targeted effective resolver, applicability, materialization, ledger, init/update, store membership, locale, and Hermes tests, then run typecheck and the full test suite.
- [ ] 6.3 Run or obtain Windows CI verification for canonical project/store roots, applicability markers, stored ledger paths, symlink/reparse protections, atomic ledger writes, and deterministic source ordering.
- [ ] 6.4 Strictly validate the final change artifacts and confirm the stacked context → scope → materialization portfolio has no duplicated implementation tasks.
