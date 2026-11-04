# Dogfood receipt 3 — verify-time re-read: the projection tracks the live run through a real stage transition

Captured 2026-08-17 during the VERIFY stage of `issue-status-projection` (child g-001), from the
issue-layer worktree (the execution root), CLI = worktree-local `node bin/rasen.js` (0.2.0), same
dogfood store `issue-layer-dogfood` as receipts 1–2.

## The real transition (underlying evidence, before → after)

Child g-001's live run-state — `<worktree>/.rasen/changes/issue-status-projection/ephemera/auto-run.json`:

```
receipt 2 (apply stage):   {"propose":"done","apply":"in_progress","verify":"pending","review-loop":"pending","ship":"pending","archive":"pending"}
receipt 3 (verify stage):  {"propose":"done","apply":"done","verify":"in_progress","review-loop":"pending","ship":"pending","archive":"pending"}
```

The stage frontier moved from `apply` to `verify` — a real LEAD-recorded transition of the live
portfolio, not a fixture edit.

## Commands and outputs

```
$ node bin/rasen.js store issue show issue-layer-phase1 --store issue-layer-dogfood
```

```
Issue issue-layer-phase1
  state: open
  title: Issue layer phase 1: status projection, execution binding, acceptance close
  revisions: 0001
  latest plan: revision 0001
  plan digest: 739fb996492c905c7f105fa2898c0a975c2646fe4de8e61329a0 (full digest below)
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

(Full plan digest as printed: `739fb996492c905c7f105fa2898c0a975c2646fe4de8e613079a6aded5bbc887`.)

```
$ node bin/rasen.js store issue list --store issue-layer-dogfood
```

```
issue-layer-phase1  [open]  active/healthy 0/3  Issue layer phase 1: status projection, execution binding, acceptance close

Run-state visible at: E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code\.claude\worktrees\issue-layer
```

```
$ node bin/rasen.js store issue show issue-layer-phase1 --store issue-layer-dogfood --json   (status object)
```

```json
{
  "phase": "active",
  "health": "healthy",
  "progress": { "completed": 0, "total": 3 },
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
    { "nodeId": "g-002", "kind": "change", "alias": "issue-execution-binding", "observation": "not-started", "blockedBy": ["g-001"], "diagnostic": null, "runStatePath": "E:\\AI\\...\\.rasen\\changes\\issue-execution-binding\\ephemera\\auto-run.json" },
    { "nodeId": "g-003", "kind": "change", "alias": "issue-acceptance-close", "observation": "not-started", "blockedBy": ["g-001", "g-002"], "diagnostic": null, "runStatePath": "E:\\AI\\...\\.rasen\\changes\\issue-acceptance-close\\ephemera\\auto-run.json" }
  ],
  "problems": [],
  "runStateVisibility": { "kind": "execution-root", "executionRoot": "E:\\AI\\ChatAI\\Agents\\VibeCodingProjects\\workflow\\Reference\\OpenSpec-code\\.claude\\worktrees\\issue-layer" },
  "complete": true
}
```

## Reading the receipt honestly

The Issue-level axes are INVARIANT across this transition — and that is the correct projection, not
a miss: the Issue's position did not change (one child still mid-pipeline, none terminal, none
escalated), so `active/healthy 0/3` is the same true answer it was during apply. What changed is
WHERE the child is inside its run (`apply: in_progress` → `apply: done, verify: in_progress`),
which the projection surfaces through the node's `runStatePath` pointing at the very file whose
bytes moved, and through the observation staying `in-flight` because "any stage in_progress" is
the honest coarse reading of both states. Per the spec: the status changes only when the
underlying evidence does — the evidence changed (stage frontier moved), the derived facts that
depend on it (`in-flight`, via the new in_progress stage `verify`) were re-derived, and the facts
that do not depend on it stayed put. A within-child stage move that does not cross a node-level
boundary (terminal / escalated / all-children-complete) is BY DESIGN invisible at the Issue axis
level; the boundary crossings that DO move the axes (child terminal → progress; child escalated →
health; all children terminal → review) are covered by the unit table
(`test/core/issue-status/issue-status-projection.test.ts`) and receipts 1–2.

## Correction for the record (task 7.2 command syntax)

Task 7.2's literal command `node bin/rasen.js validate --change issue-status-projection` is
invalid syntax for this CLI (`--change` is not a validate flag). The working form is:

```
$ node bin/rasen.js validate issue-status-projection --json
```

LEAD re-ran it: change 1/1 passed. (The implementer had already used the positional form during
apply: "Change 'issue-status-projection' is valid".)
