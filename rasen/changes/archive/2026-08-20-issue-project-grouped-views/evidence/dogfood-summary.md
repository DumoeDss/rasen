# Dogfood summary — Issue #2 on the persistent `issue-registry` store

One Issue, two member projects, driven end to end on the real persistent
Store (uid `f76edc31-…`). All Store mutations are real, durable, committed
store content; the remaining release-and-accept legs are staged in
`staged-close.md`, sequenced at portfolio close.

## Store-side mutations (committed)

| Store commit | Content |
| --- | --- |
| `a7db2fb` | rasen member OR-widened to `planning: true` (composing seam; display id restored to `rasen`), `rasen-site` member added + widened, `line-0.2` projects map extended with the site's `refs/heads/main` |
| `f12d3ea` | `rasen-site` reference recorded (duplicate `project:issue-layer` alias dropped) |
| `dd0c1a7` | the two shipped children seeded as archived committed evidence with identity blocks (seed map in `dogfood-store-4-seed-children.json`) |
| `79cf6e5` | `document-multi-project-issues` authored in the site partition (small-feature propose artifacts + identity; `dogfood-store-5-site-change.json`) |
| `f8f7776` | Issue #2 opened + plan `0001` published (4 nodes, cross-project edge) |

Machine-local (not store content): the terminal run-state mirrors under the
dated claimant aliases (`.rasen/changes/2026-08-20-issue-{target-project-binding,cross-project-gating}/ephemera/`)
— the claimant-alias keying mirror the Phase-2 findings planned for g-003,
same pattern Issue #1's dated children already use.

## The read loop, as receipts

| Receipt | Fact |
| --- | --- |
| `dogfood-issue2-3-show-lanes.txt` | two lanes: `project rasen-site (6ca78b98-…): 0/1`, `project rasen (e2ee72ed-…): 2/2`; node lines unchanged; cross-project blocker named on the site node |
| `dogfood-issue2-4-list-summary.txt` | `active/healthy 2/3 [rasen-site 0/1 · rasen 2/2]`; Issue #1's line shows the single-lane `[rasen 3/3]` |
| `dogfood-issue2-5-show-json.json` | `--json` parity: `status.projects` carries the lane facts beside the untouched `nodes` |
| `dogfood-issue2-6-gating-refusal.json` / `-human.txt` | `start --node document-multi-project-issues` refused (exit 1, both forms): names `issue-project-grouped-views@e2ee72ed-… (not-started, no local run-state)` |
| `dogfood-issue1-degradation-show.txt` / `.json` | Issue #1 reads `done/healthy 3/3`, digest `e9b0cd65…` unchanged from the g-001 receipts, exactly one lane `rasen 3/3` |

## Engine-reality gaps the design's beliefs hit (recorded, resolved without forcing)

1. **A plain `add-project` re-run does NOT OR-widen to planning.** The
   mutation composes `{planning: setPrimary || alreadyPlansHere, knowledge:
   true}` — planning is asserted only when true. The g-001 refusal's fix
   text ("re-adding OR-widens roles") overpromises for a project that
   neither binds the store as its planning home nor should. Widened here via
   `applyMembershipMutation` with explicit roles — the composing-caller seam
   `storeAddProject`'s own comment sanctions (operations.ts:1270).
2. **Store-scoped project authoring requires `planningBinding: bound`**
   (`project_not_in_store` refusal on `new change --project` from the store
   root). Binding requires adoption evidence; recording an adoption that
   never happened would be a lie in durable state. The site change was
   authored by the Phase-2 seeding discipline instead; the PUBLICATION gate
   still verified membership + committed evidence on its real terms.
3. **Legacy v1 archive records carry no outcome**, so seeded archived
   children read run-terminal via run-state, not finalized — work-complete
   basis holding exactly as designed (the query's own comment: nothing is
   inferred to fill a column).

## Findings for Phase 4

1. The refusal fix text for `issue_reference_target_not_planning_member`
   should name the real widen path (explicit-role mutation or `--set-primary`
   when truthful) — the current text sends the operator into a no-op re-run.
2. `store add-project --set-primary` is the only CLI surface that asserts
   planning; a `--planning` role flag (or a `store member set-roles`) would
   close the gap the dogfood had to script.
3. Claimant-alias keying (dated archive name vs change name) is now mirrored
   twice by hand on this store; the real fix is the locator's undated
   fallback or store-side outcome records — the Phase-2 finding stands.
