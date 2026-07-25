## Context

Three unrelated mechanisms currently stand in for Store membership, and none of them is keyed by project identity:

- **`references: [project:<alias>]`** in the Store's `rasen/config.yaml`, parsed by `parseDeclarationList` (`src/core/project-config.ts:317`) into `DeclarationEntry[]`. Its real job is the referenced-store *index* in generated instructions (`src/core/references.ts`), keyed by a display alias in the machine's project namespace.
- **`adoptions.yaml`** (`src/core/store/migration.ts:73-106`), a single `Record<projectId, AdoptionEntry>` map inside the Store's Git repository. Its `AdoptionEntry` schema is Zod `.strict()` with `sourcePath: z.string().min(1)` **required** — an absolute machine path, committed to a shared repo, and read back at `migration-ops.ts:534` as eject's default destination.
- **The member repo's own `store:` pointer**, which `management-api/spaces.ts:121` re-reads to decide a Store's `members`. That is the project's *planning binding*, not membership.

Consequences visible today: two machines adding two different projects edit the same `adoptions.yaml` map and conflict; a project cannot declare a second, knowledge-only Store at all; the same display alias in two Stores is indistinguishable; and eject on machine B follows machine A's absolute path.

Child A (`store-immutable-identity`) already landed the identity layer this builds on: `resolveStoreBinding()` and its tri-state, `requireConfigStoreLayer`, `hasStoreDeclaration(pointer)`, `inspectRegisteredStore` (moved to `src/core/store/inspection.ts`), the `identity-types.ts` vocabulary, `identity-diagnostics.ts`, and the credential-free remote helpers in `remote.ts`. Its registry rule is load-bearing here: a registry's schema version is a **function of its data**, so a mixed fleet stays alias-keyed indefinitely and nothing may assume an identity-keyed registry exists. `project:` entries keep alias keying in both versions; moving them to identity-keyed membership is **this** change's job, and it happens in the Store's records, not by re-keying the machine registry.

Constraints from the plan (§11.3, §11.4, §13, §18.3, §21, §22.2, §26 Phase B) and its locked-decision list §33:

- Planning binding and Store membership are different relations with different authorities (§33.7).
- Membership authority is a `projectId` shard inside the Store (§33.8); the project side is a locator only (§33.9).
- `sourcePath` is deleted from the Git-shared schema; renaming it to a "hint" was explicitly rejected (§33.6).
- Membership expresses roster/eligibility only, never Change target authority (§33.21).
- Two-repository mutations do not claim atomicity: plan + ordered apply + `repairNeeded` (§33.19).
- Ordinary commands stay read-only; doctor stays read-only (§33.17, §33.18).
- Readers ship before writers; legacy stays readable; new shapes are written only by an explicit migration or a new mutation.

**Timing:** child A was code-complete with its review loop in a final round when this was written, closing two Majors (a repeated display alias must warn; `store unregister|remove|doctor` should accept a permanent identity). Both are additive and local, and neither changes the API surface consumed here. The implementation of this change MUST nonetheless re-verify child A's final exported surface before starting — signatures, not just names.

## Goals / Non-Goals

**Goals:**

- One authoritative membership record per project per Store, named and keyed by project identity, in its own file.
- Planning membership and knowledge membership expressible separately, without inventing execution authority.
- Portable project-side locator hints, so a fresh clone can discover its Stores — hints only, never authority.
- One membership provider that normalizes current and legacy sources into one shape carrying its provenance.
- Ordered, previewable, verifiable two-repository mutations that report exactly what was written and what needs repair.
- No machine-absolute path anywhere in Git-shared data, and eject that never relies on one.
- Read-only membership diagnostics with copy-pasteable repairs.

**Non-Goals:**

- Session runtime context, `ActionContext` v2, execution checkout selection (child C).
- Learned-knowledge scope, the effective algorithm, ledger v2, the logical project knowledge home (child D). This change builds the eligibility *provider*; it wires no knowledge consumer.
- The `rasen bootstrap` clone/register/hydrate state machine (child E) — this change only names what bootstrap will need and emits repair commands that exist today.
- Portable knowledge bundles (child F); Issue / Execution Plan / checkpoint (`0.2.0`, never here).
- Re-keying the machine registry's `project:` namespace. Those entries keep alias keying; membership moves into the Store's records instead.

## Decisions

### D1 — The record: one file per project, keyed by project identity

```yaml
# <store>/.rasen-store/projects/<projectId>.yaml
version: 1
projectId: ed2cf5bf-2525-45ed-b665-c47a5b8d5450
id: elftia
remote: git@github.com:org/elftia.git

roles:
  planning: true
  knowledge: true

adoption:
  specs: [fundraising]
  changes: [fundraising-p0-p1]
  adoptedAt: 2026-07-25T10:00:00Z
```

`projectId` inside the file is the authority; the filename must agree with it. A disagreement is a diagnostic (`store_project_record_key_mismatch`), never resolved by preferring one over the other — silently trusting either would let a renamed file reassign membership. `id` is display-only. `remote` goes through child A's `assertCredentialFreeRemote` on write and `redactRemote` on display. `adoption` is optional and carries no path.

Alternatives considered: keeping one `projects.yaml` map (rejected — it recreates the `adoptions.yaml` concurrent-edit conflict §22.2 exists to remove); keying the file by display alias (rejected — the alias is exactly what cannot identify a project).

### D2 — `roles: { planning, knowledge }`, and what a role may never mean

§34 leaves the exact field names to this change; §11.4 sketches `planningMember` / `knowledgeMember`. Inside a `roles:` container the `Member` suffix is redundant, so the fields are `planning` and `knowledge`. What §11.4 actually requires is preserved: the two are separately expressible and never collapse into an ambiguous `member: true`. A future `execution` field fits the same container and, per §13.5, could only ever express *candidacy* — this change's spec says so explicitly so a later reader cannot mistake a roster for an assignment.

Absent `roles` on a legacy-normalized record means the roles have to be inferred, with a diagnostic saying so, because an adoption proves planning membership and proves nothing about knowledge. Inventing knowledge membership would silently widen what child D later materializes.

**Deviation recorded during implementation — the inference is per-source, not a blanket default.** This decision originally said the default is `{ planning: true, knowledge: false }` for every legacy shape. The implementation instead maps a legacy **adoption** to `planning`, a legacy `references: project:<alias>` entry to `knowledge`, and unions them when both name the same project (`membership.ts`), labelling the inference either way. The binding artifact requires only that an inferred role be *reported*, not which role is inferred, and the blanket rule would have asserted **planning** membership for a project known only through a `references:` entry — a documentation index that proves nothing about where the project plans. That is the same invention this decision's own reason forbids, pointed the other way. A later implementer must not "restore" the original sentence: the deviation is deliberate and follows the reason rather than the wording.

**Roles compose by OR, so a composing command states its own.** Roles only ever widen on write — every command here adds a role and none removes one, so re-running `add-project` after `adopt` must not clear the planning membership the adoption established. That rule is sound in isolation and defective when composed: `adopt` runs `add-project`'s registration and reference work, `add-project` asserts `knowledge: true` for its own semantics, and the OR left a plain adopt durably recording a knowledge role nobody established — in a Git-committed file that is the authority child D reads. `storeAddProject` therefore takes an explicit `roles` override for composing callers, and `adopt` passes `{ planning: true, knowledge: false }`. One consequence is visible at the other end: ejecting a project that was only ever adopted now ends the only role its record carried, so the record is removed rather than left behind expressing nothing — while a knowledge role established separately by `add-project` still survives the eject, which is what "eject ends planning, not the roster" means.

### D3 — A record key must be filesystem-safe and injective, and is validated, never sanitized

`projectId` is typed as a plain string (`project-config.ts`), so non-UUID values exist in the wild (`ensureProjectIdInConfig` mints UUIDs, but hand-written configs and the `(unassigned)` sentinel do not). A projectId is recordable when it is a valid UUID **or** a valid kebab id, and is not a Windows reserved device name. The reserved names live in a named exported constant (`WINDOWS_RESERVED_DEVICE_NAMES`), checked by explicit lookup — not a regex.

Anything else is refused with `project_identity_unrecordable` and a repair. It is never sanitized into a filename: two distinct projectIds mapping onto one file would silently overwrite one project's membership with another's, which is the exact failure class this change exists to remove. Both accepted grammars are lowercase-normalized and therefore injective on case-insensitive filesystems too.

### D4 — One provider, one normalized shape, provenance-labelled

`src/core/store/membership.ts` is the only reader of membership:

```ts
type MembershipProvenance = 'v2-record' | 'legacy-reference' | 'legacy-adoption';

interface StoreMembershipRecord {
  storeUid?: string;            // absent only for a legacy-identity Store
  projectId: string;
  id?: string;
  remote?: string;
  roles: { planning: boolean; knowledge: boolean };
  provenance: MembershipProvenance;
  diagnostics: StoreDiagnostic[];
}

listStoreMembers(store: ResolvedStoreRef): Promise<StoreMembershipRecord[]>
resolveProjectMembership(store: ResolvedStoreRef, projectId: string): Promise<StoreMembershipRecord | null>
listProjectStoreCandidates(projectRoot: string): Promise<StoreCandidate[]>
```

Precedence when one projectId appears from several sources: `v2-record` wins outright; a legacy source contributes only a projectId that has no record. New writes emit `projectId` shards only.

Normalizing `legacy-reference` is the awkward one: `references: [project:<alias>]` names an alias in the machine's project namespace, so mapping it to a projectId requires resolving that alias locally and reading the project's own config. That works only on a machine where the project is registered. Resolvable → a record with `provenance: 'legacy-reference'` plus a diagnostic that the mapping is machine-local; unresolvable → reported as `store_legacy_reference_unresolved`, never dropped silently. Reachable by design: it is precisely the fresh-machine case the migration exists to fix.

The Store is always reached through child A's `resolveStoreBinding()` / the tri-state — never `listRegisteredStores().find(id)`. Enumerating all registered Stores stays legitimate (the ban is on by-id lookup), so files that only enumerate are not added to `PHASE_A_FILES`; files whose by-id lookup this change migrates are.

### D5 — Effective eligibility is a union, and an unavailable Store is not an empty one

```
eligible(project) = { S : project declares a storeMemberships locator for S }
                  ∪ { S : S is registered here and S has a record for this projectId }
```

A locator pointing at a Store that is not registered here does **not** shrink the set to what happens to be local — it yields an entry marked unavailable with `store_bootstrap_required` (child A's code) so child D can defer cleanup rather than treat the Store as empty. This is the §33.10 fail-closed rule applied to membership, and the provider returns the unavailable entries rather than filtering them out, so a consumer cannot accidentally read "not present" as "not a member".

### D6 — Two-repository mutation: plan, ordered apply, `repairNeeded`

Following §21.1 and §22.5, `add-project` and `adopt` produce:

```ts
interface MembershipMutationPlan {
  projectBaseCommit: string | null;   // null when not a git repo — degrades, never blocks
  storeBaseCommit: string | null;
  projectWrites: string[];
  storeWrites: string[];
  repairNeeded: MembershipRepair[];
}
```

Apply order: verify both identities and base SHAs → write the Store authority record → verify it → write the project locator hint → verify both directions → emit per-repo commit suggestions. If the project write fails, the Store record **stands** (it is legitimate on its own), `project_membership_locator_missing` lands in `repairNeeded` with its repair command, and nothing is rolled back. Base SHAs are read and re-checked around apply; Rasen never pulls, pushes, stages, or commits — it renders `renderSuggestedCommit` output the user runs.

Alternative considered: a compensating rollback that deletes the Store record when the project write fails. Rejected — it destroys a valid authority record to tidy up a locator, and a crash between the two makes the "rollback" itself non-atomic.

### D7 — `sourcePath` removal, and eject's explicit destination

`AdoptionEntry.sourcePath` becomes optional **on read only** so existing files still parse, and is never written again. Nothing reads it for behavior; its presence raises `shared_metadata_contains_local_path`.

Eject destination resolution, in order, with no fallback beyond it:

1. explicit `--into <path>`
2. the current checkout, when its `projectId` matches the ejected project
3. the machine project registry's single live checkout for that `projectId`
4. otherwise fail, naming `--into` and listing the candidates when there were several

Explicitly forbidden: reading legacy `sourcePath`, inferring a local path from a `remote`, guessing by alias, and taking the first of several checkouts. Ownership (which specs and changes belong to the project) comes from the membership record's `adoption` block, with the legacy manifest read as a fallback while it still exists.

### D8 — Migration is explicit, previewable, and deletes rather than archives the legacy file

`rasen store migrate-membership <store> [--dry-run] [--apply] [--json]` reads `adoptions.yaml`, the `references` list, and the project namespace registry; emits one `projects/<projectId>.yaml` per resolvable project; drops `sourcePath`; preserves `timestamp` as `adoption.adoptedAt`. Only after every record is written and re-read successfully does it delete `adoptions.yaml`.

Deleting rather than archiving is deliberate: archiving it under another name would keep the absolute path in Git, which is the thing being removed. Nothing is lost — the adoption data moves into the records and the file's history stays in the Store's Git history. The deletion is reported in `storeWrites` for the user to commit. Migration is idempotent and re-runnable; a project it cannot resolve is reported and left alone rather than guessed at.

Kept separate from child A's `store upgrade-identity` per §25.1's "core planner should separate them, so one failure does not make every migration undiagnosable".

### D9 — The Store's member list gains records without losing pointers

`management-api/spaces.ts` currently derives `members` purely from pointer-repo registry entries re-validated against each repo's live `store:` declaration. It becomes the **union** of that (kept, so a Store with no records yet does not suddenly list zero members) and the membership provider's records. A pointer-derived member is still validated at read time exactly as today; the read stays free of writes. This keeps every existing scenario true while making a recorded member visible even when its repo points elsewhere — which is the whole point of separating the two relations.

### D10 — Project-side locator parsing degrades, it does not fail

`storeMemberships` is parsed by the same resilient hand-written path `references` uses (`project-config.ts`), not by a strict schema: a malformed entry is dropped with a warning and the rest survive. That is correct precisely *because* it is a locator — losing a hint costs a diagnostic, while losing authority would cost membership. Entries are de-duplicated on permanent identity; an entry with no identity is a warning naming the upgrade path. The written form carries only identity, alias, and a credential-free remote, and is asserted to contain no absolute path on any platform.

Note the child A trap this change inherits: `pointer.value !== undefined` is **not** "does this repo declare a Store" — a durable declaration may carry only a permanent identity. Every such check goes through `hasStoreDeclaration(pointer)`.

### D11 — Diagnostic codes

Reusing child A's `src/core/store/identity-diagnostics.ts` factory-per-code convention (one factory, rendered identically by human and JSON output, listed in an exported const array):

| Code | Severity | Meaning |
|---|---|---|
| `store_project_record_missing` | error | the project's **primary planning Store** has no record for this projectId |
| `project_membership_locator_missing` | warning | a Store has a record for this project, but the project declares no locator for it |
| `project_membership_unverified` | warning | the project declares a **secondary** locator whose Store is not registered here, so the record cannot be verified |
| `shared_metadata_contains_local_path` | warning | Git-shared data still carries a machine-absolute path |
| `store_project_record_key_mismatch` | error | a record's filename and its `projectId` disagree |
| `store_legacy_reference_unresolved` | warning | a legacy `project:<alias>` reference cannot be mapped to a projectId on this machine |
| `project_identity_unrecordable` | error | the projectId cannot safely name a record file |
| `store_membership_legacy_manifest` | warning | the Store still carries `adoptions.yaml`; migration is pending |

`store_project_record_missing` and `project_membership_unverified` look overlapping in §20.2 and are not: the first is about the *primary planning* Store (§13.4's consistency rule) and is an error because planning is already bound to it; the second is about a *secondary knowledge* locator and is a warning because the Store simply is not here yet. Every new code is recorded back into `planning-context.md` §7.

**Where they surface, recorded during implementation.** Both doctors read the membership section's own `diagnostics`, and both render it from one shared line builder over the same structure the `--json` payload carries, so human and JSON cannot report different codes or different repairs. The planning Store is resolved from the project's own declaration and handed to the provider by the shared gather, which is what makes `store_project_record_missing` reachable at all. Membership findings are deliberately **not** raised by `diagnoseMigrationDrift` any more: routing them through drift made them conditional on the project declaring a planning Store, which is exactly the state a plain `add-project` does not create — so the half-written two-repository state D6 leaves standing (record present, locator absent, no planning binding) reported nothing at all, and D6's "never roll back a valid authority record" rests on that state being diagnosable. Reporting them from both places would also make one state look like two.

### D12 — `--set-primary`: an explicit opt-in that refuses rather than overwrites

§21.1's target-writes list for add-project ends with "primary store pointer （只有用户选择绑定时）" — the project's planning Store, written *only when the user chooses to bind*. That clause is an opt-in flag, so `store add-project` gains `--set-primary` (name chosen under §34).

The danger it guards against is real: silently rebinding where a project plans would re-merge the two relations this change exists to separate (§33.7). The guard is that the write is **explicit and never implicit** — the flag defaults to off, is never inferred from any other flag or from the project's state (including "this is the project's only membership"), and:

- no existing planning Store → the target Store is recorded, and the output names the planning binding *separately* from the membership, so the user sees two distinct things happened;
- a **different** planning Store already bound → **refuse**, naming what is bound, what was requested, and the command that rebinds deliberately. Never overwrite;
- the target Store already bound → succeed as a no-op.

A refusal is scoped to the pointer only: the membership record and locator this invocation established still stand, because they are a different relation and are correct regardless of where the project plans. That is the same "never roll back a valid authority record to tidy up" rule as D6.

Alternative considered and rejected: omitting the flag and printing the bind command as a follow-up. It leaves add-project short of §21.1 and makes binding a second manual step; the separation is already protected by the opt-in being explicit.

### D13 — Cross-platform

Every path is composed with `path.join()`; record paths resolve under `getStoreMetadataDir(storeRoot)`. Record filenames are constrained by D3 so they are legal on Windows (reserved device names rejected by explicit list; no trailing dot or space; no separator or `..` can appear in either accepted grammar). Checkout comparison for eject's destination rules uses `FileSystemUtils.canonicalizeExistingPath` with the established `path.resolve` fallback, so drive-letter case and separator form never create or hide a match. Tests build expected paths with `path.join()`.

## Risks / Trade-offs

- **Eject now asks for `--into` where it used to guess.** → That guess was another machine's absolute path and was wrong off the originating machine; rules 2 and 3 cover the ordinary single-checkout case without any flag, the error lists the candidates, and the migration guide documents it.
- **Legacy `project:<alias>` references can only be normalized on a machine where the project is registered.** → Reported as `store_legacy_reference_unresolved` rather than dropped, so the gap is visible; the migration converts what it can and leaves the rest untouched for a machine that can resolve them.
- **The project's config is now written by `add-project`, where previously only the Store's was.** → The write is a single additive `storeMemberships` key. `store-add-project`'s "non-destructive" requirement stays true and is amended in place — nothing is rewritten, moved, or deleted — and its scenario asserting the project's config is not modified is amended to name the one additive hint rather than being quietly contradicted. The referenced-store entry itself still goes only to the Store's repository, which is what that scenario's title actually claims.
- **Union membership in the spaces listing can show a member twice from two sources.** → The provider de-duplicates on projectId with `v2-record` winning, and the listing renders one entry per project identity.
- **Deleting `adoptions.yaml` is irreversible from the working tree.** → It happens only under `--apply`, only after every record is written and re-read, is previewable with `--dry-run`, and the file's content survives in the Store's Git history; the deletion is surfaced for the user to commit rather than committed automatically.
- **Child A is still in its review loop.** → The two open Majors are additive and touch neither the resolver's signature nor the tri-state; implementation still re-verifies the final surface before starting, and the boundary test list must be updated in the same diff.
- **`.strict()` Zod schemas mean a new key is a parse error, not a tolerated field.** → Each new shape extends its schema *and* its serializer; the record schema is new, and the `AdoptionEntry` change is a read-side relaxation (`sourcePath` required → optional) with no new write.

## Migration Plan

1. **Readers first.** The record schema, the record reader, and the membership provider (including legacy normalization) land with no writer. Every existing command behaves identically; `rasen doctor` gains read-only membership findings.
2. **Writers.** `add-project` and `adopt` write records and locators through the ordered two-repository apply. `adopt` stops writing `sourcePath`.
3. **Eject.** Ownership reads the record with the legacy manifest as fallback; destination resolution becomes explicit.
4. **Migration command.** `store migrate-membership` converts legacy data and removes `adoptions.yaml` after verification.
5. **Surfaces, docs, locales.** The spaces listing switches to the provider; `docs/cli.md`, troubleshooting, the migration guide, the agent contract, JSON examples, the completion registry, and all three locale bundles land in the same change.

Rollback: reverting leaves `projects/*.yaml` records that a previous version ignores and a `storeMemberships` key its resilient parser drops with a warning — neither breaks the older version. The one non-reversible step is the migration's deletion of `adoptions.yaml`, which is why it is gated behind `--apply` after verification and reported for the user to commit.

## Open Questions

- Whether `management-api/spaces.ts` should ultimately drop its `listRegisteredStores` enumeration in favour of a resolver-backed enumeration helper. It is legitimate as-is (enumeration, not by-id lookup), so this change leaves it; child C, which rewrites that file's session/space resolution, is better placed to decide. **Decided during implementation: the enumeration stays, recorded explicitly in `spaces.ts` and in the boundary test's deferred list.** The file's by-id lookup — comparing a member repo's declared display alias against a store's `id` — is gone: each pointer repo now resolves through `resolveStoreBinding`. That closes the real defect (a declaration recording only the permanent identity carries no alias, so its repo silently vanished from the store's member list) and leaves only the legitimate enumeration behind.

- **Inherited from child A's design D12 row 16 / D9: `references:` in config is alias-only with no identity form. Recorded, not closed — deliberately.** Three reasons, in order of weight: (1) a `references: project:<alias>` entry is the *documentation index*, and this change's whole purpose is to move membership authority OUT of it into identity-keyed records — giving it an identity form now would re-inflate the mechanism being demoted; (2) the plan's non-goals and child A's constraint both keep `project:` entries alias-keyed in **both** registry versions, so nothing in this change depends on the gap; (3) the requirements describing `project:` references live in `store-project-namespace`, a capability child A already holds two MODIFIED blocks on — writing a second MODIFIED block for it is exactly what `planning-context.md` §11.2 forbids, and the archive that landed second would discard the other. The gap's practical cost is bounded and visible: an alias that cannot be mapped on this machine is reported as `store_legacy_reference_unresolved` with its repair, never dropped and never guessed. Whoever eventually gives `references:` an identity form should own `store-project-namespace` in the same change.
