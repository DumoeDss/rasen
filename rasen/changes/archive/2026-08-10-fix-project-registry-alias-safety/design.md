## Context

The follow-up review identifies four related read/repair failures in machine project ownership.

RSR-1 arises in `canonicalProjectIdentityClaimants()`: raw registry keys are grouped by canonical registration root, but a representative entry can still be selected from path-sort order and conflict handling is not applied consistently before every mutation. A missing alias can therefore supply the fixed `home` instead of the live claimant, and conflicting live aliases can be collapsed by a mutating path.

RSR-2 is the state-creation counterpart. Read-only self-heal is permitted to refresh a proved existing binding, but an alias-only canonical repair must not call the placement behavior that creates a missing machine-home directory. The implementation now has an `allowCreate` distinction, but the alias repair and missing-home combination lacks an end-to-end no-creation proof.

RSR-3 is a lookup-order split. `findProjectRegistryEntry()` pierces a linked worktree to the canonical main entry first and uses the direct worktree entry only as a fallback. `resolveProjectHome(..., { ensure: false })` performs those lookups in the opposite order, so a legacy worktree entry can select a different home from planning and owner resolution.

RSR-4 is in project-only selection in `StorePlanningResolver`. After a selector matches the machine registry by normalized project identity, display name, or canonical root, the resolver reads the selected root's config and assigns `explicitProjectSelector` from that config without proving it agrees with the registry entry. A copied or drifted config can silently replace the selected identity.

The existing canonical path functions, normalized project identity function, registry lock, `findProjectRegistryEntry()`, and `planning_selection_conflict` diagnostic remain the foundations. No new registry schema or runtime dependency is required.

## Goals / Non-Goals

**Goals:**

- Make canonical alias reduction independent of raw key order and preserve authoritative fixed home ownership.
- Refuse every registry mutation when live aliases for one canonical claim disagree on fixed metadata.
- Guarantee that read-only refresh and home probes create no config, registry entry, or directory that did not already exist as an owned binding.
- Give project-home, registry owner, root-selection, and planning consumers one canonical main-first lookup.
- Reject registry/config identity drift before the planning resolver adopts config evidence or accesses planning content.

**Non-Goals:**

- Repairing or deleting conflicting registry entries automatically; explicit registry/identity repair remains operator-owned.
- Changing independent-clone home forking, doctor/gc policy, Store membership, or project config identity minting.
- Owning workspace coordination claims/fsync, archive recovery, spec reconciliation, or Store/management finalization.

Store-finalization FAR-3 must preserve the complete typed reconciliation issue array without source-wide deduplication or generic replacement.

Windows 37/55 fault-matrix failures come from NTFS identity precision loss through JavaScript number; CCR-2 covers the canonical-publication-to-progress-flush window; Store finalization must reuse archive cleaner/abort ownership semantics.

## Decisions

### 1. Reduce aliases into an explicit representative-or-conflict result

`project-registry.ts` will keep one internal canonical-claim reducer shared by registration, refresh, claimant listing, and canonical lookup. It groups entries by the existing platform-aware canonical root before an identity-scoped caller filters claims; normalized project identity is part of the ownership tuple, not a pre-filter that can hide a conflicting alias at the same root. Each group retains every raw registry key, liveness, whether the key is the direct canonical key, and the fixed metadata tuple that grants machine-home ownership.

The fixed tuple is the normalized `projectId` plus `home`; `name`, `mode`, timestamps, tool/version cache fields, and other refreshable projections do not grant home ownership. Representative selection follows this order:

1. Preserve the direct canonical entry when one exists.
2. Otherwise preserve the sole live fixed-metadata claimant, regardless of raw path sort order.
3. Equivalent live aliases with the same fixed tuple may collapse to a deterministic representative because no ownership fact changes.
4. If live aliases disagree on the fixed tuple, return a conflict alongside the preferred read representative and forbid mutation.
5. Missing aliases never replace a live claimant's fixed metadata. A moved-root rebind remains allowed only when the remaining missing claim is unambiguous under the existing move rules.

Every mutating entry point checks this structured result before deleting aliases, creating a home, rebinding a path, or writing `registry.json`. Explicit registration surfaces the registry conflict; best-effort self-heal leaves the existing bytes unchanged. This preserves the direct entry for read compatibility without treating its presence as permission to erase a conflicting live home.

Keeping the current path-sorted representative was rejected because sort order carries no ownership authority. Resolving conflict by `lastSeen` was rejected because it is mutable cache data. Rewriting all aliases automatically was rejected because the engine cannot prove which conflicting home is safe to orphan.

### 2. Separate registry placement from home creation by operation authority

The placement helper will take an explicit operation authority rather than infer creation permission from the code path. Only ensure/registration authority may create a new home directory. Refresh authority may update an already-proved registry binding and collapse equivalent aliases, but it never calls directory creation—even when the selected entry names a home that is currently absent.

The RSR-2 regression will seed an alias-only canonical claim whose fixed home directory is absent, invoke the same self-heal reached by a read-only root-resolving command, and compare the global projects directory plus config/home inventory before and after. A registry refresh may canonicalize an already-owned entry, but no home, config, or unrelated registry claim may appear.

Treating an absent home as a reason to recreate it during refresh was rejected: existence does not prove that a read-only caller has state-creation authority, and silent recreation can conceal registry corruption.

### 3. Make non-ensuring project-home resolution consume the shared canonical lookup

`resolveProjectHome(..., { ensure: false })` will stop reading `state.projects` directly. After confirming the root config carries a project identity, it calls `findProjectRegistryEntry()` with the same global-data options used by owner/planning consumers. The lookup prefers the main checkout entry when it exists and falls back to a direct surviving-worktree entry only when the canonical main entry cannot be resolved or found.

The probe returns a home only when the normalized config and selected registry identities agree. It remains observational: no identity minting, touch, registry rewrite, or directory creation. This prevents a legacy worktree-keyed entry from shadowing the main entry while preserving the documented fallback for a surviving worktree whose main checkout is gone.

Adding another direct/main retry sequence inside `project-home.ts` was rejected because the two implementations already drifted. A shared lookup is the contract, not merely the same intended order.

### 4. Verify selected registry identity before adopting config evidence

For project-only planning selection, the resolver will first establish the normalized identity represented by every matched registry source that survives canonical-root unification. After reading the selected root config, it compares a declared config `projectId` with that selected registry identity before assigning `explicitProjectSelector`, following a binding, or locating planning content.

Equivalent normalized forms are accepted. A genuine mismatch raises the existing `planning_selection_conflict` with `selection.project`/the config path as evidence and names both identities; it does not substitute the config id, fall back to another registry namespace, or continue under the selector's display name/root match. The same check applies whether the project was addressed by id, registry display name, or canonical absolute root. A legacy config with no `projectId` retains the existing registry-owned selection behavior.

Silently preferring config was rejected because it changes the requested project after selection. Silently preferring registry was also rejected because subsequent binding facts would then be read under known-drifted identity. Identity disagreement is an admission failure, not precedence.

### 5. Verify behavior through real callers and immutable-state assertions

Registry tests will permute direct, live-alias, and missing-alias insertion order; assert the same representative/home; and prove conflicting live homes leave registry bytes and all home directories unchanged. Windows coverage will include case/separator/dot-segment aliases under the existing path policy.

Project-home and root-selection tests will seed both a canonical main entry and a legacy worktree entry with different homes, then prove every non-ensuring caller chooses the main entry without writes. A separate missing-main case proves the direct fallback survives.

Store-planning tests will select by normalized id, name, and absolute root while the selected config declares a different `projectId`; every case must return `planning_selection_conflict` and preserve registry/config/planning trees byte-for-byte. An equivalent-casing identity case remains accepted.

## Risks / Trade-offs

- [Existing conflicting registries stop self-healing automatically] → Refuse mutation and preserve every home; diagnostics direct the operator to explicit identity/registry repair.
- [Canonicalization differs across Windows and POSIX] → Reuse the existing path flavor/canonicalization functions and test aliases under both native and explicit Windows semantics.
- [A missing main checkout could make a surviving worktree homeless] → Retain the shared lookup's documented direct fallback only when no canonical main entry is available.
- [Identity comparison could reject benign spelling differences] → Compare with `normalizeProjectIdentity`, while treating different normalized values as real drift.
- [Read-only self-heal still writes an owned registry refresh] → No-create assertions distinguish permitted refresh of existing ownership from forbidden config, entry, or directory creation.

## Migration Plan

1. Refactor canonical claimant reduction to return representative, raw aliases, and fixed-metadata conflict explicitly; add order/conflict regressions before changing mutation paths.
2. Gate every registration/refresh placement on that result and enforce create versus refresh authority at the directory-creation boundary.
3. Route non-ensuring project-home resolution through `findProjectRegistryEntry()` and add main-entry/fallback caller tests.
4. Add the resolver's normalized registry/config identity admission check and planning-selection regressions.
5. Run focused registry/project-home/root-selection/planning suites on Windows and POSIX before the parent review cycle.

No on-disk migration runs automatically. Healthy registries converge on later authorized writes; conflicting registries remain byte-for-byte intact until explicit repair. Rollback is code-only and does not need to reinterpret stored data.

## Open Questions

None. Fixed ownership metadata is the normalized project identity and assigned home; display/cache fields remain refreshable and cannot select an alias winner.
