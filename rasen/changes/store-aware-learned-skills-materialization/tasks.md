## 1. Effective Store and Catalog Planning

- [x] 1.1 Add pure effective-plan/result types carrying resolved items, effective scope, sorted typed source identities, canonical/resolution digests, conflicts, unavailable stores, and deferred actions.
- [x] 1.2 Reverse-discover every eligible member store for the resolved project by consuming the scope child's typed registry/membership/catalog APIs; do not parse references or re-resolve knowledge owners in this child.
- [x] 1.3 Make discovery and diagnostics stable by typed store ID and cover zero/one/many stores, planning-store divergence, config-pointer non-exclusivity, transitive exclusion, same bare IDs across namespaces, and registry-order permutations.
- [x] 1.4 Model unavailable store facts separately from empty/retired catalogs and carry prior/pointer/frozen relevance into the plan for cleanup safety.

## 2. Applicability, Precedence, and Conflicts

- [x] 2.1 Filter active canonical project/store/global records through the existing applicability evaluator before resolving each ID with `project > store > global`.
- [x] 2.2 Deduplicate effective store records only when stable knowledge key and verified canonical digest/bytes match, preserving every sorted typed store source without naming a winner.
- [x] 2.3 Produce complete order-independent conflicts for divergent effective store groups and block the whole learned plan before learned file or ledger writes; report shadowed lower-store divergence as latent when a project winner exists.
- [x] 2.4 Enforce `LEARNED_SKILL_ACTIVE_DESCRIPTION_BUDGET` after applicability, precedence, and equivalent-store deduplication, counting each effective item once.
- [x] 2.5 Add matrix/adversarial tests for applicability fallback, all precedence combinations, retired records, equivalent stores, key/content disagreement, three-way conflicts, order permutations, shadowed conflicts, and post-resolution budget behavior.

## 3. Effective Rendering and Typed Ledgers

- [x] 3.1 Render managed `SKILL.md` metadata with learned ID, effective scope, all sorted typed sources, and a stable resolution digest while preserving declarative-only content and existing generated-ownership markers.
- [x] 3.2 Add a named strict versioned project learned-materialization ledger separate from `.workflow-artifacts.json`, recording typed sources, effective scope, resolution digest, exact target path/digest, and store membership/degraded facts needed for safe follow-up.
- [x] 3.3 Implement write-new-before-clear migration from legacy workflow-ledger learned entries, normalizing project/global sources, preserving workflow version/entries, treating the new ledger as authoritative on retry, and never claiming modified legacy files.
- [x] 3.4 Extend the machine-global learned ledger with strict backward reading and explicit typed global source/resolution identity; reject project/store sources in that ledger.
- [x] 3.5 Add ledger tests for legacy project/global migration, interrupted dual representations, workflow preservation, invalid/tampered entries, atomic writes, older-client-safe absence of legacy ownership, and Windows relative/absolute path forms.

## 4. Safe Project-Local and Global-Only Reconciliation

- [x] 4.1 Refactor project-local reconciliation to consume one preflight effective plan shared by every configured tool and use the resolution digest as the refresh/provenance key.
- [x] 4.2 Preserve exact ownership behavior for untracked, symlinked, non-regular, missing, and user-modified occupants; remove only unchanged typed-ledger files whose sources are authoritatively no longer effective.
- [x] 4.3 Implement degraded reconciliation so unavailable prior/pointer/frozen stores defer destructive same-layer changes, project winners can replace unknown lower sources, and unrelated unavailable stores do not block unaffected IDs.
- [x] 4.4 Refactor global-only reconciliation to independently load active approved global records, write only typed global sources through the machine-global ledger, and exclude all project/store records regardless of applicability or membership.
- [x] 4.5 Add filesystem tests for conflict no-write guarantees across several tools, provenance-only refresh, precedence transitions, exact removal, user edits, unavailable prior sources, unaffected degraded additions, Hermes global-only behavior, and one project's inability to prune shared global copies.

## 5. Init and Update Integration

- [x] 5.1 Make init resolve one authoritative project effective plan before learned materialization, keep workflow installation results separate, and refuse to choose a member project when invoked only as a store owner.
- [x] 5.2 Make update use the same planner for additions, refreshes, exact pruning, ledger migration, deferred cleanup, and no-op detection across configured project-local and global-only tools.
- [x] 5.3 Extend human/JSON result models and localized messages for typed sources, effective scope, deduplication, latent/effective conflicts, unavailable stores, deferred actions, provenance transitions, budgets, and repair guidance.
- [x] 5.4 Update learned-skills, init/update, Hermes, compatibility, and troubleshooting documentation with the many-to-many effective-set and conflict model.
- [x] 5.5 Add init/update command tests for effective mixed-scope installs, conflict blocking, workflow/learned result separation, direct-store refusal, legacy migration, degraded stores, deterministic result ordering, locale parity, and already-reconciled no-op output.

## 6. Portfolio Boundary and Release Verification

- [x] 6.1 Verify implementation consumes the context child's typed execution owner and the scope child's canonical store/membership APIs without changing selector resolution, run-state freezing, schemas, canonical storage, evidence gates, approval, or mutation policy.
- [x] 6.2 Run targeted effective resolver, applicability, materialization, ledger, init/update, store membership, locale, and Hermes tests, then run typecheck and the full test suite. (Candidate run 30140441939 and exact-parent run 30133635411 have identical failed-test sets; candidate-only failures: 0.)
- [x] 6.3 Run or obtain Windows CI verification for canonical project/store roots, applicability markers, stored ledger paths, symlink/reparse protections, atomic ledger writes, and deterministic source ordering. (The macOS/Windows canonical-root regression is absent from candidate run 30140441939; candidate-only failures versus exact-parent run 30133635411: 0.)
- [x] 6.4 Strictly validate the final change artifacts and confirm the stacked context → scope → materialization portfolio has no duplicated implementation tasks.
