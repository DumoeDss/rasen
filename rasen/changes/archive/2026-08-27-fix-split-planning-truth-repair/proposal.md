# Proposal: fix-split-planning-truth-repair

## Why

`split_planning_truth` tells an operator that a Change is blocked and nothing
about how to unblock it. Both throw sites carry `{ target: 'project.planning' }`
and no `fix` field, so the rendered refusal is one sentence — "Store and
project-local planning both exist; Change finalization is blocked." — with no
code path, no offending directory, and no command to run.

This was met for real on 2026-08-27 while running the dogfood pilot of
`fix-store-retention-scope-resolution`: archiving a Change through a verified
workspace pair refused here, *after* scope resolution had already succeeded. The
repair took an investigation of the resolver source to discover, and it was not
guessable from the message. Two things made it hard that the message could have
made easy:

1. The repair is a real command — `rasen store adopt --to <store>` — that the
   message never names. (`rasen store eject` resolves it the other way.)
2. The blocked directory is not necessarily the one the operator is standing in.
   In the pilot, adopting the project's main checkout was not enough: a linked
   execution worktree still sat on an older ref and still carried
   `rasen/changes/`, so the same refusal repeated with no indication that a
   *different* root was now the problem.

Sibling `rehearse-legacy-store-layout-migration` triaged exactly this defect
class as "(b) correct-but-illegible — the refusal is right, but the message does
not name the item, the reason, or a workable repair", and its new
`store-layout-migration` capability requires migration refusals to name a
workable repair. `split_planning_truth` lives in the planning resolver, so no
capability governs it and it was left out of that closure.

## What Changes

- Both `split_planning_truth` refusals gain a `fix` that names the concrete
  repair: adopt the project's local planning into the Store it is bound to, with
  `rasen store eject` named as the way to resolve the split the other way.
- Both refusals name **the directory that actually holds the local planning
  content**, which is the root the resolver tested rather than necessarily the
  cwd. Naming it is what makes the linked-worktree case diagnosable instead of
  looking like the same refusal repeating for no reason.
- `store-scope-resolution` gains a requirement covering this refusal, so the
  contract is recorded where the archive process protects it.

Non-goals: changing when the refusal fires, what `splitTruth` means, or the
adopt/eject flows themselves. The gate is correct and stays fail-closed; only its
legibility changes.

## Capabilities

### Modified Capabilities

- `store-scope-resolution`: gains a requirement that a refusal caused by split
  planning truth names the offending project root and a workable repair.

## Impact

- `src/core/store-planning/internal/resolver.ts` — the two `split_planning_truth`
  throw sites (finalization and creation).
- Tests: guards pinning the repair text and the named root for both intents,
  demonstrated to fail against the current message.
- No behaviour change to any gate: same refusals, same conditions, same codes.
