# Dogfood receipt 1 — Issue created, no plan yet

Commands (cwd = the issue-layer worktree, CLI = worktree-local bin/rasen.js 0.2.0):
```
$ node bin/rasen.js store issue new issue-layer-phase1 --store issue-layer-dogfood --title "Issue layer phase 1: status projection, execution binding, acceptance close"
```

Output:
```
Issue issue-layer-phase1 (open)
  title: Issue layer phase 1: status projection, execution binding, acceptance close
  checkout: C:\Users\Sayo\AppData\Local\Temp\rasen-issue-layer-dogfood\store

  Issue content is Git-tracked Store content. Rasen wrote the file and staged nothing.
    git -C C:\Users\Sayo\AppData\Local\Temp\rasen-issue-layer-dogfood\store add rasen/issues/issue-layer-phase1/issue.yaml
    git -C C:\Users\Sayo\AppData\Local\Temp\rasen-issue-layer-dogfood\store commit -m "chore(store): open issue issue-layer-phase1"
```

```
$ node bin/rasen.js store issue show issue-layer-phase1 --store issue-layer-dogfood
```

Output:
```
Issue issue-layer-phase1
  state: open
  title: Issue layer phase 1: status projection, execution binding, acceptance close
  revisions: (none)
  status:
    phase: planning
    health: healthy
    progress: -/-
    run-state: E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code\.claude\worktrees\issue-layer
```
