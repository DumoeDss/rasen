# Design: externalize-artifacts-archive-timing

## Context

Decision 1 of the design of record (`rasen/office-hours/externalize-openspec-artifacts.md`): archive decomposes into spec sync + directory bookkeeping, and timing becomes a config axis (`on-merge` default | `in-ship`), both values automating a documented upstream convention. Verified current state this design builds on:

- **Archive is entirely skill-driven in this fork** — there is NO `src/commands/archive.ts`; `archive-change.ts` (template) fetches status JSON, runs gates (tasks hard gate, verify verdict hard gate, ship-log soft check — the latter two already workDir-aware from child 2), optionally dispatches `rasen-sync-specs`, then `mv`s the change dir. The decomposition the design doc wants already exists structurally (sync = separate skill, bookkeeping = the move step); this child adds the timing brain, not a new archive engine.
- **Ship** (`ship.ts`, current post-child-2 text): resolves delivery mode `pr`/`push`/`local`, commits, merges base (pr), evidence-gated tests, delivers, writes `ship-log.md` to workDir (child 2), post-ship suggests `/rasen:archive`. Ship-log records `Mode`, `PR` URL, and the local-mode "delivery deferred to portfolio level" marker — everything the merge check and the chain decision need.
- **Config**: `rasen/config.yaml`, resilient field-by-field parsing in `src/core/project-config.ts` (child 1 precedent: `projectId`); `status --json` is the established template-facing exposure surface (child 2 precedent: `workDir`, probe-only, additive field).
- **Run-state is external** (child 2): a change staying ACTIVE while its PR is under review costs nothing — resume/status/loop all read workDir.
- Constraints from the LEAD: continuous polling is OUT (no daemon in the CLI process model); pnpm is broken machine-wide — use `node build.js` + `npx vitest run`.

## Goals / Non-Goals

**Goals:**
- One config axis controlling WHEN sync + bookkeeping run; `on-merge` default matching upstream's recommended convention.
- `pr` mode on-merge: zero drift window, change active during review, no archived-but-never-delivered states.
- `in-ship`: one-step ship for small-team/solo-trunk regimes, synced specs + archived dir riding the same delivery.
- Merge confirmation without polling, with honest degradation when `gh`/network is unavailable.

**Non-Goals:**
- Archive destination axis (child 4) — but the `archive:` config block is shaped so child 4 only adds a field.
- SHA cross-stamping (child 5); PR-body delta embedding (child 5).
- A CLI archive command, CLI-side `gh`/git calls, background watchers, or webhooks.
- `bulk-archive` timing awareness (rare path; recorded follow-up).
- Changing WHAT sync or bookkeeping do (only WHEN).

## Decisions

### D1. Config shape: nested `archive.timing` in `rasen/config.yaml`

```yaml
archive:
  timing: on-merge   # on-merge (default) | in-ship
```

Parsed resiliently in `project-config.ts`: `archive` must be a map (else warn + drop whole block); `timing` must be exactly `on-merge` or `in-ship` (else warn + drop field). `ProjectConfig` gains `archive?: { timing?: 'on-merge' | 'in-ship' }` plus a tiny resolver `resolveArchiveTiming(config | null) → 'on-merge' | 'in-ship'` applying the default — so every consumer resolves identically and child 4's `destination` slots into the same block. *Why nested rather than the design doc's `archive: on-merge` scalar shorthand:* the doc itself defines TWO archive axes (timing + destination); a scalar would force a breaking reshape in child 4. The doc's notation is shorthand, not schema.

### D2. Exposure: resolved timing rides status JSON; the CLI never touches gh/git

`rasen status --change <n> --json` gains `archive: { timing: <resolved> }` — always present (the default always resolves), additive, beside child 2's `workDir`. Ship and archive templates read it from the payload they already fetch; no template parses YAML. The merge check itself is AGENT-side (the skill instructs running `gh pr view`), preserving the CLI's no-git contract (upstream iron rule; rasen crosses the git line only in skill prose, and this design keeps it there).

### D3. Q1 decided: merge confirmation = check-on-invocation, agent-side, no polling

Mechanism (on-merge + `pr`-delivered change; delivery facts come from the workDir ship-log):

1. Any archive attempt — explicit `/rasen:archive`, the pipeline's archive stage, or a resume re-entering that stage — extracts the PR URL from `ship-log.md` and runs `gh pr view <url> --json state,mergedAt`.
2. `MERGED` → proceed (sync + bookkeeping). `OPEN` → refuse by default with "PR not merged yet"; proceed only on an explicit override naming the unmerged condition; refuse outright non-interactively. `CLOSED` without merge → refuse and surface it (a rejected PR must not silently become an archived change).
3. Degradation: `gh` missing, unauthenticated, or network failure → the skill states it cannot verify and asks the human to confirm the merge explicitly (the confirmation replaces the check); in a non-interactive/dispatched context it refuses outright with the reason, leaving the stage resumable.
4. Orchestrated runs (playbook): the LEAD dispatches archive; on an unmerged refusal it records the archive stage as `pending` with an awaiting-merge note in run-state and ends the run cleanly with the open frontier — `pipeline resume` naturally re-attempts on its next invocation. This IS the "check-on-next-command" half, realized at the agent layer where `gh` already lives.

*Rejected:* CLI-side checks on every command (network latency on every `rasen list`; breaks the no-git contract; the CLI can't interact when the check fails); polling/daemons (out by constraint); webhook/CI triggers (infrastructure this tool cannot assume).

*Trigger surface note:* `local`/`push` deliveries have no merge event — on-merge archive chains immediately after ship (ship's post-ship step says so; in pipelines the archive stage simply runs next, as today).

### D4. `in-ship` ordering: sync + move happen BEFORE ship's commit

In-ship must put synced specs and the archived change directory INSIDE the delivery. Ship's step order gains a conditional step between the test-gate/pre-commit region and the commit: when timing = `in-ship`, (1) extract what later steps need from the change dir first — PR body sections from `proposal.md`, tasks completion — since the dir is about to move; (2) run spec sync (the `rasen-sync-specs` step); (3) perform bookkeeping (the same `mv` the archive skill does, to `<changesDir>/archive/YYYY-MM-DD-<name>`); (4) commit everything together; then deliver per mode. Ship-log (workDir, unaffected by the move — child 2 synergy) records `Archived in ship: <path>`. The pipeline's archive stage then records "archived in ship" and does nothing. Accepted documented tradeoff: the PR carries specs diff + change-folder move noise (upstream's small-team variant).

*Why before the commit rather than after delivery:* after-delivery sync would need a second commit/push — that is just on-merge-for-local with extra steps and defeats in-ship's one-delivery point.

### D5. The archive skill becomes timing-aware but keeps one pipeline

New early step in `archive-change.ts` (both getters): resolve `archive.timing` from status JSON and branch:
- `in-ship` + ship-log shows archived-in-ship → report "already archived at <path>", stop cleanly (idempotent).
- `on-merge` + ship-log shows PR created → run the D3 merge-confirmation gate before the existing gates.
- `on-merge` + ship-log shows push/local delivery, or no ship-log → existing behavior unchanged (the current soft warnings already cover no-delivery; timing adds no gate where there is no delivery event to confirm).
Sync and bookkeeping remain the same two steps in the same order for every timing — the axis only decides when the skill may reach them.

### D6. Orchestration: archive stage resolves per timing, pending-merge is a first-class stage state note

`_orchestration.ts` gains one compact rule at the stage-interpretation level: for the archive stage, `in-ship` → record done/skipped with reason "archived in ship"; `on-merge` + pr-delivered → dispatch archive, and on an unmerged refusal record the stage `pending` with an awaiting-merge note (PR URL) in run-state, then end the run cleanly surfacing it; `on-merge` + local/push → run immediately. No new run-state schema fields — the note lives in the stage record's existing free-form fields, and `pending` is already a stage status.

## Risks / Trade-offs

- [Ship-log lacks a PR URL (hand-written or pre-child-2 log)] → merge gate degrades exactly like gh-absent: ask the human / refuse non-interactively; never guess a PR from the branch.
- [`gh pr view` output shape drift] → the skill pins the fields queried (`state`, `mergedAt`) and treats parse failure as "cannot verify" (degradation path), never as merged.
- [in-ship moves the change dir mid-ship; later steps read from it] → D4 orders extraction first; the archived path is recorded and used for PR-body reading if needed; spec'd as behavior ("review material remains available to later ship steps").
- [Concurrent session dirties ship.ts/_orchestration.ts again] → same discipline: `git status --porcelain` per file before edit and before commit; pathspec commits; wait/escalate on foreign dirt.
- [Users with existing muscle memory: archive right after ship in pr mode] → that is exactly the drift on-merge closes; the refusal message names the PR and the override; `in-ship` exists for those who want one-step.
- [Timing resolved at archive time may differ from ship time if config edited mid-flight] → facts recorded in ship-log (mode, archived-in-ship marker) always win over re-resolved config; timing config is only consulted for the NEXT decision, never to reinterpret a recorded delivery.

## Migration Plan

Additive and default-preserving: absent config resolves to `on-merge`, which for `local`/`push` (this repo's own mode) behaves exactly like today (archive right after ship), and for `pr` adds only the merge gate — no existing state changes shape, no migration. Rollback = revert commits; an `archive:` block left in config.yaml is dropped with a warning by older parsers (resilient policy) — harmless.

## Open Questions

None blocking. Q1 is decided (D3). Recorded follow-ups: `bulk-archive` timing awareness; a future `rasen archive` CLI command is explicitly NOT introduced here (child 4 may revisit if destination `external` needs CLI help).
