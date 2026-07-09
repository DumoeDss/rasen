## Context

Child #5 of the `prompt-audit-fixes` portfolio. The four prior children fixed expert-dispatch, verify/ship evidence, orchestration, and office-hours facilitation. This child closes the *lifecycle-stage seams* — where one stage (office-hours, verify, apply, ship, continue) promises or produces something the adjacent stage (propose, archive) never consumes or enforces — plus two inherited hardening debts (parity coverage; goal-registration).

Interface contracts this change consumes by reference (do NOT re-declare):
- **`VERIFY VERDICT: <CLEAN|BLOCKED>`** written to `verification-report.md` by `verify-change.ts` (capability `verify-ship-evidence`, child #2). `verify-change.ts:159` explicitly states the verdict "does not by itself enforce an archive refusal" — WF-4 here is the intended enforcing consumer.
- **`canonical-severity-vocabulary`** (Blocker/Major/Minor/Trivial, child #1) — referenced only indirectly via the verdict; no new severity words.
- **Ship-log deferral marker** — `ship.ts:116,132` writes `Status: … Committed (delivery deferred to portfolio level)`; WF-11 keys off that line.
- **`opsx-office-hours-command` "Downstream Consumption by Propose"** — the producer-side promise that WF-2 finally wires a consumer to.

## Goals / Non-Goals

**Goals:**
- Every producer/promise in the audit has a real consumer/enforcer after this change (no unwired seams left in the lifecycle set).
- Archive's gate language matches verify's: what verify calls "must fix before archive" archive actually refuses (with an explicit override), while genuine soft warnings stay inform-and-confirm.
- The workflow/orchestration template family is hash-locked so shared-block edits can never ship it unverified again.

**Non-Goals:**
- Store/root path resolution in archive/ship/office-hours (WF-3, WF-9 — child #6, deferred pending externalize re-sync). New code added here resolves paths from status JSON so it does not add to that debt, but existing hardcoded paths are left for child #6.
- Editing any `experts/*.ts` file (child #1/#4 territory). WF-6 edits the *workflow command* `workflows/office-hours.ts` only. `_orchestration.ts` is edited ONLY for the F.1 clause of Decision 8 (LEAD-granted scope exception, post-restart) — nothing else in that file; children 1/3's edits there survive untouched.
- Re-registering goal skills for generation — already done (see Decision 7).

## Decisions

### D1 — WF-2: implement the propose consumer, scanning both locations (resolved paths)

`propose.ts` (both the skill and command getters) gains a step, placed **after** `rasen new change` + `rasen status --json` and **before** drafting the proposal: check for office-hours validation and read it as input context if found.

Two scan locations, because office-hours writes to different places depending on whether a change existed at session time:
1. `office-hours-design.md` inside the just-created change dir (`changeRoot` from status JSON) — the active-change case.
2. `<office-hours-dir>/<change-name>.md` where `<office-hours-dir>` is the `office-hours` directory alongside the changes directory under the planning home (derive from `planningHome.changesDir`). This is the no-active-change case: office-hours derives its filename slug "exactly the way `/rasen:propose` derives a change name," so when the user later proposes with the same description, the change name equals the slug and the file is discoverable.

If found, propose reads it and incorporates its findings/decisions into the proposal (naming it as source context); if absent, propose proceeds normally. **Rationale for resolved (not hardcoded) paths:** the LEAD lean is "implement the consumption, don't delete the promise"; doing it with `changeRoot`/`planningHome` from status JSON means this new code is store-correct from birth and does not enlarge child #6's WF-3 hardcode sweep. The office-hours producer's own hardcoded `rasen/office-hours/` (WF-3) is left untouched for child #6.

The `opsx-office-hours-command` spec's existing "Downstream Consumption by Propose" requirement is the producer-side promise; the CONSUMER contract lands in `propose-workflow` (its natural home). No MODIFY of the office-hours spec for WF-2 — the office-hours template's promise text is merely made accurate (both locations) as conformance, locked by the parity hash this change adds.

### D2 — WF-4: verdict + task hard gate with explicit override; soft warnings unchanged

Two archive gate *tiers*, with precedence stated:

- **Hard gate (refuse by default; proceed only on explicit override):** (a) `verification-report.md` exists and its `VERIFY VERDICT:` line is `BLOCKED`; (b) incomplete tasks exist (`- [ ]`). These are the "must fix before archive" class. Override = an explicit, blocker-naming user acknowledgment (e.g. selecting "Archive anyway despite BLOCKED verification / N incomplete tasks"), NOT the routine confirm. In a non-interactive/dispatched context a hard gate REFUSES rather than auto-confirming.
- **Soft gate (inform + confirm, as today):** incomplete non-task artifacts, unsynced delta specs, missing ship-log (D3), portfolio-deferred delivery (D3). These stay overridable via the normal confirm.

**Precedence with the existing "Don't block archive on warnings" guardrail:** that guardrail is scoped to *soft* warnings; it does not cover the two hard-gate conditions. The archive template's guardrail gets this scope clause (enumerate-and-gate: the whole guardrail block is swept, and the task-completion + verification conditions are carved out as hard gates while the artifact/spec/ship-log conditions remain soft).

**Spec shape:** ADD `Verification Verdict Gate` requirement to `opsx-archive-skill`. MODIFY the existing `Task Completion Check` requirement's "Incomplete tasks found" scenario — it currently asserts the now-wrong soft behavior (warn→confirm→proceed), so ADDED would leave a contradiction; MODIFY (full requirement copy) is the honest fix here. This is the one deliberate MODIFY in the change.

**Why not gate on verification *absence*:** the LEAD steer gates on BLOCKED-or-unticked, not on "verify never ran." A change may legitimately archive without a formal verify pass; absence yields at most a soft note, never a hard refusal.

### D3 — WF-5 + WF-11: one delivery-precondition check in archive

Both findings are archive reading `ship-log.md`, so they collapse into one new `opsx-archive-skill` requirement, "Delivery Precondition Check":
- No `ship-log.md` in `changeRoot` → soft warn "This change has no ship log — archive without delivering?" with an explicit escape for changes that legitimately don't ship (e.g. spec-only). Soft, because not every change ships.
- `ship-log.md` present and its `Status:` line contains "delivery deferred to portfolio level" → soft note that parent-level portfolio delivery is still pending and archiving the child now may lose track of it; confirm to proceed. Minimal cross-reference only — archive gains no portfolio graph, no parent lookup, just the note. (LEAD steer: "no big machinery.")

The apply side of WF-5 (the completion nudge that jumps straight to archive) is handled in D5, not here.

### D4 — WF-6: the workflow command delegates facilitation to the expert; inline is fallback

`workflows/office-hours.ts` today runs the session inline (step 2), then says the facilitation "actually lives in the expert skill" (step 3), then produces the doc again (step 4) — undefined authority and double doc production. Precedence: **the `/office-hours` expert (`rasen-office-hours`) is the single facilitation authority.** The workflow command's value-add is lifecycle integration (mode routing, dual-write location, the WF-2 handoff), so it delegates the session to the expert; the inline six-questions/builder description is retained explicitly as a *fallback/pre-brief* (used only if the expert skill is unavailable), not a second facilitation pass. Doc production is consolidated to a single step.

This respects child #4's investment: the rich dialogue/grilling facilitation was hardened in `experts/office-hours.ts`, and duplicating it inline in the workflow command is exactly the drift that produced this conflict. Delegation (per the fix-writing philosophy: keep the version that's genuinely better, cut the seam) rather than inlining. Wired consumer confirmed: `rasen-office-hours` is registered in `skill-generation.ts`.

**Spec:** ADD `Facilitation Delegates to the Office-Hours Expert` requirement to `opsx-office-hours-command`, with a precedence scenario.

### D5 — WF-5 (apply) + WF-10 (continue): completion nudges route to the right next stage

Neither the apply nor the continue *skill* has a behavioral capability spec (they are governed only by parity hashes today). Rather than fragment, both nudge contracts land in one new small capability, `lifecycle-stage-sequencing`:
- Apply all-tasks-complete → steer to `/rasen:verify` then `/rasen:ship`; archive named only as the post-delivery step. (WF-5 apply side)
- Continue all-artifacts-complete → steer to `/rasen:apply` (implement); archive named only as the post-implementation step. (WF-10)

Template edits touch both getters of `apply-change.ts` and `continue-change.ts`; both are already parity-pinned, so the edits move existing hashes (locked, verified).

### D6 — Parity expansion (new capability `workflow-template-parity`)

Enumerated the production registries (`getSkillTemplates`/`getCommandTemplates` in `skill-generation.ts`) against the parity registries. Unpinned skill templates: `rasen-office-hours-command`, `rasen-verify-enhanced`, `rasen-ship`, `rasen-retro`, `rasen-auto`, `rasen-review-cycle`, `rasen-handoff`, `rasen-goal-plan`, `rasen-goal-iterate`, `rasen-goal-report`, `rasen-goal` (11). Unpinned command payloads: the eight `getOpsx*CommandTemplate` variants for office-hours/verify-enhanced/ship/retro/auto/review-cycle/handoff/goal (goal-plan/iterate/report are skill-only).

Each newly-pinned **skill** template gets: an entry in the test's `functionFactories` object + `EXPECTED_FUNCTION_HASHES`, and an entry in `GENERATED_SKILL_FACTORIES` + `EXPECTED_GENERATED_SKILL_CONTENT_HASHES`. Each newly-pinned **command** template gets a `functionFactories` + `EXPECTED_FUNCTION_HASHES` entry (commands are `CommandContent`, not run through `generateSkillContent`, so no generated-content entry — same as existing command coverage). New getter imports added to the test's import block.

Follows the precedent set by `expert-template-inlining` (collective 19-expert coverage requirement) and `verify-ship-evidence` (chrome-use coverage requirement naming the parity test file). New capability rather than delta because this is a genuinely new coverage surface (the workflow/orchestration family, distinct from experts and from chrome-use), and a single collective home avoids sprinkling near-identical "covered by parity" requirements across eight command specs.

**Interaction with the shared-block edits:** none of this change's template edits touch `_shared.ts`/`_orchestration.ts`, so no PREAMBLE churn. But `office-hours-command`, `apply-change`, `continue-change`, `archive-change` all get body edits here — those hashes are being *established* (office-hours-command) or *moved* (the three already-pinned) in the same regen run.

### D7 — Goal generation-registration debt is already closed (no action)

The inherited "rasen-goal/goal-plan absent from generation registries" debt (from children 2/3, predating the goal-loop merge) is **stale**. `skill-generation.ts` registers `getGoalPlanSkillTemplate`/`getGoalIterateSkillTemplate`/`getGoalReportSkillTemplate`/`getGoalCommandSkillTemplate` (lines 180-183) and `getOpsxGoalCommandTemplate` (line 243), landed by commit `60f8d10` (goal-loop primitive) and rebranded in `2ebfae9`; the `opsx-goal-command` spec's own "Templates export and register" scenario asserts this. Confirmed by inspection at proposal time. Only the parity gap remained, folded into D6. Implementer will double-confirm by observing `rasen-goal*` SKILL.md files emitted during the regen `update` step.

### D8 — F.1 resume ladder: generation-match the distillation (LEAD-added, post-restart)

`_orchestration.ts` Step F.1 step 2 ("Handoff document first, transcript second") does not state that the document must be the LATEST holder's distillation of the role's final state. Live failure mode the LEAD hit: re-engaging a role whose latest holder died un-exhausted WITHOUT a document, while an OLDER generation's retirement document exists → the LEAD matches the stale document and skips the transcript, discarding intact context. Fix = one tight clause added to F.1 step 2:
- A handoff/retirement document counts ONLY if it is the latest holder's own distillation. An un-exhausted latest holder with no document resumes from its TRANSCRIPT (step 3), which BEATS any earlier generation's document; never seed from a stale predecessor's document when a newer holder's context survives unrecorded.
- Same-session-restart nuance: when the session directory survived the restart, `SendMessage`-by-NAME MAY still resolve to the latest holder — try that wake first, fall back to the ladder only if it does not resolve.

**Scope:** LEAD-granted exception to touch `_orchestration.ts` for exactly this clause; no other edit to that file (children 1/3's edits survive). **Spec:** ADDED requirement in `orchestration-worker-lifecycle` (the existing "SendMessage-resume scoping" requirement does not assert generation-matching → no fragile MODIFY). **Parity coverage:** `_orchestration.ts` is embedded by `auto.ts`, `goal-command.ts`, and `review-cycle.ts` — all three are in this change's parity-expansion set (D6), so the F.1 edit is hash-verified via the newly-pinned `rasen-auto` / `rasen-goal` / `rasen-review-cycle` templates. Task ordering: the F.1 edit lands with all other template edits before the single regen tail, so their moved hashes are captured together; the registry expansion (D6) is what makes this edit verifiable at all (it was previously parity-uncovered).

## Risks / Trade-offs

- **MODIFY fragility (D2):** the one MODIFY (Task Completion Check) needs an exact-header full-requirement copy or the delta parser drifts. Tasks call this out explicitly.
- **Explicit-override expressibility (D2):** "explicit override vs routine confirm" is prompt-level guidance, not a hard code gate — an agent could still over-comply. Mitigated by the spec requiring the prompt to name the specific blocker and to refuse-by-default in non-interactive contexts, matching how the rest of the rasen prompt suite expresses hard vs soft gates.
- **Slug-match discovery (D1) is best-effort:** if the user proposes with a description whose derived name differs from the office-hours slug, the sibling-dir doc won't be found. Acceptable — the in-change-dir case is exact, and the sibling case degrades to today's behavior (no worse). Documented in the propose nudge so the user can point at the file.
- **Shared `archive-change.ts` with child #6:** child #6 (WF-9 path resolution) edits the same file later; different concern (gate logic vs path resolution) but overlapping lines possible. No concurrent risk (child #6 deferred); flagged for its re-verify.
- **Parity hash volume (D6):** ~19 new hash entries + 5 moved, all hand-pasted (no `-u`). Risk of paste error; tasks require confirming ONLY expected templates moved.
