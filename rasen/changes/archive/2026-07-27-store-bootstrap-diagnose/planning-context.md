# Planning context — store-bootstrap-diagnose (Phase E, slice 1 of 2)

Seeded by the LEAD before propose. Read this FIRST, then research only what is
missing.

## User intent

The A–F Store/context portfolio paused after A–D2. Phase E
(`store-bootstrap-and-hydration`, 81 tasks) and Phase F
(`portable-project-knowledge`, 78 tasks) are proposal-only and unstarted.

The user has decided to **split E and F into smaller changes** rather than run
them as two large ones, and asked to **do E1 first** as a calibration slice —
then plan the remaining decomposition afterwards, informed by how E1 goes.

So this change is **E1: the read-only diagnose/report half of Phase E.**

Locked scope:

- Implement ONLY the read/report surface: the bootstrap state machine, the
  report shape, and the check/preview mode guarantees.
- Do NOT implement the acting half (E2): project-first apply, Store-first
  obtain, clone target selection, failed-retrieval cleanup, idempotence of
  repeated applies, or durable declaration writing.
- Do NOT implement any Phase F work.

## Where E's existing work lives — reuse it, do not re-derive it

`rasen/changes/store-bootstrap-and-hydration/` already holds a COMPLETE
proposal, design, delta spec, and 81-task list for the whole of Phase E,
written during the portfolio's planning phase. **Read all four.** Your job is
to CARVE E1 out of them, preserving their wording and decisions wherever the
requirement belongs to E1 — not to reinvent the design.

- `proposal.md`, `design.md`, `tasks.md`
- `specs/store-bootstrap/spec.md` — 10 ADDED requirements against a NEW
  capability `store-bootstrap` (confirmed absent from `rasen/specs/`).

### The E1 / E2 split, by E's own task groups

E1 (this change) = E groups **2, 3, 4**, plus the parts of 11–15 that serve them:

- group 2 — state machine and report shape (pure computation, no I/O beyond reads)
- group 3 — membership verification seam (reports "cannot verify here" rather
  than failing when a dependency is absent)
- group 4 — check mode and preview mode as **separate guarantees**

E2 (a later change) = E groups 5, 6, 7, 8, 9, 10.

The seam is E's own instruction, not one invented here — task 4.3 says: *"Do NOT
collapse these into one shared 'safe mode' flag — they are different promises
and each has its own assertion."* Check mode reads only, with **no network
contact at all**; preview mode additionally resolves remotes and the exact
target path but still writes nothing and runs no version-control operation.

### Requirement-level guidance (planner owns the final call)

From `specs/store-bootstrap/spec.md`, these belong wholly or partly to E1:

- "One command reports everything a machine still needs for a project" — E1 core.
- "Checking and acting are separate promises" — E1 core.
- "Starting from a project clone resolves every declared Store and reports each
  one's state" — the **reporting** half is E1; obtaining/registering is E2.
- "Starting from a Store lists its projects and obtains none without being
  asked" — the **listing** half is E1; obtaining is E2.
- "Every hint bootstrap prints can be pasted and will work" — applies to
  whatever E1 prints; carry the rule for E1's own output.

Wholly E2: clone target selection, failed-retrieval cleanup, idempotence of
repeated applies, durable declaration writing, and "commands that cannot resolve
a Store name name bootstrap as the repair" (verify that last one — it may have
an E1-satisfiable reporting component).

**Split requirements rather than shipping a requirement E1 only half-satisfies.**
A requirement whose text promises acting must not be ADDED by this change and
then left unmet — that is exactly the class of defect the immediately preceding
change (`stabilize-store-context-foundation`) existed to eliminate.

## An open question you must resolve and REPORT (do not silently pick)

`store-bootstrap` is a NEW capability, absent from `rasen/specs/`. Both this
change and the still-present `store-bootstrap-and-hydration/` directory would
now carry an ADDED delta for it. E's own task 1.4 says to *"confirm
`store-bootstrap` is still unclaimed by any other active change directory,"*
which implies a convention against exactly this.

Determine what actually breaks, if anything: run
`node bin/rasen.js validate --changes --json` and inspect how it treats two
active changes ADDING the same capability and overlapping requirement titles.
**Report your finding** — do not modify or move
`rasen/changes/store-bootstrap-and-hydration/`. Re-deriving E's remainder is
the LEAD's next planned step, after this change lands.

## Dependencies already satisfied

E's group 1 asks to re-verify child A/B/D2 surfaces before building. A, B, C,
D1, D2 are shipped and archived, and the four seams E consumes were just
repaired and pushed in `968482cf`
(`stabilize-store-context-foundation`) — portfolio resume safety, the
learned-skill evaluation-root fallback, UID-authoritative frozen identity, and
the gate-evidence rule. **Still re-verify against the landed code**: every A–D2
child that ran its group 1 found real drift from what planning assumed.

Relevant landed surfaces: `resolveStoreBinding` and its tri-state,
`requireConfigStoreLayer` vs `resolveConfigStoreLayer`, `hasStoreDeclaration`,
`inspectRegisteredStore`, `identity-diagnostics.ts`, `writeDurablePointer`
(`upgrade-identity.ts`), `src/core/store/membership.ts` /
`resolveProjectMembership`, and `src/core/project-knowledge-home.ts`.

## Working-tree hazard

The tree is **shared and dirty**; a concurrent session is actively editing
`packages/ui/**` (including all three `i18n/locales/*.json`), `rasen/config.yaml`,
and owns several untracked directories.

- **Never `git add -A`.** Re-take `git status` before editing anything under a
  shared path. Stage nothing during propose/apply — ship owns staging.
- `rasen/work/issue-centered-automation-platform/deterministic-pipeline-kernel-research.md`
  is untracked and belongs to neither this change nor a known session — keep it
  out of every pathspec.
- Branch: `feat/store-context-unification`, `HEAD=968482cf`, pushed to origin.
  Do not rewrite history.

## Repo conventions that bite

- Specs use **user-facing product behavior language**; put mechanism in
  design.md unless it is part of the product contract.
- Cross-platform is enforced: `path.join`/`path.resolve`, never hardcoded
  separators, and tests must use `path.join` for expected path values.
- **`validate` looks for SHALL/MUST only on a requirement's FIRST body line** —
  reflowing an opening sentence can fail validation with a message implying the
  keyword is absent.
- **`rasen validate <change> --changes` validates ALL active changes**; its
  summary always shows ~10 failures from delta-less portfolio container dirs.
  Read the per-item `valid` for your change; the totals are not a signal.
- New messages go through a `*-messages.ts` module — no inline English strings.
  New commands must be added to `src/core/completions/command-registry.ts`.
- **`rasen archive` can be rehearsed with zero blast radius**: copy
  `rasen/config.yaml` + `rasen/specs/` + this one change dir into a scratch
  root and run archive with cwd there.

## Test-execution discipline

- **Never run concurrent vitest batches** — prior work observed spurious
  timeouts. Small **serial** batches only.
- Any command over ~2 minutes, or of unknown duration, runs backgrounded with
  bounded **foreground** polling at intervals of at most 270 seconds.
- Known pre-existing failures on this branch, NOT ours: `test/release-contract.test.ts`,
  `test/commands/handoff.test.ts` (stale at `58faffad`, an ancestor of the base
  — **not** `313df542`), a CLI locale test, and `test/commands/workset.test.ts`
  (Windows temp-cleanup flake; passes in isolation). All four are byte-identical
  to base `d73c1da2`.

## Append below: durable findings from each stage

<!-- Workers append durable discoveries (decisions, discovered constraints).
     Not chatter, not status recaps. -->

### propose (planner)

**Dual-claim: `validate` cannot see it; `archive` catches it; the unit is the requirement TITLE, not the capability.**
Both this change and `store-bootstrap-and-hydration/` report `"valid": true` with an ADDED delta for the
same NEW capability and two identical requirement titles — the validator has no cross-change collision
check at all, so E's task 1.4 ("confirm the capability is still unclaimed") is a convention enforced by
nothing. Rehearsed in a scratch root: archiving this change merges cleanly (7 ADDED), and archiving E's
directory on top then fails with
`store-bootstrap ADDED failed for header "### Requirement: One command reports everything a machine still needs for a project" - already exists`
(`src/core/specs-apply.ts:315-321`), reporting `"fix": "...No files were changed."` with the change
directory left in place. Fails safe, but it does fail. Two active changes may share a NEW capability iff
their requirement titles are disjoint and only one archives before the other is re-derived.

**Archiving a NEW capability discards the delta's Purpose** — confirmed live, not from memory:
`rasen/specs/store-bootstrap/spec.md` came out of the rehearsal stamped
`TBD - created by archiving change store-bootstrap-diagnose`. `src/core/specs-apply.ts:399-402`. Carried
as task 11.3.

**Dependency drift that changes the plan (verified at `HEAD=968482cf`):**
- `listProjectStoreCandidates` (`src/core/store/membership.ts:425`) exists and was **not in E's plan at
  all**. It already unions membership hints with locally-recorded members, resolves each hint through
  `resolveStoreBinding`, and marks unresolvable ones `unavailable: { reason, repair }` without dropping
  them. Compose it; a parallel walk would drift from every other consumer's answer.
- The landed `StoreUnavailableReason` (`not-registered | metadata-missing | uid-mismatch | root-unhealthy
  | alias-ambiguous | pointer-malformed`) is a *why-resolution-failed* vocabulary and does **not** map
  onto E's *what-to-do-about-it* four classes. Specifically `not-registered` does not distinguish
  "on this disk but unregistered" from "nowhere on this machine" — that distinction must be derived.
- `resolveProjectMembership` **has landed**, so E's membership seam is not needed for its designed reason
  (an unlanded child B). It is still needed for a different one: an unavailable Store's membership is
  *unknown*, and collapsing unknown into "not a member" would tell a user their project was ejected from
  a Store that simply is not on this machine.
- The project's own planning `store:` pointer is NOT part of the candidate listing and must be merged in
  separately.

**Non-breaking command surface:** the bare `rasen bootstrap` invocation is left deliberately **undefined**
(it reports which modes exist and exits). E designed bare = interactive apply; giving it any meaning here,
even "same as `--check`", would force E2 to redefine it. Every flag this change ships keeps its meaning
under E2.

### apply (implementer)

**A fifth report class was unavoidable, and E2 inherits it.** E's four classes (verified ·
present-unregistered · absent-with-remote · absent-without-remote) answer "how do I obtain this Store".
Four of the six landed `StoreUnavailableReason` values (`metadata-missing`, `uid-mismatch`,
`root-unhealthy`, `alias-ambiguous`) are not obtainability answers at all — the Store is here and broken,
or the declaration picks two Stores — so forcing them into the four would be a lie. They map to a fifth
class, `unresolvable`, which is exactly what task 2.5's "something that cannot be resolved or read at all"
turns into `blocked`. Only `not-registered` fans out into the three obtainability classes.

**Present-unregistered is derived from a SUPPLIED location, so it is reachable in check mode.** The probe
reads the candidate directory's own `store.yaml` and compares its identity against the declaration — a
local read, no network — so `--check` can still say "it is on this disk, register it". Without a supplied
`--path`/`--into`, `not-registered` can never resolve to present-unregistered, by design: nothing is
inferred from a display name, a sibling directory, or a recorded path.

**`--path` had to become `<selector>=<dir>`.** A bare `--path <dir>` is ambiguous the moment a project
expects two Stores, and applying it to all of them would name a location for repositories it was never
meant for — which destroys the one promise preview has. E2 widens the same map to real clone targets.

**Two edits landed outside the new files, both minimal and both deliberate:**
`projectStoreCandidateKey` was exported from `store/membership.ts` (it was the private `candidateKey`)
because the planning pointer must merge into the candidate set on *the same* key rule — a second rule
would let one Store appear twice. And `test/core/store/identity-boundaries.test.ts` gained both new files
in `PHASE_A_FILES` plus a `POINTER_VALUE_ALLOWLIST` entry for `store/bootstrap.ts` (presence is tested
with `hasStoreDeclaration`; the alias is read only to label the reported Store).

**Command/flag descriptions must be authored in English at the call site**, even under the
"no inline English" rule. `cli/help-localization.ts` localizes Commander help by looking the English text
up in `commandDescriptions`; a description handed to Commander already translated fails that lookup and
falls back to the registry's English. They live as named constants in `bootstrap-messages.ts`
(`BOOTSTRAP_DESCRIPTIONS`) so the command file still spells out no English of its own, and the
translations go in each locale's `commandDescriptions`. Reason phrases are NOT re-coined: bootstrap reads
child A's existing `pipeline.messages.storeReason*`.

### verify round 1 (implementer fixes)

**A read-only diagnosis command has a second, easily-missed write-nothing sibling: throw-nothing.** The
review found `rasen bootstrap` crashing with a raw unhandled rejection on an unparseable machine registry —
the exact broken machine it exists to describe — because `listProjectStoreCandidates` has its own unguarded
`readStoreEntries` that bypasses bootstrap's `.catch(() => null)`. The fix is not a `try/catch` that prints
tidily: the spec promises `blocked` as a reported end state, so unreadable machine state became a
first-class `unreadable-state` problem. Durable rule for E2 and anything like it: **every reader a
diagnosis command composes must be assumed to throw, and every throw must land as a reported state, not a
message.** The `--json` contract makes this sharper — a crash emits no JSON at all, so the machine-readable
surface simply vanishes on the one path it is most needed.

**Commander does not await an async `.action`.** An escaping rejection there is a process-level crash, not a
command failure. `registerDoctorCommand` (`doctor.ts:462`) and `StoreCommand.register` (`store.ts:1058`)
both guard their own bodies for this reason; a new command that does not is the outlier. Nothing in the
repo catches this automatically.

**Two lint/type blind spots, confirmed:** `@typescript-eslint/no-unused-vars` is `off` in `eslint.config.js`
and `tsconfig` sets no `noUnusedLocals`, so a dead import ships silently. Neither lint nor `tsc` would have
caught the unused `membershipStoreLabel` import.

**`projectStoreCandidateKey` collapses on `root:` only once a Store RESOLVES.** While a Store is unavailable
a durable hint keys `uid:` and an alias-form pointer keys `id:`, so one Store is reported twice with two
repair blocks — and only in the unavailable case, which is exactly when the report matters most. The merge
therefore matches on either half of the identity, not on the key alone.

**A `<path>` placeholder is honest only while the path is unknown.** Preview computes the exact location; a
repair printed beside it still carrying `<path>` is not pasteable, which is what the verbatim-taken
requirement forbids. The placeholder is now filled wherever the location is settled and left alone wherever
it is refused or unsupplied — and a substituted path is quoted when it contains whitespace, since bootstrap
is the first surface that substitutes a REAL path (the landed convention at `identity.ts:195` quotes nothing
because it only ever emits the placeholder).

**Spec wording completed to match verified behaviour, not bent to it:** `present-unregistered` is reachable
only when the user names a location, because nothing landed offers a filesystem scan and inventing one was
rejected. The scenario and `docs/cli.md` now state that condition, and a second scenario states plainly that
bootstrap does not search the disk. Same for the Store-first listing, which has always had a third answer
(`unlocatable`) that the requirement did not name.

### verify round 2 (implementer fixes)

**The generalisation of round 1, and the one worth carrying furthest: a composed reader in this repo has TWO
failure modes, and a guard catches only one.** It throws — or it degrades to a diagnostic and returns a
plausible-looking value with something silently dropped. `listStoreProjectRecords` takes the second path on a
corrupt record, so `resolveProjectMembership` returned a plain `null` that was indistinguishable from "no
record exists", and bootstrap reported "this Store does not record the project" about data it had never read
— then printed a MUTATING repair on that invented premise. Two durable rules follow:
(1) **any surface computing an end state must consult the diagnostics it collected** — `complete` is now
forbidden in the presence of any error-severity diagnostic; and (2) **a repair that changes state may only
be offered against an answer that was actually established** — encoded as `BOOTSTRAP_MUTATING_COMMANDS` +
`isMutatingRepair` so it is checkable rather than a per-site habit.

**A silent wrong answer that induces a mutation is worse than a crash.** The round-1 Blocker crashed: loud,
obvious, nobody acts on a stack trace. This one answered confidently and wrongly, left no trace that
anything was unreadable, and recommended a state-changing command. Rank accordingly.

**`null` was overloaded in three more places; all three are now three-valued.** The Store probe at a
supplied location (nothing there / not this Store / identity unreadable — the third printed `git clone` over
a directory that may hold the very Store being sought), the registered-project identity lookup (found /
absent / unreadable — the third printed an obtain suggestion for something possibly already checked out),
and the membership record read. Audited-and-left: `inspectChosenLocation`'s unreadable-directory fallback
reports `not-empty` rather than a distinct reason, which is a less precise REASON for an identical refusal
and induces no action.

**Design D6 and the membership requirement were completed, not bent.** The original SHALL-NOT was scoped to
an *unavailable* Store, so the available-but-unreadable case was governed by nothing at all — the behaviour
was wrong AND unrequired. D6 now records both causes of the unknown and both durable rules.

### verify round 3 (implementer fixes, review loop closed)

**Human/JSON parity has a failure mode that only shows on the paths carrying no repair.** Entry-level
diagnostics were never rendered in human mode. For membership that was masked — the repair independently
names the file — but `presence: 'unknown'` emits no repair at all, so the human reader saw "cannot be
determined" with no reason, no path and no fix while JSON carried all three. The renderer now prints entry
diagnostics AND each diagnostic's `fix`, because the `fix` is where several diagnostics keep the only
actionable half of what they know. Rule: **wherever a report answers with no repair, check what the human
renderer drops** — the parity claim is weakest exactly where the output is thinnest.

**A safety predicate is only as total as its list.** `BOOTSTRAP_MUTATING_COMMANDS` + `isMutatingRepair` were
described as making the no-mutating-repair-on-an-unknown rule "checkable rather than a per-site habit". That
overstated it: `startsWith` over a hand-maintained list moves the habit into list maintenance. The comment
and design D6 now say what the constant actually is — the commands checked at the unknown-arm filter sites,
not an inventory of every state-changing command this change prints (`rasen store register` and `git clone …`
are printed and unlisted; safe only because they appear solely on established answers). The real fix —
declaring mutation where a repair is CONSTRUCTED — is recorded in D6 as a named E2 follow-up.

**`StoreDiagnostic.fix` is a second command channel no safety filter covers.** `isMutatingRepair` inspects
`BootstrapRepair[]` and cannot see a command embedded mid-string in a diagnostic's `fix`; `identity.ts:192`,
`identity-diagnostics.ts:417` and this change's own `bootstrap_project_identity_unreadable` all do exactly
that. Recorded in D6 as a known gap so any future rule about what commands may be offered is written to
cover `diagnostic.fix`, not only `repair[]`.

**Make the argument that carries a safety rule REQUIRED, not optional.** `computeBootstrapEndState`'s
`diagnostics` was optional; a future call site that forgot it would have silently lost the never-`complete`
rule with no error. It is now required, so the compiler asks.

### verify round 4 (one revert — a regression I introduced)

**An unasked-for improvement needs the same review as an asked-for one, and rendering MORE of a payload is a
scope-widening act, not a cosmetic one.** Round 3 asked only that entry diagnostics reach human output. I
also rendered each diagnostic's `fix`, reasoning that for several diagnostics the fix is the only actionable
half. That reasoning was sound in the abstract and wrong here: it re-opened requirement 4 through the exact
second channel the round-2 known-gap paragraph had named one round earlier. A `presence: 'unknown'` row — an
answer the report had just called undetermined — ended with three state-changing commands in the repair
position, one of which would have dropped a registration for a project that was almost certainly fine (the
CONFIG was corrupt, not the registration). Reverted to `message` only; a test now pins it.

**The load-bearing lesson, and why it belongs in D6 rather than a commit message: a distinction that
preserves a rule's letter is worthless if the output does not express it.** `BootstrapRepair` is filtered and
`diagnostic.fix` is not — but both render as indented instruction lines under the same item, so a human
cannot tell which channel a command arrived through. The rule held on paper and failed on screen.

**Archive rehearsal (11.2) run and clean:** 7 ADDED, 0 modified/removed/renamed, and the D10 trap fired
exactly as predicted — the merged `rasen/specs/store-bootstrap/spec.md` came out stamped
`TBD - created by archiving change store-bootstrap-diagnose`. Task 11.3 is therefore still OPEN and
belongs to whoever runs the real archive: copy the Purpose paragraph back from the archived delta, and
confirm `grep -rl "TBD - created by archiving" rasen/specs/` is empty.
