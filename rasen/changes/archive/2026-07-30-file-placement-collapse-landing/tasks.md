# Tasks — file-placement-collapse-landing

Ordering keeps the repo green between groups: resolvers land consumer-free first; every landing rewire lands in the same group as its sticky-legacy read path so no reader ever misses a file. Tasks marked **[prompt-text]** change agent-facing template text and require the golden-master parity suite plus `skills/experts/docs/AGENTS.md` consistency; task 4.1 additionally touches the three CLI locale files.

## 1. Per-class pure resolvers

- [x] 1.1 Create `src/core/file-placement.ts` with pure resolvers `evidenceDir(changeRoot)`, `handoffDir(changeRoot)`, `ephemeraDir(executionRoot, changeName)`, `probesFallbackDir(executionRoot, changeName, probeName)`, `designDocsDir(planningRoot)` (design D1: no config branch, no I/O, platform `path.join`), with unit tests covering Windows and POSIX shapes
- [x] 1.2 Add read-only workspace-identity derivation (semantic project name + short hash of the canonicalized worktree path, design D5) exposed in `rasen context --json`; tests assert two worktrees of one project derive distinct identities and no `workspaces/` directory is ever created

## 2. Run-state lands in the execution root (the collision fix)

- [x] 2.1 Extend `resolveRunStateLocation` (`src/core/pipeline-registry/run-state.ts`) to the three-location chain — ephemera dir → legacy machine-home workDir → change dir — with tests per location and a never-split-one-file assertion
- [x] 2.2 `src/commands/workflow/new-change.ts`: initialize `--pipeline` run-state at `ephemeraDir` (drop the `ensure: true` machine-home mint); add the worktree-collision regression test — the same change name created with `--pipeline` in two worktrees of one project succeeds in both (inverts the reproduced defect in planning-context.md)
- [x] 2.3 Thread the chain through `rasen pipeline resume` (`runStateDir` reporting), the management API `GET /api/v1/runs`, and session supervision's run-state join; tests for each reader finding new-location and legacy-location state

## 3. Payloads and workDir demotion

- [x] 3.1 `status`/`instructions`/apply-instructions payloads: add always-present `evidenceDir`/`handoffDir`/`ephemeraDir`; flip `instructions.ts:171/493` from `ensure: true` to probe-only; `workDir` stays probe-only when machine identity exists; tests for the unregistered-project payload shape (no mint, no writes)
- [x] 3.2 `src/core/archive.ts` ship-log/verification evidence reads resolve `evidenceDir` first, then the legacy work directory, then the change directory; tests that archive still recognizes both new-location and legacy evidence

## 4. Config collapse (BREAKING: destination axis retired)

- [x] 4.1 `src/core/project-config.ts`: parsing `archive.destination: external|prune` emits a localized deprecation warning (new `warnConfig` key) while still exposing the value for legacy discovery — add the message to `src/locales/en.json`, `zh-cn.json`, and `ja.json` (locale consistency across all three)
- [x] 4.2 `src/core/change-work.ts`: collapse `resolveArchiveDestination` to unconditional in-repo (narrow `ArchiveDestination` usage), add a `legacyExternalArchiveDir` read-only probe; remove `src/core/archive.ts` `external`/`prune` write branches including the prune tombstone (`:728-744`) and the `:780` ensure; keep union-read enumeration and already-archived detection covering the legacy machine-home archive and `Pruned:` ship-log records; tests
- [x] 4.3 Remove the `archive.destination` entry from `src/core/config-keys.ts` (`config set` rejects it — test); `src/commands/store-migration.ts` relocate: reject `--to external` (and keep rejecting `--to prune`) with retirement guidance, stop writing any destination config on `--to in-repo|store`; tests
- [x] 4.4 Status payload `archive` block: `archiveDir` always the in-repo location, add read-only `legacyArchiveDir` when machine-home archives exist, drop the `destination` field; update payload consumers and tests
- [x] 4.5 Retire `store adopt --archive external` the same way 4.3 retired `relocate --to external`: `ArchiveMode` narrows to `move|leave`, the external branch (machine-home relocation + `archive.destination` write) is deleted, and the flag is rejected with retirement guidance in both the ops and command layers; add the `store-adopt` spec delta this needs; tests

## 5. Template rewiring — evidence [prompt-text]

- [x] 5.1 `_shared.ts` DISPATCH_CONTRACT (`:63`) and the six expert echo sites (`cso.ts:327`, `design-review.ts:210`, `qa.ts:267`, `qa-only.ts:59`, `benchmark.ts:211`, `review.ts:144`): dispatched reports land in the payload's `evidenceDir` with the sticky-legacy fallback; also drop the remaining `~/.rasen/projects/` standalone-path references per the expert-dispatch-contract delta
- [x] 5.2 `ship.ts` (ship-log landing + pre-flight evidence chain), `verify-change.ts` (verification-report landing), verify-enhanced and retro templates (evidence-first reads with legacy fallbacks)
- [x] 5.3 `archive-change.ts` / `bulk-archive-change.ts` skill templates: evidence-first ship-log/verification reads; bookkeeping always in-repo (remove destination branching per the opsx-archive-skill delta)

## 6. Template rewiring — handoff, orchestration, goal [prompt-text]

- [x] 6.1 `handoff.ts`: handoff documents, numbering scan, and `relay-prompt.txt` land in the payload's `handoffDir` with the sticky-legacy series rule (a change whose handoff series lives at a legacy location continues there)
- [x] 6.2 `_orchestration.ts`: Step F blackboard rewritten to the per-class locations (review material under `changeRoot`; reports under `evidenceDir`; run-state under `ephemeraDir`; sticky-legacy chain stated once), Step G `portfolio-run.json` at `ephemeraDir` + the semantic-child-naming rule (scheduling ids only in run-state metadata), Step L goal-record location, Step H/H.2/H.3 handoff paths → `handoffDir`
- [x] 6.3 Sweep the remaining workflow templates (`sync-specs.ts`, `help.ts`, goal templates) for `workDir` landing claims and re-target them to the per-class payload fields

## 7. Design-docs and machine-root writes [prompt-text]

- [x] 7.1 Rewrite `PROJECT_DOCS_DIR_RESOLUTION` (`_shared.ts:214-218`): primary = CLI-reported planning root + `/rasen/design-docs`; fallback = git-toplevel-relative, never cwd-relative; verify all five consumer skills (office-hours, design-consultation, design-review, qa, qa-only) pick up the shared constant and their `$DOCS_DIR` usages still cohere
- [x] 7.2 Delete the office-hours analytics append (`_shared.ts:1642-1643`, `mkdir -p ~/.rasen/analytics` + `spec-review.jsonl`) — design D8
- [x] 7.3 Re-target the propose/explore bulky-research guidance to the ephemera `research/` area
- [x] 7.4 Add the probe-placement guidance the `file-placement` probes requirement specifies — a shared `PROBE_PLACEMENT_GUIDANCE` constant (project convention first: `experiments/` / `prototypes/` / `tools/` / `fixtures/` / module-adjacent; fixed fallback `<executionRoot>/.rasen/probes/<change>/<probe>/`; no external option) carried by the skills that authorize writing probe code (`prototype.ts`, `investigate.ts`); tests tie the guidance to `probesFallbackDir`'s path shape
- [x] 7.5 Stop `rasen work migrate` sweeping `<changeRoot>/handoff/` — it is the terminal handoff landing, and one run would reverse this change for that change and pin its future handoff documents to the machine home via the sticky-legacy series rule; report the directory instead of moving it, keep the rest of the legacy sweep intact for child B, and add the `work-migration` delta

## 8. Verification and closure

- [x] 8.1 Regenerate/update the golden-master template parity hashes once after all template edits; run the `skills/experts/docs/AGENTS.md` consistency check
- [x] 8.2 Full test suite + build green (`pnpm build` before trusting `runCLI`-style tests — stale-`dist/` hazard); on touched historical-CRLF files restore per-line endings so diffs stay minimal (stage advice for the LEAD: `git -c core.autocrlf=false add`)
- [x] 8.3 Stale-claim sweep by claim, not by token: grep generated templates, specs, and docs for surviving claims that reports/run-state/handoff land in the machine-home work directory or that `archive.destination` selects behavior; fold fixes into the owning task's files
- [x] 8.4 Archive dry-run rehearsal: `rasen archive file-placement-collapse-landing --json --yes` in dry-run form to prove the delta-to-main-spec merge applies cleanly (validate does not apply deltas), and confirm `grep -rl "TBD - created by archiving" rasen/specs/` gains no new hits
- [x] 8.5 Update the header's implementation-gap list in `docs/zh/file-placement-and-planning-roots.md` to reflect the gaps child A closed (factual maintenance only, Chinese only, no design edits)
