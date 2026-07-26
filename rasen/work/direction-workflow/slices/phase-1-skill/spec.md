# Phase 1 Skill Slice

## User-visible Outcome

A user can explicitly select or invoke `rasen-direction` and receive one
coherent governance workflow for Establish, Calibrate, Select, Project, and
Reconcile. A user without Direction artifacts experiences no new prerequisite
or interruption.

## Why Validate Now

Rasen already has long-lived workstream documents, but their authority chain,
slice selection, and reconciliation behavior are maintained manually. A
prompt-and-Git workflow is the smallest product capable of testing whether
those recurring decisions can be made more consistently before introducing a
new CLI model.

## Observable Acceptance

- Built-in identity `direction` generates `rasen-direction/SKILL.md` for full
  and explicit custom selection, but remains outside core.
- The installed skill contains the five actions, experimental artifact layout,
  one-active-Slice rule, source-of-truth boundaries, `target-state.md` versus
  `rasen-goal` distinction, legacy `goal.md` read compatibility, confirmation
  boundaries, Project handoffs, evidence-backed Result states, stale-state
  checks, terminal workstream states, North Star byte protection, and exactly
  one next action.
- Help and navigator route explicit long-horizon needs without changing the
  ordinary main line.
- Ordinary init/update create no Direction artifacts; propose/auto/goal acquire
  no Direction prerequisite or implicit handoff.
- Focused tests, build, lint, and repository tests pass; independent review and
  delivery evidence are recorded when they actually occur.

## Exclusions

No first-class Direction CLI/parser, stable schema, database, UI, automatic
large-task routing, automatic North Star mutation, or application
implementation by Direction.

## Alignment

This Slice directly establishes the Target State's minimum usable governance
surface. There is no separate North Star for this workstream.

## Result Vocabulary

`passed | partial | failed | superseded | cancelled`
