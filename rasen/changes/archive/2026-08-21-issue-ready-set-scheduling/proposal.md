# Proposal — issue-ready-set-scheduling

## Why

Phase 5 (cross-project replanning) needs its deterministic scheduling face: today the
"which nodes may run now" answer exists only piecemeal — `store issue start` computes a
frontier and refuses when several qualify, `confirm` classifies nodes for one revision,
and the projection lists per-node blockers — so the operator has no single honest answer
for "what is runnable, and why is everything else not". Worse, the Phase-4 close of
Issue #3 collided with the legacy-seed gap: work delivered and archived before the v2
outcome records existed reads back `not-started` forever, so the scheduler would wait
eternally on delivered work unless a human hand-mirrors run-state to the archive-done
truth — the mirrors that close needed are the symptom, not the fix.

## What Changes

- A deterministic ready-set for an Issue's latest published revision: the exact set of
  Change nodes the plan still wants (`required`/`optional`) that have not started and
  whose every dependency's observed work is complete on the work-complete basis —
  cross-project dependencies included, releasing on completed work exactly as the P3
  gate defines. Derived on read through the status projection as a post-pass (beside
  lanes and the revision delta), persisted nowhere.
- A read verb `rasen store issue ready <issue-id>` (human and `--json`) reporting the
  ready set and EVERY non-member with a closed reason vocabulary: `cancelled`/`superseded`
  with their recorded reasons (visible, not silently dropped), intent nodes as pending
  Change creation, running/failed observations, blocked nodes with each blocker named
  (node id, target project, observed state), complete nodes, and unknown nodes with
  their diagnostics.
- The start frontier and the confirm classification are composed onto the same
  predicate — the ready set IS start's candidate set (what its several-candidates
  refusal names) and confirm's launchable scope — pinned by equivalence tests so the
  three surfaces cannot drift apart.
- The legacy-seed ruling (Phase-4 handover #1), landed read-side: an archived Change
  whose committed archive entry carries a legacy record basis (no v2 outcome) has its
  work read complete for scheduling — observation `finalized` with the basis named —
  while an archive record that exists in v2 shape but fails validation fails closed as
  `unknown` with a status problem naming the file and reason. Nothing is minted at seed
  time; the four-outcome model's no-inference stance on the outcome column is untouched,
  and delivered-legacy dependencies no longer need run-state mirrors to release
  downstream work.

## Capabilities

### New Capabilities

- `issue-ready-set-scheduling`: the deterministic ready-set — derivation through the
  status projection, the closed exit-reason vocabulary, the `rasen store issue ready`
  read surface, the equivalence with the start frontier and confirm scope, and the
  scheduling-level statement that archived legacy work releases its dependents.

### Modified Capabilities

- `issue-status-projection`: the completion basis over committed evidence widens — a
  Change archived under a legacy record basis (no v2 outcome) counts its work complete
  (observation `finalized`, basis named in the diagnostic), and a v2-shaped archive
  record that fails validation is reported as a status problem with the node `unknown`,
  never guessed complete or fresh. Drives progress, phase, lanes, and blocker facts
  through the same one basis.

## Impact

- `src/core/store/query/` — `readArchiveEntry` records which branch fired (v2 /
  legacy / invalid) and threads the basis through `deriveReadiness` into the plan
  resolution the projection consumes (additive fields; display semantics unchanged).
- `src/core/issue-status/` — the observation ruling in `projection.ts`, a new
  ready-set derivation module and types, and the new `invalid-archive-record` problem
  kind.
- `src/core/issue-execution/` — `binding.ts` frontier and `confirm.ts` classification
  consume the shared ready-set predicate (behavior-preserving for the fresh-launch scope;
  one begun-node seam changes by design — design D2's carve-out: a begun node no longer
  waits on incomplete dependencies, it keeps its per-node resolution).
- `src/commands/store-issue.ts` — the `ready` subcommand with `--json` parity, plus
  the locale (en/ja/zh-cn) and completions sync the command surface owes.
- Tests: equivalence pins (start candidates / confirm scope / ready set), the
  legacy-release replay of the Issue #3 shape on a temp store, corrupt-record
  fail-closed, and the read-only guard extension.
- Fences kept: no UI (`packages/ui/**` untouched), `src/core/pipeline-registry/`
  untouched, no version changes, no new Issue mutations (the five stay five), Issue #4
  dogfood authoring stays g-003's staging point.
