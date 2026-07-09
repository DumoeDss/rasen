# Review Report: externalize-artifacts-archive-timing

**Reviewer:** reviewer-archive-timing (dispatched, report-only)
**Scope:** uncommitted diff on src/core/project-config.ts, src/commands/workflow/status.ts, src/core/templates/workflows/{ship,archive-change,_orchestration}.ts, test/core/project-config.test.ts, test/commands/artifact-workflow.test.ts, test/core/templates/skill-templates-parity.test.ts
**Known green:** 123 files / 2264 passed / 0 failed; live smoke on default/flip/invalid config paths.

**VERDICT: NOT CLEAN — 0 Blocker, 4 Major, 3 Minor, 1 Trivial.** All four Majors are template-prose branch-condition defects (no product-code changes required); the shared root cause of Majors 1–3 is branching keyed on the re-resolved config value or on the wrong detection token instead of on the recorded ship-log facts, contradicting this change's own ADDED requirement "Recorded delivery facts outrank re-resolved config" (specs/archive-timing/spec.md).

## Scope Check

CLEAN. Diff matches tasks.md groups 1–6 exactly. Parity-hash moves cover precisely the playbook-embedding templates (ship, archive-change, auto, review-cycle, goal) — expected, since auto/review-cycle/goal embed `ORCHESTRATION_PLAYBOOK`. No unrelated files touched; foreign dirt in the working tree ignored per dispatch.

## Findings

### Major

**M1. Timing-flip loophole: step 2.5's branch matrix is non-exhaustive and keyed on re-resolved timing, not recorded facts.**
`src/core/templates/workflows/archive-change.ts:49-52` (skill getter) and `:201-204` (command getter).
Branches 2 and 3 both require "`on-merge` timing". Scenario: a change ships pr-mode under on-merge; the user later flips config to `archive: { timing: in-ship }` (e.g. preparing for the next change); an archive attempt then matches NO branch — branch 1 fails (no `Archived in ship:` marker), branches 2 and 3 fail (timing is not on-merge) — and the most natural agent reading falls through to step 3's gates, archiving while the PR is still open. This is exactly the drift window the change exists to close, and it violates the delta spec's requirement "Editing the timing mid-flight SHALL NOT reinterpret a recorded delivery" (the spec's own scenario only covers the in-ship→on-merge flip direction; this is the reverse direction). Step 2.5's opening sentence ("These recorded facts, not a re-resolved config value, drive what happens next") states the right rule, but the explicit branch labels contradict it. Fix shape: key branch 2 on the recorded pr-mode delivery + absence of the in-ship marker, independent of current timing; make the matrix exhaustive.

**M2. Orchestration in-ship branch records "archived in ship" on the config value, not the ship-log marker.**
`src/core/templates/workflows/_orchestration.ts:92`.
The rule's in-ship branch asserts "ship already ran sync + bookkeeping inside its own stage" as a premise, triggered by resolved timing alone. Same flip scenario as M1 (on-merge pr ship, then config flipped to in-ship): at the archive stage the LEAD records the stage done/skipped "archived in ship" for a change that was never synced or moved — a falsely-satisfied stage; the run completes, the PR merges, delta specs never reach main specs, the change dir stays in changes/ while run-state says done. Worse than M1 because the outcome is silent (recorded success) rather than a confused fall-through. The branch should trigger on the ship log's `Archived in ship:` line (the recorded fact); timing=in-ship without the marker means ship has not run yet under this timing, or ran under on-merge — dispatch archive normally.

**M3. A pr-mode ship log without a PR URL bypasses the merge gate instead of reaching the cannot-verify path.**
`src/core/templates/workflows/archive-change.ts:51` / `:203` (branch condition) vs `:60` / `:212` (2.6 cannot-verify list).
Branch 2 detects pr-mode delivery by "(a `PR:` URL present)". Step 2.6's cannot-verify list explicitly includes "no PR URL in the ship log" — but that clause is unreachable, because the only route into 2.6 requires the URL to exist. A ship log with `Mode: pr` and no PR line (hand-written or degraded log — the exact risk design.md's Risks section names, with mitigation "degrades exactly like gh-absent ... never guess a PR from the branch") matches neither branch 2 nor branch 3 (which requires push/local or no ship log) and plausibly falls through to step 3 with no gate. Fix shape: detect pr-mode from the `Mode:` line; a pr-mode log with a missing/unextractable URL routes into 2.6's cannot-verify degradation.

**M4. The post-in-ship idempotent no-op is unreachable via the prescribed steps — the spec scenario cannot execute as scripted.**
`src/core/templates/workflows/archive-change.ts:47` / `:199` (step 2.5 depends on step 2's status JSON) + `src/core/templates/workflows/ship.ts:184` (the promise) + `src/commands/workflow/shared.ts:171-172` (why it throws).
After an in-ship archive the change dir lives at `<changesDir>/archive/YYYY-MM-DD-<name>`. A later `/rasen:archive <name>`: step 1's `rasen list` shows only active changes; step 2's `rasen status --change <name> --json` THROWS (validateChangeExists does a direct existsSync on `<changesDir>/<name>`), so step 2.5 — the sole source of `workDir`, the ship log, and the no-op branch — is never reached. The delta spec scenarios "Archive after in-ship is an idempotent no-op" and "Config flipped after ship does not rewrite history" (specs/archive-timing/spec.md) cannot execute through the written steps, and ship.ts:184's "a later archive invocation for this change reports it as already archived and stops cleanly" overpromises. Actual behavior is a loud status error naming available changes — not silent corruption, and an agent may recover by spotting the archive dir, which is why this is graded Major rather than Blocker under "required spec behavior missing"; but the prose provides no such recovery path. Fix shape: step 2.5 (or a pre-step) must handle status failure for a name found under `<changesDir>/archive/` and report already-archived from there.

### Minor

**m1. Guardrail wording can be read to forbid the legitimate cannot-verify confirmation path.**
`archive-change.ts:148` / `:349` ("the merge gate's override applies ONLY to an open PR, never to closed-unmerged or unverifiable") vs 2.6 (`:60` / `:212`), which allows unverifiable to proceed on explicit human merge confirmation. The intended distinction — override = proceed-despite-unmerged; confirmation = the human's assertion replaces the check — is inferable but unstated; a literal agent could over-refuse interactively. Fails safe (refusal, never wrong archive), hence Minor. One clarifying clause in the guardrail resolves it.

**m2. PR Body Generation is not in-ship-aware.**
`ship.ts:109-119`. Under in-ship + pr (the spec's headline scenario), `rasen/changes/<name>/proposal.md` no longer exists when PR body generation runs — the step-3b move already happened — and the "If no proposal.md: ... Note that no proposal was available" branch literally matches the post-move state, producing a degraded PR body with a false claim. Step 3b.1 captures the sections, but nothing in the PR Body Generation block tells the agent to use the captured content (the opsx-ship-command spec requires the captured content so "later steps still have it"). Add one line: under in-ship, use the content captured in step 3b.

**m3. Ship-log fallback path is invalid under in-ship timing.**
`ship.ts:132`. "write ship-log.md to the work directory (fallback: `rasen/changes/<name>/ship-log.md`)" — under in-ship with `workDir` absent from the payload, the fallback path was just moved; writing there resurrects an empty change directory and strands the log outside the archive. Rare post-child-2 (workDir is near-universal), but the fallback under in-ship should be the archived path recorded in step 3b.3.

### Trivial

**t1.** Ship post-ship "push/local → suggest `/rasen:archive` now" (`ship.ts:186`) sits in mild tension with archive step 3.6's portfolio-deferred soft warning for local-mode children. Coherent in practice — 3.6 still fires at archive time and the guidance is spec-mandated — noted for awareness only.

## Verified clean (dispatch focus areas)

- **D3 decision tree (reachable paths):** OPEN → refuse, override must NAME the unmerged condition, non-interactive refuses outright; CLOSED-unmerged → refuse + surface, no override path; cannot-verify → never treated as merged, confirmation-only interactive, refuse non-interactive, re-attemptable. No reading lets "couldn't verify" pass as "merged". Fields pinned (`state,mergedAt`); check-on-invocation, agent-side, CLI no-git contract preserved.
- **Duplicated getter sites:** both 2.5/2.6 blocks and both guardrail blocks in archive-change.ts are byte-identical (programmatic extraction + comparison, 2 occurrences each).
- **Single-writer invariant:** no conflict. The archive worker refuses (per 2.6 non-interactive rule); the LEAD records `pending` + awaiting-merge note (Step D rule, _orchestration.ts:92), consistent with H.3 "Workers NEVER write run-state". `pending` is a valid Step F status and is not complete (complete = done|skipped), so `pipeline resume` re-attempts — the "no run-state schema change" claim is accurate.
- **in-ship ordering (ship.ts:80-87):** capture → sync → move → record marker → stage (specs + moved dir included) → commit is unambiguous; the clean-tree skip is correctly scoped to on-merge only; commit precedes base-merge/test-gate/delivery as designed (D4).
- **Config semantics (project-config.ts:107-122, 142-144):** invalid timing → parse-time warn + field drop → resolver defaults; never throws; resolver total over null/undefined/absent-block/absent-field. Unknown keys under `archive:` are silently tolerated (child-4 `destination` forward-compat). Zod ProjectConfigSchema has no external consumers (grep-verified) — the manual resilient parse is the only live path. Status exposure is intentionally always-resolved (D2: templates read one authoritative value; absent-vs-default deliberately not distinguishable).
- **Cross-child-2 coherence:** workDir-first + sticky-legacy ship-log wording matches child 2's existing steps 3.5/3.6 and _orchestration Step F verbatim; the new prose contradicts nothing child 2 shipped. on-merge + push/local immediate chaining is stated consistently in ship post-ship, archive 2.5 branch 3, and the orchestration archive-stage rule.
- **Spec conformance:** config-loading ✓; cli-artifact-workflow ✓ (tests mirror both scenarios plus payload-field preservation); opsx-ship-command largely ✓ (gap = m2); opsx-archive-skill and archive-timing partially violated (M1, M3, M4); opsx-orchestration partially violated (M2).

## Recommended triage order

M2 (silent false success) → M1/M3 (same branch-matrix fix in archive-change.ts, both getters) → M4 (needs a small prose recovery path; optionally a follow-up for CLI-side archived-change status support) → m1/m2/m3 one-line prose clarifications. All fixes are template prose; every template fix requires the build → update regeneration flow and parity-hash refresh for the affected templates.

---

# Round 2 — delta re-review

**Reviewer:** reviewer-archive-timing (same reviewer, original context held). Scope: the fix delta on archive-change.ts, ship.ts, _orchestration.ts + parity hashes.

## Per-finding verdicts

- **M1 — RESOLVED.** Step 2.5 (archive-change.ts:51-57 / :208-214) is rewritten to branch exclusively on recorded ship-log facts, with an explicit "regardless of the currently-resolved `archive.timing` ... whether the axis is `on-merge` or was later flipped" clause on the pr branch. The on-merge→in-ship flip now lands in the Mode:pr branch and hits the merge gate. One residual non-exhaustiveness noted as R2-m1 below.
- **M2 — RESOLVED.** _orchestration.ts:92 now keys on the ship log's `Archived in ship:` marker ("key the decision on what the ship log actually recorded, NEVER on the currently-resolved `archive.timing`"). Flip scenario: no marker → dispatch archive normally → merge gate refuses → LEAD records `pending`. Reverse flip: marker → recorded no-op, matching the recorded-facts spec requirement.
- **M3 — RESOLVED.** pr-mode detection is now the `Mode:` line (2.5 branch 3); a pr-mode log with a missing PR URL reaches 2.6, whose "no PR URL in the ship log" cannot-verify clause is reachable for the first time.
- **M4 — RESOLVED.** New step 1.5 (archive-change.ts:31-35 / :188-192) runs the directory scan BEFORE any status call, sourced from `rasen list --json`'s `root.path`. ship.ts post-ship (:186) now accurately describes the status-throws-then-1.5-recovers behavior instead of overpromising. The delta-spec idempotence and flip scenarios are now executable as scripted.
- **m1 — RESOLVED.** Guardrails now spell out the two distinct proceed paths (override = OPEN-only; confirmation = unverifiable-only, replaces the check; closed-unmerged has neither), exactly consistent with 2.6.
- **m2 — RESOLVED.** PR Body Generation (ship.ts:109-121) branches by timing; in-ship uses the step (b).1 captured content and explicitly forbids the false "no proposal was available" reading; the no-proposal branch is guarded with "(and nothing was captured in step (b).1)".
- **m3 — RESOLVED.** Ship-log fallback (ship.ts:133) excludes in-ship from the original-path fallback and redirects to the archived path recorded in step (b).3, naming the resurrect-empty-dir hazard.
- **t1 — open by design (accepted, unchanged).**

## Adversarial checks (dispatch items a–e)

- **(a) Matrix exhaustiveness:** the four branches cover {no log} ∪ {marker} ∪ {no marker × Mode:pr} ∪ {no marker × Mode:push|local}. Residual gap: a ship log with no marker and a MISSING or unrecognized `Mode:` line (the hand-written-log class M3 was about) matches no branch — see R2-m1.
- **(b) Exact name-segment match:** suffix/prefix collisions with other change names are correctly excluded ("segment AFTER the date must equal `<name>` EXACTLY"). But same-name prior generations are NOT — see R2-M1, the one new Major.
- **(c) `rasen list --json` with the change dir gone:** confirmed safe — the command is root-scoped (src/cli/index.ts:280-304), never touches a specific change dir, and always includes `root: { path, source, store_id? }` in the JSON payload on success (index.ts:303, src/core/list.ts:151, RootOutput at src/core/root-selection.ts:429). Also verified the hardcoded `rasen/changes/archive/` segment is safe: `changesDir` is unconditionally derived as `<root>/rasen/changes` (root-selection.ts:122) — no custom-layout path exists.
- **(d) Orchestration simplification:** no behavior lost. push/local immediate-chain is preserved — "no marker → dispatch the archive stage normally" IS the immediate dispatch (the archive skill's 2.5 branch 4 then proceeds gate-free); the pr unmerged-refusal → `pending` → clean end → resume re-check path is intact verbatim; the in-ship no-op is intact and now fact-keyed. Delegating the push/local-vs-pr branch to the skill removes a duplicated decision rather than a needed one.
- **(e) Byte-identity:** all five edited block classes (1.5, 2.5, 2.6, hard-gate guardrail, no-op guardrail) extracted programmatically — 2 occurrences each, byte-identical across both getters.
- **Parity:** ran `npx vitest run test/core/templates/skill-templates-parity.test.ts` myself — 6/6 green against the current source.

## New findings (round 2)

**R2-M1 [Major] — Step 1.5's scan false-positives on recycled change names, stranding the active change.**
`archive-change.ts:33-35` / `:190-192`. The scan matches ANY date prefix + exact name and unconditionally STOPs on a match, without checking whether `<changesDir>/<name>` still EXISTS as an active change. Scenario: "update-deps" was archived months ago (`archive/2026-03-01-update-deps/`); the user creates a NEW change named `update-deps`, completes it, runs `/rasen:archive update-deps` → step 1.5 matches the OLD archive, reports "already archived at 2026-03-01-update-deps", and stops — the active change never archives, and the prose forbids proceeding to status ("do NOT call `rasen status` for this name"). Recurring maintenance names make this a plausible path, and dated archive dirs exist precisely to permit same-name re-archiving (step 5's collision rule only guards same-day). Fix shape: step 1.5 must first check the active change directory — if `<changesDir>/<name>` exists, the change is active and the scan is moot (proceed to step 2); the archive scan is only meaningful when the active dir is GONE. Aggravator to note in the fix: workDir ephemera are keyed by change name (resolveChangeWorkDir(projectRoot, changeName)), so a recycled name also inherits the OLD ship-log with its `Archived in ship:` marker — a pre-existing child-2 property that this change makes newly load-bearing (it would then trip 2.5's inconsistency HARD STOP, which at least fails loud and safe, not silent).

**R2-m1 [Minor] — Residual 2.5 non-exhaustiveness: ship log without a recognizable `Mode:` line.**
`archive-change.ts:54-57` / `:211-214`. A ship log with no `Archived in ship:` line and a missing/unparseable `Mode:` line matches no branch. Suggested closure: no Mode line but a `PR:` URL present → treat as a recorded pr delivery (2.6); neither Mode nor PR → treat as branch 1 (nothing recorded to gate on; step 3.6's soft warnings still apply). One added sub-clause closes the matrix completely.

## Round 2 verdict

**VERDICT: NOT CLEAN — 1 Major open (R2-M1, new), 1 Minor open (R2-m1, new), 1 Trivial accepted (t1). All 4 original Majors and all 3 original Minors RESOLVED and verified against actual code; both getters byte-identical; parity 6/6 re-confirmed by this reviewer.** R2-M1 is a one-clause prose fix in step 1.5 (active-dir existence check) + regen + parity refresh; R2-m1 is one sub-clause in 2.5.

---

# Round 3 — delta re-review

**Reviewer:** reviewer-archive-timing (same reviewer, full context held). Scope: the two-clause fix delta in archive-change.ts (both getters) + parity hashes.

## Per-finding verdicts

- **R2-M1 — RESOLVED.** Step 1.5 (archive-change.ts:35 / command getter mirror) now checks `<changesDir>/<name>` existence FIRST; an active directory unconditionally routes to step 2 ("an active directory always means 'go to step 2', never 'treat as already archived'"), and the archive scan is explicitly gated on the directory being gone (:37). The recycled-name note (:41) covers the inherited-workDir stale-marker case and directs a SPECIFIC "prior same-named change was archived in ship; this ship log is stale" explanation at 2.5's HARD STOP rather than the generic directory-move message. Verified the fix does NOT break the original M4 scenario: in-ship-archived change (dir gone) → active-dir check fails → scan runs → match → clean already-archived STOP, exactly as before.
- **R2-m1 — RESOLVED.** Two new branches (2.5, :64-65) close the matrix: no-marker + unparseable-Mode + `PR:` URL → merge gate (2.6); no-marker + neither Mode nor PR → nothing-recorded, step 3.

## Exhaustiveness verification (the round-3 claim)

Walked the full state space (ship log present?) × (`Archived in ship:` marker?) × (`Mode:` parseable pr / push|local / missing-unparseable) × (`PR:` URL present?):
- no log → branch 1; log + marker → branch 2 (marker checked before Mode, so Mode/PR states under a marker are all covered); log + no marker + Mode:pr → branch 3; Mode:push|local → branch 4; Mode missing/unparseable + PR URL → branch 5; Mode missing/unparseable + no PR URL → branch 6. **Exhaustive and mutually exclusive — confirmed.**
- Two marginal states noted informationally, neither a finding: (i) Mode:push|local WITH a stray `PR:` URL matches branch 4 and skips the gate — correct-by-design, the recorded Mode is the authoritative delivery fact; (ii) a recycled name whose stale inherited ship log has Mode:pr + the OLD PR's URL (no marker) reaches the merge gate against the old PR — inherited child-2 workDir-keying staleness, pre-existing, and fail-safe in direction (an old merged PR proceeds into the unchanged task/verify gates; an old open PR refuses).

## Mechanical checks

- **Byte-identity:** all five block classes (1.5, 2.5, 2.6, both guardrails) re-extracted programmatically — 2 occurrences each, byte-identical across both getters.
- **Parity:** re-ran `npx vitest run test/core/templates/skill-templates-parity.test.ts` myself — 6/6 green against the current source.

## Round 3 verdict

**VERDICT: CLEAN — all original findings (M1–M4, m1–m3) and all round-2 findings (R2-M1, R2-m1) RESOLVED and verified against actual code. Open: t1 (Trivial, accepted by design). The 2.5 branch matrix is exhaustive; both getters byte-identical; parity green. This closes the review loop.**
