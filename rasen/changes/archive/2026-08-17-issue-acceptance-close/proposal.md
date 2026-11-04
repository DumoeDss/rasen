# Proposal: issue-acceptance-close

## Why

The golden path's last gap: an Issue's `done` today follows a bare operator state flip —
`resolved` alone derives `done` (C1's interim rule), and nothing records WHAT was accepted or
verifies that the work being accepted actually finished. The direction is explicit on both
halves: "所有 Change archived" must not auto-derive Done, and Issue completion belongs to
explicit acceptance (goal.md §7; roadmap Phase 6 seeds). What is missing is acceptance as Issue
content, an explicit accept/close action that refuses honestly while the work is not actually
done, and the Done rule rewired to follow the recorded acceptance instead of the state flip.

## What Changes

- **Acceptance conditions become Issue content**: `rasen store issue acceptance <issue-id>
  --from-file` publishes an acceptance-conditions revision — an immutable, ordinally addressed,
  digest-carrying checklist (condition id + requirement + optional verification note) under the
  Issue's own directory, using the same revision discipline Execution Plans already follow.
- **An explicit accept/close action**: `rasen store issue accept <issue-id> [--note]` evaluates
  the acceptance gate and, only when it holds, writes the durable acceptance record and closes
  the Issue. The gate is derived from the tri-axis status: every required node's work complete
  (the observation rule C2 fixed), health not failed, and no open status problem — and each
  refusal NAMES what is not accepted yet (un-terminal nodes with their observations, failing
  nodes, open problems). A dropped Issue is not acceptable; an already-accepted Issue is refused
  re-acceptance; an Issue without conditions or without a plan is refused toward the missing
  step.
- **The acceptance record is durable close evidence**: one record per Issue (the state lifecycle
  admits at most one acceptance), freezing the conditions revision it accepted (id + digest),
  the gate snapshot (progress counts, health, zero problems), an optional note, and its own
  content digest. Like every Issue write it prints a pathspec-scoped commit suggestion and
  stages nothing.
- **Done follows explicit acceptance**: `done` requires the recorded acceptance beside the
  resolved state — never an archived count, never a bare state flip. A resolved Issue with no
  acceptance record (a pre-capability close) reads `review` — awaiting acceptance — and can
  still run `accept` to record its acceptance without a state transition; that is the whole
  compatibility story, alongside unchanged Issue-record bytes.
- **The gate is visible before it is crossed**: `rasen store issue show` gains an acceptance
  section (latest conditions, the gate evaluation with named blockers, the acceptance record
  when present), in both human and `--json` forms.
- Dogfood: rebuild the dogfood store per the trap list, author real acceptance conditions for
  this portfolio, prove the gate HOLDS while a required node is un-terminal (the live g-003
  run), then close a second plan revision whose nodes are the archived children — gate passes,
  acceptance records, `done` reads back. Receipts under `evidence/`.

## Capabilities

### New Capabilities

- `issue-acceptance-close`: The Issue-level acceptance gate — acceptance conditions as versioned
  Issue content, the explicit accept/close action with named refusals, the durable acceptance
  record, and the Done-follows-acceptance contract.

### Modified Capabilities

- `issue-status-projection`: the phase requirement's `done` clause is replaced (recorded
  acceptance beside resolved state; a resolved-without-acceptance Issue reads `review`), and the
  derivation-inputs requirement names the Issue's recorded acceptance as a fourth input.
- `store-issue-resources`: the mutation vocabulary grows from three operations to five
  (publishing acceptance conditions; recording an acceptance) — requirement renamed and
  modified accordingly.
- `store-planning-layout-v2`: the Store-level Issue address family gains the acceptance
  conditions directory, one conditions revision file, and the acceptance record — each its own
  address.

## Impact

- `src/core/store/issues/`: new `acceptance.ts` (conditions-revision + acceptance-record
  schemas, digests, serializers — mirroring `plans.ts`/`records.ts` discipline), scope addresses
  for the new content, two new module mutations (`publishAcceptance`, `accept`) under the
  existing issue lock and commit-suggestion discipline.
- New `src/core/issue-acceptance/` (gate evaluation + accept orchestration — the C2
  composition pattern; keeps `store/issues` free of any upward dependency); `src/core/issue-status/`
  extended in place (acceptance input, done rule, acceptance block in `IssueStatus`).
- `src/commands/store-issue.ts`: `acceptance` and `accept` subcommands, `show` acceptance
  section; three-way surface sync (commander tree + en/ja/zh-cn locales + completions
  `COMMAND_REGISTRY`); CLI tests run `dist/`, so the build is part of the loop.
- Tests: acceptance-content and mutation units, gate derivation units (incl. the failed-health
  hold over real-shaped run-state fixtures), CLI parity/refusal suites, C1 done-rule tests
  updated to the new contract.
- `architecture-index` skill: new module + subcommands.
- No web UI, no management-api routes, no version bumps; `src/core/pipeline-registry/` and
  `packages/ui/**` untouched.
