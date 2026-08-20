# 5.1 — Durability statement + follow-up notes

## The persistent store (D6)

| fact | value |
| --- | --- |
| What | The machine's first persistent Issue registry |
| Store id | `issue-registry` |
| Permanent uid | `f76edc31-229a-42bc-a5c7-848021eeb2da` |
| Durable path | `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\rasen-issue-store` (outside every Git repository, outside temp space — never torn down) |
| Layout | v2 native (declared at creation by this change's own `--layout 2`; no flat tree ever existed) |
| Machine registry | `C:\Users\Sayo\.rasen\stores\registry.yaml`, entry `{id: issue-registry, uid, type: store}` |
| Git history (branch `main`) | `39847ce` bootstrap · `4b2908d` membership · `4964916` target line line-0.2 · `9d1452d` seeded children · `b38b3f5` issue + plan 0001 · conditions 0001 commit — all pathspec-scoped, one concern each |
| Member | this repository (`rasen`, projectId `e2ee72ed-04a1-4395-86aa-7e77d2b83ec7`), membership ≠ planning binding |
| Target line | `line-0.2` — storeRef `refs/heads/main`, codeRef `refs/heads/dev/0.2.0` |
| Issue #1 | `issue-multi-change-execution` — open, plan 0001, conditions 0001, gate holding at 2/3 pending g-003 |

## How future sessions address it

From anywhere on this machine (the machine registry resolves the id):

```
node bin/rasen.js store issue show issue-multi-change-execution --store issue-registry --json
node bin/rasen.js store issue list --store issue-registry --json
node bin/rasen.js store doctor issue-registry --json
```

Live per-child run-state observation needs the execution root — run from the
worktree while the loop lives there (designed behavior, demonstrated in
`4-2-tri-axis-gate-holds.json`); from anywhere else the projection still
derives phase/progress from committed evidence. Reviewer-measured (round 1):
out-of-worktree reads show `ready` / `0/3` / every node `not-started` with
`runStateVisibility: none` for these legacy-record claimants until the store
records carry outcomes — that reading is the designed g-002 semantics, NOT a
regression of the loop captured in 4-2. The repo's `rasen/config.yaml`
membership hint (`storeMemberships: [{uid, id}]`) makes the store a resolution
candidate for this project's store-scoped commands. New store content commits
pathspec-scoped on `main` (Rasen never stages anything itself).

## Backup follow-up (the operator's)

Local durable path + own Git history + machine registry is durable for THIS
machine. A remote (`git -C <store> remote add origin <url>` + push) is the
operator's follow-up when cross-machine durability is wanted; the store's
history is clean single-concern commits, so a remote can be added at any time
with no history surgery.

## Follow-up notes (observed, not blocking)

1. **Seeding has no product surface.** The bootstrap seeding (identity minting
   + archive mirroring + run-state keying) is operator tooling under this
   change's ephemera `research/` using shipped helpers. A repeatable
   `store seed`-shaped surface is a Phase 3 candidate, not a gap in this
   change (non-goal by design).
2. **The stray `rasen-store` remains registered.** The v1-layout empty shell
   beside the repo (single "Initialize" commit, no members) is untouched
   evidence the no-flag default still creates legacy stores; retiring it
   (`rasen store remove rasen-store --yes` after operator review) is the
   operator's call, recorded here as the retirement candidate the proposal
   named.
3. **Historical run-states predate today's strict RunState schema.** The real
   g-001/g-002 `auto-run.json` carry `openFindings` as bare strings, which
   today's strict parse refuses whole-file (projection: `invalid-run-state`
   → `unknown` + problem). `src/core/pipeline-registry/` is frozen this
   portfolio, so the mirror normalized losslessly (string → `{summary}`);
   whether the schema should tolerate the historical string form is a Phase 3
   decision, recorded here so it is not rediscovered.
