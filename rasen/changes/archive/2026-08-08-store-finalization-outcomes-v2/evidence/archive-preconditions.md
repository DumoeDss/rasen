# Archive-ordering preconditions — recorded for the shipper (tasks 14.1–14.5)

These are **notes and checks**, not actions. The archive step itself was not run
by any implementer; every item below is either a check that was executed and its
result recorded, or an instruction the shipper must carry out at archive time.

## 14.1 — `store-layout-v2-migration` must archive FIRST

**Checked, and the dependency is confirmed.** This change's
`specs/store-planning-scope-routing/spec.md` carries one MODIFIED requirement:

> Layout and planning binding states fail closed with a read-only legacy layout

That title does **not** exist in today's `rasen/specs/store-planning-scope-routing/spec.md`.
It is ADDed by the unshipped sibling `store-layout-v2-migration`, which retires
the older `Layout and planning binding states fail closed` via REMOVED + ADDED.

Consequence: archiving this change before that one fails with
`archive_spec_update_failed`, and the failure names only that one requirement.
**Archive order is load-bearing:** children must archive in DAG order
(3 → 4 → 5).

## 14.2 — Pairwise MODIFIED title / scenario comparison

Run before the archive step. The detector used here walks every `## MODIFIED
Requirements` block in this change's `specs/`, matches each `### Requirement:`
title against the then-current `rasen/specs/<capability>/spec.md` byte for byte,
and additionally reports any scenario the canonical spec still contains that the
MODIFIED block omits (scenario drift, which `validate` does not catch either).

Result at the time of writing (with siblings still unshipped):

| Capability | MODIFIED requirement | Status |
| --- | --- | --- |
| `cli-archive` | Archive Process | OK — title matches, no scenario drift |
| `cli-archive` | Spec Update Process | OK |
| `cli-archive` | Archive command always lands in the planning root | OK |
| `management-http-api` | Loopback and bearer security across the CLI-backed mutation surface | OK |
| `store-planning-scope-routing` | Layout and planning binding states fail closed with a read-only legacy layout | INTRODUCED BY SIBLING `store-layout-v2-migration` — see 14.1 |

**Re-run this immediately before archiving**, because the canonical baseline at
that moment is today's `rasen/specs/` PLUS every earlier sibling's applied
delta. The comparison must be done in full, not one requirement at a time: the
archive engine surfaces only the first failing requirement per attempt.

## 14.3 — Purpose for the two new capabilities

This change ADDs two capabilities that have no canonical spec yet:

- `change-finalization-outcomes` (7 ADDED requirements)
- `change-finalization-transaction` (8 ADDED requirements)

Archiving a NEW capability writes a placeholder Purpose
(`TBD - created by archiving change …`), which fails
`test/specs/source-specs-normalization.test.ts`. After the archive, author a
real `## Purpose` for both from their requirement sets, then confirm:

```
grep -rl "TBD - created by archiving" rasen/specs/
```

returns nothing.

## 14.4 — Trailing blank line at EOF

The archive engine leaves a trailing blank line at EOF in every spec file it
merges, and CI's `git diff --check` rejects it. Trim it from every merged spec
file before committing, then confirm `git diff --check` is clean.

**`git diff --check` alone is NOT sufficient for this change, and the recorded
"clean" result said nothing about it.** `git diff --check` inspects the
working-tree diff of *tracked* files. Every file this change adds is untracked
(`??` in `git status --porcelain`) — `src/core/archive-accounting-v2.ts`,
`src/core/management-api/finalize.ts`, all twelve
`src/core/store/finalization/*.ts`, and seventeen new `test/**` files — so the
gate examined **none of them**. It also skips binary files entirely, and a file
containing a NUL byte is classified binary, which is how three literal NUL
bytes in `src/core/store/finalization/successor.ts` survived every check until
a byte-level sweep found them.

Before committing, run BOTH:

```
git add -A -n                      # confirm the file list, then
git add -A && git diff --cached --check
npx vitest run test/source-byte-hygiene.test.ts
```

The second is the byte gate this change added: it reads bytes rather than text
and fails on any NUL, BOM, or U+FFFD under `src/` or `test/` outside an
enumerated, staleness-checked exception list. Its exception list currently
carries files belonging to children 3 and 6; when those are repaired the list
must shrink, and the suite fails if a stale entry is left behind.

## 14.5 — `store-scoped-issues-management` (child 6): BOTH ITEMS ARE ALREADY DONE

**Do not act on this section as it was originally written. Nothing here is
outstanding.** It previously instructed the shipper to make two corrections in
child 6; an independent review re-derived both and found them already satisfied
in the tree. Recorded so the instruction is not followed twice:

- The claim that child 6's `tasks.md` "still contains task 11.6, asserting that
  archiving still reports `store_v2_finalization_unavailable`" is **false**.
  `rasen/changes/store-scoped-issues-management/tasks.md:129` already reads
  *"now that `store-finalization-outcomes-v2` has landed and
  `store_v2_finalization_unavailable` no longer exists"*. A repository-wide grep
  for that code finds zero hits in children 6 and 7 and zero in `src/`.
- The claim that child 6's `management-http-api` delta "has to be refreshed
  after this change archives, or its own archive will be refused for scenario
  drift" is **false**. Applied in DAG order (3 → 4 → 5 → 6 → 7) through
  production's own `findSpecUpdates` + `buildUpdatedSpec`, child 6's delta
  applies cleanly and its MODIFIED body is already a strict superset of this
  change's — it carries the finalize path in both the served-endpoint and
  mutating-endpoint lists. Leaving it untouched is correct.

**The real hazard for this shared requirement is the opposite one, and it is
silent.** `findMissingCurrentScenarios` (`src/core/specs-apply.ts`) compares
scenario **names only**. A later sibling that reproduces the same scenario names
with a STALE body is accepted without complaint and overwrites the earlier
sibling's body — a silent revert, never an `archive_spec_update_failed`. So the
thing to check before archiving child 6 is not whether its scenario names still
match, but whether its MODIFIED body still contains the change-finalization
endpoint in both endpoint lists. Names matching proves nothing.

For reference, this change AMENDS the `management-http-api` requirement
**"Loopback and bearer security across the CLI-backed mutation surface"**: it
adds the Store change-finalization path
(`POST /api/v1/stores/:storeUid/projects/:projectId/lines/:targetLineId/changes/:instance/finalize`)
to both the served-endpoint list and the mutating-endpoint list, and adds one
new requirement, "The change-finalization endpoint requires a complete scope and
one explicit outcome". That is the body child 6's delta must not lose.
