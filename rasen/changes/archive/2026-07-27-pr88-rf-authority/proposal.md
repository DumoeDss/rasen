# Proposal: pr88-rf-authority — Store record is the sole Session-eligibility authority

## Mission (PR #88 review finding M6)

PR #88 introduced a membership seam in `src/core/management-api/session-launch-context.ts`
that grants Store-scoped Session eligibility when **EITHER** of two authorities vouches
for a project:

1. the Store's own membership record (`<store>/.rasen-store/projects/<projectId>.yaml`,
   via `resolveProjectMembership`); OR
2. the project's own durable Store declaration resolving to THIS Store root (via
   `readStorePointer` + `resolveStoreBinding`).

That OR-arm contradicts the locked decisions in
`rasen/explorations/global-store-project-unification-development-plan.md` §33:

- **#7** — planning binding vs membership are separated concepts.
- **#8** — Store membership authority lives in the projectId-sharded
  `projects/<projectId>.yaml` records.
- **#9** — the Project-side membership list is **LOCATOR-only**.

It also contradicts `rasen/specs/store-project-membership/spec.md` (the "single
authority" clause) and creates a state where a fresh clone that has not yet been
recorded by the Store can nonetheless drive a Store-scoped session against the
Store — exactly the silent grant the authority separation was designed to prevent.

This change closes that seam: **the Store record is the sole Session-eligibility
authority**. The Project-side declaration remains a locator and may surface the
diagnostic / repair path, but it cannot itself vouch for the project at session
launch.

## Resolution (LOCKED — no new design here)

Per the locked decisions and the C5 brief:

- `storePermitsProject` loses its declaration arm. Eligibility is decided by
  `resolveProjectMembership` alone.
- A declaration that resolves to THIS Store but lacks a Store record is the
  legacy "declaration-only install" shape. It MUST NOT silently break — the
  rejection MUST name the missing record AND call out that the project's own
  declaration used to be sufficient, with the copy-pasteable repair command
  (`rasen store add-project <projectId> --store <storeId>`).
- A declaration that is absent, malformed, or resolves to a DIFFERENT Store
  falls back to the standard "missing membership" diagnostic with the same
  repair command.
- Both specs are reconciled to ONE answer: the session-runtime-context spec
  stops saying the declaration grants eligibility; the store-project-membership
  spec reaffirms that the Store record is the sole authority and adds an
  explicit "declaration alone does not establish eligibility" scenario so the
  rule is auditable from one place.

## Eligibility rule (before / after)

### BEFORE (`session-launch-context.ts:93-108`)

```
storePermitsProject(space, checkoutRoot, projectId):
  membership = resolveProjectMembership(space, projectId)  // arm 1
  if membership: return true
  pointer = readStorePointer(checkoutRoot)                 // arm 2
  if hasStoreDeclaration(pointer):
    binding = resolveStoreBinding(declaration)
    if binding.resolved and rootsEqual(binding.store.root, space.root):
      return true
  return false
```

Caller at line 276-283 emits `code: 'execution_not_member'` with a generic
`rasen store add-project` repair when both arms fail.

### AFTER

```
storePermitsProject(space, checkoutRoot, projectId):
  membership = resolveProjectMembership(space, projectId)  // sole authority
  if membership: return true
  return false
```

The caller distinguishes the rejection reason so the diagnostic is actionable
rather than opaque:

- It re-runs the declaration resolution that the old arm used to do, but ONLY
  to **classify** the failure for the diagnostic — never to re-grant.
- When the declaration resolves to THIS Store and only the Store record is
  missing, the rejection carries a legacy-migration marker (e.g.,
  `legacy_declaration_only`) and the message names both the missing record and
  the fact that the declaration used to be sufficient, with the repair command.
- When the declaration is absent, malformed, or names another Store, the
  rejection carries the plain `execution_not_member` code with the same repair
  command and a one-line "the project's own declaration does not name this
  Store" clarification.

The declaration-resolution helpers (`readStorePointer`,
`hasStoreDeclaration`, `storeBindingDeclarationFrom`, `resolveStoreBinding`,
`rootsEqual`) all remain in the file — they are now used purely for diagnostic
classification. No new helper is introduced.

## Legacy migration

There is no automatic re-grant and no automatic rewrite of the project
declaration. The migration path is:

1. The user runs `rasen store add-project <projectId> --store <storeId>`.
2. That writes the Store's per-project authority record (the existing
   `applyMembershipMutation` flow already does this atomically and writes the
   locator hint in the defined order).
3. Subsequent session launches succeed via the Store-record arm.

This change only ensures that step 1 is **surfaced** — the diagnostic tells the
user exactly which command to run and why — and that the previous silent
acceptance stops. It does not introduce a new "auto-migrate on launch" path;
that would re-create the silent-grant problem under a different name.

Existing `rasen doctor` already reports "missing Store record for the planning
Store" as an error per the spec (store-project-membership, "Membership
diagnostics are read-only and name the repair"); the legacy-migration marker
on the launch-time rejection is consistent with that diagnostic shape.

## Spec reconciliation

### `session-runtime-context` (MODIFIED)

Requirement: **"Choosing a project to work on in a Store session is validated
before the session starts"** (canonical, verbatim title from
`rasen/specs/session-runtime-context/spec.md:211`).

Body changes:

- The "either authority" clause is removed.
- The Store's own membership record is the SOLE authority for the vouch.
- The Project's own durable Store declaration is named explicitly as a
  LOCATOR that does not vouch.
- The rejection when only the declaration names this Store MUST carry the
  legacy-migration marker and the `rasen store add-project` repair command,
  not a silent grant and not an opaque crash.

Scenario changes:

- The existing scenario "A project the Store records only by its own
  declaration is a valid choice" is **removed** (it directly contradicts the
  new rule).
- A new scenario "A project whose own declaration names this Store but no
  Store record exists is rejected with a repair command" replaces it.
- The existing scenario "A project the Store does not have as a member is
  rejected" is sharpened so the "neither the Store's membership record nor
  the chosen project's own declaration names this Store" wording becomes
  "the Store's membership record does not name this project" — the
  declaration is no longer an authority that can be lacked.

### `store-project-membership` (MODIFIED)

Requirement: **"A Store records each member project in its own file, keyed by
project identity"** (canonical, verbatim title from
`rasen/specs/store-project-membership/spec.md:8`).

This requirement's body already declares the record "the single authority for
whether a project belongs to the Store". The MODIFIED delta sharpens that
clause so it cannot be read as silent on the session-eligibility question:

- Adds: "No other source — including the project's own durable Store
  declaration — SHALL confer membership or grant Store-scoped Session
  eligibility. A project whose declaration names a Store but for which no
  Store record exists SHALL be rejected from Store-scoped sessions with a
  diagnostic that names the missing record and the copy-pasteable repair
  command (`rasen store add-project`)."
- Adds a scenario "A declaration alone does not establish Session eligibility"
  so the rule is auditable from this spec without having to chase the
  session-runtime-context cross-reference.

The OTHER requirements in this spec are not touched. In particular, the
existing "A project's eligible Stores include those declared and those
recorded, and an unavailable Store is not an empty one" requirement (about
the project → store discovery direction) is unchanged: a hint-only Store
remains *discovered*, but it never grants this Store the right to launch a
session against the project — those are two different questions.

## Scope

| Surface | File | Change |
|---|---|---|
| Code | `src/core/management-api/session-launch-context.ts` | Remove declaration arm in `storePermitsProject`; classify rejection reason in caller for diagnostic. |
| Tests | `test/core/management-api/session-launch-context.test.ts` | Flip the two OR-arm tests to rejection-shape; add legacy-migration-marker test; add both-sides-present happy-path test. |
| Spec | `rasen/specs/session-runtime-context/spec.md` | MODIFIED requirement "Choosing a project to work on in a Store session is validated before the session starts". |
| Spec | `rasen/specs/store-project-membership/spec.md` | MODIFIED requirement "A Store records each member project in its own file, keyed by project identity". |

Strictly M6. No C1/C2/C3/C4 files touched.

## Collision check vs C2 (pr88-rf-locks)

C2's committed delta at `rasen/changes/pr88-rf-locks/specs/store-project-membership/spec.md`
MODIFIED exactly two requirement titles in `store-project-membership`:

1. "Adding membership writes each repository in a defined order and reports what still needs repair"
2. "A project carries portable locator hints for the Stores it belongs to"

C5 MODIFIES a DIFFERENT title in the same capability — "A Store records each
member project in its own file, keyed by project identity" — plus a
requirement in a different capability (`session-runtime-context`). No title
overlap. Archive-time sync will merge cleanly because the two deltas touch
disjoint requirement titles within `store-project-membership`.

## Backward compatibility

Honest answer: this IS a breaking change for declaration-only installs. The
mitigation is:

1. The rejection is **diagnostic**, not silent — the user sees the exact
   repair command.
2. The repair command (`rasen store add-project`) is the existing,
   spec-defined mutation flow; no new surface.
3. `rasen doctor` already reports the same condition (missing Store record
   for the planning Store); users running doctor on their setup before
   launching sessions will see it there too.
4. No data is destroyed: the project's declaration is left intact and the
   Store record is added alongside it; removing the declaration is not
   required for the session to start.

The alternative — keeping the OR-arm "for backward compatibility" — would
preserve the silent grant indefinitely and make the authority separation
unenforceable, which is the defect M6 calls out.
