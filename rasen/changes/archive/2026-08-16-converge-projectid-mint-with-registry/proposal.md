## Why

A project whose path is already registered in the machine project registry gets a new planning root (for example a fresh `rasen init` after an upgrade) and its lazily minted `projectId` never converges with the registry's sticky entry: the mint side always creates a fresh id, the registry side always keeps the existing one, and every consumer that assumes the two agree (learned-skills sync `knowledge_owner_stale`, space addressing `project:<id>`) then fails permanently. The built-in repair hint tells the user to run `rasen init` — which is exactly what minted the divergent id, so the hint can never work. Diagnosed on a real 0.1.7→0.2.0 upgrade today; the only workaround is hand-editing `rasen/config.yaml`.

## What Changes

- Lazy `projectId` minting adopts the machine registry's identity: when a command is about to mint a `projectId` and the machine project registry already holds an unambiguous entry for the project's canonical root (including a linked-worktree run, which pierces to the main checkout), it writes the registry's `projectId` into the config instead of a fresh UUID. A fresh UUID is minted only when the machine has no registry entry for the root.
- `rasen init` (and every command that asserts machine identity) repairs an already-diverged project: when the config carries a `projectId` that disagrees with the registry entry for the same canonical root, the config is reconciled toward the registry identity, preserving the file's other content and comments. Re-running init therefore genuinely repairs the divergence, making the existing `knowledge_owner_stale` guidance true.
- Identity comparison for both arms uses the canonical (trimmed, case-insensitive) form: a config id that differs only in case or whitespace from the registry id is already the same project and is left byte-identical, never rewritten.
- Refuses to pick a winner when the registry itself is conflicted: if the live registry aliases for the root disagree on identity, no silent adoption or rewrite happens; the existing registration conflict error (which names the manual repair) remains the authority.
- No new CLI surface: identity reconciliation is automatic inside existing commands. A deliberately-new-identity escape hatch stays the documented hand-edit of the registry/config (non-goal to add a command).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `project-registry`: the "Stable project identity" requirement changes — lazy minting now adopts the machine registry's identity for a registered root before minting fresh, and an identity-asserting run (e.g. `rasen init`) reconciles a config id that disagrees with the path's registered identity toward the registry; the registry remains the winner for a registered path, ambiguous registry state is never silently resolved, and case/whitespace-equivalent ids are not rewritten.

## Impact

- `src/core/project-config.ts` — the lazy-mint path (`ensureProjectIdInConfig`) gains registry adoption under the existing registry lock; a sibling in-place id rewrite helper with the same write discipline (preserve content, verify, revert on failure).
- `src/core/project-registry.ts` — a read-only lookup returning the adoptable identity for a root (reusing the existing canonical-claimant machinery, worktree piercing, and fixed-metadata-conflict detection).
- `src/core/project-home.ts` — the ensure path of `resolveProjectHome` compares the registered identity with the config identity after registration and triggers the repair when they disagree.
- `src/core/init.ts` — no flow change expected (it calls `resolveProjectHome`); covered by end-to-end verification.
- Consumers that already assume convergence (learned-skills owner resolution, planning-space addressing) are unchanged and simply stop seeing the divergence.
- Tests: `test/core/project-config.test.ts`, `test/core/project-registry.test.ts`, `test/core/project-home.test.ts`, and an init-level end-to-end case; Windows CI leg must stay green (path handling via `path.join`, registry keys already canonicalized).
