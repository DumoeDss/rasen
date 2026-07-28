## Context

This is slice 1 of 2 of Phase E. The whole of Phase E was designed up front and still sits, unstarted, in `rasen/changes/store-bootstrap-and-hydration/` — a complete proposal, design, delta spec, and 81-task list. This change **carves the read-only half out of that design rather than re-deriving it**: where a requirement, a decision, or a task belongs to the diagnose half, its wording is preserved.

The split point is E's own. E's task 4.3 already says the two safe modes must not be collapsed into one flag "because they are different promises". This change takes that further and makes *reporting* and *acting* the seam between two changes, not just two flags.

### Dependency re-verification against landed code

E's group 1 asked for this, and every A–D2 child that ran it found drift. Run against `HEAD=968482cf`:

| Surface | State | Drift that matters |
|---|---|---|
| `resolveStoreBinding` (`src/core/store/identity.ts:520`) | landed | Takes `ResolveStoreBindingInput { declaration, projectRoot?, ...StorePathOptions }`, not a pointer. Returns `StoreBindingResolution = { kind: 'absent' } \| ResolvedStoreBinding \| UnavailableStoreBinding`. Performs no writes on any path — so it is usable unchanged inside check mode. |
| `StoreUnavailableReason` (`identity.ts:52`) | landed | **`'not-registered' \| 'metadata-missing' \| 'uid-mismatch' \| 'root-unhealthy' \| 'alias-ambiguous' \| 'pointer-malformed'`.** This is a *different taxonomy* from E's four-class table (see D5). |
| `UnavailableStoreBinding.repair: string[]` | landed | Already "ordered, copy-pasteable commands". E1 consumes these rather than inventing a second repair vocabulary. |
| `requireConfigStoreLayer` / `resolveConfigStoreLayer` (`src/core/effective-config.ts:214` / `:168`) | landed, both present | Bootstrap uses neither — it needs the declaration, not the resolved config layer. |
| `hasStoreDeclaration` (`src/core/project-config.ts:1501`) | landed | Takes a `StorePointerRead`. Still the only legal presence test; never `pointer.value`. |
| `inspectRegisteredStore` (`src/core/store/inspection.ts:35`) | landed | Returns a discriminated result with `kind`, `canonicalRoot`, `uid`. |
| `resolveProjectMembership` (`src/core/store/membership.ts:363`) | **landed** | Signature is `(store: ResolvedStoreRef, projectId: string, options)` → `StoreMembershipRecord \| null`. E planned for this being *absent*; it is not (see D6). |
| `listProjectStoreCandidates` (`src/core/store/membership.ts:425`) | **landed, not in E's plan at all** | Already unions membership hints with locally-recorded members, resolves each hint through `resolveStoreBinding`, attaches `unavailable: { reason, repair }` **without filtering the Store out**, and emits `projectMembershipUnverified` diagnostics. This is a large part of E's group 2 already built (see D5). |
| `listStoreMembers` (`src/core/store/membership.ts:254`) | landed | The Store-first listing reads through this, not a second implementation. |
| `writeDurablePointer` (`src/core/store/upgrade-identity.ts:195`) | landed | **E1 does not call it.** It writes nothing. Named here only so the constraint is not lost for E2. |
| `resolveProjectKnowledgeHome` (`src/core/project-knowledge-home.ts:96`) | landed, synchronous | E1 does not call it; knowledge-location preparation is E2. |
| `src/commands/bootstrap.ts`, `src/core/store/bootstrap.ts` | **absent** | Both are new in this change. |
| `src/commands/doctor.ts` (522 lines), `src/core/relationship-health.ts` (452 lines) | landed | `inspectRelationships` is already a read-only aggregator. E1 deliberately does not touch either (see D8). |

Net: **every dependency E hedged against has landed.** The two seams E designed as fallbacks for unlanded children are not needed for that reason — but one of them is still needed for a different reason (D6).

## Goals / Non-Goals

**Goals:**

- One command that computes and reports the complete set of what a machine is missing for a project, and writes nothing doing it.
- Check mode and preview mode as two *separately specified* guarantees, requested separately.
- A report shape — three end states, per-Store classification, per-item repair — that the acting half can consume unchanged.
- A command surface that E2 extends without redefining anything E1 shipped.
- Every printed command resolves unambiguously on the machine it was printed on.

**Non-Goals:**

- Anything that writes. No registration, no clone, no minted identity, no declaration, no directory — on any path, in any mode.
- Project-first apply, Store-first obtain, clone target *creation*, failed-retrieval cleanup, idempotence of repeated applies, durable declaration writing. All E2.
- Rewriting the failure text of ordinary commands, and the doctor readiness integration. Both E2 (D8).
- Cross-machine knowledge bundles and run checkpoints. Not this release.

## Decisions

### D1 — The dual-claim question: what actually breaks, and when

**Finding, established by reading the code and running the tool, not by inference.**

`store-bootstrap` is absent from `rasen/specs/` and is claimed by exactly two active change directories: this one and `store-bootstrap-and-hydration/`.

**`validate` does not care, and cannot.** `node bin/rasen.js validate --changes --json` validates each change directory in isolation; there is no cross-change collision check anywhere in the validator. Proof: with both directories present and both carrying an `ADDED` delta for `store-bootstrap` with three *identical requirement titles*, `store-bootstrap-and-hydration` reports `"valid": true`. E's task 1.4 ("confirm the capability is still unclaimed") is therefore a **convention enforced by nothing** — it will never fail a gate, which is exactly why it is easy to violate.

**`archive` is where it bites, and only on overlapping requirement titles.** `src/core/specs-apply.ts:315-321`:

```js
for (const add of plan.added) {
  const key = normalizeRequirementName(add.name);
  if (nameToBlock.has(key)) {
    throw new Error(`${specName} ADDED failed for header "### Requirement: ${add.name}" - already exists`);
  }
```

So the sequence is: this change archives first and creates `rasen/specs/store-bootstrap/spec.md` holding its seven requirements. If `store-bootstrap-and-hydration/` were then archived **as it stands today**, its `ADDED` block would throw on the first requirement title this change already landed. The throw happens during the spec merge, *before* the change directory is moved, so the archive aborts cleanly and nothing is corrupted — but it does abort.

Concretely, two titles are shared verbatim between the two directories today:

- `One command reports everything a machine still needs for a project`
- `Every hint bootstrap prints can be pasted and will work`

E's `Checking and acting are separate promises` is **not** a collision, because this change renamed it to `Checking and previewing are separate promises` (D3). The four requirements this change split all carry new titles for the same reason.

**Consequence, and the deliberate non-action.** This is not a problem to solve here: the LEAD's stated next step is to re-derive E's remainder into E2 *after* this change lands, at which point E2 writes `MODIFIED` blocks against a spec that exists rather than `ADDED` blocks that collide. `store-bootstrap-and-hydration/` is left untouched by this change — not moved, not edited, not deleted. What must not happen is someone archiving that directory unchanged after this one; it will fail, loudly and safely, at the merge.

**Durable rule this yields:** two active changes may safely claim one NEW capability as long as their requirement *titles* are disjoint and only one of them archives before the other is re-derived. Title disjointness is the real constraint, not capability disjointness — and nothing in the toolchain checks either.

### D2 — Which of E's ten requirements this change takes, splits, and defers

The governing rule: **split a requirement rather than ADD one this change only half-satisfies.** A requirement whose text promises acting must not land unmet. The change immediately before this one (`stabilize-store-context-foundation`) existed to clean up gates and specs asserting things that were not true; reintroducing that on day one of Phase E would be the worst possible calibration result.

| E's requirement | Disposition | Why |
|---|---|---|
| One command reports everything a machine still needs for a project | **Taken**, one clause adjusted | E's text ends "…and the command that obtains it". No such command exists here. Adjusted to "a repair that works on this machine today" — `rasen store register <path>` and `rasen store doctor` are real and pasteable now. |
| Checking and acting are separate promises | **Taken, renamed** to *Checking and previewing are separate promises* | The body only ever constrained the two read-only modes, so it is fully satisfiable. The title said "acting", which is not delivered. Renaming keeps the requirement honest and frees the original title for E2. |
| Starting from a project clone resolves every declared Store and reports each one's state | **Split** | Its resolve-and-classify half is this change. Its "SHALL register the current checkout", "prepare the project's local knowledge location", and blanket-confirmation clauses are acting → E2. |
| — the membership scenario inside it | **Split out into its own requirement** | The seam has a promise of its own ("cannot verify here"), which E buried as one scenario. See D6. |
| Starting from a Store lists its projects and obtains none without being asked | **Split** | The listing half is this change. Everything about obtaining, explicit selection, and blanket confirmation is E2. Note this crosses E's task-group line — group 7 was nominally E2 — because the listing is pure read-and-report and belongs with the rest of the reporting. |
| A clone target is chosen by stated priority and never overwrites anything | **Split** | Preview mode cannot name "the exact path the Store would be placed at" without the priority rules and the safe-name derivation, so the *choosing* is this change. The *not overwriting* — passing the remote as an argument, refusing at clone time, cleanup — is E2. This change reports a refused location; it does not enforce a refusal, because it never clones. |
| A failed retrieval is cleaned up only when provably safe | **Deferred whole** | Nothing is retrieved here. |
| Running bootstrap again changes nothing that is already correct | **Deferred whole** | Vacuously true when nothing is written. Adding it would be an assertion with no content. |
| A declaration bootstrap writes is durable and usable | **Deferred whole** | Nothing is written here. |
| Every hint bootstrap prints can be pasted and will work | **Taken verbatim** | This change prints repair commands, so the rule binds now. |
| Commands that cannot resolve a Store name bootstrap as the repair | **Deferred whole** | Three of its four scenarios are about other commands' failure text naming bootstrap as *the repair* — which would be a hint that does not repair anything until E2 lands, in direct conflict with the requirement above. Its fourth scenario (read-only diagnosis) is separable but goes with the doctor work; see D8. |

Result: seven requirements, all satisfiable by a change that writes nothing.

### D3 — Check and preview stay two promises, and are requested separately

| | reads local declarations | resolves remotes and target paths | creates directories | runs git | writes registry / pointer |
|---|---|---|---|---|---|
| check | yes | **no** | no | no | no |
| preview | yes | **yes** | no | no | no |

Unchanged from E's D2, with one clarification E left implicit: **"resolves remotes" is the line where network contact becomes permissible.** Check mode must not reach out at all — it is the mode a user runs when they do not yet trust the tool with their network. Preview mode answers "exactly where would this land, and from where?", which may require confirming a remote is reachable. The spec states the product-level rule (check contacts nothing; preview may, and still writes nothing) and leaves whether reachability is actually probed to the implementation.

Collapsing these into one "safe mode" flag remains forbidden. Each gets its own requirement and its own zero-write assertion, and the assertions are whole-tree snapshots rather than "we didn't call the writer".

### D4 — Command surface: leave the bare invocation undefined so E2 can claim it

This change ships `rasen bootstrap` with `--check`, `--dry-run`, `--json`, and the two location inputs preview needs (a supplied path and a supplied parent directory). It ships **no flag that would obtain, register, or write** — not even as a stub that errors, because a "not available yet" message is itself a promise.

**A mode is required.** `rasen bootstrap` with no mode flag reports which modes exist and exits without doing anything. This is deliberate and is the whole non-breaking story:

- E designed the bare invocation to mean *interactive apply*. If this change gave it any other meaning — even "same as `--check`" — E2 would have to redefine it, breaking anyone who scripted it.
- Leaving it undefined costs one line of UX friction now and lets E2 define bare `rasen bootstrap` as apply **exactly as E designed it**, with zero redefinition of anything this change shipped.
- Every flag this change defines keeps its meaning under E2. `--check` and `--dry-run` are unchanged. The location inputs become inputs to the real clone instead of inputs to the preview, which is a widening, not a change — and it is what makes the preview honest, because the same selection code produces both answers.

E2 therefore adds: the bare invocation, `--yes` (with the adjudicated project-first/Store-first asymmetry E already settled), and per-project selection. It modifies nothing.

### D5 — Compose the landed classification; do not build a second one

`listProjectStoreCandidates` was not in E's plan and does most of what E's group 2 described: it unions the project's membership hints with every locally available Store whose records include the project, resolves each hint through `resolveStoreBinding`, and marks the unresolvable ones `unavailable: { reason, repair }` **without dropping them**. Bootstrap's state machine composes it. Writing a parallel walk over hints would produce a second answer that drifts from the one every other consumer sees.

Two genuine gaps remain, and they are the real work of this change's core:

1. **The planning Store declaration is not in that listing.** `listProjectStoreCandidates` covers `storeMemberships` hints and local records; the project's own `store:` pointer is separate. Bootstrap resolves it through `resolveStoreBinding` (guarded by `hasStoreDeclaration`, never `pointer.value`) and merges it into the expected set, deduplicating against the candidates by the same identity key.

2. **The landed reason taxonomy is not E's classification taxonomy.** `StoreUnavailableReason` is a *why-resolution-failed* vocabulary (`not-registered`, `metadata-missing`, `uid-mismatch`, `root-unhealthy`, `alias-ambiguous`, `pointer-malformed`). E's four classes are a *what-to-do-about-it* vocabulary (verified · present-unregistered · absent-with-remote · absent-without-remote). They do not map one-to-one, and the important case is that **`not-registered` does not distinguish "the Store is on this disk but unregistered" from "the Store is nowhere on this machine"** — which is precisely the difference between E's `present-unregistered` and `absent-*` classes. Bootstrap must derive that distinction itself, from the supplied path or parent directory plus the declaration's recorded remote. This is new logic; it is not available from any landed surface, and it is the one place where a naive reuse of the tri-state would silently produce a wrong classification.

The classification lives in `src/core/store/bootstrap.ts` as a pure function over already-read data, so every branch is testable without a filesystem fixture.

### D6 — The membership seam survives, for a different reason than E designed it for

E designed the membership seam as a fallback for child B not having landed: "reports *cannot verify here* rather than failing when the dependency is absent". Child B **has** landed — `resolveProjectMembership` is exported and `listProjectStoreCandidates` already calls it.

The seam is still needed, because the same "cannot verify here" answer is required for a case that has nothing to do with unlanded dependencies: **a declared Store that is not available on this machine.** Its records cannot be read, so its membership answer is *unknown*, and the one thing bootstrap must never do is collapse unknown into "not a member" — that would tell a user their project was ejected from a Store when in fact the Store simply is not here. The landed code already models this correctly (`projectMembershipUnverified` on the unavailable arm), and this change surfaces it as a first-class reported state with its own requirement.

So the seam is retargeted, not dropped: one function answering `confirmed | not-recorded | unverifiable-here`, with the third arm carrying what would make it verifiable.

**Amended during review: the unknown has TWO causes, not one.** The paragraph above framed "cannot verify here" as the answer for a Store that is not on this machine. A second cause produces the identical unknown and was initially collapsed into `not-recorded`: the Store is available and healthy, and its record for *this* project exists but will not parse. `listStoreProjectRecords` does not throw on that — it drops the record and emits a diagnostic — so `resolveProjectMembership` returns a plain `null`, indistinguishable from "no record exists". The distinction is recoverable only from `readStoreProjectRecord`, which returns empty diagnostics for a missing file and the parse or key-mismatch diagnostic for a broken one, so bootstrap re-asks that question rather than inferring it.

Two rules follow, and they generalize past this seam:

1. **A composed reader in this repo has two failure modes** — it throws, or it degrades to a diagnostic and returns a plausible-looking value. A guard catches only the first. Any surface computing an end state must therefore consult the diagnostics it collected, which is why `computeBootstrapEndState` refuses `complete` in the presence of any error-severity diagnostic.
2. **A repair that changes state may only be offered against an answer that was established.** The `not-recorded` repair is `rasen store add-project`, which writes; offering it on an unknown asks the user to act on a premise bootstrap never verified. `BOOTSTRAP_MUTATING_COMMANDS` + `isMutatingRepair` enforce this at the unknown arms — but be precise about how much that buys: the check is `startsWith` over a hand-maintained prefix list, so it is total only for the commands someone remembered to list. The per-site habit did not disappear; it moved into list maintenance.

This is completing an incomplete design and spec to match verified-correct behaviour, not bending them to fit the code: the requirement's original SHALL-NOT was scoped to an *unavailable* Store, so the available-but-unreadable case was governed by nothing at all.

**Follow-up for E2 (deliberately deferred, not overlooked).** Replace the prefix list with mutation declared where a repair is CONSTRUCTED — `{ kind: 'command'; command: string; mutates: boolean }` — so a new repair cannot be added without stating whether it writes, and the filter stops depending on anyone updating a list. It is deferred here because E2 is the change that adds most of the mutating repairs; introducing the shape now would mean E1 defining a field it barely exercises, and reshaping the report type is exactly the kind of churn this slice exists to avoid. E2 inherits this as a settled decision.

**Known gap, recorded so a future rule is stated wide enough.** A `StoreDiagnostic.fix` is a SECOND command channel that no safety filter in this repo covers. `isMutatingRepair` inspects `BootstrapRepair[]`; it cannot see a command embedded mid-string in a `fix`, and several exist — `identity.ts:192`, `identity-diagnostics.ts:417`, and this change's own `bootstrap_project_identity_unreadable` (`bootstrap.ts`), whose `fix` names `rasen store unregister --project <id>` on an explicitly undetermined answer. The letter of the "no state-changing repair on an unknown" rule holds, because that text travels as a diagnostic's `fix` rather than as a repair — but the letter is narrower than the intent. Any future rule about what commands may be offered must be written to cover `diagnostic.fix`, not only `repair[]`. E2 and E3 both need this.

**This gap was proved live, one round after it was written down — carry the evidence, not just the warning.** In review round 3 the human renderer was extended to print `diagnostic.fix` alongside `diagnostic.message`, on the reasonable-sounding ground that for several diagnostics the fix is the only actionable half. Within that one change, a `presence: 'unknown'` row — an answer the report had *just* called undetermined — ended with three state-changing commands in the repair position: `rasen store unregister --project <id>` from this change's own diagnostic, and `rasen store migrate-membership … --apply` plus `rasen store add-project … --to <store>` from the landed `storeLegacyReferenceUnresolved`. Following the first would have dropped a registration for a project that is almost certainly fine (the *config* is corrupt, not the registration). `isMutatingRepair` could not have caught any of them: all three are embedded mid-sentence, so a prefix match misses them even if the commands were listed.

Two consequences. First, the renderer now prints `diagnostic.message` only, and a test pins that. Second — the reason this belongs in the design rather than a commit message — **the `BootstrapRepair`-versus-`diagnostic.fix` distinction that preserves the rule's letter is invisible at the point it matters**: both render as indented instruction lines under the same item, so a human cannot tell which channel a command arrived through. A rule that holds only in a distinction the output does not express is not holding for the reader. E2's construction-time `mutates` field must therefore govern both channels, or the same defect returns the first time someone renders a payload more completely.

### D7 — Repairs come from the landed vocabulary, and are checked for ambiguity at print time

`UnavailableStoreBinding.repair` is already "ordered, copy-pasteable commands". This change consumes those rather than inventing a second repair vocabulary, and adds only the repairs the landed resolver has no reason to produce (for example, "supply a path for this Store").

E's D7 row D13 still binds: every printed command names an **unambiguous** selector — the permanent identity when the display name matches more than one Store on this machine, the display name otherwise. Bootstrap knows the arity at the moment it prints because it just resolved every Store, so this is a check it can always make. Row B (uid-only declarations) does not apply here: it is about what bootstrap *writes*, and this change writes nothing.

### D8 — The doctor readiness integration is deferred to E2, deliberately

E's group 11 pairs "ordinary-command repair text" with "doctor readiness". The repair text is E2 by D2. Doctor readiness is read-only and would fit here — but it is deferred anyway:

- It touches `src/commands/doctor.ts` (522 lines) and `src/core/relationship-health.ts` (452 lines) plus their existing tests and human/JSON parity, which is a large fraction of a review diff for a slice whose purpose is to be reviewable.
- E2 does not depend on it.
- The readiness doctor reports is more useful once there is something bootstrap can actually repair.

This is a judgement call and the cheapest one to reverse: the state machine is a pure function with a stable report shape, so wiring doctor to it later is additive. Flagged here so it is a recorded decision rather than an omission.

### D9 — Cross-platform

Every path is composed with `path.join()`; supplied locations resolve with `path.resolve()` and are compared canonically through `FileSystemUtils.canonicalizeExistingPath` with the established `path.resolve` fallback — so a drive-letter or separator difference never reads as a different location and never defeats the already-has-contents check that preview reports on. The safe basename derived from a remote is validated against the existing filesystem-safety rules (no separators, no traversal, no reserved device names) rather than a second set written here. Tests build expected paths with `path.join()`. No version-control process is spawned by this change at all, so the argument-vector-and-`windowsHide` discipline has nothing to bind to yet; it binds in E2.

### D10 — Archiving a NEW capability drops the delta's Purpose

Known trap, and this change is a NEW capability so it will hit it. `src/core/specs-apply.ts:399-402` builds the skeleton for a new spec as:

```
## Purpose
TBD - created by archiving change <name>. Update Purpose after archive.
```

The Purpose written in the delta spec is discarded. The archive step must copy it back from the archived delta into `rasen/specs/store-bootstrap/spec.md`, and `grep -rl "TBD - created by archiving" rasen/specs/` must come back empty. Carried as an explicit task rather than trusted to memory.

## Risks / Trade-offs

- **A report that names a repair the tool cannot perform reads as a broken promise.** → Every repair this change prints is a command that exists and works today (`rasen store register`, `rasen store doctor`, supply a path). Nothing printed says "run bootstrap to fix this", because bootstrap cannot yet.
- **Preview names a location that a later apply might refuse.** → The location selection is one function shared between preview and (later) apply, and preview reports a location it would refuse *as refused* rather than naming it as if it would work. A test asserts the previewed answer and the applied answer come from the same code path — the assertion lands here as "the selection function is the only source of a location", and E2 extends it end-to-end.
- **Reusing `listProjectStoreCandidates` inherits its taxonomy.** → The four-class mapping is derived explicitly and tested branch by branch (D5), rather than assuming `not-registered` means "absent".
- **An unavailable Store's membership silently reading as "not a member".** → Its own requirement, its own reported state, and a test that a Store absent from this machine is never reported as not recording the project.
- **The E1/E2 seam leaves E's spec directory in a state that cannot be archived as-is.** → D1 documents exactly what fails and why it fails safely; the remainder is re-derived, not archived.
- **Deferring the doctor integration means the read-only work has one consumer instead of two.** → Accepted (D8); the report shape is designed to take a second consumer without change.

## Migration Plan

1. **Readers and classification.** The state machine, the merge of the planning declaration with the candidate listing, the four-class mapping, and the report shape land as pure computation over what already exists.
2. **The membership seam** with its three-way answer.
3. **Check mode**, fully functional at that point, with the zero-write and zero-network assertions.
4. **Preview mode**: remote and location resolution, with its own zero-write assertion.
5. **Store-first listing.**
6. **Command surface, docs, and locales.**

Rollback: reverting removes one command and some message text. Nothing this change produces is persisted anywhere, so nothing becomes unreadable and no state needs unwinding.

## Open Questions

- Whether E2 should be one change or two. E's remaining groups (5–10) are project-first apply, knowledge-location preparation, Store-first obtain, clone target safety, idempotence, and durable declaration writing — that is more surface than this change carries, and all of it writes. Recommendation, for the LEAD to decide when re-deriving: split again at the same kind of seam, with clone-target safety and failed-retrieval cleanup as their own change, since those are where the expensive failures live.
- Whether `rasen doctor` should report bootstrap readiness before or after the acting half exists (D8). Deferred here; cheap to revisit.
