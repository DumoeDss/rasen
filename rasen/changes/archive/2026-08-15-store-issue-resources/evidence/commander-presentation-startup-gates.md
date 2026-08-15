# `commander-presentation.ts`'s startup gates hard-crash the CLI, not a test

## The finding

`src/cli/commander-presentation.ts` runs two structural checks at CLI
startup — before any command dispatches — and **throws** if either fails:

1. **Registry-tree agreement**: the live Commander program tree (every
   registered command and its flags) must structurally match
   `command-registry.ts`'s declared shape. A command or flag registered on
   one side and missing from the other is a startup failure.
2. **English locale completeness**: every registered command and flag must
   have English locale copy (help text / descriptions). A registered surface
   with no English copy is also a startup failure.

Both are enforced via `applyCliPresentation`'s localization overlay, which
this child's CLI additions (`store issue`, `store changes`, `store
projects`) pass through.

## Why this matters more than a failing test

**The failure mode is a dead binary, not a red test.** If a new command or
flag is registered in `src/commands/` / `command-registry.ts` without a
matching locale entry, or if the registry and the live Commander tree
diverge, the CLI does not fail one test — it fails to start *at all*, for
every command, for every user. Nothing in `tsc --noEmit` or an isolated unit
test for the new command would catch this; it only fires when the whole CLI
boots, which is what running `node bin/rasen.js --help` (or any command)
against the built program tree exercises.

## Consequence for this child, and for whoever adds a command surface next

This child's new CLI surface (`store issue new/list/show/plan/state`, `store
changes`, `store projects`) was verified against both gates by the ordinary
act of running the CLI and its own tests, which would have failed loudly
(startup crash, not a quiet miss) had either gate been unsatisfied — they
were not exercised as a separate task, because the gates make omission
impossible to miss rather than possible to miss quietly.

**Anything that registers a new command or flag in this repo must satisfy
both gates or the binary does not start.** This is the transferable part:
before assuming a new command surface is "done" because its own tests pass,
confirm the CLI still boots (`node bin/rasen.js --help`) — a locale gap or a
registry/tree mismatch will not show up any other way.
