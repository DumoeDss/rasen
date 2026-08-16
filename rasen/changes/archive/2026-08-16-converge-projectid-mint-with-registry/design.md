## Context

A Rasen project's identity lives in two places: `rasen/config.yaml`'s `projectId` (tracked with the repo, hand-mintable) and the machine-wide project registry (`<globalDataDir>/projects/registry.json`), keyed by the project's canonical root path. Consumers assume the two agree: learned-skills owner resolution fails with `knowledge_owner_stale` when they differ (`src/core/learned-skills/context.ts:558-573`), and planning-space addressing fails with `planning_selection_conflict` (`src/core/config-api/project-addressing.ts:160-171`).

The two writers move in opposite directions and never converge:

- **Mint side** — `ensureProjectIdInConfig` (`src/core/project-config.ts:2057`) returns an existing config id unchanged, else mints a fresh `crypto.randomUUID()`. It never consults the registry, so a registered path gets a second, divergent id.
- **Sticky side** — `registerProject`'s `existingAtPath` branch (`src/core/project-registry.ts:460-480`) keeps the registry entry's id when the path is already registered; a same-path claimant carrying a different id does not overwrite it.

Both are individually correct policies; together they are a livelock. Real repro (2026-08-16): a project registered 2026-08-01 by a 0.1.7-era build (no `rasen/` root then); a 0.2.0 `rasen init` created the root, lazily minted a new id, the registry kept the old one, and every identity-dependent feature failed until a human hand-edited config.yaml. The `knowledge_owner_stale` hint says "Run `rasen init` to repair it" — but init is what minted the divergent id, so the hint is a loop.

All mint callers funnel through `ensureProjectIdInConfig` (init via `resolveProjectHome`, pipeline commands, UI launch, change-work, store adopt/add-project, layout migrations). Minting already runs under `withProjectRegistryLock` (`project-config.ts:2074`).

## Goals / Non-Goals

**Goals:**

- A registered path can never acquire a second identity: the lazy mint adopts the registry's id for the canonical root.
- An already-diverged project self-repairs on the next identity-asserting run (`rasen init` being the documented one), so the existing repair hint becomes true.
- Worktree runs converge on the main checkout's registered identity (same piercing registration already uses).
- The registry's ambiguity guards stay authoritative: no silent winner when the registry itself is conflicted.
- Case/whitespace-equivalent identities are recognized as the same project and never rewritten (project-identity-canonical-form).

**Non-Goals:**

- No new un-register / re-identity CLI command. `rasen home prune` only removes dangling (missing-path) entries; `rasen store unregister` covers the typed store registry, not the machine project registry. For a deliberately new identity, the documented escape remains hand-editing the registry entry and the config's `projectId` (both are human-repairable by design). Noted as a possible future capability, not built here.
- No change to registry self-healing (`touchProjectRegistry`): it stays a best-effort registry mirror and never writes into the repo. Repair runs only where identity is asserted (the `resolveProjectHome` ensure path).
- No change to the sticky registration policy itself, the alias-conflict error, or the registry file format.
- No consumer-side tolerance: `knowledge_owner_stale` / `planning_selection_conflict` keep failing on genuine divergence — the fix removes the divergence instead of teaching consumers to live with it.

## Decisions

### D1: The registry entry wins for a registered path

When config and registry disagree for the same canonical root, convergence is toward the registry's `projectId`. Rationale:

- The codebase already treats the registry entry as the permanent machine identity: registration refuses to move it (sticky `existingAtPath`), store membership is "keyed by the project's permanent identity" (`src/core/store/operations.ts:1212`), and space addressing `project:<id>` resolves through the registry.
- The minted id can never win anyway: registration will not adopt it, so minting fresh on a registered path produces an id that is dead on arrival. Making the mint adopt the registry id is the only direction that converges.
- This matches the existing sticky semantics for the "different project now lives at a registered path" edge: the system already treats the path as the registered project (that is exactly today's defect); the escape hatch stays the documented hand-edit (Non-Goals).

Alternative rejected: config wins (rewrite the registry toward the config id). It would let any fresh mint silently hijack a path's accumulated machine state (home dir, knowledge, spaces) — precisely the accident this change exists to prevent.

### D2: Adoption happens at the mint point, inside `ensureProjectIdInConfig`

When the mint path is about to create a fresh UUID, it first looks up the adoptable registry identity for the project's canonical root (under the same registry lock it already holds) and, when one exists unambiguously, writes that id into the config instead. Only when the machine has no entry for the root does it mint fresh. This fixes every mint caller uniformly (init, pipeline, UI launch, change-work, store adopt/add-project, migration destinations) with one change, and it cannot regress the "read-only commands never dirty the repo" contract — the fast path (config already has an id) still returns it without touching the registry or the file.

Lookup semantics (new read-only helper in `project-registry.ts`, reusing `findProjectRegistryEntry`'s canonicalization and worktree piercing plus the existing `canonicalProjectClaimants` machinery — no new detection mechanism):

- Pierce a linked-worktree run to the main checkout's entry (a worktree adopts the main's registered identity).
- Return the entry's `projectId` when the root's claim is present and unambiguous.
- Return "not adoptable" when the root's live registry aliases disagree on fixed ownership metadata (`fixedMetadataConflict`): silently adopting one alias's id would choose a winner the registry explicitly refuses to choose. The mint then proceeds with a fresh UUID exactly as today, and the subsequent registration surfaces the conflict through the existing `project_registry_alias_conflict` error, which names the manual repair. Minting never throws for registry reasons — its contract is unchanged.

Alternative rejected: adoption inside `registerProject` (pass the config along and let registration write it back). That couples the registry writer to config-file mutation and misses every mint that is not immediately followed by a registration write; the mint point is the single seam where the divergence is born.

### D3: Repair of an already-diverged config lives in `resolveProjectHome`'s ensure path

Mint adoption alone cannot fix the existing fleet of diverged configs: the fast path returns the wrong id B unchanged. The repair runs where both truths are in hand — after `registerProject` returns the registry entry in `resolveProjectHome` (`src/core/project-home.ts:139-141`):

1. `ensureProjectIdInConfig` returns the config id (adoption-aware after D2).
2. `registerProject` returns the registry truth (`entry.projectId`).
3. When the two are not the same project identity, the config is rewritten toward `entry.projectId`.

This is exactly the `rasen init` code path (`registerMachineHome` → `resolveProjectHome(ensure: true)`), so "Run `rasen init` to repair it" becomes true, and every other identity-asserting command (pipeline resume, UI launch, change-work ensure) converges too. Probe mode (`ensure: false`) stays non-mutating and keeps returning null on mismatch.

Why not repair inside `ensureProjectIdInConfig`'s fast path: that would put a registry read and a possible tracked-file rewrite on the hottest path of every identity consumer, and would change the documented "existing id returned unchanged" contract even when nothing is wrong. The ensure funnel already exists, already serializes identity work under the registry lock, and sees the post-registration truth rather than a pre-registration guess — an interleaved registry change between steps 1 and 2 is absorbed because the comparison uses registration's answer.

### D4: The rewrite helper follows the mint's write discipline

New sibling helper in `project-config.ts` (e.g. `reconcileProjectIdInConfig(root, expectedId, options)`): under `withProjectRegistryLock`, read the config, replace the value on the existing `projectId:` line (found by the same explicit field lookup the mint uses — not a pattern match over the file), or append the line when the field is absent; preserve every other byte, comment, and the `.yml`/`.yaml` precedence; re-read and validate; revert on failed validation. This mirrors `ensureProjectIdInConfig`'s proven append discipline so the tracked file is never left corrupt.

### D5: Comparison is canonical-form; equivalent identities are never rewritten

Both the adoption decision and the repair trigger compare with `sameProjectIdentity` (`src/core/store/project-records.ts:74`, trim + lowercase). A config id differing only in case or padding from the registry id is the same project (project-identity-canonical-form): no rewrite, the file stays byte-identical. The rewrite, when it does happen, writes the registry's exact string.

### D6: The repair hint stays, and becomes true

The `knowledge_owner_stale` message ("Run `rasen init` to repair it", `learned-skills/context.ts:567`) is kept: after D2+D3, re-running init genuinely converges a diverged project. The one state init cannot repair is a registry-internal alias conflict, where the authoritative guidance already lives in the `project_registry_alias_conflict` error; if verification shows the stale message misleading in that state, append a clause pointing at registry repair — wording left to implementation, bounded by the spec scenario ("the guidance names a repair that works").

### D7: Alias guards are untouched and cannot be tripped by this change

Adoption and repair write only the config file; neither creates nor moves registry entries, so `authority: 'ensure'` + `fixedMetadataConflict` refusals in `registerProjectWithPolicy` behave exactly as before. After adoption, the subsequent `registerProject` call carries the registry's own id at a path registered with that id — the `existingAtPath` branch places the same id and converges. The conflict guard fires only for genuinely conflicted registry state, which D2 declines to resolve silently.

## Risks / Trade-offs

- [Repair rewrites a tracked file from non-init commands (pipeline resume, UI launch)] → The rewrite fires only on actual disagreement, is idempotent, preserves all other content, and converges after one run; commands on the ensure path already mint (write config) today under the same conditions.
- [A genuinely different project cloned onto a registered path gets folded into the old identity] → This is the existing sticky-registry semantics, now made consistent; the escape hatch (hand-edit registry + config) is documented in the spec's convergence requirement rather than left implicit.
- [Two processes race: one mints/adopts while another repairs] → All mutation is serialized under the registry lock; every writer's target is the registry id, so concurrent convergence is idempotent (both write the same id, verify-and-revert guards a torn write).
- [Adoption lookup adds a registry read + possible git piercing to first-run minting] → One-time cost on the mint path only (never on the fast path), same cost class as the registration that immediately follows in every caller.
- [Fresh mint on a conflicted registry still pollutes config with a doomed id] → Accepted: `ensureProjectIdInConfig` never throwing for registry reasons keeps its contract; the alias-conflict error from registration names the manual repair, and after the registry is repaired the next run converges (the minted id is replaced by the repair arm).

## Migration Plan

No persisted-format change; rollout is code-only. Existing diverged projects converge on their next identity-asserting run (init being the documented one). Rollback is a plain revert — no state to unwind, since the registry was never modified by this change.

## Open Questions

- None blocking. The optional hint-wording extension in D6 is a bounded implementation choice verified during testing.
