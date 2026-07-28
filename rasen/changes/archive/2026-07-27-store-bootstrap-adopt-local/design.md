## Context

This is slice 2 of 4 of Phase E. E1 (`store-bootstrap-diagnose`) shipped the
read-only diagnosis command at `f11daa1d`: `rasen bootstrap` reads what the
project and its Stores declare, works out everything missing on this machine,
and reports it — writing nothing, on any path, in any mode. E1 landed 7
requirements and 35 scenarios against a new `store-bootstrap` capability, plus a
report shape (`BootstrapReport`), a four-class classification, a membership seam,
a previewed-location selector, and a command surface with `--check`, `--dry-run`,
`--json`, `--path`, and `--into`. E1 is not archived (`archive.timing: on-merge`,
branch unmerged), so `rasen/specs/store-bootstrap/` does not exist yet; this
change's MODIFIED target is frozen in E1's delta.

This change **carves the project-first acting half** out of E's complete design
rather than re-deriving it. Where a requirement, a decision, or a task belongs
to the acting-on-local half, its wording is preserved from E. The carve point is
E's own: E's task 4.3 already says the two safe modes must not be collapsed "because
they are different promises"; this change takes that further and makes *reporting*
and *acting-on-what's-local* the seam between E2 and E3, not just two flag sets.

### What "acting on what is already local" means — and does not

E2 performs every repair that can be carried out from state this machine already
owns:

- **Register the current project checkout** through the existing project registry
  (`registerProject`).
- **Register a present-but-unregistered Store** the user names a location for,
  through the existing `rasen store register` path (`registerExistingStore`).
- **Re-verify a Store's record of this project** once that Store becomes
  available through registration — the membership answer E1 had to call
  `unverifiable-here` moves to `confirmed` or `not-recorded` because the Store's
  records are now readable.
- **Prepare the project's local knowledge location** as empty base directories,
  through child D2's `resolveProjectKnowledgeHome`.
- **Write the durable Store declaration** through the single writer
  `writeDurablePointer`, when the project's declaration is in the earlier form
  and the Store has a resolvable identity.

E2 does **not** retrieve, clone, create a checkout, run a version-control
operation, or contact a remote for retrieval, on any path, in any mode. Those
are E3 (`store-bootstrap-obtain`). E2 does **not** touch the Store-first acting
flow (E's group 7), ordinary-command repair text, or the doctor readiness
integration — those are E3 and E4 respectively.

### Dependency re-verification against landed code

E's group 1 asked for this, and every A–D2 child that ran it found drift. Run
against `HEAD=f11daa1d`:

| Surface | State | What E2 does with it |
|---|---|---|
| `writeDurablePointer` (`upgrade-identity.ts:195`) | landed, unchanged since child A | E2 routes every declaration write through it. Signature: `(configPath, { uid, id, remote? })`. The one writer `rasen store upgrade-identity` already uses. |
| `resolveStoreBinding` / tri-state (`identity.ts`) | landed | E2 does not call it on new paths — E1's classification already composes it, and E2's apply consumes E1's report shape. Confirmed unchanged. |
| `hasStoreDeclaration` (`project-config.ts`) | landed | E2 uses it to decide whether the project's declaration is in the earlier form and needs upgrading. |
| `projectStoreCandidateKey` (`membership.ts`) | landed, E1's export | Confirmed exported; E2 does not call it on new paths. |
| `resolveProjectKnowledgeHome` (`project-knowledge-home.ts:96`) | landed, synchronous | E2 calls it to resolve where the empty base directories go. Returns `{ projectId, root, catalogDir }`. |
| `registerProject` (`project-registry.ts:292`) | landed | E2 calls it to register the current checkout. Idempotent (path-exact match updates in place). Takes `{ projectRoot, projectId, mode }`. |
| `registerExistingStore` (`operations.ts:945`) | landed | E2 calls it to register a present-unregistered Store the user named a location for. The `rasen store register <path>` path. |
| `BOOTSTRAP_MUTATING_COMMANDS` / `isMutatingRepair` (`bootstrap.ts`) | landed (E1) | **E2 replaces these** — see D3. The prefix list is removed; the filter reads a construction-time `mutates` field. |
| `BootstrapRepair` command variant (`bootstrap.ts`) | landed (E1) | **E2 changes the type** — gains `mutates: boolean`. Every construction site is updated. |
| `src/commands/bootstrap.ts` command surface | landed (E1) | E2 extends it: adds `--apply` mode and `--yes`, extends the messages module. |
| `src/core/store/bootstrap.ts` report shape | landed (E1) | E2 extends `BootstrapReport` / `BootstrapStoreEntry` with apply-path fields (`action`, `alreadyRegistered`, `alreadyHydrated`). The report shape is additive — check and preview are unchanged. |

Net: **no dependency drifted in a way that changes the plan.** Two surfaces E2
modifies directly (`BootstrapRepair` type, `isMutatingRepair`), both expected.
The registration and declaration-writing surfaces match what E's design assumed.

## Goals / Non-Goals

**Goals:**

- Close every gap that can be closed from what is already on this machine,
  behind an explicit apply mode.
- Re-verify membership once a Store becomes available, so the answer E1 had to
  call `unverifiable-here` does not stay frozen.
- Route every durable-declaration write through `writeDurablePointer`, with the
  object form (identity + display name), and refuse to write a declaration that
  silently fails elsewhere.
- An idempotent rerun that reports what was already in place and writes nothing
  new.
- Replace E1's prefix-list mutation filter with a construction-time `mutates`
  field that governs both command channels, so the rule is total rather than
  list-maintained.

**Non-Goals:**

- Retrieving, cloning, or creating any repository. That is E3.
- The Store-first acting flow (registering a Store's own checkout, obtaining its
  projects). That is E3 (group 7 entire).
- Clone target creation, the non-empty-directory refusal at clone time, and
  failed-retrieval cleanup. Those are E3.
- Rewriting the failure text of ordinary commands, and the doctor readiness
  integration. Those are E4.
- Cross-machine knowledge bundle import. That is F4. E2 prepares the knowledge
  *location* only — empty directories, no content, no import.
- Re-litigating E1's report shape, classification, membership seam, or the
  `--check` / `--dry-run` separation. E2 consumes them unchanged.

## Decisions

### D1 — Which of E's ten requirements this change takes, modifies, and defers

The governing rule (same as E1's): **split a requirement rather than ADD one
this change only half-satisfies.** A requirement whose text promises retrieving
must not land unmet.

| E's requirement | Disposition | Why |
|---|---|---|
| Starting from a project clone resolves every declared Store and reports each one's state | **MODIFY** E1's split of it (*Starting from a project clone, every declared Store is classified and reported*) | E1 shipped the read-and-classify half; E2 deepens it with the acting-on-local half — registering the current checkout, registering present-unregistered Stores, preparing the knowledge location, and re-verifying membership after a Store becomes available. E1's seven scenarios are preserved verbatim; E2 adds the acting scenarios. |
| Running bootstrap again changes nothing that is already correct | **ADD** (verbatim) | Vacuous when E1 shipped it (nothing was written). E2 performs the writes this requirement governs, so it is no longer vacuous. |
| A declaration bootstrap writes is durable and usable | **ADD** (verbatim) | E2 is the child that writes declarations. |
| A clone target is chosen by stated priority and never overwrites anything | **Deferred** to E3 | E1 landed the *previewed-location* selection half. The *enforcement* half (refusal at clone time, the argument-vector discipline) is E3 — E2 does not clone. |
| A failed retrieval is cleaned up only when provably safe | **Deferred** to E3 | Nothing is retrieved here. |
| Starting from a Store lists its projects and obtains none without being asked | **Deferred** to E3 | E1 landed the listing half. The acting half (registering the Store checkout, obtaining projects) is E3 — group 7 entire. |
| Commands that cannot resolve a Store name bootstrap as the repair | **Deferred** to E4 | Its central claim (other commands name bootstrap as the repair) is false until E3 can obtain absent Stores. |
| Checking and acting are separate promises | **Already landed** by E1 | E1 renamed it *Checking and previewing are separate promises* and fully satisfied the read-only half. E2 does not touch it. |
| One command reports everything a machine still needs for a project | **Already landed** by E1 | E2's apply mode also produces the report, ending in the same three states. No change needed. |
| Every hint bootstrap prints can be pasted and will work | **Already landed** by E1 | E2's new hints (apply-mode consent prompts, declaration-upgrade suggestions) inherit the rule. No change needed. |

Result: **one MODIFIED block and two ADDED blocks**, all against `store-bootstrap`.
E1's other six requirements are untouched.

### D2 — The invariant, and the one hole in it

**The invariant:** nothing is retrieved from anywhere, and no repository checkout
is created. Every write lands in machine-local state this machine already owns,
PLUS the project's own durable declaration when the project asks for one. No
network, no `git`, no new checkout, on any path, in any mode.

**The hole — and why it does not collapse the invariant.** The durable
declaration is the one write that lands in a **Git-tracked file in the user's
repository** (`<workspace>/config.yaml`). Every other write is machine-local
ephemera: the project registry, the Store registry, and the knowledge-location
directories all live under the machine data dir and are never committed. The
declaration is not ephemera — it travels with the repository.

This is the single point where the invariant is weaker than it looks, and it is
where child A lost the most time: a bare string written into a tracked file that
then could not resolve. E2's mitigations are exact:

- **Every declaration goes through `writeDurablePointer`** — the one writer whose
  body child A debugged line by line. Bootstrap does not assemble the object a
  second way.
- **The object form is recorded** — permanent identity AND display name together,
  so surfaces that still compare on the name (the session-launch path child A's
  row B identified) keep working while the durable identity is the authority.
- **A bare display name is never written.** The declaration carries the identity
  or it does not get written.
- **A nameless Store reports the limitation.** A Store with no display name at all
  would produce a uid-only declaration that reads as a mismatch in session launch.
  Bootstrap reports the limitation and its repair instead of manufacturing an
  instance of the bug.
- **Tests assert what lands in the file, not what the message says** (E's task
  10.5). The message is a report; the file is the contract.

Review attention concentrates here. An invariant with an "except" is not really
an invariant (E1's own finding), and E1's two Blockers were neither a write-safety
question — so the invariant bought less than the sizing model assumed. Budget for
the heavier review on this write specifically, not on the machine-local writes
that share E1's collapsing property.

### D3 — THE binding constraint: construction-time `mutates` on BOTH command channels

This is the settled decision E1 deferred to E2, and it is the one design rule
this change owns outright.

E1's `design.md` D6 says, exact words: *"E2 is the change that adds most of the
mutating repairs; introducing the shape now would mean E1 defining a field it
barely exercises… E2 inherits this as a settled decision."*

And: *"the `BootstrapRepair`-versus-`diagnostic.fix` distinction that preserves
the rule's letter is invisible at the point it matters… a rule that holds only in
a distinction the output does not express is not holding for the reader. E2's
construction-time `mutates` field must therefore govern both channels, or the
same defect returns the first time someone renders a payload more completely."*

**The shape.** The `BootstrapRepair` command variant gains a required field:

```ts
| { kind: 'command'; command: string; mutates: boolean }
```

Three properties follow, and each is load-bearing:

**1. The filter reads the field, not a list.** `isMutatingRepair(repair)` becomes
`repair.kind === 'command' && repair.mutates`. E1's `BOOTSTRAP_MUTATING_COMMANDS`
prefix list is removed. A repair constructed in bootstrap's own code cannot be
added without stating `mutates` — TypeScript enforces it at every construction
site, and a future contributor cannot introduce a command repair without deciding
which value it carries. The per-site habit E1's list existed to police does not
disappear by itself; it moves from list maintenance into the type system, where
forgetting is a compile error rather than a latent gap.

**2. Both command channels are governed by the same field.** A rule this change
carries covers any command the report can offer: a state-changing command SHALL
NOT be offered against an answer the report did not establish, whether the
command travels as a `repair` or as a `diagnostic.fix`. E1 proved this gap is
live — one round after writing the rule down, rendering `diagnostic.fix` put
three mutating commands (`rasen store unregister --project`, `rasen store
migrate-membership … --apply`, `rasen store add-project … --to`) under an answer
the report had just called undetermined. E1 closed the rendering path (message-
only, with a test pinning it). This change ensures the **data model** also
carries the field, so a future change that surfaces `diagnostic.fix` as a command
goes through the `mutates`-carrying `BootstrapRepair` shape rather than printing
a raw string. Any diagnostic `fix` that bootstrap surfaces as a command SHALL
pass through `bootstrapRepairsFrom`, which classifies `mutates` — it is not
rendered as a raw string, because the distinction between the two channels is
invisible to the reader and that is exactly the condition under which the defect
returned.

**3. Consumed command strings default to `mutates: true`.** The landed
`UnavailableStoreBinding.repair` and `StoreDiagnostic.fix` emit plain strings,
not `BootstrapRepair` objects. `bootstrapRepairsFrom` — the single consumption
point — classifies each string as a command or manual instruction (E1's existing
regex) and sets `mutates: true` for every command. This is the conservative read:
the landed resolver's commands are almost all state-changing (register, upgrade-
identity, clone), so treating a command of unknown effect as mutating is safer
than treating it as read-only. The safe direction is "block unless proven
read-only," not "allow unless proven mutating." Bootstrap's OWN repairs —
constructed explicitly at sites that know what they do — set `mutates` to the
value the construction site knows: `rasen store register <path>` is `true`;
`rasen doctor` is `false`; `rasen store upgrade-identity` is `true`.

**What this does NOT change about the filter's scope.** The filter blocks
mutating repairs at the **unknown arms** — the `unverifiable-here` membership
answers, the `locationUnreadable` classification arms. It does NOT block
mutating repairs at established answers: `rasen store register <path>` against a
present-unregistered Store (confirmed present) is a mutating repair offered
against an established answer, and that is correct. The rule is "no state-
changing command on an unknown," not "no state-changing command anywhere." E2
adds mutating repairs at established arms (register, upgrade-identity) and the
filter passes them through, because the answer they act on was verified.

### D4 — Two inherited rules from E1's D6 (carried forward, not re-derived)

E1 encoded two rules after its two Blockers proved they were needed. Both bind
E2 because E2 composes more readers than E1, not fewer.

**Rule 1: a composed reader in this repo has two failure modes.** It throws, or
it degrades to a diagnostic and returns a plausible-looking value with something
silently dropped. A `try/catch` catches only the first. Any surface computing an
end state must therefore consult the diagnostics it collected — which is why
`computeBootstrapEndState` refuses `complete` in the presence of any error-
severity diagnostic. E2's apply path inherits this: an apply that registered a
Store whose records then failed to parse MUST NOT report `complete`, because the
membership answer is still unknown even though the registration succeeded.

**Rule 2: a mutating repair may only be offered against an answer that was
established.** A registration command against a Store whose presence was
verified is legitimate. The same command against a Store whose presence is
unknown asks the user to act on a premise bootstrap never verified. E2's consent
gating inherits this: a present-unregistered Store (presence confirmed by the
probe) may be registered; an absent Store (presence not confirmed) may not — its
repair is obtain, which is E3.

### D5 — The project-first apply state machine

E1's read path produces a report: classify each Store, resolve membership,
compute end state. E2's apply path consumes that report and acts on the stores
that can be acted on locally. The order is the whole resumability property
(E's task 5.4: an interruption leaves a state a rerun can resume):

1. **Read and classify** (E1's path, unchanged). The report is the input.
2. **Register the current project checkout.** Through `registerProject`, always,
   as the first acting step — it is machine-local, idempotent, and the project's
   own checkout. No separate consent: invoking apply IS the consent for this
   step.
3. **Register each present-unregistered Store** the user named a location for.
   Consent-gated: without `--yes`, each registration asks; with `--yes`
   (project-first), the Stores the project itself declares are confirmed
   without asking. Through `registerExistingStore`.
4. **Re-verify membership** for each Store that became available through step 3.
   The Store's records are now readable, so `resolveProjectMembership` moves the
   answer from `unverifiable-here` to `confirmed` or `not-recorded`.
5. **Prepare the knowledge location.** Through `resolveProjectKnowledgeHome`,
   creating empty base directories. Idempotent.
6. **Write the durable declaration**, when the project's declaration is in the
   earlier form and the Store has a resolvable identity with a display name.
   Through `writeDurablePointer`. Consent-gated the same way step 3 is.

Each step is individually idempotent, so an interruption at any point leaves a
state a rerun resumes from: `registerProject` updates in place; a Store already
registered is skipped; the knowledge location already exists is a no-op; a
declaration already durable is skipped. Step 9 (idempotence) asserts the whole
rerun writes nothing new.

**The end state of an apply is still one of E1's three.** `complete` when every
declared Store is verified and every membership is confirmed. `degraded` when
some Store is absent (its obtain is E3, so a degraded apply is the expected
outcome on a machine missing remote Stores). `blocked` when the machine's own
state is unreadable. The report shape E1 defined carries the end state
unchanged; the apply path populates it with the post-acting facts.

### D6 — Knowledge location preparation: empty base directories, no content, no import

E's group 6 is one seam, backed by child D2's `resolveProjectKnowledgeHome`.
E2 creates the canonical knowledge root and the catalog directory as **empty
base directories** — `fs.mkdirSync(home.root, { recursive: true })` and the same
for `home.catalogDir`. `recursive: true` is idempotent: a rerun that finds them
already present writes nothing and marks `already_hydrated`.

What E2 does NOT do here, stated explicitly because each is a plausible shortcut:

- **Invents no content.** No placeholder files, no README, no default catalog
  entries. The directories are empty because the project's knowledge is the
  project's own, and bootstrap is not the command that creates it.
- **Imports nothing.** The portable bundle import is a SEPARATE reported step
  (F4), and E2 plans it in the report (as a named step the user can see) but
  does not perform it. The line between "prepare the location" and "import a
  bundle" is the line between E2 and F4, and it is stated in the report.
- **Reads no legacy catalog.** The migration off the per-clone layout is an
  existing command (`rasen project knowledge migrate`); bootstrap does not
  repeat it.

### D7 — Durable declarations via `writeDurablePointer`

E's task 10.1 is non-negotiable: every declaration bootstrap writes goes through
`writeDurablePointer`. Bootstrap does not assemble the object a second way.

**When bootstrap writes a declaration.** During apply, after the planning Store
resolves (step 3 may have registered it), if the project's `store:` declaration
is in the alias form (a bare display name) — or is durable but missing the
display name the Store now carries — bootstrap upgrades it to the object form
through `writeDurablePointer`. The trigger is narrow on purpose: bootstrap
writes when the project has a declaration that could be more durable, not when
it has none at all (a project with no declaration is not bootstrap's to create —
that is `rasen init`'s contract).

**What the object form records.** The permanent identity (`uid`) and the display
name (`id`) together, plus the credential-free `remote` when the Store's
metadata carries one. This is the form `writeDurablePointer` already writes for
`rasen store upgrade-identity`: `{ uid, id, remote? }`. Bootstrap calls it with
exactly the same shape.

**The nameless-Store limitation.** A Store with no display name at all would
produce a uid-only declaration. Child A's row B identified the consequence: a
uid-only declaration reads as a mismatch in session launch, because the stale
comparison there keys on the name. Bootstrap reports the limitation and its
repair (`rasen store upgrade-identity` once the Store has a name, or `rasen init`
to record one) rather than manufacturing an instance of the bug. The real fix
belongs to child C's session-launch path; this change refuses to emit data that
walks into it.

**Consent.** The durable declaration write lands in a Git-tracked file. It is
gated by the same consent path as the Store registrations: without `--yes`, the
user is asked; with `--yes`, the upgrade is confirmed because it is implied by
the project's own existing (alias-form) declaration. The file is written
atomically (temp + rename), never committed, never pushed — the same discipline
`rasen store upgrade-identity` already enforces.

### D8 — Idempotence on rerun

E's group 9, now that this change writes. A rerun against the same project
identity and the same checkout:

- **Rewrites no identity.** `registerProject` updates in place (path-exact match).
  The Store registration creates no second entry; the durable declaration is not
  rewritten when it already carries the identity and display name.
- **Creates no duplicate registration.** A Store already registered is reported
  as `already_registered`; the registry holds exactly one entry per Store with
  an unchanged path.
- **Changes no recorded path.** The canonical paths are stable; a rerun does not
  move a registration.
- **Re-imports nothing.** The knowledge location already exists is a no-op;
  `already_hydrated` marks it in JSON.
- **Reports drift, never corrects it.** A display name or remote that no longer
  matches the Store's own metadata is reported with the command that would
  refresh the declaration (`rasen store upgrade-identity`). Bootstrap does not
  change the declaration on its own — auto-fixing a declaration during what the
  user asked to be a setup step is exactly the silent rewrite this release spent
  four changes eliminating.

JSON carries `already_registered` and `already_hydrated` markers so a caller can
distinguish "did nothing because it was already right" from "did nothing because
it failed."

### D9 — The `--yes` asymmetry: project-first half only

The `--yes` adjudication is settled (E's tasks 7.5 / 12.2) and is not re-litigated
here. E2 owns the **project-first** side only.

`--yes` MAY cover registering the Stores the project itself declares and names a
location for, because the expected Store set comes from the user's own committed
configuration (the `store:` pointer and the `storeMemberships` hints) and a
scripted setup that stops halfway is unusable. It covers:

- Registering the current project checkout (no consent needed — it is the user's
  own checkout, and apply was invoked).
- Registering each present-unregistered Store the project declares and the user
  named a location for.
- Preparing the knowledge location (machine-local).
- Upgrading the durable declaration when the project's declaration is in the
  earlier form.

It does NOT cover:

- **Obtaining a Store from a remote.** That is E3. E2 does not obtain at all,
  so `--yes` has no obtaining to confirm. E3 will inherit the project-first
  `--yes` for the obtain half.
- **The Store-first flow.** A Store's roster is authored by other people and can
  grow without the local user knowing. `--yes` in the Store-first flow covers
  registering the Store's own checkout only — and that is E3's group 7, not E2's.

The two flows are not unified behind one predicate. E2 implements the project-
first predicate; E3 implements the Store-first one.

### D10 — Command surface: `--apply` mode, and the Store-first seam left for E3

E1 shipped `rasen bootstrap` with `--check`, `--dry-run`, `--json`, `--path`, and
`--into`, and made a mode required: the bare invocation reports which modes
exist and does nothing else. E1's requirement 2 scenario ("A mode is chosen
explicitly") governs that bare invocation.

E2 extends the command surface **without redefining anything E1 shipped**:

- **`--apply` is added as a third mode.** It is the mode that acts. `--check`
  and `--dry-run` keep their meanings and their zero-write guarantees. The bare
  invocation still reports modes and does nothing else — it now reports three
  modes instead of two, which is additive and does not contradict E1's scenario.
  This is the cleanest seam: E1 made "a mode is required" the contract, and E2
  honors it by making apply a mode the user names explicitly rather than
  redefining the bare invocation.
- **`--yes` is added**, meaningful only with `--apply`. `--apply --yes` is
  project-first apply with blanket confirmation (D9). `--yes` without `--apply`
  is rejected before any work, the same way `--check --dry-run` is.
- **The bare invocation is unchanged.** E1's scenario "A mode is chosen
  explicitly" stays true. E3 may later claim the bare invocation as interactive
  apply for the Store-first origin; E2 does not touch it.

**The Store-first `--apply` seam.** `--apply` is defined for the project-first
flow. If invoked from a Store checkout, origin detection routes to E1's Store-
first read path — which E2 does not change — and the result is the read-only
listing E1 ships. E2 adds no Store-first acting (group 7 is E3), so `--apply`
from a Store checkout performs no registration and no obtain. This is not a "not
available yet" message (E1's D4 forbids one); it is the same read-only listing
`--check` produces from a Store, because E2 adds nothing to that path. E3 will
define what `--apply` does from a Store checkout.

### D11 — Cross-platform

Inherited from E1's D9, with the path discipline now binding on writes as well as
reads:

- Every path is composed with `path.join()`; the knowledge-location directories
  resolve through `resolveProjectKnowledgeHome`, which already composes with
  `path.join`.
- The project root is canonicalized through `FileSystemUtils.canonicalizeExistingPath`
  with the established `path.resolve` fallback, so a drive-letter or separator
  difference never reads as a different checkout.
- The durable declaration is written through `writeDurablePointer`, which uses
  `writeFileAtomically` (temp + rename) — the same discipline every other writer
  in the repo uses. No path is concatenated with a separator.
- No version-control process is spawned by this change at all (the argument-
  vector / `windowsHide` discipline has nothing to bind to here; it binds in E3).
- Tests build expected paths with `path.join()`.

## Risks / Trade-offs

- **The durable declaration is the one write that lands in a Git-tracked file.**
  → Every declaration goes through `writeDurablePointer`, the object form is
  recorded, a bare name is never written, a nameless Store reports the
  limitation, and tests assert what lands in the file rather than what the
  message says (D2, D7).
- **The construction-time `mutates` field changes a type E1 landed.** → The
  change is mechanical (add `mutates: boolean` to each construction site), and
  TypeScript makes every site a compile error until it is set correctly. The
  filter becomes simpler, not more complex.
- **A nameless Store cannot have its declaration upgraded.** → Reported as a
  limitation with the repair, not silently written. The user runs `rasen store
  upgrade-identity` once the Store has a name.
- **A degraded apply may be mistaken for success.** → The report still ends in
  one of E1's three named states. A degraded apply names what is still missing
  (absent Stores whose obtain is E3) and does not claim completeness.
- **The `--apply` mode from a Store checkout does nothing the user can see.** →
  It produces E1's read-only Store-first listing, identical to `--check`. E3
  defines Store-first apply. Documented as a deliberate seam (D10), not a hidden
  limitation.
- **`--yes` does not cover obtaining.** → Stated in the help text, the docs, and
  the spec. E2 does not obtain; the project-first `--yes` covers registration and
  declaration upgrade only.

## Migration Plan

1. **Type change.** `BootstrapRepair` gains `mutates`; every construction site is
   updated; `isMutatingRepair` reads the field; `BOOTSTRAP_MUTATING_COMMANDS` is
   removed. Lint and the existing test suite confirm the change is total.
2. **Apply path.** The state machine (D5) lands as an extension of
   `buildBootstrapReport` gated on a new `apply` mode, consuming E1's report
   shape and producing the post-acting facts.
3. **Registration.** `registerProject` for the current checkout;
   `registerExistingStore` for each present-unregistered Store; consent handling
   for the interactive and `--yes` paths.
4. **Knowledge location.** `resolveProjectKnowledgeHome` + `mkdir recursive`;
   `already_hydrated` in the report.
5. **Durable declarations.** `writeDurablePointer` at the narrow trigger;
   nameless-Store limitation reported.
6. **Idempotence.** The rerun assertions; drift reported not corrected.
7. **Command surface.** `--apply` and `--yes`; messages module extended; docs and
   locales.

Rollback: reverting removes the apply mode and the `mutates` field. The
registrations and declarations bootstrap writes are the same registrations and
declarations the existing commands already write and already understand, so
nothing E2 produces becomes unreadable.

## Open Questions

- Whether `--apply` should also be reachable as the bare invocation (E designed
  it that way). Resolved for now as a deliberate non-action (D10): keeping the
  bare invocation as "report modes" avoids modifying E1's requirement 2 scenario
  and keeps each mode explicitly named. E3 may revisit when it claims the Store-
  first bare invocation.
- Whether bootstrap should offer to write a membership hint when a Store records
  the project but the project does not declare it. Unchanged from E's open
  question — it is child B's write path and belongs to whichever change owns that
  decision. E2 reports the drift; it does not write the hint.
