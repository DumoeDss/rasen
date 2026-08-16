# Dogfood receipt 2 — the real transition: plan published, child 1 in-flight from live run-state

Run from the issue-layer worktree (cwd = the execution root whose .rasen/changes/ holds the
live portfolio run-state), CLI = worktree-local bin/rasen.js 0.2.0.

```
$ node bin/rasen.js store issue plan issue-layer-phase1 --store issue-layer-dogfood --from-file <plan-nodes.yaml>
```

Output:
```
Issue issue-layer-phase1: Execution Plan revision 0001
  supersedes: (none)
  nodes: 3
```

(Plan names the three committed Change instances in the dogfood store; the issue record and
plan revision were then committed in the store repo — commit 0d33b4f.)

```
$ node bin/rasen.js store issue list --store issue-layer-dogfood
```

Output:
```
issue-layer-phase1  [open]  active/healthy 0/3  Issue layer phase 1: status projection, execution binding, acceptance close

Run-state visible at: E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code\.claude\worktrees\issue-layer
```

```
$ node bin/rasen.js store issue show issue-layer-phase1 --store issue-layer-dogfood
```

Output:
```
Issue issue-layer-phase1
  state: open
  title: Issue layer phase 1: status projection, execution binding, acceptance close
  revisions: 0001
  latest plan: revision 0001
  plan digest: 739fb996492c905c7f105fa2898c0a975c2646fe4de8e613079a6aded5bbc887
  status:
    phase: active
    health: healthy
    progress: 0/3
    run-state: E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code\.claude\worktrees\issue-layer
    nodes:
      g-001 change issue-status-projection — in-flight
      g-002 change issue-execution-binding — not-started (blockedBy g-001)
      g-003 change issue-acceptance-close — not-started (blockedBy g-001, g-002)
```

```
$ node bin/rasen.js store issue show issue-layer-phase1 --store issue-layer-dogfood --json
```

Output (status object only, abridged for the node runStatePath fields — full JSON in this receipt's raw run):
```
{
  "issue": {
    "issueId": "issue-layer-phase1",
    "record": {
      "version": 1,
      "id": "issue-layer-phase1",
      "title": "Issue layer phase 1: status projection, execution binding, acceptance close",
      "state": "open",
      "reason": null,
      "createdAt": "2026-08-16T20:21:22.149Z"
    },
    "diagnostic": null,
    "divergence": null,
    "revisionIds": [
      "0001"
    ],
    "latestRevisionId": "0001",
    "refs": [
      "refs/heads/master"
    ],
    "uncommitted": false
  },
  "plan": {
    "issueId": "issue-layer-phase1",
    "revisionId": "0001",
    "revision": {
      "version": 1,
      "issueId": "issue-layer-phase1",
      "revisionId": "0001",
      "supersedes": null,
      "createdAt": "2026-08-16T20:21:39.041Z",
      "contentSha256": "739fb996492c905c7f105fa2898c0a975c2646fe4de8e613079a6aded5bbc887",
      "nodes": [
        {
          "nodeId": "g-001",
          "kind": "change",
          "projectId": "e2ee72ed-04a1-4395-86aa-7e77d2b83ec7",
          "targetLineId": "line-issue-layer",
          "changeInstanceId": "ci_64e8e65a918fc1854afba004b79f2b61b4b82d07a33b06db5ad6554968bf9ac4",
          "changeAlias": "issue-status-projection",
          "dependsOn": []
        },
        {
          "nodeId": "g-002",
          "kind": "change",
          "projectId": "e2ee72ed-04a1-4395-86aa-7e77d2b83ec7",
          "targetLineId": "line-issue-layer",
          "changeInstanceId": "ci_66d07de3bb7dcab51e63534db9a951304569251a577ea3565e470ba182101b62",
          "changeAlias": "issue-execution-binding",
          "dependsOn": [
            "g-001"
          ]
        },
        {
          "nodeId": "g-003",
          "kind": "change",
          "projectId": "e2ee72ed-04a1-4395-86aa-7e77d2b83ec7",
          "targetLineId": "line-issue-layer",
          "changeInstanceId": "ci_4e708025cf105a92471538793ded5f06f4961b70490fda0ad11b795f96f4ec0b",
          "changeAlias": "issue-acceptance-close",
          "dependsOn": [
            "g-001",
            "g-002"
          ]
        }
      ]
    },
    "diagnostic": null,
    "readiness": {
      "nodes": [
        {
          "node": {
            "nodeId": "g-001",
            "kind": "change",
            "projectId": "e2ee72ed-04a1-4395-86aa-7e77d2b83ec7",
            "targetLineId": "line-issue-layer",
            "changeInstanceId": "ci_64e8e65a918fc1854afba004b79f2b61b4b82d07a33b06db5ad6554968bf9ac4",
            "changeAlias": "issue-status-projection",
            "dependsOn": []
          },
```
{
  "phase": "active",
  "health": "healthy",
  "progress": {
    "completed": 0,
    "total": 3
  },
  "nodes": [
    {
      "nodeId": "g-001",
      "kind": "change",
      "alias": "issue-status-projection",
      "observation": "in-flight",
      "blockedBy": [],
      "diagnostic": null,
      "runStatePath": "E:\\AI\\ChatAI\\Agents\\VibeCodingProjects\\workflow\\Reference\\OpenSpec-code\\.claude\\worktrees\\issue-layer\\.rasen\\changes\\issue-status-projection\\ephemera\\auto-run.json"
    },
    {
      "nodeId": "g-002",
      "kind": "change",
      "alias": "issue-execution-binding",
      "observation": "not-started",
      "blockedBy": [
        "g-001"
      ],
      "diagnostic": null,
      "runStatePath": "E:\\AI\\ChatAI\\Agents\\VibeCodingProjects\\workflow\\Reference\\OpenSpec-code\\.claude\\worktrees\\issue-layer\\.rasen\\changes\\issue-execution-binding\\ephemera\\auto-run.json"
    },
    {
      "nodeId": "g-003",
      "kind": "change",
      "alias": "issue-acceptance-close",
      "observation": "not-started",
      "blockedBy": [
        "g-001",
        "g-002"
      ],
      "diagnostic": null,
      "runStatePath": "E:\\AI\\ChatAI\\Agents\\VibeCodingProjects\\workflow\\Reference\\OpenSpec-code\\.claude\\worktrees\\issue-layer\\.rasen\\changes\\issue-acceptance-close\\ephemera\\auto-run.json"
    }
  ],
  "problems": [],
  "runStateVisibility": {
    "kind": "execution-root",
    "executionRoot": "E:\\AI\\ChatAI\\Agents\\VibeCodingProjects\\workflow\\Reference\\OpenSpec-code\\.claude\\worktrees\\issue-layer"
  },
  "complete": true
}
