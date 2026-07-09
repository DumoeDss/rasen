# Review Report: externalize-artifacts-t3-workdir

**VERDICT: FINDINGS — 0 Blocker, 1 Major, 2 Minor, 1 Trivial**

- Reviewer: dispatched non-author reviewer (rasen-review, dispatched report-only mode)
- Scope: uncommitted working-tree diff (31 modified + 2 new files; foreign `rasen/` untracked ephemera ignored)
- Date: 2026-07-09
- Context: proposal.md, design.md (D1–D8), tasks.md, 13 delta specs; known green: 123 files / 2245 tests / 0 failed; live smoke (fresh-workDir + sticky-legacy) passed
- Report location: change directory per the LEAD's explicit instruction for this run (the pipeline reads it here)

## Scope Check

- Intent: T3 process ephemera move to the external per-change work directory; CLI exposes `workDir`/`machineHome`/`runStateDir`; ~20 templates consume the CLI-reported path with sticky-legacy fallback.
- Delivered: matches. Every dirty file in the tree belongs to this change's declared file list. No scope creep found; `working-set.ts` and `workflow/shared.ts` are the natural type-carrier edits for the new fields.
- Scope: **CLEAN**

## Findings

### F1 — Major — Probe-path errors are NOT swallowed; a corrupt project registry bricks every change-scoped command

`src/core/change-work.ts:55` — the `ensure:false` probe (`resolveProjectHome(projectRoot, probeOptions)`) is called outside any try/catch; only the second, `ensure:true` call (line 64–72) is wrapped. `resolveProjectHome`'s probe calls `readProjectRegistryState`, which **throws** on malformed or schema-invalid registry JSON (`src/core/project-registry.ts:104` and `:109` — `invalidProjectRegistryError`). `src/commands/context.ts:58` has the same exposure via its direct unwrapped `resolveProjectHome(root.path, { ensure: false })`.

Concrete failure scenario: `registry.json` under the global data dir becomes malformed (hand edit, disk fault, interrupted write outside `writeFileAtomically`). From that moment `rasen status --change <n>`, `rasen instructions <artifact>`, apply-instructions, `rasen pipeline resume`, and `rasen context` ALL throw — commands that before this change never touched the registry. There is no self-heal path (`touchProjectRegistry` swallows, so it never repairs it; recovery requires manually deleting the registry file), so this is a persistent machine-wide brick of the workflow CLI.

This contradicts the module's own documented contract (change-work.ts:41–43: "T3 work-dir placement is an enhancement, never a requirement for a workflow command to succeed — same 'never break a user command' contract as `touchProjectRegistry`") and makes the docstring line "The `ensure:true` path swallows any error" misleading (the probe inside the ensure flow still propagates). It also strains the change-work-dir delta spec's degradation intent ("Read-only surfaces never mutate" / graceful-degradation requirement), which presumes a probe miss degrades to an absent field rather than a command failure.

Recommended fix: wrap the entire body of `resolveChangeWorkDir` (both probe and ensure) in try/catch → `null`, and guard the `context.ts` probe the same way. One-line-class fix, testable with a deliberately corrupted registry file.

### F2 — Minor — goal-report.ts gives the report-tail worker no way to locate `goal-run.json`; tasks.md 4.4 claims it was updated but the file is untouched

`src/core/templates/workflows/goal-report.ts:21` ("`goal-run.json` (authoritative)") and `:37` ("Read `goal-run.json` as the source of truth") name the loop spine with no location and no `workDir` guidance, and this template does NOT embed the orchestration playbook (no `ORCHESTRATION_PLAYBOOK` import), so the dispatched shipper worker has nothing telling it the spine now lives in the work directory. For a new-style change (spine in workDir), a shipper that looks in the change directory finds nothing.

Mitigations that keep this Minor: the LEAD's dispatch prompt can carry the path; the template's honesty constraints make the failure loud (the worker should refuse to guess), not silently wrong; goal-loop-research is a niche pipeline. `goal-command.ts` being unmodified is defensible — it embeds the playbook whose Step F/L now defines the locations, and its own references are location-agnostic.

Conformance note: tasks.md task 4.4 is checked `[x]` claiming "`goal-command.ts`, `goal-iterate.ts`, `goal-report.ts`: `goal-run.json` / run artifact and implementer-handoff paths reference the resolved work dir" — for `goal-report.ts` that claim is false (file has zero diff). Fix: add one clause to goal-report's Input section ("in the change's work directory — `workDir` from `rasen status --change <n> --json`; change-directory fallback") and correct or annotate the task claim.

### F3 — Minor — Location resolution is existence-based, not validity-based: a corrupt workDir copy shadows a valid legacy file

`src/core/pipeline-registry/run-state.ts:232–249` (`resolveRunStateLocation`) and `portfolio-state.ts:121–137` (`resolvePortfolioStateLocation`) pick the workDir candidate on `fs.existsSync` alone. `readRunState`/`readPortfolioState` then return `null` on unparseable content. Consequence in `src/commands/pipeline.ts:313–314` and `:375–377`: when BOTH locations hold a file and the workDir copy is corrupt JSON, resume reports "no run-state" (or a corrupt portfolio file silently falls through to the single-change run-state branch) even though a valid change-directory copy exists — pre-change behavior would have read the valid legacy file.

Reaching this state requires a writer that already violated the sticky-legacy write rule (compliant agents never create the second copy), and design D4 explicitly accepts deterministic workDir-first read order for the both-exist case — so this is recorded as accepted-known friction, not a gate. If ever hardened: fall through to the next candidate when the chosen file fails to parse.

### F4 — Trivial — `sessionHandoff.path` / `handoffs[].path` stay location-relative while the document and run-state can now live in different directories

`src/core/templates/workflows/handoff.ts:29` records `"path": "handoff/lead-<n>.md"` and `_orchestration.ts:159,163` shows the same relative shape. In a half-migrated change (run-state sticky in the change dir, new handoff doc born in workDir) the pointer's base directory is ambiguous; nothing states that relative run-state paths resolve per the workDir-first read rule. The Step F fallback rule plausibly covers it if the successor applies it to the pointer, and the resume ladder degrades to transcript/cold reconstruction rather than losing data. Consider one clarifying clause where the run-state shape is defined: "relative paths in run-state resolve workDir-first, change-dir fallback."

## Dispatch focus areas — verdicts

1. **D2 mutation boundary — CLEAN.** Exhaustive caller audit: `resolveChangeWorkDir` has exactly four call sites — `status.ts:114` (`ensure:false`), `pipeline.ts:308` resume (`ensure:false`), `instructions.ts:162` and `:484` (`ensure:true`, the two designated minting surfaces). `context.ts:58` probes `resolveProjectHome` directly with `ensure:false`. `generateApplyInstructions` (the ensure:true library path) is reachable only from `applyInstructionsCommand` (`cli/index.ts:582`). `list`/`show`/`validate` never import the resolver. The probe itself performs zero writes (`readProjectConfig` read, `canonicalizeExistingPath` never-throws resolve, `readProjectRegistryState` read) and never `mkdir`s (`workDir()` is a pure path join, `buildProjectHome` creates nothing). No probe-only surface can mint. Verified by test: "status --json omits workDir for an unregistered project, with zero writes".

2. **Sticky-legacy correctness — CLEAN (one edge in F3).** Precedence is deterministic: workDir wins when both exist (existence check ordered workDir → changeDir), covered by the "prefers the work-dir copy" and "falls back to legacy" tests plus the portfolio matrix. A half-migrated change does NOT lose run-state: legacy `auto-run.json` stays sticky (writers per templates never create the workDir copy while the legacy file exists), resume reads it via fallback and reports `runStateDir` = change dir, and the LEAD is instructed to write further updates to `runStateDir` rather than re-deriving `workDir` (Step F). End-to-end trace of resume (`pipeline.ts:298–380`) holds for portfolio and single-change shapes; `runStateLocation!` non-null assertion at `:453` is guarded by the `!runState` early return. The only wrong-read window is F3's corrupt-workDir-copy shadowing, which requires a prior sticky-rule violation.

3. **Error-swallow blast radius — the real risk is the opposite (F1).** The swallow on the ensure path cannot strand ephemera in an unregistered workDir: `resolveProjectHome(ensure:true)` registers the project BEFORE returning a home (`project-home.ts:102–105`), and the probe requires BOTH a config `projectId` AND a live registry entry (`:86–99`), so a non-null `workDir` implies a registered home in every code path. If minting fails (e.g. registry lock timeout in `registerProject`), the helper returns null, `workDir` is absent, agents fall back to the change directory — degraded but safe, and the next ensure call retries the mint. GC cross-check: `gcProjectRegistry` (`project-registry.ts:405–445`) only evaluates TOP-LEVEL directory names under `<globalDataDir>/projects/` against registered homes; work dirs are nested inside homes and can never be orphan candidates while the entry lives — the "GC deletes an unregistered workDir" scenario is impossible by construction. The genuine gap is F1: the probe path swallows nothing at all.

4. **Template prose coherence — CLEAN.** Spot-checked _orchestration (Step F two-location blackboard + rule stated once; Step G.7 portfolio-run; H.2/H.3/H.7 handoff paths; Step B expert-report sentence), ship, verify-change (both sites), verify-enhanced, review-cycle, archive-change (both sites), retro, handoff, auto, goal-iterate, explore, propose, and all six expert dispatched-mode lines. Every consumer says HOW to obtain `workDir` (from `rasen status --change <n> --json`, the instructions payloads, or the dispatch prompt — expert PREAMBLE `_shared.ts:62` names both channels). Expert canonical report paths (workDir-first, change-dir fallback) match exactly what ship's pre-flight reads (`ship.ts:38`) and what archive's gates read. Ship's evidence-based test gate (`ship.ts:89`) names the same report files whose location the pre-flight rule already resolves. Bare `goal-run.json` references in goal-command defer to the embedded playbook; goal-report is the one gap (F2). Regeneration (D8) confirmed live: `.claude/skills/**` is gitignored, regenerated, and carries the new wording (this reviewer's own dispatched preamble included it).

5. **Spec conformance — CLEAN (13/13).** All four change-work-dir requirements implemented (external-from-birth, CLI-reports-agents-never-derive, sticky-legacy, research demotion in propose/explore); cli-artifact-workflow (absent-not-null field semantics verified in code — conditional spread, never null/empty); opsx-pipeline-registry (`runStateDir` in both JSON shapes, legacy scenario, no writes on resume); opsx-orchestration (two-location blackboard, absolute paths from status JSON); workflow-handoff-command (numbering scans the single resolved location — matches the template's implication); session-relay (relay-prompt.txt in resolved handoff dir; quiesce digest path updated); expert-dispatch-contract (PREAMBLE + all six per-skill lines; Step B verifies-report-present retained); opsx-ship / verify-ship-evidence / opsx-verify-enhanced / opsx-retro / opsx-archive-skill all match their template edits; goal-loop-workflow's write side matches (the read-side gap is F2, whose spec scenario — successor readability — is about relay, not the report tail). `rasen validate externalize-artifacts-t3-workdir` passes.

6. **Windows path handling — CLEAN.** `workDir`/`machineHome`/`runStateDir` are produced by `FileSystemUtils.joinPath`/`path.join` and emitted through `JSON.stringify`, which escapes backslashes correctly; human output prints them raw (fine). Templates treat the value as an opaque absolute string (same contract as `changeRoot` today, design risk row). Tests build expectations with `path.join`/`normalizePaths` and the full suite is green on this Windows machine. Mixed-separator joins agents may produce (`C:\...work/handoff/x.md`) are valid on Windows.

## Test coverage

New-code paths are well covered: helper probe/mint/idempotence/layout/store-root (test/core/change-work.test.ts — 6 tests), status/instructions/apply/context exposure incl. zero-write probe (artifact-workflow.test.ts — 5 tests), resume matrix incl. both-exist precedence and portfolio (pipeline.test.ts — 4 tests). Gaps (all Minor, matching findings): no test for a corrupted registry on the probe path (F1); no test that a corrupt workDir copy falls back (F3 — current behavior would fail such a test); task 3.3's "store-root resume unaffected" leg relies on the pre-existing store-resolution tests rather than a workDir-specific store case. Parity hash updates span exactly the templates whose RENDERED output changed (embedders of the playbook/PREAMBLE included) — consistent with task 7.2 and a green parity run.

## Verdict

**FINDINGS — 0 Blocker, 1 Major (F1), 2 Minor (F2, F3), 1 Trivial (F4).**

Nothing here is ship-blocking by the canonical scale, but F1 should be fixed before ship: it is a one-catch fix that restores the module's own stated "never break a user command" contract, and every change-scoped CLI surface inherits the exposure.

---

## Round 2 — delta re-review (same non-author reviewer, original context retained)

Scope: only the F1/F2 fix delta. F3 and F4 stay accepted-known per the LEAD's triage — not re-litigated.

### F1 — RESOLVED (verified in code + tests)

- `src/core/change-work.ts:54-76`: the try/catch now wraps the ENTIRE body — probe and ensure alike. No half-initialized state is possible: the only returns inside the try are a fully-formed `workDir(changeName)` string or `null`; the catch returns `null`. The widened catch would also swallow a hypothetical programmer error inside `resolveProjectHome`, but that is exactly the module's stated contract (same as `touchProjectRegistry`), and the docstring (`:38-47`) now describes the behavior accurately — including the previously misleading "ensure path swallows" claim, now corrected to "the ENTIRE body".
- `src/commands/context.ts:59` (post-fix numbering): `.catch(() => null)` is attached directly to the `resolveProjectHome(root.path, { ensure: false })` promise — the exact call site flagged in Round 1. `resolveProjectHome` is an async function, so all failure modes are rejections (no synchronous-throw gap); the null flows into the existing ternary. Covered.
- Diagnostic surface preserved: `src/commands/doctor.ts:111-116` reads the registry through its own path with an explicit "corrupt/unreadable registry.json must surface as a diagnostic here" contract — so the swallow does not make corruption invisible; doctor remains the reporting surface.
- Regression tests confirmed present and correct — 6 as claimed: 2 unit (`test/core/change-work.test.ts:96,112` — both mint FIRST so the probe actually reaches `readProjectRegistryState`, the subtle precondition that makes the test meaningful, since a config without `projectId` short-circuits before the registry read), 3 CLI (`test/commands/artifact-workflow.test.ts:796-852` — status/instructions/context exit 0 with `workDir`/`machineHome` simply absent against a corrupted registry), 1 resume (`test/commands/pipeline.test.ts:887-906` — falls back to legacy change-dir run-state, `runStateDir` = change dir). Independently re-ran `test/core/change-work.test.ts`: 8/8 passed.
- Behavior note (acceptable, by design): with a corrupt registry, `instructions` succeeds with `workDir` absent and never re-attempts a repair — degradation to legacy change-dir behavior, corruption surfaced by doctor.

### F2 — RESOLVED (verified in code + parity)

- `src/core/templates/workflows/goal-report.ts` Input section: the `goal-run.json` bullet now names the location with the SAME formula the other templates use — "`workDir` from `rasen status --change <n> --json`, or the resolved location the LEAD's dispatch prompt names; fall back to the change directory when `workDir` is absent or the file already lives there (sticky-legacy)" — matching `experts/_shared.ts` in structure (both channels + both fallback triggers). The Constraints section back-references it. One consistent instruction; no drift.
- `report.md` deliverable location correctly untouched (it is the research pipeline's T2 deliverable, not ephemera).
- Parity delta verified isolated: exactly the goal-report pair moved in Round 2 — `getGoalReportSkillTemplate` and `'rasen-goal-report'` (`test/core/templates/skill-templates-parity.test.ts:165,213`); the goal-command pair hashes are byte-identical to their Round-1 values. Note the `'rasen-goal-report'` hash is computed from the RENDERED template (`generateSkillContent`), not an on-disk file — this repo's `.claude/skills/` does not deliver the goal skills, so there is no generated artifact to regenerate for it; parity green covers the contract.
- `tasks.md` task 4.4 now carries an annotation correcting the false tick, naming this review round. Conformance restored.

### Round 2 verdict

**CLEAN — F1 and F2 resolved as claimed, no new findings introduced by the fix delta. Remaining open: F3 (Minor, accepted-known), F4 (Trivial, accepted-known).**
