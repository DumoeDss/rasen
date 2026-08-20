# 2.2 — This repository registered as `issue-registry`'s member project

Command (cwd = worktree; the MAIN checkout addressed by absolute path, never
the worktree — Phase-1 lesson 6):

```
node bin/rasen.js store add-project E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code --to issue-registry --as rasen --json
```

Full JSON payload: `2-2-add-project.json` (exit 0, `status: []`,
`repair_needed: []`). The three-step chain (path exists as repo → healthy
rasen root → no residue) passed with no hand-holding — the point of the
v2-native store: no flat scaffold ever existed to retire.

## Store side (committed on the store's `main`)

- Membership authority record (v2 catalog, schema follows the declared
  layout): `.rasen-store/projects/e2ee72ed-04a1-4395-86aa-7e77d2b83ec7.yaml`
  — roles `planning: false, knowledge: true`, `planningBinding: unbound`
  (membership ≠ binding; no `--set-primary`).
- Store config `references: [project:rasen]` appended.
- Commit `4b2908d` "chore: record rasen as a member", pathspec-scoped
  (`rasen/config.yaml` + the catalog). The diff's 19 deletions are the
  config template's optional comment scaffold dropped by the append
  rewrite, not content loss; committed bytes verified LF-only.

## Main-checkout side (persists; operator coordinates the commit — flagged)

The tooling wrote two things into the MAIN checkout, both expected and left
in place (this change does not commit anything there):

1. `rasen/config.yaml` — one hint block appended (the LEAD-dispositioned
   one-line-class write; it is 3 lines of YAML: the `storeMemberships` list
   with `uid: f76edc31-229a-42bc-a5c7-848021eeb2da`,
   `id: issue-registry`).
2. `.rasen-store/store.yaml` — the project's permanent identity record
   (`version: 1`, `id: rasen`), minted by the registration half of
   add-project (`metadata_created: true`).

Both are durable machine state for a persistent membership; teardown is NOT
planned (D1/Migration). Planning resolution is unchanged — the hint makes
the store a resolution candidate and binds no planning
(`planning_binding.requested: false`).

## Identities (for future sessions)

| identity | value |
| --- | --- |
| Member projectId | `e2ee72ed-04a1-4395-86aa-7e77d2b83ec7` (pre-existing in the checkout's config; the record keys by it) |
| Member display id | `rasen` (the `--as` alias; `version: 1` identity file) |
| Store uid | `f76edc31-229a-42bc-a5c7-848021eeb2da` |
