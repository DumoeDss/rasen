# Persistent-store dogfood summary (read-only) — `issue-registry`

Store: `issue-registry` (`Reference\rasen-issue-store`), Issue
`issue-multi-change-execution`, revision `0001`. No writes of any kind were
issued; the only commands run are `store issue show` (human + `--json`).

## The revision bytes are untouched by the read

sha256 of `rasen/issues/issue-multi-change-execution/plans/0001.yaml`:

- before (pre-change dist): `477f89625a36a561ed7a5b5c42ca5aba2ae5603d3455321bc599702cdc079d66`
- after (post-change dist):  `477f89625a36a561ed7a5b5c42ca5aba2ae5603d3455321bc599702cdc079d66`

## The axes are the values the same evidence derived before

`phase: done`, `health: healthy`, `progress: 3/3`, acceptance gate/record
lines — diff of the two human receipts over every axis line: empty. The
`--json` receipts compare equal on phase/health/progress/problems and on every
node's observation/lifecycle/blockedBy/alias.

## The node lines now name the target project

Before: `issue-plan-publication change 2026-08-20-issue-plan-publication — run-terminal`
After:  `issue-plan-publication change e2ee72ed-04a1-4395-86aa-7e77d2b83ec7 2026-08-20-issue-plan-publication — run-terminal`

`--json` now carries `projectId`/`targetLineId` per node structurally
(`line-0.2` on all three); the before receipt has neither field.

## Why this is the ground-truth case

This Store records the rasen member (`e2ee72ed-…`) as
`roles: { planning: false, knowledge: true }` — knowledge-only — and this
revision legitimately targets it (published under the pre-gate rules). The
read succeeds, reports the project, and re-checks no membership: a new
PUBLICATION targeting this member would be refused with
`issue_reference_target_not_planning_member` (proven on the temp store),
while this revision reads exactly as it always has.

## g-003 prerequisite (flagged, not executed here)

Before Issue #2's plan publishes on this Store: widen the rasen member to
`roles.planning: true` (re-run `rasen store add-project` — OR-widens roles)
and add the second member project `rasen-site` (`Reference\rasen-site`).
Planner decision recorded in the portfolio planning context and design D7.

## Receipts

- `dogfood-persistent-before-human.txt` / `dogfood-persistent-before-json.json` (pre-change dist)
- `dogfood-persistent-after-human.txt` / `dogfood-persistent-after-json.json` (post-change dist)
- `dogfood-temp/` — the temp-store receipts (both sources, refusals, show)
