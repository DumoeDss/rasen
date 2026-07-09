# Design: close-fusion-followups

## Context

Three small follow-ups to the fusion series. Two are polish (navigator one-liner, ship evidence token); one is a real behavior change (archive zero-requirement deletion) and is the focus of this design.

Current state of the archive/rebuild path, from `src/core/specs-apply.ts` and `src/core/archive.ts`:

- `buildUpdatedSpec(update, changeName)` reads the existing target spec, parses the change's delta (ADDED / MODIFIED / REMOVED / RENAMED), and applies them in order RENAMED → REMOVED → MODIFIED → ADDED onto a `nameToBlock` map. It knows `isNewSpec` (whether the target file existed). It returns `{ rebuilt, counts }`.
- After all operations, `nameToBlock` holds the surviving requirements. If a delta REMOVES every requirement of an existing spec, `nameToBlock.size === 0` and `!isNewSpec` — the rebuilt markdown has an empty Requirements section.
- The rebuilt content is then validated by `Validator.validateSpecContent` against `SpecSchema`, whose `requirements` field is `z.array(RequirementSchema).min(1, SPEC_NO_REQUIREMENTS)`. An empty requirements array fails validation.
- This validation runs at **two** call sites: `archive.ts` (the archive loop, before any writes) and `specs-apply.ts` (`applySpecs`, the standalone spec-sync path). Both abort on the failure, so there is no supported way to reduce a spec to zero through a change.

Current state of the ship evidence gate (`src/core/templates/workflows/ship.ts`, step 3d): it skips the test run when green evidence exists "with the code unchanged since — compare the recorded git state (HEAD + dirty status) against now", and separately asserts that "the commit in (b) moves HEAD but does not change code content, so it does not invalidate evidence". The review-cycle report and the auto adaptive-verify run-state record evidence as "HEAD + (dirty or clean)" / "HEAD + dirty status" for ship to consume.

## Goals / Non-Goals

**Goals:**
- Make "a change deletes a spec by REMOVING all its requirements" a supported, validated archive outcome (and the same for standalone spec-sync), with a clear log line and no abort.
- Keep the general rule that a spec must have ≥1 requirement intact for every other case (new specs, hand-edited files, structural validation).
- Sharpen the ship evidence gate's "code unchanged since" check to a content-addressed token, and align the three evidence-recording sites onto that one token.
- Keep the navigator's ship entry a one-liner.

**Non-Goals:**
- The 18-expert empty `description: '|'` block-scalar bug (excluded; a content decision, not a mechanical fix).
- Changing the SpecSchema `min(1)` rule globally.
- Adding a new CLI flag or delivery mode.
- Recomputing parity hashes for workflow templates (ship/review-cycle/auto are not in the golden master).

## Decisions

### Decision 1 (the real one): detect "emptied existing spec" inside `buildUpdatedSpec`; both callers delete the directory

**Choice.** Add the deletion signal to `buildUpdatedSpec`, not to the validator and not to one caller:

- `buildUpdatedSpec` already computes `nameToBlock` and already knows `isNewSpec`. After applying all operations, set `emptied = (!isNewSpec) && nameToBlock.size === 0` and return it alongside `{ rebuilt, counts }` (the `rebuilt` string is still produced for symmetry but is not written when `emptied` is true).
- Both callers handle the flag identically:
  - **Validation pass:** skip `validateSpecContent` for an `emptied` entry — there is no content to validate because the spec is going away, not staying empty.
  - **Write pass:** instead of `writeUpdatedSpec`, remove the target spec directory: `fs.rm(path.dirname(update.target), { recursive: true, force: true })`.
  - **Logging:** print one clear line naming the deleted capability, e.g. `Deleting spec '<capability>' — all requirements removed by this change.` (suppressed in JSON mode like the other prose).

**Why here, not elsewhere.**

- *Not the SpecSchema.* Relaxing `requirements.min(1)` would make an empty spec valid everywhere — including new specs and hand-edited files — which is wrong. The deletion is a specific archive/apply outcome ("this existing spec is fully superseded"), not a general relaxation of what a spec may contain.
- *Not one caller.* Both `archive.ts` and `applySpecs` run the same rebuild-then-validate-then-write shape. Putting the detection in the single rebuild function and the handling in each caller's existing loop keeps the two paths symmetric — `openspec archive` and `openspec apply` delete on the same condition, so they cannot drift.
- *Not a pre-scan.* The rebuild already does the authoritative merge; re-deriving "would this be empty?" in a separate pre-pass would duplicate the RENAMED→REMOVED→MODIFIED→ADDED logic and could disagree with the real merge.

**Safety boundary.** `emptied` requires `!isNewSpec`, so it fires only for a spec that existed and was read. A new spec that ends empty (e.g. a change whose only operations are REMOVEDs against a not-yet-existing spec, which are warned and ignored, leaving the skeleton) still hits `min(1)` and fails — correct, because creating an empty spec is never intended. The deletion removes the capability directory (`openspec/specs/<capability>/`), which is the unit a spec lives in; the change's own delta file still moves to archive normally, so the deletion is auditable.

### Decision 2: F2 tree fingerprint as the canonical code-state token

**Choice.** Replace "HEAD + dirty status" with the content-tree hash `git rev-parse HEAD^{tree}` as the code-state token everywhere ship's evidence gate is involved:

- **Evidence recording:** when a green test run is recorded for ship's gate, record `git rev-parse HEAD^{tree}` at the time of the green run. Three sites: ship log, `review-cycle-report.md` (final clean round + each Tier C gate-run), and auto adaptive-verify run-state.
- **Evidence gate (ship 3d):** skip the test run when the recorded tree fingerprint equals the current `git rev-parse HEAD^{tree}`. The two other run-conditions are unchanged: (a) the base merge introduced new commits, and (c) the user explicitly asks. Because merging new content changes the tree hash, condition (a) still triggers a run when it should.
- **Ship log:** add a `Tree:` field carrying the fingerprint, alongside the existing `Commit:` field.

**Why the tree hash over HEAD + dirty.** The tree hash is content-addressed: it changes if and only if the tracked tree content changes, regardless of where HEAD points. This is exactly the principle the gate already appeals to ("a commit that moves HEAD but changes no content does not invalidate evidence") — the tree hash makes the comparison key match the principle, instead of using HEAD (a commit identity) plus a dirty/clean boolean (a proxy that collapses many distinct dirty states into one). Recording one token at all three sites means ship consumes any of them uniformly, with no HEAD↔tree translation.

**Alignment with the existing check.** The gate already had a "code unchanged since" comparison and a stated principle; F2 only sharpens the comparison key. The base-merge override (3d.1) is preserved and still fires correctly because new merged content changes the tree hash.

**Scope of code edits for horizontal consistency:** `ship.ts` (gate comparison + ship log field), `review-cycle.ts` (report line), `auto.ts` (run-state line). The `opsx-auto-command` spec needs no delta — its evidence scenario says only "the git code state it ran against" (generic), which the tree fingerprint satisfies without contradiction. The `review-cycle-workflow` spec DOES pin "HEAD, working-tree dirty or clean", so it gets a delta to say tree fingerprint instead.

### Decision 3: navigator one-liner, not the contract

The navigator's `/opsx:ship` entry becomes one line naming pr / push / local and evidence-gated testing (e.g. "ship it — resolve the delivery mode (pr / push / local), test only when evidence demands it, deliver"). It does NOT inline resolution precedence, the merge step, or the ship-log fields — those stay in `opsx-ship-command`. This matches the navigator's stated style ("each entry says when to reach for it") and the existing spec scenario that requires the entry to remain a one-liner.

## Risks / Trade-offs

- **[A deleted spec directory is gone, not empty]** → Mitigation: the deletion fires only under the narrow `!isNewSpec && nameToBlock.size === 0` condition, the requirement removals are explicit in the change delta, and the change (with its delta) is archived, so the deletion is fully auditable from history. The log line names the capability. This is strictly better than the current `--no-validate` + manual `rm`, which leaves the same audit gap plus an unvalidated archive.
- **[Deleting a capability dir removes any non-`spec.md` files in it]** → Mitigation: capability directories conventionally hold only `spec.md`; a spec dir IS the capability unit. If a project kept sidecar files in a spec dir, they would be removed with the spec — acceptable, since "this spec no longer exists" means the capability is gone. Documented in the spec scenario.
- **[Tree fingerprint recorded at green-run time can drift from the moment ship reads it]** → Mitigation: the fingerprint is taken at the green run (review/verify/auto) and again at ship; a mismatch means "run", which is the safe direction. The base-merge and user-request overrides still force a run independently, so a stale fingerprint cannot cause a skipped run when content actually changed.
- **[Two navigator parity hashes must both be recomputed]** → Mitigation: tasks.md calls out both `getNavigatorSkillTemplate` (function hash) and `openspec-navigator` (content hash) explicitly; missing one fails the parity test loudly. Confirmed ship/review-cycle/auto are not in either map, so no spurious recompute.
- **[Windows `fs.rm` on a directory another process holds open]** → Mitigation: `force: true` and `recursive: true` mirror the existing `moveDirectory` fallback discipline; the archive flow already handles EPERM-class Windows errors for moves. If `rm` fails it surfaces as a normal archive error (no partial write, because the change dir is moved only after spec updates succeed).
