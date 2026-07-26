## Context

Source commit `48142395` (PR #66, effective scoped materialization) was reviewed and merged onto a stacked branch. Re-verified against current `HEAD`: it is **not** an ancestor, and `5fa32300` (#65) is its ancestor — so the sibling `store-scoped-learned-knowledge` change lands first and this one consumes its catalog.

#66's algorithm is correct and is preserved verbatim in intent. Three layers underneath it must be replaced:

| The source assumes | This release provides |
|---|---|
| a Store is identified by its display name | a permanent identity, the name demoted to a renameable alias (child A) |
| membership is inferred from whichever pointer is nearby | the Store's own per-project membership record (child B) |
| the current directory is the project | the session's recorded execution checkout (child C) |
| project knowledge lives under the clone you are standing in | one canonical knowledge home per project identity (§11.7, landing here) |

That last row is Phase F part 1, and it lands **here** rather than in child F because multi-checkout correctness is a precondition for this change, not a follow-on: without it, two clones of one project produce two catalogs and the resolution below silently answers differently depending on where the command ran.

Two facts about the tree shape this change:

- `freezeKnowledgeContext` in `src/core/learned-skills/context.ts` records `{planningRoot, owner}` as `{type,id}` pairs with no checkout binding — the conflation this change has to undo.
- **`rasen/specs/` contains no learned-knowledge capability.** `learned-skills` and `learned-skill-knowledge-context` are declared only inside unarchived change directories whose code has shipped — archive debt the LEAD deliberately sequenced for later. So there is nothing to write a `MODIFIED` block against, and `learned-skill-knowledge-context` must stay untouched because that debt still claims it.

This is the second half of the split the LEAD took after Phase D was assessed as roughly twice child A. The seam is drawn by the source commits; no acceptance criterion moved.

## Goals / Non-Goals

**Goals:**

- Preserve #66's resolution algorithm and test intent exactly.
- Split the three roots §15.6 separates: canonical owner root, applicability evaluation root, materialization target.
- One canonical knowledge home per project identity, with a conflict-safe migration off per-clone catalogs.
- Ledger v2 and resolution digest v2, each detected, previewable, and blocking rather than guessing.
- An unreachable Store never reads as an empty one.

**Non-Goals:**

- The Store catalog, publication evidence, and approval — the sibling change.
- Bootstrap (child E) and cross-machine knowledge bundles (child F part 2).
- Issue / Execution Plan / checkpoint.
- Re-litigating #66's decisions. This change adapts its plumbing.

## Decisions

### D1 — Spec surface: two NEW capabilities, zero MODIFIED blocks

`learned-skill-effective-materialization` was declared by the retired `store-aware-learned-skills-materialization` directory and is now unclaimed. `project-knowledge-home` is new and unclaimed. Zero `MODIFIED` is forced — there is nothing in `rasen/specs/` to modify — and it makes this change **order-independent** with respect to whatever archive debt is paid down later.

Deliberately untouched: `learned-skill-knowledge-context` (still claimed by #62's unarchived directory) and `cli-init` / `cli-update` (contested by several active changes). When the resolved set is materialized is stated inside `learned-skill-effective-materialization` as behavior; wiring it into init and update is an implementation task, not a further claim on a contested capability.

### D2 — The resolution algorithm, preserved exactly

```
applicability filtering
        ↓
project record exists → project wins
        ↓
otherwise resolve every eligible Store record
        ↓
records exactly equivalent → one winner, recording ALL contributing Store identities
records differ            → conflict
        ↓
no Store winner → global fallback
```

Eligibility is `storeMemberships` ∪ locally-registered Stores whose record includes this `projectId` (child B's provider) — **not** the primary planning pointer.

Explicitly forbidden, each a spec scenario rather than a note because each is a plausible shortcut: first Store by registry order; planning-Store priority; alphabetical display-name order; judging sameness from the knowledge key alone; and treating an unavailable Store as an empty directory.

**Equivalence** requires all five of: identifier, knowledge key, byte-identical canonical content, content digest, and both being valid managed records. Four of five is a conflict.

**Conflict** collects every participant and is order-independent. With a project winner it is latent — recorded, not fatal. Without one it blocks the whole learned reconciliation, writes no partial files and no partial ledger, and never blocks ordinary workflow generation.

**Unavailable relevant Store** — relevant means declared in `storeMemberships`, or a source in the previous ledger, or a frozen planning/membership fact, or the current pointer, or locally reverse-discovered. Never read as empty; cleanup and replacement of what it previously provided are deferred; an unrelated higher-precedence project winner may still safely override; the state is reported as degraded with a repair.

### D3 — Three roots, kept apart

```
canonicalOwnerRoot     ~/.rasen/project-knowledge/<projectId>   — where the project's knowledge lives
evaluationRoot         the session's recorded execution checkout — where applicability is decided
materializationTarget  a tool's project-local skill home in that checkout — where files are written
```

The source conflates all three into "the current project directory". Separating them is what lets two clones share a catalog while still deciding applicability and generating files in the checkout actually being worked on. The evaluation root comes from child C's runtime context, with the current directory as the fallback following **child C's stated precedence** — not a second precedence invented here.

### D4 — The knowledge home migration blocks rather than guesses

New `src/core/project-knowledge-home.ts` owns `~/.rasen/project-knowledge/<projectId>/learned-skills/<id>`, separate from the clone-specific work directory, clone-specific archive and work ephemera, and the in-checkout materialization target.

Migration per §11.7:

1. scan the machine homes of every clone carrying this `projectId`;
2. exactly one catalog → move it;
3. several byte-identical → deduplicate and move one;
4. several differing for the same identifier → **report a conflict, pick no winner, delete nothing**;
5. never delete an old catalog until the new home is written **and** verified by re-reading it;
6. repeatable, dry-runnable, and resumable after an interruption without duplicating what already moved.

Rule 4 is the one that matters. Choosing between two divergent catalogs would silently discard a project's knowledge, and no available signal could justify the choice. Partial divergence is handled honestly: agreeing knowledge migrates, the conflicting identifier is reported and left alone.

### D5 — Ledger v2 and resolution digest v2

**Ledger v2** carries a permanent-identity-keyed `stores` map (`lastMembership`, `relevant`, display name as a convenience field only), durable `sources[].owner`, `canonicalContentDigest`, and `resolutionDigest`.

v1 alias-keyed ledgers exist on development and dogfood machines even though never released, so the migration must detect them, dry-run, upgrade when the name→identity mapping is unique, and **block when a name is ambiguous**, never silently dropping source provenance. Blocking is correct: an ambiguous mapping means the ledger cannot say which Store owns a generated file, and guessing would attach ownership of a real file to the wrong Store.

**Resolution digest v2** takes schema version, identifier, knowledge key, effective scope, sorted durable source identities, canonical content digests, and the rendered managed body. **No display name enters the identity portion**, so a rename cannot surface as a content change — which is exactly what the sibling change's rename-changes-nothing guarantee makes possible. The v1→v2 change is recorded as a migration and never presented as edited content; otherwise every user's first post-upgrade run reports their whole catalog as modified.

Child A's round-4 rule applies to every write path here: after resolving, display and record use the resolved name, re-resolution uses `uid ?? id`. What lands on disk is what gets reviewed, not what the log line says.

### D6 — Exact ownership over generated files

A generated file is modified or removed only when the record claims that exact path, the file on disk is still an ordinary file, its content still matches what was recorded, and the source is still verifiable. Anything failing a check is left alone and reported. A file the user authored at a generated path is never taken over. A tool whose knowledge home is machine-wide receives only machine-wide knowledge — never a project's or a Store's.

### D7 — Dependency seams so this is not blocked

Children B and C were proposed, not implemented, when this was planned, and the sibling Store-catalog change is in flight. Membership lookup and evaluation-root lookup each sit behind **one** seam, falling back to today's behavior when a dependency has not landed. The algorithm does not change either way. Implementation re-verifies every dependency's final surface — names *and* signatures — before starting.

### D8 — Cross-platform

Every path uses `path.join()`; the knowledge home resolves under the existing machine data directory helper. Path comparison goes through `FileSystemUtils.canonicalizeExistingPath` with the established `path.resolve` fallback, so a drive-letter or separator difference never makes two clones look like different projects — which here would produce a spurious catalog conflict. Content digests are computed over normalized bytes so a checkout with different line endings does not read as divergent content between two Stores. Tests build expected paths with `path.join()`.

## Risks / Trade-offs

- **The migrations are where a user's knowledge could be lost.** → Every step is detect → dry-run → verify → only then remove, and every ambiguous case blocks. Divergent catalogs and ambiguous name→identity mappings are reported, never resolved.
- **The v1→v2 digest change touches every record at once.** → Recorded as a migration, so the first post-upgrade run reports a migration rather than claiming the whole catalog was edited.
- **A conflict blocking learned reconciliation could look like a broken tool.** → Scoped: ordinary workflow generation is unaffected, nothing partial is written, and the diagnostic names every participant and the command that resolves it.
- **Dependencies may not have landed.** → One seam each for membership and evaluation root, with today's behavior behind them.
- **Deferring cleanup for an unavailable Store leaves stale generated files in place.** → Correct trade: a stale file is recoverable, a deleted one the user was relying on is not. The degraded state is reported with the repair, so it does not go unnoticed.
- **This change depends on its sibling and cannot ship alone.** → Accepted and stated; the split's whole basis is that the sibling is independently shippable and this half is not.

## Migration Plan

1. **Shapes and readers.** v2 ledger, v2 digest, and the knowledge-home resolver land as readers alongside the v1 paths. Behavior unchanged.
2. **Three-root split.** Canonical owner root, evaluation root, and materialization target separated; the evaluation root taken from child C's context.
3. **Effective resolution.** Applicability, precedence, equivalence, conflict, unavailable handling — membership from child B's provider.
4. **Knowledge home + migrations.** The logical home, the catalog migration, ledger v1→v2, digest v1→v2 — each dry-runnable, each blocking on ambiguity.
5. **Materialization wiring.** Init and update materialize the resolved set with exact-ownership reconciliation.
6. **Docs and locales**, including `docs/retention-and-learned-skills.md` and the migration guide.

Rollback: reverting leaves v2 records an older reader does not understand. Bounded by every v2 write being reachable only through an explicit migration the user ran, which reports what it is about to do first.

## Open Questions

- Whether the catalog migration should offer to merge two divergent catalogs interactively rather than only reporting the conflict. Reporting only is assumed — a merge interface for knowledge content is its own feature, and the honest report is the better first answer.
- Whether `rasen doctor` should report a pending ledger or catalog migration. It fits doctor's read-only remit and the diagnostic vocabulary already reserves a code for catalog conflicts; left out only to keep this change's surface from growing, and cheap to add later.
