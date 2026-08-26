# Tasks: rehearse-legacy-store-layout-migration

SAFETY (binds every task): the real store `E:/AI/ChatAI/Agents/VibeCodingProjects/workflow/Reference/rasen-store` is read-only material. No rasen command (including `--status` and previews) may run while the effective registry resolves its id/uid to the real path; every mutating step targets a disposable copy in a temp root under `RASEN_HOME` + `GIT_CONFIG_GLOBAL` redirection, using the real built CLI (`node bin/rasen.js`) after `pnpm build`. Test-run discipline: never pipe a test run through tail/head; long runs go through background execution + bounded foreground polling; real-git tests carry explicit per-test timeouts.

## 1. Isolated disposable-store harness

- [x] 1.1 Build the CLI (`pnpm build`) and record the built stamp; create the temp root (system temp, not the repo, not E: repo tree), `RASEN_HOME=<temp>/rasen-home`, `GIT_CONFIG_GLOBAL=<temp>/gitconfig` with a committed git identity, and a helper script/env wrapper the later steps reuse; verify `node bin/rasen.js store list --json` under redirection shows an EMPTY registry (proves redirection works before any copy exists)
- [x] 1.2 Create the pristine copy: recursive directory copy of the whole real store including `.git` (Windows: `robocopy /E`, exit codes 0-7 = success) into `<temp>/copy-pristine`; verify the copy preserves the uncommitted drift (`git -C <copy> status --porcelain` shows the two modified files; `store.yaml` shows `version: 2` + uid) and that the real store's mtime/content is untouched (`git -C <real> status --porcelain` unchanged from the recorded baseline)
- [x] 1.3 Create the clone variant: `git clone <real> <temp>/copy-clone` (reads the real repo only); verify it carries committed truth (`store.yaml` = `version: 1`, no uid, clean worktree)
- [x] 1.4 Register the pristine copy in the redirected registry (`rasen store register <temp>/copy-pristine`); MANDATORY pre-flight for this and every later stage: `rasen store list --json` under redirection must resolve the id to the COPY's path, never the real path — record the output as evidence step 0 of each stage
- [x] 1.5 Write `evidence/rehearsal/steps.md` scaffolding and the capture convention (numbered `NN-<command-slug>.json`/`.txt` pairs + exit codes per design D6); bulky scrollback goes to the ephemera `research/` dir, never committed

## 2. Run the official flow and capture evidence

- [x] 2.1 Stage 1 (pristine, the real store's actual shape): run `migrate-layout <id>` preview (human + `--json`), `--status`, an `--apply` attempt, a `--retire-flat` attempt, and one partition-write probe that reproduces `legacy_flat_store_requires_migration`; capture every output, exit code, and refusal text under `evidence/rehearsal/01-pristine/` — expected per design: zero items, plan not applicable, the wedge (D5's pre-admitted defect) reproduced verbatim
- [x] 2.2 Stage 2 seed: enrich a fresh copy (commit via redirected identity) with the design-D2 content set: Change with recorded identity, Change with none, archive entry with and without `archive.json`, one spec touched by two archived Changes (shared-spec), one UTF-8 Chinese-named Change and spec, membership records for two projects (one with adoption lists), a second local branch still carrying flat content, one dirty tracked file under a Change; register it
- [x] 2.3 Stage 2 run, part A (refusals): preview and capture the pre-enumerated fail-closed checks (design D3 items 1-3, 6, 7, 9): unknown-owner, evidence-conflict (seed an E2/E3 disagreement), non-member, shared-spec, missing-target-line, dirty-source, otherFlatRefs reporting, and repair-text legibility for each; then author a mapping file that deliberately contradicts a recorded identity and capture the whole-file refusal
- [x] 2.4 Stage 2 run, part B (happy path + recovery surface): author the correct mapping (targetLines + assignments + shared-spec resolution), re-plan, `--apply`, `--status`, capture the recovery manifest (machine-local, runId != planId) and receipt; verify published partitions byte-match sources (UTF-8 names intact), then `--retire-flat`, re-run retirement (idempotence), attempt `--rollback` after retirement (expect the Git-pointing refusal); capture all under `evidence/rehearsal/02-enriched/`
- [x] 2.5 Stage 2 run, part C (staleness): on a re-planned copy, edit one source between plan and apply and capture the `migration_plan_stale` refusal (must list the changed path and state nothing was written)
- [x] 2.6 Stage 3 (clone): register `<temp>/copy-clone`, preview (expect `store-identity-missing` blocks), follow the refusal's own repair (`store upgrade-identity`), re-plan, and record whether the repair chain actually leads out; capture under `evidence/rehearsal/03-clone/`
- [x] 2.7 Teardown check-point: unregister both copies, delete temp roots (EBUSY retry), re-verify the real store is byte-untouched (`git -C <real> status --porcelain` matches the 1.2 baseline; `.rasen-store/store.yaml` mtime/hash unchanged) and the REAL machine registry never changed; record as the final evidence step (keep a temp-root re-creation script since later fix verification re-runs stages)

## 3. Triage what surfaced (criteria fixed in design D4 — do not improvise)

- [x] 3.1 Write `evidence/rehearsal/triage.md`: one row per observation from every stage, classified (a) defect / (b) correct-but-illegible / (c) correct-and-legible / (d) out-of-scope-real (sibling seam or deeper design gap), each with the evidence step it cites; the empty-store dead end enters as the pre-admitted (a); anything implicating `resolver.ts`, `identity.ts`, or `workspace/plan.ts|apply.ts` is (d) with a handover note, never a fix here
- [x] 3.2 Reconcile the spec delta with the triage outcome: add/adjust `specs/store-layout-migration/spec.md` requirements ONLY where the evidence supports a durable contract (keep scenarios testable, 4 hashtags); re-run `rasen validate rehearse-legacy-store-layout-migration` after edits
- [x] 3.3 Confirm the fix list with the LEAD if triage admits more than the empty-store fix plus legibility-message fixes (scope gate, not a blocker for starting task 4 on already-admitted items)

## 4. Fix and guard each admitted defect

- [x] 4.1 Empty-store trivial migration (design D5): make a zero-item, zero-blocker plan applicable — token issued, apply publishes receipt + layout flip with no items, retirement handles the empty retirement set; do NOT weaken the blockers gate (unresolved/blocked items must still refuse exactly as before)
- [x] 4.2 Guard for 4.1, written to fail first: real-git test reproducing today's dead end (empty legacy store -> plan not applicable -> partition write refused) that FAILS against pre-fix code — run it pre-fix and record the red run in evidence — then passes post-fix and asserts a subsequent partition write is accepted; explicit per-test timeout
- [x] 4.3 Registered-store end-to-end guard (design D7 t2, the seam no suite crosses): temp store + redirected registry env -> `store register` -> `migrate-layout` by store id -> mapping -> apply -> retire, through the module's production resolution path; explicit per-test timeouts; prove it runs green alongside heavyweight neighbors (parallel full-suite context), not just solo
- [x] 4.4 Implement each remaining triage-(a)/(b) fix admitted in 3.3, smallest change that keeps every existing fail-closed test green; each with its own guard shown to fail against pre-fix behavior (mutation-anchored: assert on the exact refusal text/landing site, print line numbers on failure)
- [x] 4.5 Update refusal/fix texts made stale by 4.1 (e.g., `layout-write-guard.ts:246` fix text now points at a command that works for the empty case); sweep existing tests that assert those exact messages

## 5. Verify

- [x] 5.1 Re-run the rehearsal stages that exercised fixed paths against the rebuilt CLI (at minimum stage 1 end-to-end: empty store now migrates trivially and accepts a partition write) and capture the post-fix evidence beside the pre-fix runs
- [x] 5.2 Full test suite via background run + bounded foreground polling, no output piping; enumerate the complete failure list (never extrapolate from a truncated tail); compare any failures against the known machine-state baseline cluster before attributing them to this change
- [x] 5.3 `pnpm build` clean; `rasen validate rehearse-legacy-store-layout-migration` passes; confirm no writes exist under sibling-owned files (`git status` + diff scope audit) and no file under the real store changed
- [x] 5.4 Verify the evidence directory is self-contained: every triage row cites an existing step file; pre-fix red-guard run recorded; `steps.md` indexes complete

## 6. Deliver

- [x] 6.1 Write the ship summary into `evidence/rehearsal/triage.md` closing section: SS15 row-by-row honest acceptance statement (which rows now carry real-CLI/registry/host evidence, which remain fixture-only — long-path stays fixture-only per design), the accepted-knowns with reasons, and the (d)-category handovers to siblings A/B
- [x] 6.2 Report to the LEAD: artifacts, fix list actually landed vs deferred, validate + suite results, and the operator-facing note that the real `rasen-store` remains unmigrated by design and the evidence doubles as its migration runbook
