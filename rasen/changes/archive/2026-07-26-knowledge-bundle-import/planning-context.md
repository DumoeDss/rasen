# Planning context — knowledge-bundle-import (F3)

## User intent

Continue from `origin/feat/store-context-portable-knowledge` at
`d2549d87212bb497f03d6f87f3581e7997a49aee`, which cleanly integrates
E1/E2/E3 and F1/F2. Complete F3 and then F4 end to end, without merging into
`dev/0.1.5`.

## Locked authority

Do not re-derive the design. Carve F3 from these sources while preserving the
original wording:

1. `C:\Users\Sayo\.rasen\projects\autonomy-ladder-1e42477e\changes\store-context-unification\work\ef-decomposition-plan.md`
2. The complete original Phase F artifacts under the shared checkout:
   `rasen/changes/portable-project-knowledge/{proposal.md,design.md,tasks.md,specs/portable-project-knowledge/spec.md}`
3. `rasen/changes/store-bootstrap-diagnose/planning-context.md`

## F3 scope

- Original task groups 5, 6, and 7 entire.
- Only the command, acceptance, docs/locales, and verification slices from
  groups 9–12 that serve those groups.
- Four verbatim ADDED requirements, with their complete original scenarios:
  - `A bundle is validated in full before anything is imported`
  - `Import never overwrites or removes local knowledge, and a conflict stops the whole import`
  - `Imported knowledge stays the project's own, whatever route it travelled`
  - `Import previews completely and changes nothing`
- Zero MODIFIED requirements.
- Collapsing invariant: either every new record in the bundle is added, or the
  project's stored knowledge is byte-identical to before.
- `--dry-run` and apply use the same validation/classification plan. Keep the
  preview/import agreement scenarios in this child.

## Excluded from F3

- Original group 8 and all machine-preparation integration (F4).
- Any E4 work or ordinary Store-repair message sweep.
- Export or Store-transport redesign; reuse F1/F2's landed schema, reader,
  canonical bytes, path assertion, and transport boundaries.
- Interactive conflict reconciliation, portable run checkpoints, or any
  automatic synchronization.
- Do not split or partially ADD any of the four F3 requirements.

## Dependency and archive facts

- F2 → F3 is HARD and is satisfied by the integration base.
- F3 has no dependency on Phase E, though the integration base already contains
  E1/E2/E3.
- F3 → F4 is HARD. F4 does not start before F3 is implemented,
  independently reviewed clean, shipped locally, and archived.
- All Phase F requirement titles are disjoint; every child uses ADDED blocks.
- `validate` cannot see cross-change collisions. Before ship, rehearse archive
  from a scratch root containing only `rasen/config.yaml`, `rasen/specs/`, and
  this change.
- Preserve the existing `portable-project-knowledge` Purpose verbatim and
  require zero `TBD - created by archiving` occurrences.

## Repository and test discipline

- Work only in the isolated worktree
  `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-wt-knowledge-bundle-import`.
- Never stage during propose/apply; ship owns exact pathspec staging. Never use
  `git add -A` or `git add .`.
- Re-verify the landed project-knowledge-home record layout and F1/F2 exports
  before implementation; planning-time names/signatures are not authoritative.
- Use `path.join()` / `path.resolve()` and Windows-aware tests.
- Run Vitest batches serially, never concurrently. Prefer focused coverage;
  the user explicitly does not want an unnecessary full suite.
- New CLI text goes through `knowledge-messages.ts`; completions and all three
  locales stay in sync.
- `package.json` version remains unchanged.

## Durable findings

Workers append only discoveries that remain useful to F4 or later integration.

### propose (planner)

- At `d2549d87`, the reusable write authority for F3 is
  `resolveCanonicalStore('project', context)`: it returns the canonical
  identity-keyed catalog, durable project owner, and the same per-owner lock
  ordinary learned-skill mutations use. F3 exposes one
  `importKnowledgeBundle` validate/plan/apply seam around that authority. F4
  should call this core seam directly; it must not invoke the CLI or recreate
  validation, classification, locking, or conflict policy.
- The landed `BootstrapReport.knowledge` /
  `BootstrapKnowledgePreparation` field means only that the empty canonical
  knowledge location was prepared during apply. It is not an action list and
  its own comment says portable import is a separate F4 step. F4 must add a
  distinct declared-bundle action/result surface rather than overloading
  `knowledge` or treating directory hydration as import consent.
- F3's core input contains only a bundle path, a project selector, dry-run
  intent, and injectable local dependencies; it has no Store selector or
  transport-origin input. F4 must keep declaration trust/confirmation outside
  the importer. A Store-named declaration may choose which file is offered,
  but that fact must never be passed through as record ownership, source, or
  new evidence.

### apply (implementer)

- `importKnowledgeBundle()` returns the same immutable added/already/conflict
  plan for preview and apply. Apply re-resolves the canonical catalog and
  recomputes that plan under the landed project-owner lock; F4 can therefore
  use the returned plan for confirmation without acquiring or emulating write
  authority.
- Import success always projects records to the resolved permanent project
  owner and `sources: []`. Version-1 evidence is normalized through
  `normalizeEvidence()` and version-2 evidence is copied; the receiving
  machine and a declaration's transport route never enter the record.
- F4 should treat `staging_cleanup_deferred` as a successful import with a
  cleanup warning: the published records were verified and `changed` remains
  true. Refusals and fully verified transaction rollbacks carry
  `changed: false`; an unverifiable rollback retains every named ambiguous
  path and carries `changed: "unknown"` without claiming the pre-import
  snapshot was restored. Conflict errors also carry the complete refreshed
  plan.
