## Context

Plan §23. This is the last child of the `store-context-unification` portfolio and the narrowest.

**Phase F part 1 is not here.** The logical project knowledge home (`~/.rasen/project-knowledge/<projectId>/learned-skills/<id>`) and its conflict-safe migration off per-clone catalogs landed in child D2 (`learned-knowledge-effective-resolution`), because multi-checkout correctness is a precondition for D2's resolution rather than a follow-on. This change is Phase F part 2 only: cross-machine bundle export and import.

What it consumes from D2, which was **proposed and not implemented** when this was planned:

- the catalog layout — one canonical location per project identity, separate from the clone-specific work directory, from clone-specific archive and work ephemera, and from the in-checkout materialization target;
- what a durable record keys on — permanent identity, never a display name;
- content identity — schema version, identifier, knowledge key, effective scope, sorted durable source identities, content digests, rendered managed body, and **no display name in the identity portion**. That last exclusion is what makes a bundle portable at all: a Store renamed on one machine and not the other must not read as changed content on import.

Two facts about the tree shape this change:

- The managed record is already close to portable. `LearnedSkillManifest` (`src/core/learned-skills/schema.ts`) carries `id`, `knowledgeKey`, `scope`, `status`, `contentDigest`, `description`, `applicability`, `evidence`, and timestamps — and `EvidenceReference.artifact` is an artifact *kind* (`proposal`, `design`, …), not a path. The canonical body lives beside it in `SKILL.md`. So the excluded categories are excluded by *what is not read*, not by scrubbing a structure that contains them.
- `rasen/specs/` contains **no** learned-knowledge capability at all. `learned-skills` and `learned-skill-knowledge-context` are declared only inside unarchived change directories whose code has shipped — archive debt sequenced for later. There is nothing here to write a `MODIFIED` block against, and `learned-skill-knowledge-context` must stay untouched because that debt still claims it.

## Goals / Non-Goals

**Goals:**

- One explicit export/import route for a project's own knowledge, and no implicit one.
- A bundle whose contents are chosen by an explicit permitted-field list, not by scrubbing.
- Import that validates fully before writing, and that blocks on conflict instead of choosing.
- A Store usable as transport without becoming an owner.
- One confirmed, separately listed bundle step in machine preparation, and no automatic import.

**Non-Goals:**

- The project knowledge home and the per-clone catalog migration — child D2.
- The Store catalog, publication evidence, and approval — child D1. Import is not a route around either.
- Portable run checkpoints (plan §24, §26 Phase G, §33 decision 16) — `0.2.0` or later. `baseProjectCommit` here is recorded for audit and reported on divergence; it never gates an import, because gating on a base SHA is checkpoint semantics and importing that machinery early is precisely what §26 Phase G forbids.
- Issue / Execution Plan.
- Any automatic synchronization of `~/.rasen` (§33 decision 14).

## Decisions

### D1 — Spec surface: one NEW capability, zero MODIFIED blocks

`portable-project-knowledge` is unclaimed in `rasen/specs/` and in all 36 other active change directories. Zero `MODIFIED` continues the run from child C onward and keeps this change **order-independent** with respect to child A's review and the deferred archive debt.

Deliberately not modified:

- **`store-bootstrap` (child E).** The declared-bundle step is stated inside this capability instead. E's own task 6.3 already reserves it — "plan an explicit portable bundle import as a SEPARATE reported step; do not perform it (that is the following change)" — so this composes with E rather than amending it, exactly as child C composed with session supervision.
- **`learned-skill-effective-materialization` / `project-knowledge-home` (child D2)** and **`store-scoped-learned-skills` (child D1).** This change adds a route into the project's catalog; it changes nothing about how the catalog resolves or what a Store's catalog requires.
- **`learned-skill-knowledge-context`** — still claimed by PR #62's unarchived directory.

### D2 — An import is all-or-nothing; the catalog migration is not, and that difference is deliberate

D2's catalog migration migrates the knowledge that agrees and reports the identifier that conflicts. This change refuses the **entire** import when any record conflicts.

They differ because of who authored the situation. The migration is *recovering* from state the user did not choose — two clones that drifted apart without anyone deciding to — so salvaging what agrees is strictly better than salvaging nothing. An import is a single transfer the user initiated with a file they are holding; a half-applied bundle leaves a state they cannot name ("some of that bundle"), cannot repeat, and cannot undo. Refusing keeps the receiving machine in a state that is exactly describable: before, or after.

The cost is one extra round trip, and `--dry-run` removes it — it reports **every** conflict rather than stopping at the first, so the user resolves once and imports once. Reporting only the first conflict would make all-or-nothing genuinely hostile; that is why it is a spec scenario rather than an implementation nicety.

### D3 — What excludes machine state is a permitted-field list, not a scrub

The bundle writer names the fields it copies. Anything not named is absent because it was never read. This is the project's standing rule that generated artifacts are tracked by explicit named lists rather than pattern matching, applied to serialization: a scrub pass is a denylist, and a denylist silently ships whatever a later field addition introduces.

On top of that, an assertion pass runs over the serialized bundle before it is written, and rejects any value that is an absolute path in **Windows drive-letter form, Windows network-share form, or POSIX form** — all three regardless of the exporting platform, because the bundle is read on the other one, and a POSIX-absolute value produced on Linux is exactly as wrong on Windows as the converse. Failure names the record and the field (plan §28.6: "context/bundle 拒绝不允许的绝对路径"). Import re-runs the same assertion: a bundle is untrusted input, and the producer may be an older or hand-edited version.

### D4 — The bundle record carries the canonical content, which the plan's sketch omits

Plan §23.2 sketches `records[]` as `{id, knowledgeKey, contentDigest, manifest}`. A digest cannot reconstruct a record: the canonical body lives in `SKILL.md`, and `LearnedSkillManifest` carries `description` but not `instructions`. So each record additionally carries its **canonical content**, and the recorded `contentDigest` is what validates it on arrival. This is an addition to an illustrative shape, not a change to any invariant — without it the bundle is not importable at all.

### D5 — Destinations: `--to` is the file, `--to-store` additionally places a copy

`--to <path>` is required, as the plan writes it, and is the bundle the user holds. `--to-store <store>` is additive: the same bundle is also placed into the Store's reserved transport location. Keeping `--to` always required means every export leaves the user an artifact independent of any Store, and it avoids inventing flag-arity rules the plan does not state.

`--to` **refuses to overwrite** an existing file — the user named that path, and replacing knowledge they may not have imported yet is not recoverable. The Store destination is derived and includes the bundle identity (§34 explicitly leaves the in-Store path to this change), so repeated exports never collide and never need an overwrite rule. Accumulated bundles in a Store are ordinary Git files the user prunes; that is a better failure than a silent replacement.

### D6 — Transport is not ownership, and the boundary is enforced on both sides

A Store carrying a file must not become the owner of what is in it. This is the subtle failure this change exists to prevent: project-scoped and Store-scoped knowledge have different owners in D2's model, and D1's evidence and approval rules exist precisely to gate the transition between them. If import inferred Store scope from the fact that a bundle sat in a Store, it would be a route around D1 that requires no evidence, no membership, and no approval.

So:

- **Export side** writes a *file* into the Store. The Store's catalog, project records, and metadata are untouched; nothing is staged, committed, or pushed; the files to commit are printed — the same rule D1 states for catalog mutations.
- **Import side** stores every record as the project's own, owned by the project's identity. No Store is recorded as a source. Evidence arrives as it was recorded and the receiving machine is not added as a further independent source, so an import cannot inflate the distinct-project count that a wider scope requires.
- An unreachable transport Store **fails** the placement rather than being read as empty (§33 decision 10).

Child A's round-4 rule applies to every assertion here: check what lands on disk, not what the message says.

### D7 — Machine preparation: declared only, separate, confirmed, and asymmetric on `--yes`

Per §23.3 the import is never automatic. It is offered only when the project's own configuration or a Store's record for the project names a bundle, it is a **separate** listed action, and it happens on confirmation.

Child E adjudicated what a blanket confirmation means: it confirms actions the user's own committed configuration already implies, and never expands scope to what only the remote side knows. Applied here, that yields an asymmetry identical in shape to E's project-first/Store-first split:

| Bundle named by | Under blanket confirmation |
|---|---|
| the project's own committed configuration | imported |
| a Store's record for the project only | listed, never imported without an explicit choice |

A Store's record is authored by other people and can change without the local user knowing; "I trust my own config" must not become "import whatever that Store now points at". A missing or unreadable declared bundle **degrades** with its repair rather than stopping preparation, matching E's three end states.

### D8 — Dependency seams

Children B, C, D1, D2 and E were proposed and not implemented when this was planned. Each dependency sits behind **one** seam that degrades to a report rather than failing:

| Needed | Seam falls back to |
|---|---|
| the project's canonical knowledge location (D2) | today's per-clone catalog location |
| a Store's transport root (A's resolver) | the existing registered-Store lookup |
| the declared-bundle step in preparation (E) | the step is simply not offered |

Implementation **re-verifies every dependency's final exported surface — names *and* signatures — before starting**, since all of them were still proposals. Store resolution uses `resolveStoreBinding` and its tri-state; a durable declaration is inspected with `hasStoreDeclaration(pointer)`, never `pointer.value`; anything durable this change writes goes through `writeDurablePointer`.

### D9 — Cross-platform

Every path is composed with `path.join()` / `path.resolve()`; tests build expected paths with `path.join()`, never a hardcoded separator. Store-root and destination comparison goes through `FileSystemUtils.canonicalizeExistingPath` with the established `path.resolve` fallback, so a drive-letter-case or separator difference never makes one destination look like two. Bundle content digests are computed over normalized bytes, so a checkout with different line endings does not make an identical record read as a conflict on the receiving machine — which under D2 would be a spurious block. The machine-path assertion covers all three absolute forms on every platform (D3). A Windows CI verification task covers the path-sensitive test files.

## Risks / Trade-offs

- **All-or-nothing import could feel obstructive.** → `--dry-run` reports every conflict at once, so it costs one preview rather than a series of surprises. The alternative — partial application — produces a state the user cannot name or repeat.
- **A bundle is untrusted input.** → Closed schema, full validation before any write, digest verification per record, the machine-path assertion re-run on import, and refusal by version for anything newer. Nothing partial is written on any failure path.
- **Transported bundles accumulate in a Store's Git history.** → Accepted: they are ordinary files the user can prune, and the alternative is overwriting a bundle someone else may not have imported.
- **Recording `baseProjectCommit` invites checkpoint expectations.** → It is reported, never enforced; the docs say plainly that it is provenance, and that resuming a run across machines is not in this release.
- **Every dependency was a proposal when this was planned.** → One seam each, each degrading to a report; the acceptance criteria do not change either way.
- **Exporting could be mistaken for backup.** → The docs state the three-way distinction explicitly, and the export output names what it did and did not include.

## Migration Plan

1. **Bundle shape and readers.** The versioned bundle schema, the permitted-field list, the machine-path assertion, and a reader that validates without writing. Nothing produces a bundle yet.
2. **Export.** Read the project's own catalog through the knowledge-location seam, build records, assert, write atomically via temp-then-rename, refuse an occupied destination.
3. **Store transport.** Resolve the Store through the tri-state resolver, place the file at the derived location, touch nothing the Store owns, print what to commit.
4. **Import planning.** Validate in full, compare against the local catalog, classify each record as new, identical, or conflicting, and produce a plan. `--dry-run` reports the plan.
5. **Import apply.** Write only when the plan has no conflict, atomically, adding only.
6. **Preparation integration.** The declared-bundle step behind the seam, with the confirmation asymmetry.
7. **Docs and locales**, including the release-note distinction between Store knowledge, machine-local project knowledge, and a portable bundle.

Rollback: reverting removes the commands and leaves any bundle files inert — nothing else on disk changed shape, because import only ever adds ordinary catalog records.

## Open Questions

- Whether `rasen doctor` should mention a declared bundle that has never been imported. It fits doctor's read-only remit, and preparation already reports it; left out to keep this change's surface small, and cheap to add later.
- Whether a future version should offer to reconcile a conflicting record interactively rather than only reporting it. Reporting only is assumed, for the same reason D2 assumed it for divergent catalogs: a merge interface for knowledge content is its own feature, and the honest report is the better first answer.
