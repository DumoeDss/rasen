## Context

Source commit `5fa32300` (PR #65, Store-scoped knowledge) was reviewed and merged onto a stacked branch. Re-verified against current `HEAD`: it is **not** an ancestor. It is an ancestor of `48142395` (#66), which the sibling change adapts — so this change lands first and #66's work consumes its catalog.

Its algorithm is correct and is preserved in intent. What must be replaced is what it stands on:

| The source assumes | This release provides |
|---|---|
| a Store is identified by its display name | a permanent identity, with the name demoted to a renameable alias (child A) |
| membership is inferred from whichever pointer is nearby | the Store's own per-project membership record (child B) |

Landing it unchanged would publish ownership records and content identity keyed on the field the release makes explicitly renameable, then require migrating every one of them — which §6.7 rules out by name.

Two facts about the tree shape this change:

- `src/core/learned-skills/` exists with the `rasen knowledge` command surface, but has no Store scope: the source commit is where that came from.
- **`rasen/specs/` contains no learned-knowledge capability at all.** `learned-skills` and `learned-skill-knowledge-context` are declared only inside unarchived change directories whose code has shipped — outstanding archive debt the LEAD has deliberately sequenced for later. Consequence for this change: there is nothing to write a `MODIFIED` block against, and it must not touch `learned-skill-knowledge-context`, which that debt still claims.

This change is the first half of the split the LEAD took after Phase D was assessed as roughly twice child A. The seam is drawn by the source commits themselves; no acceptance criterion moved.

## Goals / Non-Goals

**Goals:**

- A Store owns a versioned knowledge catalog, identified permanently.
- Publication and promotion gated on independent evidence, with membership taken from the Store's records.
- Approval explicit and scope-bound, never inferred.
- Mutations exact, atomic, and never touching user-authored files or the git index.
- Independently shippable: a Store can hold and publish knowledge before anything consumes it.

**Non-Goals:**

- What a project receives, applicability, precedence, equivalence, conflict, unavailable Stores, generated-file ownership, content identity, the three-root split, the project knowledge home, or the init/update wiring. All of that is the sibling change.
- Bootstrap, knowledge bundles, Issue / Execution Plan / checkpoint.
- Paying down the learned-knowledge archive debt.

## Decisions

### D1 — Spec surface: one NEW capability, zero MODIFIED blocks

`store-scoped-learned-skills` was declared by the retired `store-aware-learned-skills-scope` directory and is now unclaimed. This change defines it.

Zero `MODIFIED` is forced rather than chosen: `rasen/specs/` holds no learned-knowledge capability to modify. The useful consequence is that this change is **order-independent** with respect to whatever archive debt is paid down later. `learned-skill-knowledge-context` is deliberately untouched — still claimed by the unarchived `store-aware-learned-skills-context` (#62) directory.

`cli-init` and `cli-update` are likewise untouched: they are contested by several active changes, and nothing in this change needs them — materialization belongs to the sibling.

### D2 — Permanent identity is what gets written; the display name is only displayed

Every durable record — the catalog record, its ownership, anything naming a source — keys on the Store's permanent identity. The display name may appear alongside as a convenience field and nowhere else. Sorting uses the permanent identity or a stable canonical serialization, never the display name: an alphabetical tie-break on a renameable field is a winner chosen by accident.

Child A's round-4 rule applies directly and is the reason to inspect what reaches disk rather than what the message says: **after resolving, display and record use the resolved name; re-resolution uses `uid ?? id`.** A's most expensive defect was a raw selector echoed into a Git-tracked write. Every write path here is reviewed for which identity form lands in the file.

The testable consequence: **renaming a Store changes no record.** Asserted directly, and it is what the sibling's content-identity work then depends on.

**Known-open — one durable record still keys on the display name: the frozen knowledge context.** `KnowledgeOwnerRef` (`learned-skills/types.ts`) carries `{ type: 'store'; id }` with no `uid`, and `freezeKnowledgeContext` writes exactly that into the run-state file, which is Git-tracked for a repo-local change. It is the single place this decision's own rule is not yet true. Two things bound it, both verified: it **fails closed** — after a rename a resume raises `knowledge_owner_stale`, and with two namesakes `resolveStoreBinding` returns `unavailable` naming both, so nothing ever resolves to the wrong Store — and it has **no production writer** today; only the reader is wired up. This change is nonetheless what makes store owners reachable at all, so the seam moves from impossible to dormant here. **Not closed in this change deliberately:** the frozen-context shape belongs to the `learned-skill-knowledge-context` capability, which #62's unarchived change directory still claims, and writing a second delta against it is what `planning-context.md` forbids. **Owner: whoever archives or supersedes #62's `learned-skill-knowledge-context` work** — adding `uid` to the frozen owner is additive and small, and must land before anything starts calling `freezeKnowledgeContext` in production. Recorded with an owner because "deferred" and "forgotten" are indistinguishable six weeks later.

### D3 — Evidence is counted per project, and membership decides who counts

Publication into a Store requires evidence from its member projects, counted per distinct project — the same project contributing repeatedly counts once. Promotion beyond the Store requires more than one distinct project and homogeneous sources: evidence for the same knowledge, not merely knowledge sharing an identifier.

Membership comes from child B's provider, which reads the Store's own per-project records. It is explicitly **not** the project's planning pointer — that answers "where does this project plan", a different question, and using it would let a project that merely plans in a Store vote on what the Store publishes.

A refusal writes nothing at all: no record, no file, no ownership entry. Reporting what evidence exists and what is missing is the whole output.

### D4 — Approval cannot be inherited, inferred, or widened

Approval names the scope it applies to. A Store-scoped approval never satisfies a machine-wide promotion; an existing narrower record is not evidence of approval for a wider scope; and the absence of an objection is not approval. Each of those three is a spec scenario rather than a note, because each is a plausible implementation shortcut that would quietly widen what a Store can publish.

### D5 — Mutations are exact, atomic, and never touch the index

A catalog mutation modifies only records the catalog declares it owns; a file the user authored at a catalog path is left alone. Writes are temp-then-rename so an interruption leaves no partial record. Nothing is staged, committed, or pushed — the command prints the files the user needs to commit, matching how every other Store-repository write in this release behaves.

**Refined during implementation: "reads exactly as it did before" is what a FAILED mutation delivers, not a KILLED one.** A rewrite is two renames — record aside, replacement in — and the restore path covers a thrown error, not process death. A SIGKILL between them leaves the record absent with its previous copy under a `.rasen-learned-skill-backup-*` name, and because a catalog lives inside the Store's Git repository that debris also lands in the user's `git status`. Rather than weaken the promise to match, the next mutation now recovers: under the lock, before anything reads the catalog, staging debris is removed and a backup whose record directory is absent is **restored** rather than deleted. Deleting backups blindly would have been the obvious sweep and is the one thing that must not happen — in exactly the window that produces the debris, the backup is the only surviving copy. A backup whose own manifest cannot be read is left strictly alone; nothing may delete a directory it cannot identify.

**Reading verifies, and what verification rejects is reported.** Every read re-checks a record against its manifest — body digest, id, scope, owner, and a version able to hold that owner. A check that removes a record without saying so is indistinguishable from a deletion: a user who hand-edits `SKILL.md` would watch the skill disappear from `knowledge list` with no diagnostic anywhere. So the reader returns the rejections alongside the records, and `knowledge list` / `knowledge show` name the record, the failed check, and the way back. The line between reported and silent is `generatedBy`: a record Rasen wrote that no longer verifies is reported, while an occupant the catalog never claimed — a hand-written skill, another tool's marker — stays silent, because a warning per user file would bury the one that matters.

The marker is read **as early as it becomes readable**, which is the schema-failure branch, not after it: the YAML has already parsed there, so ownership is known. Drawing the line one check later would silently drop three states carrying an intact marker — an added key (every schema here is `.strict()`), a retyped field, and a record written by a **newer release** read back on this one. The last needs no user error at all, and cross-version, cross-machine Store sharing is what this catalog exists for, so it is the state that most needed to be visible.

Two boundaries around that line are load-bearing and easy to break by accident:

- **Mutation debris stays silent only because of a leading dot.** A `.rasen-learned-skill-backup-*` directory holds a genuine Rasen manifest whose id no longer matches its directory — a reported refusal by every rule above. It is skipped because `isOsJunkEntryName` skips dot-prefixed entries. Renaming either debris prefix to a non-dot name would make every killed mutation report its own backup as a corrupt record.
- **Known-open, deliberately not closed: between a kill and the next mutation, the record still reads as a plain disappearance.** The backup holds it, but the reader is dot-skipping that backup and the recovery only runs inside a mutation. The obvious fix is forbidden — sweeping or restoring on read is a WRITE, and this capability requires verification to write nothing. The correct close is to *report* a recoverable backup as a finding (read-only, naming the record and the mutation that restores it), not to restore during a read. Owner: whoever next revisits catalog recovery; it is additive and needs no schema change.

### D6 — Dependency seams so this is not blocked

Children B and C were proposed, not implemented, when this was planned. Membership lookup sits behind **one** seam: child B's `resolveProjectMembership` when it exists, today's behavior when it does not. The evidence and approval rules do not change either way. Implementation re-verifies both dependencies' final surfaces — names *and* signatures — before starting.

### D7 — Cross-platform

Catalog paths are composed with `path.join()` under the Store's metadata directory. Content comparison is byte-exact over normalized bytes, so a checkout with different line endings does not read as different content. Tests build expected paths with `path.join()`, and a Windows scenario covers catalog write-and-read-back under a Windows Store root.

## Risks / Trade-offs

- **A rename must not disturb anything already recorded.** → Nothing durable keys on the display name, ordering never depends on it, and a rename-changes-nothing test asserts it directly. This is also a Gate 4 acceptance item the sibling change relies on.
- **Membership as the gate means a Store with no membership records can publish nothing.** → Correct and intended: publication requires member evidence, and a Store with no members has none. The refusal names the missing membership and the command that adds it, rather than failing opaquely.
- **Child B may not have landed when implementation starts.** → One seam, one call site, today's behavior behind it. Nothing about the evidence model changes.
- **The retired source proposal is gone from the working tree.** → Its content is not lost: the algorithm comes from `5fa32300`, which stays in git history, and its test intent is carried in this change's task list. What was discarded is the old-model plumbing the plan forbids landing.
- **This change ships a scope nothing yet consumes.** → Deliberate, and the reason the split is safe: a Store holding and publishing knowledge is independently testable, and every test in the sibling needs this catalog to exist first.

## Migration Plan

1. **Shapes and readers.** Durable source refs on permanent identity, the versioned record schema and its serializer, and the reader for earlier records. Behavior unchanged.
2. **Catalog.** The Store canonical catalog, reached only through the single Store resolver.
3. **Evidence and approval.** Publication and promotion gates, membership behind its seam, explicit scope-bound approval.
4. **Mutation.** Exact-ownership, atomic writes, no git index.
5. **Docs and locales**, including `docs/retention-and-learned-skills.md`.

Rollback: reverting leaves catalog records an older reader does not recognize. Bounded by every record being written only through a mutation the user performed, which reports what it is about to write first.

## Open Questions

- Whether a Store should be able to declare its own evidence threshold rather than using the built-in one. Deferred — a configurable gate on what may be published is a policy surface of its own, and the fixed rule is the right first answer.
