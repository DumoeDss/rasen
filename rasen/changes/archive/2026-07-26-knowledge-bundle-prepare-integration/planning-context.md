# Planning context — knowledge-bundle-prepare-integration (F4)

## User intent

Continue from the clean integration of E1/E2/E3/E4 and archived F1/F2/F3 at
`568318891ef1ef46b984cb4cdbfa87512e5ae2d3`. Complete F4 end to end, then
fast-forward the integration branch; do not merge or open a PR against
`dev/0.1.5`.

## Locked authority

Do not re-derive the product contract. This change is carved from:

1. `C:\Users\Sayo\.rasen\projects\autonomy-ladder-1e42477e\changes\store-context-unification\work\ef-decomposition-plan.md`
2. The complete original Phase F proposal, design, tasks, and
   `specs/portable-project-knowledge/spec.md` under the shared checkout's
   `rasen/changes/portable-project-knowledge/`
3. `rasen/changes/store-bootstrap-diagnose/planning-context.md`
4. Archived F3 at
   `rasen/changes/archive/2026-07-26-knowledge-bundle-import/` and the final
   E2/E3/E4 bootstrap/config/Store project-record code and tests at this base

## Scope and invariant

- Original Phase F group 8 entire.
- Only the command/help, acceptance, docs/locales, and verification slices of
  groups 9–12 that serve group 8.
- Exactly one verbatim ADDED requirement, all seven original scenarios:
  `Preparing a machine imports a declared bundle only as a separate, confirmed step`.
- Zero MODIFIED requirements.
- Collapsing invariant: preparation offers only what a durable declaration
  names and imports nothing without confirmation.
- Hard dependencies F3 and E2 are satisfied.

Excluded:

- doctor/readiness changes, including E4's documented future input note;
- any Phase E implementation;
- F3 validation, conflict, transaction, ownership, source, or evidence redesign;
- Store catalog/membership/metadata/Git mutation or publication;
- interactive conflict reconciliation, automatic synchronization, and portable
  run checkpoints.

## Locked declaration and precedence decisions

The minimal representation is the same optional non-empty string field on each
durable owner:

```yaml
# <project>/rasen/config.yaml
knowledgeBundle: carry/project-knowledge.bundle.json
```

```yaml
# <store>/.rasen-store/projects/<projectId>.yaml
knowledgeBundle: rasen/knowledge-bundles/<projectId>/<bundleId>.bundle.json
```

- Project config resolves relative to the project root.
- Store project record resolves relative to that Store's root.
- Absolute paths in Windows drive-letter, Windows network-share, or POSIX form
  are rejected on every host.
- Lexical parent traversal and existing-target symlink escape are rejected.
- The Store field is only a locator. It never becomes owner, source, evidence,
  membership, or publication authority.
- Actions de-duplicate by canonical path per permanent project identity and
  retain every source.
- If a de-duplicated path is also named by project config, it has project trust
  and blanket `--yes` may cover it.
- Different paths remain separate listed actions; none overrides another.
- A Store-record-only action is always listed under `--yes` and never imported
  without an explicit choice.

## Durable implementation handoff

- Add `knowledgeBundle?: string` to `ProjectConfigSchema` and the resilient
  manual parse in `src/core/project-config.ts`. A malformed field drops with a
  field-local diagnostic; valid siblings survive.
- Add the same optional field to `StoreProjectRecord`, its strict Zod schema,
  fixed-order serializer/parser, any record equality/composition paths, and
  `StoreMembershipRecord` / `fromStoreProjectRecord` in
  `src/core/store/{project-records,membership}.ts`. Existing records stay
  version 1 and are not rewritten merely because the optional field exists.
- Prefer a focused module under `src/core/knowledge-bundle/` for declaration
  resolution, safe containment, action de-duplication, and direct F3
  composition. Keep `src/core/store/bootstrap.ts` responsible for flow ordering
  and end-state composition, not bundle parsing or conflict rules.
- `BootstrapReport.knowledge` remains directory hydration. Add a distinct
  optional `bundleImports` action/result collection.
- Project-first collects project config plus readable Store membership records.
  Store-first carries its project-record locator and adds a local/just-obtained
  project's config locator. Apply re-reads declarations after existing
  register/obtain/hydration work.
- A Store locator can be listed while the target project is absent, but import
  waits until that permanent project resolves locally.
- Extend `BootstrapConsentRequest` with an `import-bundle` action and reuse the
  existing `confirmAction` trust parameter. Do not turn project and Store trust
  into one predicate.
- For each usable local action, call
  `importKnowledgeBundle({ bundle, project, dryRun: true })` directly before
  consent, then call the same seam in apply mode only after consent. Never call
  the knowledge CLI or duplicate F3.
- Preserve F3's complete plan/errors/warnings. In particular,
  `staging_cleanup_deferred` is successful-with-warning and an unverifiable
  rollback keeps `changed: "unknown"` plus retained paths.
- Missing/unreadable/unsafe/unconfirmed/conflicting/refused actions degrade but
  never stop unrelated preparation. No declaration creates no action and makes
  no F3 call.
- Replace the provisional `knowledgeBundleStep` prose with real action
  rendering. Update all three locales and bootstrap completion/help descriptions;
  add no new flag.

## Repository and verification discipline

- Work only in
  `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-wt-knowledge-bundle-prepare-integration`
  on `feat/knowledge-bundle-prepare-integration`.
- Propose/apply stage nothing. Ship must stage exact pathspecs; never use
  `git add -A` or `git add .`.
- Use `path.join()` / `path.resolve()` and Windows-aware expected paths.
- Run Vitest serially in small focused batches; the user explicitly does not
  want an unnecessary full suite.
- Run lint/build, strict single-change validation, title collision sweep, and a
  scratch-root archive rehearsal.
- The exact normalized requirement block hash is
  `826d998e3c622420e31c80a7a223fbb331688946b99f5ec9526ec32bf93fcf26`.
- Preserve the original `portable-project-knowledge` Purpose verbatim and
  require zero `TBD - created by archiving` hits.
- Leave `package.json` version unchanged.

## Durable findings

Workers append only discoveries that remain useful after the current stage.

### propose (planner)

- The landed F3 seam resolves only registered project selectors. Project-first
  apply registers the current checkout before the F4 step, so apply can pass
  the permanent project identity/root directly. Check/preview must not fake a
  registered project or bypass F3 identity checks; they may list the safely
  resolved declaration without running an import apply.
- `StoreMembershipRecord` currently drops fields not explicitly projected from
  `StoreProjectRecord`; adding the strict schema field without updating
  `fromStoreProjectRecord` would make Store declarations parse yet disappear
  before bootstrap sees them.
- E4 left a comment suggesting a future doctor input named
  `knowledgeBundlePrepared`, but this child's locked scope explicitly excludes
  doctor. Do not implement that note here.
- The current bootstrap renderer prints a placeholder
  `knowledgeBundleStep` only under `BootstrapReport.knowledge`. It is not a
  declaration/action and must be replaced, not treated as evidence F4 is partly
  implemented.
