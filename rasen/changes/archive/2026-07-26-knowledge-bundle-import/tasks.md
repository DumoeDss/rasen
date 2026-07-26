## 1. Re-verify landed seams

- [x] 1.1 Re-verify `resolveProjectSelector(selector)` and `resolveCanonicalStore('project', context)` at the implementation base, including the resolved permanent project identity, canonical catalog directory, durable owner, and existing per-owner lock path; do not derive a clone-local catalog or a second lock.
- [x] 1.2 Re-verify F1's `readKnowledgeBundle`, `KnowledgeBundle` / record shapes, `assertNoMachinePath`, digest normalization, and version-refusal errors; use that complete non-writing reader rather than creating an import-only parser.
- [x] 1.3 Re-verify `readCanonicalRecord`, `checkLearnedSkillId`, `learnedSkillIdCollisionKey`, `normalizeEvidence`, manifest serialization/schema, named managed files, and lock acquire/release signatures before writing the import plan or transaction.
- [x] 1.4 Re-verify F2's reserved transport boundary and current command/completion/message layout. Confirm F3 needs no Store resolver, catalog writer, membership writer, Phase E surface, or `PHASE_A_FILES` addition; if a new Store-identity consumer becomes unavoidable, stop and re-check scope before editing.

## 2. Complete validation and import planning

- [x] 2.1 Add `src/core/knowledge-bundle/import.ts` with explicit result, plan, conflict, warning, error, dependency, and I/O types; expose one reusable `importKnowledgeBundle` seam for both the CLI and later F4 preparation integration.
- [x] 2.2 Resolve `<projectId|root>` through the landed project selector, read and validate the entire bundle through `readKnowledgeBundle`, and refuse an identity mismatch naming both identities before catalog mutation or staging.
- [x] 2.3 Validate every bundle record identifier through `checkLearnedSkillId()` and reject duplicate or cross-platform-colliding identifiers through `learnedSkillIdCollisionKey()`; keep record/field context on schema, digest, machine-path, managed-record, and identifier failures.
- [x] 2.4 Project each new destination manifest explicitly as project scope with the resolved permanent project owner, original lifecycle/content/timestamps/evidence facts, normalized version-1 evidence where needed, an empty transport-source list, and no receiving-machine evidence; schema-validate the projection before planning can authorize it.
- [x] 2.5 Classify every bundle record against `readCanonicalRecord` as new · identical · conflicting in deterministic identifier order. Identical requires matching canonical content and lifecycle status; same knowledge key is not identity, retired-versus-active conflicts, and an occupied/unreadable target conflicts rather than being overwritten.
- [x] 2.6 Return the complete immutable plan with every new, already-present, and conflicting record plus provenance-only `baseProjectCommit` warnings. Report every conflict in one pass and let any conflict block the whole apply.

## 3. Dry-run and all-or-nothing apply

- [x] 3.1 Implement `--dry-run` as the same validation/classification plan with mutation suppressed; invalid inputs and conflicts must carry the same refusal facts as apply, and preview must create no lock, directory, file, or cleanup debris.
- [x] 3.2 For apply, acquire the exact landed per-project catalog lock, re-resolve/re-read every target under that lock, and recompute classification before staging; target drift turns into a refreshed conflict/refusal with the catalog byte-identical.
- [x] 3.3 For a conflict-free locked plan, create one private named transaction staging directory beside the canonical catalog, write only the explicit managed manifest and canonical content files for every new record, and read back/verify the whole staged set before publishing any target.
- [x] 3.4 Publish only to targets re-proved absent. On any injected write, verification, or publish failure, remove only directories and files whose transaction ownership, identity, and expected contents still verify. A fully verified rollback restores the pre-import whole-tree snapshot and reports `changed: false`; an unverifiable identity or content retains every named ambiguous path, reports `changed: "unknown"`, and does not claim that the snapshot was restored or that nothing landed.
- [x] 3.5 Leave identical and unrelated local records byte-identical, clean owned staging/rollback debris, and make a second import of the same bundle report every record already present without acquiring write authority or changing any byte.

## 4. Ownership and publication boundaries

- [x] 4.1 Assert the imported on-disk manifest and canonical reader result name the resolved project identity as owner; do not accept success-message text as evidence.
- [x] 4.2 Import a bundle from a Store checkout and prove no Store owner or transport source lands in any record, original evidence facts/counts remain unchanged, and the receiving machine is not added as an independent source.
- [x] 4.3 Snapshot every involved Store catalog, project record, metadata, membership, Git index, HEAD, and remote before import and prove all are byte-identical afterward; import must call no Store mutation, stage, commit, or push path.
- [x] 4.4 Exercise the existing publication/promotion gate after import and prove Store or wider scope still requires the landed evidence, membership, and explicit approval; arrival by import satisfies none of them.

## 5. Command surface, output, and locales

- [x] 5.1 Register `rasen knowledge bundle import <bundle> --project <projectId|root> [--dry-run] [--json]` under the existing bundle command in `src/commands/knowledge.ts`, preserving export and rejecting incompatible or missing input before core work.
- [x] 5.2 Keep core and CLI human/JSON facts aligned: state (`previewed` or `imported`), project, bundle identity/path, added, already-present, every conflict, warnings, refusal reason, repair, and whether anything changed.
- [x] 5.3 Route every import description, state, classification, warning, refusal, conflict-side description, and repair through `src/commands/knowledge-messages.ts`; add matching keys to `src/locales/{en,zh-cn,ja}.json` with no English fallback.
- [x] 5.4 Add the import positional argument and every option to `src/core/completions/command-registry.ts`; test Commander parsing, stable JSON shapes, localized human output, parity, and early rejection while keeping export/transport behavior unchanged.

## 6. Acceptance and cross-platform coverage

- [x] 6.1 Add a two-machine fixture with separate machine data directories: export on machine A, import on machine B, and prove the same project-owned records resolve from B's canonical project knowledge home.
- [x] 6.2 Cover new, identical, differing, retired-versus-active, unreadable/occupied, and unrelated local records; one conflict among five must prevent all five, resolution followed by retry must complete, and a second clean import must be a byte-identical no-op.
- [x] 6.3 Run Store-as-transport end to end: place on machine A, clone/copy the Store fixture on machine B, import from its reserved bundle path, and prove project ownership with zero Store mutation or publication authority.
- [x] 6.4 Snapshot the project catalog, checkout, and whole machine data directory around dry-run; cover three simultaneous conflicts, invalid-last-record, malformed/newer/wrong-project/tampered bundles, and prove preview and apply reach identical decisions for unchanged inputs.
- [x] 6.5 Add cross-platform coverage using `path.join()` / `path.resolve()` expectations: Windows drive/separator bundle paths, case-colliding identifiers, all three absolute-machine-path forms through the landed reader, and line-ending divergence that remains identical; confirm Windows CI includes each path-sensitive test file.

## 7. Documentation and release contract

- [x] 7.1 Update `docs/cli.md` with the import syntax, every flag, classifications, all-or-nothing conflict behavior, complete dry-run, human output, and JSON examples for clean import, conflict preview, and refusal.
- [x] 7.2 Update `docs/retention-and-learned-skills.md` with the three-way distinction: Store knowledge travels by cloning, project knowledge is machine-local by default, and it crosses machines only through explicit export and import.
- [x] 7.3 Update `docs/migration-guide.md` with the two-machine and Store-transport import walkthroughs, conflict resolution/retry, and the rule that imported knowledge remains project-owned.
- [x] 7.4 State in docs and the `0.1.5` `CHANGELOG.md` that `baseProjectCommit` is provenance rather than a gate and that F3 adds portable project knowledge import but not machine-preparation integration, interactive reconciliation, or portable run checkpoints.

## 8. Verification and archive gate

- [x] 8.1 Run focused schema/import core, command, completion, locale, identity-boundary, ownership/publication, acceptance, and Windows-path Vitest batches serially; do not run concurrent Vitest or an unnecessary full suite.
- [x] 8.2 Run `pnpm lint` and `pnpm build`; if focused evidence reveals a wider regression, expand only to the smallest relevant serial test batch and record why.
- [x] 8.3 Run `node bin/rasen.js validate knowledge-bundle-import --changes --strict --json` and require this change's result to be valid with exactly four ADDED requirements, 23 scenarios, and zero MODIFIED requirements.
- [x] 8.4 Re-run the portfolio-wide active-change collision sweep. Confirm all Phase F titles remain disjoint and this child is the sole owner of its four requirement titles.
- [x] 8.5 Before ship, rehearse `rasen archive knowledge-bundle-import --json --yes` from a temporary root containing only copied `rasen/config.yaml`, `rasen/specs/`, and this change directory. Require a clean four-ADD merge, verbatim existing Purpose, zero `TBD - created by archiving`, an unchanged real worktree/shared checkout, and an unchanged `package.json` version.
