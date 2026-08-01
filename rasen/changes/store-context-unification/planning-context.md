# Planning context — store-context-unification portfolio

> Seeded by the LEAD before the first propose. The persistent planner reads this
> FIRST and researches only what is missing. APPEND durable new findings
> (decisions, discovered constraints) after each propose — not chatter.

## 1. User intent (verbatim)

```
auto-decompose 完成任务的开发：rasen/explorations/global-store-project-unification-development-plan.md。
ship和archive,retro使用sonnet，其他使用opus。
```

User adjudications taken at run start:

- **Phase F part 2 (cross-machine knowledge bundle export/import) IS in scope** —
  all six phases A–F run. `0.1.5` release notes may therefore claim project
  knowledge portability.
- **Delivery = single integration PR.** All children commit locally on branch
  `feat/store-context-unification`; ONE PR → `dev/0.1.5` after every child is
  done. This satisfies plan §27.1 clause 1 ("存在一个明确的最终 integration PR").
  No per-child push, no per-child PR.

## 2. The authority document

`rasen/explorations/global-store-project-unification-development-plan.md`
(3131 lines, untracked working-tree file, dated 2026-07-25, baseline
`d73c1da2`). It is the **single main entry** for this work. Read it — do not
work from a single old PR, old change directory, or chat fragment.

Document authority order above it:

```
rasen/work/issue-centered-automation-platform/north-star.md
  > goal.md
    > roadmap.md
      > the Store/Context plan (this portfolio)
```

Sections every planner must read before proposing: **0–18, 26, 27, 28**, plus
the phase section for its own child. §33 is the locked-decision list — those 26
decisions are NOT reopenable in a proposal. §34 lists what a change MAY decide.

Background doc `store-multi-machine-collaboration-design.md` is historical; on
any conflict the development plan wins.

## 3. Verified fact baseline (LEAD, this session)

```
branch at start:  dev/0.1.5      HEAD d73c1da2  (matches plan's documented baseline)
portfolio branch: feat/store-context-unification   (created from that HEAD)
projectId:        e2ee72ed-04a1-4395-86aa-7e77d2b83ec7
planning root:    local repo (NOT store-scoped — no --store/--project flag on any command)

PR ancestry re-verified against HEAD — matches the plan's expected result exactly:
  #62 da02dd60 : true    (store-aware knowledge context — IS in dev)
  #65 5fa32300 : false   (store-scoped knowledge — NOT in dev)
  #66 48142395 : false   (effective scoped knowledge — NOT in dev)
  #68 c8dde6aa : true    (session planning/execution split — IS in dev)
```

So the plan's §3 fact baseline holds unchanged. Do not re-derive it; do not
assume #65/#66 are present because GitHub says MERGED — they landed only onto
stacked feature branches.

Untracked files that must NOT be cleaned, committed, or overwritten by any
worker:

```
docs/handoff/
rasen/explorations/store-multi-machine-collaboration-design.md
rasen/explorations/global-store-project-unification-development-plan.md
```

## 4. Decomposition plan and dependency rationale

Six children, **strictly serial**. Parallelism was evaluated and rejected: every
phase writes overlapping files (`src/core/project-config.ts`,
`src/core/relationship-health.ts`, `src/core/root-selection.ts`,
`src/commands/doctor.ts`, `src/commands/store.ts`), so no positive independence
proof exists. The plan's own §26 ordering (A→B→C→D→E→F) agrees.

| # | Change | Prereqs | Phase | Why it depends |
|---|---|---|---|---|
| A | `store-immutable-identity` | — | A | foundation: `storeUid` must exist before anything references it |
| B | `project-keyed-store-membership` | A | B | `projects/<projectId>.yaml` records live under a UID-identified Store |
| C | `unified-session-runtime-context` | A, B | C | `RuntimePlanningRef` carries store `uid` (A); Store Session validates the project record (B, plan §16.5 step 4) |
| D | `store-aware-learned-skills-integration` | A, B, C | D + F.1 | adapts #65/#66: alias→UID (A), membership authority→B provider, evaluation root→C runtime context, project catalog→logical knowledge home |
| E | `store-bootstrap-and-hydration` | A, B, D | E | bootstrap state machine validates Store UID (A) + project records (B) + hydrates the logical knowledge home (D) |
| F | `portable-project-knowledge` | D, E | F.2 | bundle export/import over the logical catalog (D); bootstrap integration (E) |

**Phase 0 (integration rehearsal branch) is skipped** — the plan marks it
optional (§26 Phase 0: "如果不需要预演，可跳过"). Instead, child D's planner
fetches commits `5fa32300` and `48142395` directly as its algorithm source.

**Phase G (portable run checkpoint) is OUT OF SCOPE** — plan §26 Phase G and
§33 decision 16 move it to `0.2.0`. Do not implement `rasen checkpoint`.

**Also out of scope (plan §7.3):** Issue schema, Execution Plan schema, Issue
acceptance, Issue Board, Issue scheduler, durable `Change → targetProject`
binding, automatic git pull/push, distributed locks, cross-repo atomic
transactions, CRDT, credential sync.

## 5. Locked decisions — do NOT relitigate in any proposal

Full list is plan §33 (26 items). The ones most likely to be accidentally
reopened:

1. Store gets a UUID `storeUid`; `id` is demoted to a mutable alias. No global
   auto-increment numbering (§6.1) — offline machines cannot allocate safely.
2. `sourcePath` is **deleted** from Git-shared schema. Renaming it to
   `sourcePathHint` was explicitly rejected (§4.6, §6.3) — any absolute path in
   shared YAML leaks machine layout and misroutes eject.
3. Checkout root NEVER enters Git.
4. Planning binding (project's primary Store pointer) and Store membership
   (many-to-many roster) are **different relations** with different authorities.
   Membership authority = `<store>/.rasen-store/projects/<projectId>.yaml`.
   Project-side `storeMemberships` is a **locator only**, never authority.
5. Config precedence: `env > project > primary planning Store > global > default`.
   Secondary knowledge Stores do NOT participate in config inheritance.
6. Learned precedence: `project > all eligible Stores > global`.
7. Project canonical knowledge is unique per `projectId` per machine
   (`~/.rasen/project-knowledge/<projectId>/learned-skills/<id>`).
8. `~/.rasen` is never wholesale-synced; only explicit whitelist bundles.
9. Ordinary commands (`status`/`list`/`show`/`doctor`/plain context resolution)
   NEVER implicitly clone, register, fetch, mint a projectId, write a pointer,
   upgrade metadata, or repair a registry. They resolve, validate, report, and
   emit a copy-pasteable repair command.
10. An `unavailable` Store must **fail closed** — never collapse to `null` and
    fall through to global/default. Never treat it as an empty directory and
    delete existing materialization.
11. Doctor is read-only.
12. Two-repo mutations do not claim strong atomicity — plan + ordered apply,
    with `repairNeeded` output on partial failure.
13. Store membership expresses roster/eligibility ONLY — never Change target
    authority (that is `0.2.0`'s accepted Execution Plan).

## 6. Cross-cutting engineering constraints

From `rasen/config.yaml` (project context) and the plan:

- TypeScript, Node ≥20.19.0, ESM, pnpm, Commander.js.
- **Cross-platform is mandatory** (macOS/Linux/**Windows**). Always
  `path.join()`/`path.resolve()`; never hardcode separators; tests must use
  `path.join()` for expected values, not hardcoded strings. Add a Windows CI
  verification task whenever the change touches paths. Include Windows path
  scenarios in specs.
- Product-behavior language in proposals/specs; internal mechanism goes in
  `design.md`/`tasks.md` unless the mechanism IS the user contract.
- Generated artifacts are tracked by explicit named constant lists — never
  deleted/modified by pattern matching or regex.
- **Version numbers belong to the user.** Never bump major/minor. Release-shaped
  work reads `package.json` rather than asserting a literal version.
- Schema discipline (plan §7.2): every identity-bearing schema is versioned;
  legacy data stays readable; new formats are written only by an explicit
  migration or a new mutation; mutations get plan/apply + dry-run + atomic write.
  **Readers ship before writers** (§30.2).
- Every phase syncs docs (§32): `docs/cli.md`,
  `docs/retention-and-learned-skills.md`, Store/bootstrap troubleshooting, agent
  contract, **en/zh-cn/ja locales**, CLI completion registry, JSON examples,
  migration guide. User-facing messages must state whether a UID or an alias was
  resolved, the planning Store, the execution project/checkout, what enters Git
  vs stays local, whether the command touches the network or writes, and the next
  copy-pasteable repair command.

## 7. Diagnostic code vocabulary (plan §20.2) — keep names consistent across children

```
store_bootstrap_required        store_uid_mismatch
store_alias_ambiguous           store_pointer_legacy
store_pointer_remote_divergence project_binding_missing
project_binding_ambiguous       store_project_record_missing
project_membership_locator_missing
project_membership_unverified   shared_metadata_contains_local_path
learned_owner_legacy_alias      project_knowledge_catalog_conflict
```

A child that needs a new code adds it here so siblings reuse rather than
reinvent.

**Added by children so far** (LEAD-routed: a child confined to its own change
directory reports new codes in its return and the LEAD records them here):

```
# child A — store-immutable-identity (landed 01070db9)
store_pointer_alias_drift       store_metadata_legacy
store_remote_credentials        store_alias_numeric
store_remote_divergence         store_registry_rekey_blocked
store_alias_repeated            store_alias_renamed

# child B — project-keyed-store-membership (landed 149c0136)
store_project_record_key_mismatch   store_legacy_reference_unresolved
project_identity_unrecordable       store_membership_legacy_manifest
store_membership_roles_inferred     project_planning_binding_refused

# child C — unified-session-runtime-context
project_binding_mismatch        project_binding_selector_conflict
session_context_broken
# (project_binding_missing and project_binding_ambiguous were already above and
#  are reused verbatim)
```

`STORE_IDENTITY_DIAGNOSTIC_CODES` in `src/core/store/identity-diagnostics.ts` is
the **factory-backed** set, not the exhaustive set of store diagnostic codes:
`identity.ts` also emits `store_metadata_missing`, `invalid_store_metadata`,
`unhealthy_store_root`, and `invalid_store_pointer` as inline diagnostics. Follow
that boundary — factories in `identity-diagnostics.ts`, parse/verify failures
inline — rather than "fixing" it.

## 8. Shared type vocabulary (plan §12) — introduced by child A, consumed by all

```ts
type StoreIdentityRef   = { type: 'store';   uid: string; id?: string }
type ProjectIdentityRef = { type: 'project'; projectId: string; id?: string }
type GlobalIdentityRef  = { type: 'global' }
type DurableOwnerRef    = GlobalIdentityRef | StoreIdentityRef | ProjectIdentityRef

type ResolvedStoreRef           = StoreIdentityRef   & { root: string }
type ResolvedProjectCheckoutRef = ProjectIdentityRef & { root: string; home?: string }
```

Durable refs carry no root. Manifests, ledgers, and digests use durable
identity. The ambiguous `{type, id}` shape that simultaneously meant Store UID,
Store alias, projectId, and project-namespace alias is retired.

Store binding resolver returns a **tri-state** (plan §14) — never a bare
nullable:

```ts
type StoreBindingResolution =
  | { kind: 'absent' }
  | { kind: 'resolved'; store: ResolvedStoreRef; pointer: StorePointerV2 }
  | { kind: 'unavailable'; expected: StoreIdentityRef
      reason: 'not-registered' | 'metadata-missing' | 'uid-mismatch'
            | 'root-unhealthy' | 'alias-ambiguous' | 'pointer-malformed'
      repair: string[] }
```

## 9. Per-child scope pointers into the plan

- **A** — §11.1, §11.2, §11.5, §14, §18.1, §20, §26 Phase A, §28.1 Identity.
  Explicitly EXCLUDES #65/#66 learned materialization, membership sharding,
  bootstrap clone, checkpoint, sourcePath migration.
- **B** — §11.3, §11.4, §13, §18.3, §21, §22.2, §26 Phase B, §28.1 Membership.
- **C** — §16, §17, §18.2, §18.4, §26 Phase C, §28.1 Runtime, §28.3.
- **D** — §15 (all), §11.7, §18.4, §26 Phase D, §28.1 Learned, §28.4, §28.8.
  Source commits `5fa32300` then `48142395`; cherry-pick as a starting point is
  allowed, committing them unadapted is not.
- **E** — §19, §20, §26 Phase E, §28.2, §28.6.
- **F** — §23, §11.7, §26 Phase F, §28.6. Bundle carries no machine paths, no
  target ledger, no tool materialization, no tokens/sessions; import validates
  `projectId` and FAILS on conflict rather than overwriting.

## 10. Findings appended by planners

<!-- Planners: append durable discoveries below this line, newest last.
     Format: ### <child-id> — <date> then bullet points. -->

### store-immutable-identity — 2026-07-25

**Actual current code shape (verified, not assumed)**

- Store metadata reader/writer, registry schema, and key grammar all live in
  `src/core/store/foundation.ts` (528 lines). `StoreMetadataState` is
  `{version:1,id,remote?}`; `StoreRegistryState` is
  `{version:1,stores:Record<key,{type?,backend}>}`. Both are Zod `.strict()`
  schemas, so an unknown key is a parse ERROR, not a tolerated field — every
  child adding a field must extend the schema, not just the TS interface. The
  one deliberate exception is `repos: z.unknown().optional()` (legacy, dropped
  on write).
- `parseRegistryKey()` / `registryKeyFor()` (`foundation.ts:63,71`) are the only
  key-grammar seam. `assertKeyTypeAgreement()` already treats a key-form vs
  `type`-field disagreement as `invalid_store_registry` — reuse it, do not add a
  parallel check.
- **The silent-ignore bug is one line:** `resolveConfigStoreLayer()` in
  `src/core/effective-config.ts` ends `if (!store) return null;` (line 125), and
  a malformed pointer returns `null` at line 112. Child A changes that function's
  return type to the tri-state so the fall-through cannot come back.
- There are **16 `listRegisteredStores()` call sites** and four independent
  Store-lookup implementations with disagreeing failure semantics:
  `root-selection.ts:209` (throws `RootSelectionError`),
  `effective-config.ts:104` (returns null),
  `config-api/project-addressing.ts:115` (returns an HTTP-ish result),
  `store/registry.ts:180 getRegisteredStoreOrThrow` (throws `StoreError`).
- `inspectRegisteredStore()` (`root-selection.ts:310`) is already the SHARED
  non-throwing metadata+health inspection (`ok` | `metadata_error` |
  `metadata_missing` | `metadata_id_mismatch` | `unhealthy_root`). Extend it;
  never fork a second health path.
- `copyForwardLegacyStoreMetadata()` (`foundation.ts:485`) is the precedent for
  copy-only legacy handling (`.openspec-store/` → `.rasen-store/`). It copies a
  file the user owns; it is NOT a precedent for minting new identity on read.
- UUID minting precedent: `crypto.randomUUID()` at `project-config.ts:1326`
  (lazy `projectId`). UUID *acceptance* precedent: any RFC 4122 textual form,
  per `management-api/router.ts:200`. Follow both.
- `readStorePointer()` (`project-config.ts:1207`) deliberately REPORTS a
  malformed pointer instead of dropping it (unlike `readProjectConfig`). Any
  child extending the pointer shape must preserve that.
- `store` CLI subcommands today: `setup`, `register`, `unregister`, `remove`,
  `add-project`, `adopt`, `eject`, `list`, `doctor`. Child A adds
  `upgrade-identity`. There is no `bootstrap` command yet (child E).

**Naming this child commits to — siblings must stay consistent**

- New module `src/core/store/identity.ts`, single entry
  `resolveStoreBinding()` → `StoreBindingResolution`. **Deviation from plan §31,
  recorded deliberately:** the plan's code map puts the tri-state in
  `root-selection.ts`, but that would force `effective-config.ts` and
  `config-api/*` to import command-facing root selection. `store/` is the leaf
  both already import. `root-selection.ts` keeps §31's role as the tri-state's
  *adapter* (reason → `RootSelectionError`).
- Exported types: `StoreIdentityRef`, `ProjectIdentityRef`, `GlobalIdentityRef`,
  `DurableOwnerRef`, `ResolvedStoreRef`, `ResolvedProjectCheckoutRef`,
  `StoreBindingResolution`, `StoreUnavailableReason`, `StorePointerV2`.
  Child A defines all of them (including the project-side ones) so the §12
  vocabulary is declared once; children B/C/D import rather than redeclare.
- Field names: metadata v2 `{version:2, uid, id, remote?}`; pointer v2
  `store: {uid, id?, remote?}`; registry v2 `{version:2, stores:{<uid>:{id,
  backend}}}`.
- **New diagnostic codes added to §7's vocabulary** (reuse, don't reinvent):
  `store_pointer_alias_drift` (warning), `store_metadata_legacy` (info),
  `store_remote_credentials` (error), `store_alias_numeric` (warning).
  Child A also owns `store_bootstrap_required`, `store_uid_mismatch`,
  `store_alias_ambiguous`, `store_pointer_legacy`,
  `store_pointer_remote_divergence`.

**Constraints and boundaries a sibling must respect**

- **Registry v2 re-keys the STORE namespace only.** `project:<id>` entries keep
  alias keying and `(type,id)` uniqueness in both versions — child B owns their
  move to `projectId` records. Do not re-key them twice.
- **Registry key grammar is selected by the file's `version` field**, never
  inferred from key text: v1 bare key = alias, v2 bare key MUST be a UUID.
- **The v2 registry writer refuses to rewrite** while any store entry lacks a
  resolvable UID; it names the entries needing `store upgrade-identity` instead
  of minting UIDs. So a mixed fleet keeps a v1 registry indefinitely — children
  B–F must not assume a v2 registry exists.
- **Fail-closed carve-out (child A decision, applies to every later child):**
  `rasen doctor`, `rasen store doctor`, `rasen store list`, `rasen config
  --global`, and `rasen init`'s pointer guard MUST keep working on an
  `unavailable` binding — they are how the user learns it is broken. Everything
  else fails closed. Do not "fix" these into failing.
- **Deferred consumers, by owning child:** `learned-skills/context.ts` → D;
  `management-api/spaces.ts` + `management-api/session-launch-context.ts` → C;
  `config-api/config-context.ts` inherits A's fix through `effective-config`.
  Child A adds a guard test asserting no Phase-A-set file imports
  `listRegisteredStores`; **children C/D must extend that test's file list**
  when they migrate their consumers, or the ban silently stops covering them.
- Credential detection is `new URL()` userinfo inspection, NOT a regex token
  scan; scp-form `git@host:path` is explicitly allowed. Reuse the shared
  redaction renderer for any surface printing a remote.
- UID comparison is trim + lowercase before compare (a hand-edited uppercase UID
  must not read as a mismatch).

**Spec-surface facts for the next planner**

- Delta specs written: NEW `store-identity`; MODIFIED `config-resolution`,
  `store-config-inheritance`, `store-project-namespace`.
- `store-config-inheritance`'s requirement *"Inactive inheritance degrades
  without failing"* is REMOVED (with Reason + Migration) and replaced by an
  ADDED *"An unavailable planning Store stops the command instead of
  degrading"* — a genuine rename, since the old title asserts the opposite of
  the new behavior. Its canonical-path/Windows scenario was carried forward
  verbatim into the replacement.
- `store-registration` needed NO delta: metadata-directory naming, default
  location, pointer-repo rejection, and the doctor drift states are all still
  accurate; new identity behavior lives in the new `store-identity` spec.
- `validate --changes` does not apply deltas to main specs (known blind spot).
  Titles were cross-checked mechanically against `rasen/specs/*/spec.md` before
  finishing: all MODIFIED requirement AND scenario titles match exactly, no
  scenario dropped. Do the same check for every sibling.


### project-keyed-store-membership — 2026-07-25

**Actual current code shape (verified this turn)**

- **Three unrelated things stand in for membership today**, none keyed by
  identity: `references: [project:<alias>]` in the Store's config (parsed by
  `parseDeclarationList`, `project-config.ts:317`; its real job is the
  instruction *index* in `references.ts`), `adoptions.yaml` (a single
  `Record<projectId, AdoptionEntry>` map, `store/migration.ts:73-106`), and the
  member repo's own `store:` pointer (`management-api/spaces.ts:121`).
- **`sourcePath` lives in exactly two places** and nowhere else in `src/`:
  declared in `store/migration.ts:81` + schema line 96 (Zod `.strict()`,
  `z.string().min(1)`, **required**), written at `migration-ops.ts:375`, read at
  `migration-ops.ts:534` as eject's default destination. Removing it = relax the
  schema to optional on read and delete both call sites. Every other `sourcePath`
  hit in the repo belongs to workflows/profiles/pipelines and is unrelated.
- `AdoptionEntry` is already keyed by `projectId` — the shard migration is a
  re-shape, not an identity-discovery problem, EXCEPT for `references:` entries
  which carry only an alias.
- Store CLI subcommands after child A: `setup`, `register`, `unregister`,
  `remove`, `add-project`, `adopt`, `eject`, `list`, `doctor`,
  `upgrade-identity`. Child B adds `migrate-membership`.
- `project-registry.ts` already has everything eject's destination rule needs:
  `findProjectRegistryEntry`, `readProjectRegistryState`,
  `resolveRegistrationRoot` (worktree piercing), plus `resolveProjectSelector`
  in `config-api/project-addressing.ts`. Child B only READS it, so
  `rasen/specs/project-registry/spec.md` needs no delta.

**Naming this child commits to — siblings must stay consistent**

- Record: `<store>/.rasen-store/projects/<projectId>.yaml`, fields
  `{version:1, projectId, id?, remote?, roles:{planning,knowledge},
  adoption:{specs,changes,adoptedAt}?}`. **`roles.planning` / `roles.knowledge`**
  (§34 lets the change name them; §11.4's `planningMember`/`knowledgeMember`
  is redundant inside a `roles:` container). A future `execution` field fits the
  same container and per §13.5 could only ever mean *candidacy*.
- Project side: **`storeMemberships`** in `rasen/config.yaml` (matches §11.3).
- New modules: `src/core/store/project-records.ts` (schema/read/write) and
  `src/core/store/membership.ts` (the provider).
- Provider shape: `StoreMembershipRecord = {storeUid?, projectId, id?, remote?,
  roles, provenance, diagnostics}` with
  `MembershipProvenance = 'v2-record' | 'legacy-reference' | 'legacy-adoption'`.
  Entry points `listStoreMembers`, `resolveProjectMembership`,
  `listProjectStoreCandidates`.
- Two-repo mutation shape (§22.5): `MembershipMutationPlan = {projectBaseCommit,
  storeBaseCommit, projectWrites, storeWrites, repairNeeded}`.
- **New diagnostic codes added to §7's vocabulary**:
  `store_project_record_key_mismatch` (error),
  `store_legacy_reference_unresolved` (warning),
  `project_identity_unrecordable` (error),
  `store_membership_legacy_manifest` (warning). Child B also owns
  `store_project_record_missing`, `project_membership_locator_missing`,
  `project_membership_unverified`, `shared_metadata_contains_local_path`.
- **§20.2's `store_project_record_missing` vs `project_membership_unverified`
  are NOT duplicates** — the split child B commits to: the first is the
  **primary planning** Store having no record (error — planning is already bound
  to it); the second is a **secondary knowledge** locator whose Store is not
  registered here (warning — it simply is not present yet).

**Constraints and boundaries a sibling must respect**

- **A record filename is validated, never sanitized.** `projectId` is typed
  `z.string()`, so non-UUID values exist (hand-written configs; the
  `UNASSIGNED_PROJECT_ID = '(unassigned)'` sentinel at `migration-ops.ts:216`).
  Recordable = valid UUID **or** valid kebab id, and not a Windows reserved
  device name (`WINDOWS_RESERVED_DEVICE_NAMES`, explicit list, no regex).
  Sanitizing would let two distinct projectIds collide onto one file and
  silently overwrite a membership.
- **Eligibility is a union and an unavailable Store is returned, not filtered:**
  `declared hints ∪ locally-recorded members`, unavailable entries carrying
  child A's reason + repair. **Child D must not read "absent from the set" as
  "not a member"** — that is §33.10 fail-closed applied to membership.
- **`v2-record` beats every legacy source** for the same projectId; legacy
  sources contribute only projectIds that have no record. New writes are
  projectId shards only.
- **`legacy-reference` normalization is machine-local by nature** (alias →
  project namespace → that project's config `projectId`). Unresolvable on a
  fresh machine BY DESIGN; reported as `store_legacy_reference_unresolved`,
  never dropped, never guessed.
- **The migration DELETES `adoptions.yaml`** after records are written and
  re-read — not archived under another name, because archiving keeps the machine
  path in Git, which is the thing being removed. Content survives in Git history.
- **The `listRegisteredStores` ban targets by-id LOOKUP, not enumeration.**
  `spaces.ts:47` enumerates all stores, which is legitimate, so child B does
  **not** add `spaces.ts` to `PHASE_A_FILES`. Child C, which rewrites that
  file's resolution, should decide whether to retire the import.
- Store `members` in the spaces listing becomes the **union** of provider
  records and the existing pointer-derived entries (not a replacement), so a
  Store with no records yet does not suddenly list zero members and every
  pre-existing scenario stays true.

**Spec-surface facts for the next planner**

- Delta specs written: NEW `store-project-membership` (9 requirements);
  MODIFIED `store-add-project`, `store-adopt`, `store-eject`,
  `planning-space-addressing`.
- **Deliberate avoidance: child B touches NO capability child A touches.**
  Verified mechanically — shared capabilities between the two changes: NONE.
  This matters because the portfolio ships as ONE PR with archives in child
  order: two MODIFIED blocks for the same requirement would have the second
  archive clobber the first (MODIFIED replaces the whole requirement).
  **Every later child must run the same cross-child check**, not just
  delta-vs-main.
- **Trap that nearly detonated this proposal:** in
  `rasen/specs/store-add-project/spec.md`, *"The reference is written into the
  store's repo, not the project's"* is a **scenario** (line 45) of the
  requirement *"The command is non-destructive to the in-repo project"* — NOT a
  requirement. Writing a REMOVED block for it produced a no-op removal AND
  silently dropped a scenario from the MODIFIED requirement. Only the mechanical
  scenario-SET diff caught it; reading the spec by eye did not. Diff scenario
  sets, never just requirement titles.
- `rasen/specs/store-project-namespace/spec.md` needs **no** child-B delta: its
  `project:` reference requirements describe the instruction index, which is
  unchanged, and child A already modified two of its requirements.
- `store-registration` and `project-registry` also need no child-B delta.

**LEAD adjudications folded in after the first pass (2026-07-25)**

- **`store add-project --set-primary` is IN**, opt-in and default-off. The LEAD
  overruled the planner's "omit it": §21.1's target-writes list literally ends
  with "primary store pointer（只有用户选择绑定时）", which IS an explicit
  opt-in flag, so omitting it leaves add-project short of §21.1. The separation
  between planning binding and membership is preserved by the write being
  **explicit and never implicit** — default off, never inferred from another
  flag or from the project's state — and by the command **refusing** (naming
  what is bound, what was requested, and the rebinding command) rather than
  overwriting when a DIFFERENT planning Store is already bound. A refusal is
  scoped to the pointer only: the membership record and locator established by
  the same invocation still stand, same "never roll back a valid authority
  record to tidy up" rule as the two-repo apply. `adopt` binds by definition and
  is NOT routed through the flag.
- **The migration guide MUST state, as its own passage, that the deleted
  `adoptions.yaml` stays recoverable from the Store's Git history**, with the
  concrete `git log`/`git show` commands. It is the change's only
  non-reversible step and a user must not be left believing the data is gone.

### unified-session-runtime-context — 2026-07-25

**The gap, located exactly**

- `resolveSessionLaunchContext` already does the hard work and returns
  `{planningSpace?, cwd, attachedRoots, executionProject?:{projectId,root}}`.
  **`sessions.ts:146-154` then drops `executionProject`** and passes only
  `cwd`/`attachedRoots`/`space`. That single omission is the whole Phase C gap;
  everything downstream re-derives from cwd because nothing else was given.
- `SessionRecord` (`session-registry.ts:36`) has `cwd` + `space?` and NO
  execution field. `supervisor.ts:300` spawns with a bare `env: process.env` —
  nothing session-specific is injected today.
- `run-state.ts:167` freezes `knowledgeContext` only;
  `freezeKnowledgeContext` (`learned-skills/context.ts:547`) freezes
  `{planningRoot, owner}` as `{type,id}` pairs with **no checkout binding**.
- `buildActionContext` (`change-status-policy.ts:55`) returns
  `allowedEditRoots: [projectRoot]` — one root, one meaning, 82-line file.
- Child A's `ResolvedProjectCheckoutRef` was defined and left unused; child C is
  its first real consumer.

**⚠️ ARCHIVE DEBT that changes how deltas must be written — read before C/D/E/F**

`separate-session-planning-and-execution-context` (PR #68) has its **code merged
into `dev/0.1.5`** but its **change was never archived**. So
`rasen/specs/session-supervision/spec.md` still describes PRE-#68 behavior:

- main still contains `Session launch accepts a space selector that sets the
  working directory`, which #68's pending delta REMOVES;
- the requirement a runtime change would naturally extend — `Session launch
  separates planning space from validated execution context` — exists ONLY in
  #68's pending delta, not in main;
- `packages/ui`'s launch dialog already ships an execution selector, so
  `sessions-ui`'s "exactly three inputs" clause is already stale.

**Consequence: main specs are NOT ground truth for session behavior.** Do not
write a MODIFIED block against `session-supervision` or `task-detail-ui` — you
would be modifying a description of behavior that no longer exists, and
whichever of you and #68 archives second silently discards the other.

**The generalized rule (supersedes §11 item 2's sibling-only framing):** the
collision check must run over **every active change directory**, not just
portfolio siblings. Other live overlaps found this turn, all currently benign
because they touch different requirements — verify before assuming:
`store-adopt` (child B + `fix-adopt-dryrun-archive-preview`),
`store-project-namespace` (child A + `store-aware-learned-skills-context`),
`learned-skill-knowledge-context` (`store-aware-learned-skills-context` +
`-scope`), `pipelines-ui` (`keepalive-beat-config` +
`simplify-pipeline-handoff-ui`), plus `cli-init`/`cli-update`/`profiles`/
`workflow-library` each touched by 4–5 active changes.

**Child C's spec surface (deliberately minimal to stay collision-free)**

- NEW `session-runtime-context` (8 requirements, 37 scenarios) carries the whole
  runtime contract, composed WITH session supervision rather than editing it.
  "What a session records and hands its child process" is a genuinely distinct
  behavior area from "how a session is spawned and supervised", so this is
  honest decomposition, not evasion — and it makes C archivable in any order
  relative to #68.
- MODIFIED `cli-artifact-workflow` :: `Status JSON action context` — the only
  place `ActionContextV2` belongs, and no other active change touches that
  capability.
- **Not** `sessions-ui`: its `Launching an auto or goal run from the UI`
  requirement claims "exactly three inputs", which #68's shipped dialog already
  contradicts. Fixing that is #68's archive debt, not C's. C's UI requirement
  lives in its own capability instead.

**Naming C commits to — siblings must stay consistent**

- `RuntimeContext = {version:1, sessionId, planning: RuntimePlanningRef,
  execution: RuntimeExecutionRef}`;
  `RuntimePlanningRef = {type:'project',projectId,root} | {type:'store',uid?,id?,root}`;
  `RuntimeExecutionRef = {kind:'planning-only'} | {kind:'project',projectId,root,home?}`.
  `uid` optional on the Store arm ONLY, same reason child A made it optional on
  `ResolvedStoreRef` (legacy metadata resolves legitimately with no identity).
- Context file: `<machine data dir>/sessions/<sessionId>/context.json`.
  Env var: **`RASEN_SESSION_CONTEXT` carries the PATH, never the JSON** (process
  table, `ps`, log dumps, Windows quoting/length).
- `ActionContextV2 = {version:2, planningWriteRoots, codeWriteRoots, readRoots,
  requiresAffectedAreaSelection, constraints}`. Planning writes narrow to
  `rasen/specs` + `rasen/changes`, never a repo root.
- Reused diagnostic code: `project_binding_ambiguous` (already in §7).

**Constraints a sibling must respect**

- **The v1 `allowedEditRoots` projection may only NARROW.** It reports v1 only
  when `codeWriteRoots ∪ planningWriteRoots` is a subset of what v1 previously
  granted for that same session; otherwise it reports the newer version so a v1
  consumer stops instead of inheriting a root it never asked for. Child C adds a
  test asserting the subset property for every session shape — do not relax it.
- **Frozen identity is authority; session context/current checkout is only the
  locator; an explicit selector only cross-checks.** A frozen/checkout mismatch
  FAILS — never falls back to another clone. A resume into the wrong working
  tree produces a plausible-looking diff, which is worse than an error.
- Child C changes WHERE `learned-skills/context.ts` gets its context, not WHAT
  it decides. **Child D owns the effective algorithm** and must not read C's
  edit as having settled precedence.
- `session-launch-context.ts` joins `PHASE_A_FILES` in child C.
- Membership validation sits behind ONE seam so it works before child B lands
  (today's pointer check, via `hasStoreDeclaration`/durable comparison — NOT
  `pointer.value`) and after (`resolveProjectMembership`).

**UI sequencing (LEAD-owned)**

`packages/ui/src/components/LaunchSessionDialog.tsx` and
`packages/ui/src/api/types.ts` were verified CLEAR of the concurrent session.
`packages/ui/src/i18n/locales/{en,ja,zh-cn}.json` are OCCUPIED — task 9.4
isolates the UI-string step for separate sequencing. CLI-side
`src/locales/*.json` is unaffected. Wire-type mirror discipline: an additive
`wire-types.ts` change drifts `packages/ui/src/api/types.ts` silently and
nothing fails — the mirror update is task 9.2, never an assumption.

### store-aware-learned-skills-integration — 2026-07-26

**Ancestry re-verified against current HEAD**

```
#62 da02dd60  ancestor: TRUE      #65 5fa32300  ancestor: FALSE
#66 48142395  ancestor: FALSE     (#65 is an ancestor of #66)
```

**⚠️ The learned-knowledge spec surface is ENTIRELY PHANTOM**

`rasen/specs/` contains **no** learned-knowledge capability. All four exist only
inside unarchived change directories:

| Capability | Declared by | Code status |
|---|---|---|
| `learned-skills` | `add-retention-codify-skills` | appears SHIPPED (`rasen knowledge`, `src/core/learned-skills/`) — **unverified archive debt, LEAD should confirm** |
| `learned-skill-knowledge-context` | `store-aware-learned-skills-context` (#62) + `-scope` (#65) | **#62 IS merged** — archive debt, same class as #68 |
| `store-scoped-learned-skills` | `store-aware-learned-skills-scope` (#65) | not merged |
| `learned-skill-effective-materialization` | `store-aware-learned-skills-materialization` (#66) | not merged |

Two different problems wearing the same shirt, and they need different fixes:

- **#62 and `add-retention-codify-skills` are archive debt** — code shipped, spec
  never landed. Pay down like #68.
- **#65 and #66 are stale PROPOSALS for work child D redoes on new contracts.**
  Their change dirs declare the exact capability names D defines. Two changes
  cannot both ADD the same new capability, so **D cannot archive until the LEAD
  retires `store-aware-learned-skills-scope` and
  `store-aware-learned-skills-materialization`.** This is the spec-level form of
  the plan's "adapt, never transplant": the algorithms come from the source
  commits (still in git), the old-model plumbing is discarded.

**Child D's spec surface — three NEW capabilities, ZERO MODIFIED blocks**

`store-scoped-learned-skills` (6 req / 20 scn), `learned-skill-effective-materialization`
(8 req / 31 scn), `project-knowledge-home` (3 req / 13 scn).

Zero MODIFIED is not tidiness, it is forced: there is nothing in `rasen/specs/`
to modify. It also makes D **order-independent** with respect to whatever
archive debt the LEAD pays down. Deliberately untouched:
`learned-skill-knowledge-context` (leave to #62's archive) and
`cli-init`/`cli-update` (already contested by FIVE active changes — D states
"when the effective set is materialized" inside its own capability instead, and
treats the init/update wiring as an implementation task).

**Constraints later children must respect**

- **Display name never keys anything durable.** Ledger `stores` map,
  `sources[].owner`, manifests, and the digest identity portion all key on
  permanent Store identity. Sorting uses identity or a stable canonical
  serialization — an alphabetical tie-break on a renameable field is a winner
  chosen by accident. **A rename must change no digest and no ledger entry**
  (Gate 4 acceptance item).
- Child A's round-4 rule applies to every write path here: after resolving,
  display/record uses the resolved NAME, re-resolution uses `uid ?? id`. Check
  what lands ON DISK, not what the log line says.
- **Three roots stay apart** (§15.6): `canonicalOwnerRoot`
  (`~/.rasen/project-knowledge/<projectId>`), `evaluationRoot` (child C's
  recorded checkout — applicability decided here), `materializationTarget` (the
  tool's project-local home in that checkout). The source commits conflate all
  three into "the current project directory".
- **Eligibility is child B's provider**, never the primary planning pointer; an
  unavailable eligible Store arrives marked unavailable and must NOT be dropped.
- **Every ambiguous migration BLOCKS rather than guesses**: divergent catalogs
  → report, pick nothing, delete nothing; ambiguous alias→identity in a v1
  ledger → stop, never drop provenance. Old data survives until the new location
  is written AND re-read.
- **The v1→v2 digest change is recorded as a migration, never as edited
  content** — otherwise every user's first post-upgrade run reports their whole
  catalog as modified.
- New module `src/core/project-knowledge-home.ts`. Phase F part 1 lands HERE,
  not in child F.

**Size: D is bigger than one reviewable diff — seam proposed, not trimmed**

Two source PRs of algorithm + three schema migrations + a new module + init/
update wiring. The seam is drawn by the source commits themselves (#65 is an
ancestor of #66):

- **part 1** — Store catalog, permanent identity, membership authority,
  promotion evidence/approval, manifest v2 → `store-scoped-learned-skills`
  (task groups 2–4).
- **part 2** — effective resolution, equivalence/conflict/unavailable, the
  three-root split, knowledge home + migration, ledger v2, digest v2, init/update
  wiring → `learned-skill-effective-materialization` + `project-knowledge-home`
  (task groups 5–9).

Part 1 is independently testable (a Store can hold and publish knowledge before
anything consumes it); every part-2 test needs part 1's catalog to exist. If
split, no acceptance criterion moves — only the diff boundary.

### Phase D split into D1/D2 — 2026-07-26

Phase D was assessed at roughly twice child A and split on the LEAD's decision.
The single `store-aware-learned-skills-integration` directory is **deleted**;
its three capability specs moved verbatim, so no acceptance criterion changed —
only the diff boundary.

| | change | capability | tasks |
|---|---|---|---|
| **D1** | `store-scoped-learned-knowledge` (adapts #65 `5fa32300`) | `store-scoped-learned-skills` | 50 |
| **D2** | `learned-knowledge-effective-resolution` (adapts #66 `48142395`) | `learned-skill-effective-materialization`, `project-knowledge-home` | 72 |

The seam is the source commits themselves (#65 is an ancestor of #66). **D1 is
independently shippable** — a Store can hold and publish knowledge before
anything consumes it — and every D2 test needs D1's catalog to exist. D2 cannot
ship alone, and its design says so rather than pretending otherwise.

**Both carry ZERO MODIFIED blocks**, which is forced rather than tidy: `rasen/specs/`
still holds no learned-knowledge capability. The useful consequence is that both
are **order-independent** with respect to the learned-knowledge archive debt the
LEAD sequenced for later.

**Retired by the LEAD (commit `5c465158`)**: `store-aware-learned-skills-scope`
and `store-aware-learned-skills-materialization`, freeing the two capability
names. Their algorithms live on in the source commits; only the old-model
plumbing was discarded.

**Archive debt still outstanding, deliberately deferred — do not touch these:**

- `store-aware-learned-skills-context` (#62, merged) still claims
  `learned-skill-knowledge-context` **and** `store-project-namespace`. Child A
  holds MODIFIED blocks on the latter, so archiving #62 now would move main out
  from under A mid-review. Deferred until A lands.
- `add-retention-codify-skills` (shipped, `451bfc39`, 53/53 ticked) claims TEN
  capabilities including `cli-init`, `cli-update`, `profiles`,
  `workflow-library`. Deferred permanently out of this portfolio — archiving it
  would sync all ten into main at once.

**⚠️ Pre-existing MODIFIED conflicts OUTSIDE this portfolio (found by the
portfolio-wide sweep, reported not fixed).** Several active changes carry a
MODIFIED block for the SAME requirement; whichever archives last silently
discards the others, because MODIFIED replaces the whole requirement:

```
profiles   :: 'Profile configuration via interactive picker'
             -> add-retention-codify-skills, add-zh-cn-cli-locale,
                cli-locale-workflow-list-skill-title-fixes,
                fix-profile-picker-terminal-height        (FOUR changes)
profiles   :: 'Profile settings stored in global config'
             -> add-retention-codify-skills, add-zh-cn-cli-locale
cli-update :: 'Update respects global profile config'
             -> add-retention-codify-skills, init-profile-lock
```

None involves this portfolio and none is this portfolio's to fix. Recorded
because the same sweep that clears a child also finds these, and they are real
latent damage whenever those changes archive.

**Sweep worth reusing verbatim by E and F:** scan every `rasen/changes/*/specs/**`,
build `capability -> {change -> {(section, requirement)}}`, then report (a) any
capability your change shares with another, and (b) any requirement with more
than one MODIFIED owner portfolio-wide. 35 active change dirs, runs in seconds.

### store-bootstrap-and-hydration — 2026-07-26

**Spec surface: one NEW capability `store-bootstrap` (10 req / 37 scn), zero
MODIFIED blocks.** Free in both `rasen/specs/` and all 35 active change dirs.
Deliberately NOT modified: child A's `store-identity` — A already requires every
unavailable-Store failure to carry a copy-pasteable repair, so the repair string
becoming `rasen bootstrap` SATISFIES A's contract rather than amending it. Also
untouched: `cli-completion` (a completion entry is an implementation task, as A
did for `upgrade-identity`) and `project-registry` (E only reads/registers
through existing behavior). Every child from C onward has now landed zero
MODIFIED blocks — that is what keeps them order-independent with respect to A's
review and the deferred archive debt.

**`--check` and `--dry-run` are DIFFERENT promises — spec them separately**

| | reads | resolves remotes + target path | mkdir | git | writes |
|---|---|---|---|---|---|
| `--check` | yes | **no** | no | no | no |
| `--dry-run` | yes | **yes** | no | no | no |

Collapsing them into one shared "safe mode" flag is the natural implementation
and is wrong: `--check` is what a user runs when they do not yet trust the tool
with their network, so it must contact nothing; `--dry-run` must resolve the
remote to answer "exactly where would this land?". Each gets its own zero-write
assertion, and check mode additionally gets a no-network assertion.

**Decisions on child A's deferred rows (LEAD asked for these explicitly)**

- **Row B — a uid-only declaration reads as a mismatch in session launch (409).**
  Bootstrap is the command that CREATES declarations, so it must not manufacture
  instances of the bug: it writes the object form with the permanent identity
  **and the display name whenever the Store has one**, keeping the stale
  name-comparison satisfied while identity stays the authority. A Store with no
  display name at all still yields a uid-only declaration — bootstrap REPORTS
  that limitation with its repair rather than writing something that silently
  fails elsewhere. The real fix stays in the file child C owns.
- **Row D13 — hints suggest `--store <name>`, which fails for the user who typed
  a uid.** Every hint bootstrap prints names an UNAMBIGUOUS selector: the
  permanent identity when that display name matches more than one Store on this
  machine, the display name otherwise. Bootstrap knows the arity at print time
  because it just resolved every Store. A hint that fails when pasted is worse
  than no hint.

Both are scoped to bootstrap's own output and writes — neither touches another
child's file, so neither creates a collision.

**Constraints later children must respect**

- **Store-first LISTS, it does not harvest.** Never obtain every project a Store
  records — a Store can hold a hundred. Listing is the product; obtaining is
  opt-in per project.
- **"Clean up the failed clone" deletes user data** when the failure was caused
  by a pre-existing directory. Removal requires proof this run created the
  directory AND that removal is safe; anything else is left and reported.
- **An absent Store with no remote and no supplied path has no honest answer.**
  Never infer a location from a display name, a sibling directory, or a legacy
  recorded source path. Demand a path or metadata.
- The remote is passed as an ARGUMENT with `windowsHide`, never assembled into a
  shell command line (§28.6).
- Three named end states — complete / degraded / blocked — in both human and
  JSON. "Partially worked" is the NORMAL fresh-machine outcome and needs a name
  both the user and a JSON consumer can act on.
- Drift (display name / remote) is REPORTED, never auto-corrected. Auto-fixing a
  declaration during a setup step is the silent rewrite four changes were spent
  eliminating.
- Two dependency seams (membership verification → child B; knowledge-location
  preparation → child D2) both DEGRADE to "cannot verify here" rather than
  failing, so bootstrap's core works before either lands.

**Size: one reviewable diff.** Comparable to child A, well under D. One command,
two flows, one new core module — no seam needed.

**Portfolio-wide sweep, re-run (35 dirs):** E is clean on both arms. The same
three pre-existing MODIFIED conflicts persist and remain outside this portfolio
(`profiles` ×4 and ×2, `cli-update` ×2, all involving
`add-retention-codify-skills`). Unchanged since the D1/D2 split; still not this
portfolio's to fix.

### portable-project-knowledge — 2026-07-26

**Spec surface: one NEW capability `portable-project-knowledge` (8 req / 51 scn),
zero MODIFIED blocks.** Free in `rasen/specs/` and in all 34 active change dirs.
Every child from C onward has now landed zero MODIFIED, so the whole portfolio
after A is order-independent with respect to A's review and the archive debt.

Deliberately NOT modified: **`store-bootstrap`** (child E) — E's own task 6.3
already reserves "plan an explicit portable bundle import as a SEPARATE reported
step; do not perform it", so F's bootstrap requirement composes with E inside F's
capability instead of amending E's, the same move child C made against session
supervision. Also untouched: D1/D2's three capabilities (F adds a route *into*
the project catalog, changes nothing about how it resolves) and
`learned-skill-knowledge-context` (still claimed by #62's unarchived directory).

**Phase F is narrower than the plan's Phase F section reads.** Part 1 (logical
knowledge home + per-clone catalog migration) is D2's `project-knowledge-home`.
F is §23.2/§23.3 only.

**Two decisions a later reader will otherwise mistake for inconsistency**

- **Import is all-or-nothing; D2's catalog migration is not.** D2 migrates what
  agrees and reports the conflicting identifier; F refuses the entire import on
  any conflict. The difference is who authored the situation. The migration
  *recovers* from drift the user never chose, so salvaging what agrees beats
  salvaging nothing. An import is a single transfer the user initiated with a
  file in hand; a half-applied bundle leaves a state they cannot name, repeat, or
  undo. `--dry-run` reporting **every** conflict rather than the first is what
  makes all-or-nothing tolerable, so it is a spec scenario, not a nicety.
- **`baseProjectCommit` is provenance, never a gate.** Enforcing a base SHA is
  checkpoint semantics; importing that machinery now is exactly what §26 Phase G
  moves to `0.2.0`. It is reported on divergence and the docs say so.

**The plan's bundle sketch is incomplete and F extends it deliberately.** §23.2
lists `records[]` as `{id, knowledgeKey, contentDigest, manifest}`. That cannot
reconstruct a record: `LearnedSkillManifest` carries `description` but **not**
`instructions`, and the canonical body lives beside it in `SKILL.md`. So each
record also carries its **canonical content**, validated against the recorded
digest on arrival. Extension to an illustrative shape, no invariant touched.

**Codebase facts verified this turn (useful to D1/D2's implementers too)**

- `EvidenceReference.artifact` is an artifact **kind** (`proposal`, `design`, …),
  not a path — `src/core/learned-skills/types.ts:79`. So the managed record is
  already close to portable; F's exclusions are enforced by *what is not read*,
  not by scrubbing a structure full of machine state.
- `LearnedSkillManifest` (`schema.ts:84`) is Zod `.strict()`: `version, id,
  knowledgeKey, scope, status, generatedBy, contentDigest, description,
  applicability, evidence, evidenceOverflow?, createdAt, updatedAt, retiredAt?,
  retirementReason?`. Canonical dir = `learned-skill.yaml` + `SKILL.md`
  (`constants.ts`).
- `rasen knowledge` today has exactly `apply`, `list`, `show`, `retire`, sharing
  `addOwnerSelectorOptions` (`--project/--store/--run-state-dir`) at
  `src/commands/knowledge.ts:513`. F adds the `bundle export` / `bundle import`
  pair. Completion entries live at `command-registry.ts:745`.

**Content rules stated as scenarios, per the LEAD's instruction** — no machine
path, no target ledger, no tool materialization, no tokens/sessions, projectId
validated, conflict fails instead of overwriting. Three additions worth keeping:

- The machine-path assertion covers **Windows drive-letter, Windows UNC, and
  POSIX absolute forms on every platform** — a POSIX-absolute value produced on
  Linux is exactly as wrong on Windows as the converse, and the bundle is read on
  the other machine by definition.
- The permitted-field list is an explicit **allowlist**, not a scrub. A scrub is
  a denylist, and a denylist silently ships whatever a later field addition
  introduces — the same reasoning behind this repo's named-constant rule for
  generated artifacts.
- **Retired records travel with their status**, and retired-vs-active is a
  conflict. Omitting them would let one machine silently keep a record the other
  deliberately retired.

**Transport is not ownership — the specific failure F exists to prevent.**
A Store may carry the *file*; it must not become the owner. Import inferring
Store scope from "the bundle sat in a Store" would be a route around D1 needing
no evidence, no membership, and no approval. Enforced on both sides: export
writes a file and touches no catalog / project record / metadata and commits
nothing; import stores everything as the project's own, records no Store as a
source, and adds the receiving machine as no further independent evidence source
(so an import cannot inflate the distinct-project count a wider scope needs).

**Bootstrap `--yes` asymmetry, inherited from child E's adjudication:** a
blanket confirmation covers a bundle the **project's own committed configuration**
names, and never one named only by a **Store's record for the project**. Same
shape as E's project-first/Store-first split, same reason — a Store's record is
authored by other people and can change without the local user knowing.

**Size: one reviewable diff**, the smallest child in the portfolio. 12 task
groups, 78 tasks, one new `src/core/knowledge-bundle/` plus two subcommands on
the existing `knowledge` command. No seam needed.

**Portfolio-wide sweep, re-run (34 dirs):** F is clean on both arms — no shared
capability, no MODIFIED at all. The same three pre-existing conflicts persist and
remain outside this portfolio (`profiles` ×4 and ×2, `cli-update` ×2, all
involving `add-retention-codify-skills`). Unchanged since child E.

## 11. Standing instructions for every remaining child (C, D, E, F)

These are mandatory, not advisory. Both were learned the hard way in child B and
are invisible to `rasen validate` and to reading a spec by eye.

1. **Diff scenario SETS, never just requirement titles.** Before finishing any
   proposal, mechanically compare each delta's MODIFIED requirement against the
   main spec at the SCENARIO level: every main-spec scenario title must still be
   present in the delta. Child B mistook
   *"The reference is written into the store's repo, not the project's"* for a
   requirement — it is a **scenario** (`rasen/specs/store-add-project/spec.md:45`)
   of *"The command is non-destructive to the in-repo project"*. The resulting
   REMOVED block was a silent no-op AND the MODIFIED requirement silently lost
   that scenario. `validate --strict` passed; only the set-level diff caught it.
   A dropped scenario is an implicit deletion that detonates at archive.

2. **Run a cross-change collision check over EVERY active change directory —
   not just portfolio siblings.** No two changes may carry a MODIFIED block for
   the same requirement. Archives apply in whatever order the changes land, and
   MODIFIED replaces the WHOLE requirement — so the later archive discards the
   earlier one's work with no tool complaining. Child B routed around
   `store-project-namespace` because child A owns two of its requirements;
   child C routed around `session-supervision` / `task-detail-ui` because the
   unarchived `separate-session-planning-and-execution-context` (PR #68) owns
   them. Scope the check to `rasen/changes/*/specs/**`, not just this
   portfolio's children. If the intersection cannot be emptied, raise it with
   the LEAD rather than writing the second MODIFIED block.

   **Corollary — main specs are not always ground truth.** A change whose CODE
   is merged but whose change directory was never archived leaves
   `rasen/specs/<cap>/spec.md` describing behavior that no longer exists
   (`session-supervision` is in exactly that state today). Before writing a
   MODIFIED block, check whether an unarchived change already owns that
   capability; if one does, prefer a new capability that composes with it over
   a MODIFIED block that fights it.

Running both checks as a throwaway script over `rasen/changes/*/specs/**` and
`rasen/specs/**` takes seconds and is the only thing that catches either class.
