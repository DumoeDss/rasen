# Orchestration-family prompt-conflict audit

Scope: `src/core/templates/workflows/{auto,_orchestration,goal-command,goal-plan,goal-iterate,goal-report,review-cycle,handoff}.ts` + all `pipelines/*/pipeline.yaml` + the pipeline-registry schema/resolvers (`src/core/pipeline-registry/types.ts`) they contract against.

Taxonomy: A rule-vs-rule · B missing state · C precedence gap · D wrong-generalization · E buried override · F cross-file seam.
Severity: Critical = wrong behavior on the common path · Major = wrong behavior on a plausible path · Minor = friction.

Line numbers are as-read at audit time (unmodified working tree).

---

## OR-1 — Planner-reuse threshold: H.2 says 0.5, B.1.5 says 0.25 (opposite decisions)
- **Taxonomy:** A (rule-vs-rule) + E (buried override)
- **Severity:** Critical (fires on every portfolio planner re-engagement)
- **Sides:**
  - `_orchestration.ts:223` (H.2): *"Before EVERY `SendMessage` to an existing worker (delta re-review, **planner reuse**, any Tier A continuation): probe that worker's recorded transcript. Below **its resolved threshold** → continue warm (cheapest). At or above → retire it via handoff…"* — inside Step H, "resolved threshold" is the **handoff** threshold (default **0.5**, `_orchestration.ts:219`).
  - `_orchestration.ts:76` (B.1.5): *"Before EVERY planner re-engagement, apply the Step H.2 warm-continue guard… at or above its threshold, retire it… the threshold it compares against is the resolved **reuse** threshold for the planner (`resolvePipelineReuseConfig(pipeline).roles.planner`, default **0.25**) — NOT the handoff threshold that governs mid-task relay."*
- **Scenario:** A persistent planner is at 0.40 context occupancy when the LEAD needs it to propose child #2. H.2 (which explicitly names "planner reuse" as one of its cases) says 0.40 < 0.5 → **continue warm**. B.1.5 says 0.40 ≥ 0.25 → **retire and re-staff**. The two rules give opposite instructions for the identical event. H.2 is the eye-catching general rule; B.1.5 is the correct carve-out, but H.2 never points to it, so a LEAD reading top-down applies the wrong (0.5) threshold and over-retains a bloated planner across children.
- **Verified:** both quotes present; H.2 literally lists "planner reuse" in its trigger set, which is exactly the case B.1.5 overrides. Not resolvable by reading order — H.2 comes later in the file than B.1.5.
- **Fix direction:** In H.2, exclude planner-reuse (and cross-child implementer-reuse) from the "resolved threshold" default and forward-reference B.1.5 / G.1.3: "for cross-change re-staffing decisions use the *reuse* threshold (Step B.1.5 / G.1.3), not the handoff threshold."

---

## OR-2 — Run-state example omits `sessionHandoff.n` → session-relay generation cap never trips
- **Taxonomy:** B (missing state) + F (cross-file seam)
- **Severity:** Major (unbounded auto-relay once a run starts relaying itself)
- **Sides:**
  - `_orchestration.ts:157` (the canonical run-state JSON the section tells the LEAD to write): `"sessionHandoff": { "path": "handoff/lead-1.md", "pct": 0.52, "afterStage": "apply", "at": "<iso>" }` — **no `n` field**.
  - `handoff.ts:29`: *"set top-level `sessionHandoff` to `{ "path"…, "n": <n>, "pct"…, "afterStage"…, "at"… }` — `n` is the relay generation… (a record without `n` reads as generation 1)."*
  - `_orchestration.ts:240` (H.7): *"`sessionHandoff.n` at `maxRelays` (resolved config, default 3) stops auto-relay."*
- **Scenario:** The LEAD models its run-state on the Step F example (:157), which has no `n`. Per handoff.ts's own rule, "a record without `n` reads as generation 1." So every session relay is read as generation 1, `sessionHandoff.n` never advances toward `maxRelays`, and H.7's cap ("stop auto-relay, recommend decompose") never fires. The run relays itself indefinitely instead of surfacing the decompose signal.
- **Verified:** :157 field list confirmed to lack `n`; H.7 and handoff.ts both depend on `n`. The example is the one most likely to be copied.
- **Fix direction:** Add `"n": 1` to the `sessionHandoff` object in the Step F example (:157) and note it is the relay generation that H.7 caps.

---

## OR-3 — childPipeline internal gates under portfolio orchestration are undefined; "proceeds automatically" contradicts "always pause at gates"
- **Taxonomy:** C (precedence gap) + B (missing state)
- **Severity:** Major (every taken-decompose run; either many surprise pauses or a broken guardrail)
- **Sides:**
  - `auto.ts:53` / `auto.ts:130`: decompose *"proceeds automatically (no human gate)"*; and Step G self-audits then *"proceed automatically"* (`_orchestration.ts:187`).
  - `_orchestration.ts:88` (Step D **gate**): *"After the stage, pause… wait for the human to Continue / Stop…"* and `auto.ts:124` guardrail: *"Always pause at gate stages — never skip human confirmation."*
  - childPipeline = `small-feature` (`auto-decompose.yaml:15`), whose `propose` (`small-feature.yaml:11`), `apply` (:16), and `ship` (:38) stages all carry `gate: true`.
- **Scenario:** A decompose fans out into 3 children. Each child runs `small-feature` = 3 gated stages. Step G never says whether childPipeline gates fire under portfolio orchestration. If honored (per Step D + the guardrail), a "proceed automatically" portfolio actually stops for the human **3× per child (9 pauses)** plus the final delivery — the opposite of autonomous. If suppressed (to honor the autonomy claim), that silently violates "always pause at gate stages." Neither the playbook nor auto.ts resolves which wins.
- **Verified:** small-feature's three `gate: true` stages confirmed; Step G has no gate-handling clause; the two guardrails are literally "proceed automatically" vs "always pause."
- **Fix direction:** Add an explicit rule in Step G: under portfolio orchestration, childPipeline stage gates are [suppressed / collapsed into one per-child checkpoint / honored], and state it. Reconcile the "proceeds automatically" wording to say it governs only the decompose decision, not the children's internal gates.

---

## OR-4 — goal-loop `evaluate` gate has no Tier-C author≠verifier fallback
- **Taxonomy:** D (wrong-generalization — a rule silently assumes Tier A/B) + B
- **Severity:** Major (author≠verifier collapses on the Tier-C evaluate path with no stated degradation)
- **Sides:**
  - `_orchestration.ts:119` (Step L evaluate): *"dispatch a **FRESH reviewer worker** (≠ the implementer — author ≠ verifier)…"* — assumes subagent spawning.
  - `_orchestration.ts:84` (Step C Tier-C degrade): *"the non-author confirmation degrades to an independent **gate-run (tests/lint/build)** plus a diff-read…"* — a code-gate substitute that does not exist for a subjective quality rubric.
  - `goal-command.ts:66`: *"For an evaluate gate, a FRESH reviewer worker (≠ the implementer) judges each round."* — no Tier-C branch.
- **Scenario:** A `goal-loop-evaluate` run on a host with no subagent capability (Tier C, an explicitly supported fallback per `_orchestration.ts:28`). The single context both makes the change AND judges the rubric each round — a pure self-review. Step C's Tier-C substitute (tests/lint/build gate-run) is meaningless for an evaluate rubric, and neither Step L nor goal-command.ts offers any other degradation. The loop's core invariant (author≠verifier) is silently void, and "satisfied" can be self-declared — exactly what Step L:119 and goal-command.ts:66 forbid.
- **Verified:** Step L's evaluate branch names no tier; Step C's degrade is code-gate-shaped; goal-command Termination Invariants list author≠verifier with no Tier-C carve-out.
- **Fix direction:** In Step L (and goal-command's invariants), state the Tier-C evaluate degradation — e.g. run `evaluate` in a second, freshly-reset single-context pass seeded only with goal+rubric+artifact (no implementation transcript), recorded as the fallback; or declare goal-loop-evaluate unsupported under Tier C.

---

## OR-5 — `goal-plan.md` carries `maxRounds`, but Step L injects only gate config → the planner's maxRounds is orphaned
- **Taxonomy:** B (missing state) + F (cross-file seam)
- **Severity:** Major (research/quality runs run longer than the plan says)
- **Sides:**
  - `goal-plan.ts:51`: goal-plan.md field *"## maxRounds `<number>` # default 5; research/evaluate MAY set lower (e.g. 3)"* — the planner authors a per-task round cap.
  - `_orchestration.ts:113` (Step L **Inject**): *"merge the concrete **gate config** into `iterate.loopConfig`… copy `threshold`/`target`/`direction`/`timeoutSec`… or copy `goal`/`rubric`."* — injects gate fields only; **maxRounds is not read from goal-plan.md**.
  - `goal-loop-research.yaml` sets no `maxRounds`, so the schema default (`types.ts:223`, **5**) applies.
- **Scenario:** For a context-heavy research task the planner writes `maxRounds: 3` in goal-plan.md (as goal-plan.ts:52 explicitly invites). The LEAD's inject step never copies it, so the loop uses the pipeline/schema default of 5. The run does 5 rounds when the plan called for 3 — the planner's cap silently has no effect. Symmetric surprise for any evaluate run where the planner lowered the cap.
- **Verified:** Step L Inject enumerates gate fields and omits maxRounds; goal-plan template includes maxRounds; research yaml has no override.
- **Fix direction:** Add `maxRounds` (and `loopStallLimit` if the planner may set it) to the Step L Inject list, or delete the maxRounds field from the goal-plan.ts template and state that the round cap is pipeline-only.

---

## OR-6 — `DONE` with unticked tasks is lumped with a dead worker → cold-reconstruct + relay burn (sibling of the H.4 death-taxonomy defect)
- **Taxonomy:** D (missing taxonomy — different situations treated as one)
- **Severity:** Major (plausible on any stage where the worker finishes but tasks.md isn't fully ticked)
- **Sides:**
  - `_orchestration.ts:231` (H.4): *"A worker that dies without a document, **or returns `DONE` with unticked tasks**, is treated as a handoff WITHOUT a document: cold-reconstruct the successor's context from the change-directory blackboard."* (also appends to `handoffs[]` → consumes relay budget per the same paragraph).
  - The cheap in-session primitive exists but is buried under F.1's cross-session framing (`_orchestration.ts:174-176`): a still-alive worker (one that just returned `DONE`) is reachable via `SendMessage` within the session.
- **Scenario:** An implementer returns `DONE` having ticked 3 of 5 tasks because it judged 4.4/4.5 unnecessary and said so in its `DONE` summary. H.4 discards that summary, treats it as a document-less handoff, **cold-reconstructs** a fresh successor from the blackboard (which cannot show the two-tasks-are-moot reasoning), and burns a relay toward the decompose cap. The worker is alive and in-session; a single `SendMessage` ("you left 4.4/4.5 unticked — finish or explain") is far cheaper and preserves its reasoning — the same class of over-reaction the calibration defect flags for transient deaths.
- **Verified:** H.4 explicitly folds "returns DONE with unticked tasks" into the same cold-reconstruct branch as a document-less death; F.1's in-session SendMessage primitive is present but scoped under the "agentIds are dead handles across a restart" cross-session header.
- **Fix direction:** Split the taxonomy in H.4: (a) alive worker, ambiguous DONE, same session → `SendMessage` clarify/finish (no relay charged); (b) worker dead / cross-session → cold-reconstruct. Charge relay budget only in (b).

---

## OR-7 — A `loop` stage has one `role` (`fixer`) but Step E dispatches reviewers + implementers inside it → per-role handoff threshold is misresolved
- **Taxonomy:** F (cross-file seam) + B
- **Severity:** Major (systematic wrong handoff timing for reviewers dispatched inside the review loop)
- **Sides:**
  - `small-feature.yaml:26-28` / `full-feature.yaml:68-74`: the `review-loop` stage has `role: fixer`.
  - `_orchestration.ts:103` (Step E.1): *"dispatch **reviewer** worker(s)… over the current diff"* and E.2 routes non-trivial fixes to the **implementer** — i.e. the loop stage internally dispatches reviewer/implementer/fixer roles.
  - Threshold resolution keys on the *stage's* single role: `resolveStageHandoffConfig` (`types.ts:431-437`) reads `stage.role`; H (`_orchestration.ts:219`) notes reviewers vs fixers *"typically carry higher thresholds."*
- **Scenario:** A pipeline sets `handoff.roles: { reviewer: 0.65, fixer: 0.45 }`. The reviewer dispatched *inside* the `review-loop` stage (Step E.1 / E.4 re-review) belongs to a stage whose `role` is `fixer`, so per-stage resolution hands that reviewer the 0.45 fixer threshold instead of its intended 0.65 reviewer threshold — the reviewer relays ~20 points of context too early every loop. The one-role-per-stage metamodel cannot express the loop's multi-role dispatch, and the playbook never tells the LEAD to resolve thresholds by the *dispatched* role rather than the stage role.
- **Verified:** review-loop stages are `role: fixer`; Step E provably dispatches reviewers/implementers; resolveStageHandoffConfig is stage-role-keyed.
- **Fix direction:** State in Step E/H that inside a loop stage the LEAD resolves each dispatched worker's handoff threshold by that worker's *actual* role (`handoff.roles[<dispatched role>]`), not by the loop stage's nominal `role`.

---

## OR-8 — Reuse-threshold semantics: schema says "headroom", playbook + other schema comment use it as an occupancy ceiling
- **Taxonomy:** F (cross-file seam) + A
- **Severity:** Minor (playbook behavior is determinate; the trap is for config authors)
- **Sides:**
  - `types.ts:131-134` (`ReuseThresholdSchema`): *"the fraction of context **headroom** in (0, 1] a worker must **have** before it may take on a whole new child change."* — headroom semantics (0.25 = need ≥25% free ⇒ occupancy ≤ 0.75).
  - `_orchestration.ts:208-209` (G.1.3): *"`pct ≤ threshold` → warm reuse. `pct > threshold` → retire."* where `pct` is **occupancy** (`_orchestration.ts:217`) ⇒ reuse only if occupancy ≤ 0.25 (headroom ≥ 0.75). And `types.ts:474-477`: reuse threshold *"stricter than handoff's"* (0.5) — only true under the occupancy reading.
- **Scenario:** Behavior today follows G.1.3 (occupancy ≤ 0.25 → reuse). But the `ReuseThresholdSchema` doc says the number is headroom. A maintainer tuning `reuse.threshold` per that doc — e.g. setting `0.6` to mean "reuse when ≥60% headroom" — actually makes reuse *more* permissive by occupancy (reuse until 60% full), the reverse of their intent. The stored number's meaning is self-contradictory across the two comments in the same file, with the playbook silently picking one.
- **Verified:** the "headroom … must have" comment and the "stricter than handoff's" comment coexist in types.ts and imply opposite comparisons; G.1.3 uses occupancy.
- **Fix direction:** Rewrite `ReuseThresholdSchema`'s comment to occupancy-ceiling language ("max occupancy at which a worker may take on a new child change") to match G.1.3 and the "stricter than handoff" note.

---

## OR-9 — `loopStallLimit` (goal rounds) vs `stallLimit` (handoff relays): H.5 names only the relay counter, Step L routes rounds to it
- **Taxonomy:** A (rule-vs-rule terminology) + C
- **Severity:** Minor (both default 2, so numerically harmless today; a conflation trap if either is retuned)
- **Sides:**
  - `_orchestration.ts:126` (Step L): *"`loopStallLimit` (default 2) consecutive NON-progressing **rounds** → run the Step H.5 LEAD strategy review."*
  - `_orchestration.ts:233` (H.5): *"on `stallLimit` consecutive NO-progress **relays** (this fires early…)."* — a different counter (`types.ts:224` deliberately separates `loopStallLimit` to *"avoid HandoffConfigSchema.stallLimit collision"*).
- **Scenario:** A pipeline author sets `handoff.stallLimit: 4` intending "let stalled *rounds* run longer," but that field governs only handoff **relays**; the goal loop still stalls at `loopStallLimit` = 2 rounds. Step L points the LEAD to H.5, whose text talks about `stallLimit`/relays, so which counter (and whose reset semantics) governs a goal round is ambiguous.
- **Verified:** two distinct fields exist in the schema with the stated anti-collision intent; H.5 is written only in relay terms yet is Step L's cited escalation entry.
- **Fix direction:** In H.5 add a parenthetical: "for a goal loop the counter is `loopStallLimit` over rounds (Step L), not `stallLimit` over relays."

---

## OR-10 — `loop.runArtifact` is a schema/YAML field the playbook never honors (hardcodes `goal-run.json`)
- **Taxonomy:** F (cross-file seam) + D
- **Severity:** Minor
- **Sides:**
  - `goal-loop-measure.yaml:20` (and evaluate/research): `loop: { … runArtifact: goal-run.json }`; schema `types.ts:230` `runArtifact: z.string().default('goal-run.json')`.
  - `_orchestration.ts:122` / `:128` (Step L): every reference hardcodes *"Append … to `goal-run.json`"* / *"authoritative = `goal-run.json` last record"*; the field is never read.
- **Scenario:** A pipeline sets `runArtifact: research-run.json`; the LEAD keeps writing/reading `goal-run.json`, so the configured spine and the actual spine diverge and resume reads the wrong (or empty) file.
- **Verified:** field present in all goal yamls + schema; Step L uses the literal filename throughout.
- **Fix direction:** Either make Step L read `loop.runArtifact` (fall back to `goal-run.json`), or drop the field from the schema/yamls and document the filename as fixed.

---

## OR-11 — `verifyPolicy: standard` (and schema `light`) carried by stages but only `adaptive` is defined
- **Taxonomy:** B (missing state) + F
- **Severity:** Minor
- **Sides:**
  - `small-feature.yaml:23` / `auto-decompose.yaml:35`: `verifyPolicy: standard`; schema enum `types.ts:258` = `adaptive | standard | light`.
  - `auto.ts:76-81` (§5) defines behavior **only** for `verifyPolicy=adaptive`; `standard` and `light` are listed as metadata (`auto.ts:51`) but given no semantics anywhere; the shared playbook (Step D:92) punts verifyPolicy to "the consuming workflow's own sections," and review-cycle/goal commands embed the playbook without any such section.
- **Scenario:** A `verify` stage with `verifyPolicy: standard` has no defined effect — the LEAD cannot tell it from no policy. `light` is unreachable dead config.
- **Verified:** enum has three values; only adaptive has a handler; standard is used in two shipped pipelines.
- **Fix direction:** Define `standard`/`light` in auto §5 (even as "standard = default single review; light = skip the loop when the diff is trivial"), or remove the unused enum members and the `standard` labels.

---

## OR-12 — define-goal gate guardrail says "confirm a measure command," but the gate also fires for evaluate/research pipelines that have no command
- **Taxonomy:** D (wrong-generalization)
- **Severity:** Minor
- **Sides:**
  - `goal-command.ts:92` guardrail: *"Always pause at the define-goal gate — never skip human confirmation **of a measure command**."*
  - `goal-loop-evaluate.yaml` / `goal-loop-research.yaml`: `define-goal` has `gate: true` but the gate carries an **evaluate** config (goal/rubric) with no command; `goal-plan.ts:63` frames the gate's rationale entirely as *"`measure.command` is arbitrary shell… the user confirms the command."*
- **Scenario:** On a `goal-loop-evaluate` run the LEAD reaches the define-goal gate whose stated purpose ("confirm the measure command") does not apply — there is no command. A LEAD taking the guardrail literally may treat the gate as vacuous and skip it, losing the intended human review of the goal/rubric.
- **Verified:** guardrail wording is measure-specific; the gate exists on all three goal pipelines; goal-plan's gate rationale is measure-only.
- **Fix direction:** Generalize the wording: "confirm the goal + gate (the measure command *or* the evaluate goal/rubric) before any round runs."

---

## OR-13 — `maxRelays` off-by-one: worker relays trigger review at the (N+1)th; session relays *stop* at the Nth
- **Taxonomy:** A (rule-vs-rule) + C
- **Severity:** Minor
- **Sides:**
  - `_orchestration.ts:233` (H.5): *"On the **(maxRelays+1)th** handoff request for one stage… STOP relaying and review."* (review, not a hard stop; may continue if progressing).
  - `_orchestration.ts:240` (H.7) + `handoff.ts:37`: *"`sessionHandoff.n` **at** `maxRelays`… stops auto-relay"* / *"if the new document's `n` has **reached** `maxRelays`… do NOT auto-spawn."* (hard stop).
- **Scenario:** With `maxRelays: 3`, worker relays are permitted through the 3rd and only reviewed on the 4th, while session relays are blocked at the 3rd. Same config value, two different trigger points and two different meanings (soft review vs hard stop). A reader calibrating "how many relays do I get" will be off by one depending on which mechanism they're in.
- **Verified:** H.5 says maxRelays+1 for worker relays; H.7/handoff.ts say at/reached maxRelays for session relays.
- **Fix direction:** State the asymmetry explicitly (worker relay = soft review after `maxRelays`; session relay = hard stop at `maxRelays`) or align the trigger points.

---

## OR-14 — `parallelGroup` has no stated Tier-C degradation
- **Taxonomy:** D (rule silently assumes subagent capability)
- **Severity:** Minor
- **Sides:**
  - `_orchestration.ts:90` (Step D **parallelGroup**): *"Run the group's members **concurrently** and collect every result before proceeding."* — no tier caveat.
  - Tier C = *"No subagent capability. Execute the pipeline sequentially in a single context"* (`_orchestration.ts:28`).
- **Scenario:** A `full-feature` run under Tier C hits the `experts` parallelGroup. Concurrency is impossible in a single context; the playbook never says "under Tier C run the group's members sequentially in-context," so a literal reader is stuck. (Lower severity than OR-4 because the result — run them one at a time — is correctable, whereas OR-4 loses an invariant.)
- **Verified:** parallelGroup rule states "concurrently" unconditionally; Tier C forbids concurrency.
- **Fix direction:** Add a clause: "Under Tier C, run parallelGroup members sequentially in the single context and collect all results before proceeding."

---

## OR-15 — Review-cycle round cap and handoff `maxRelays` are distinct counters that both default to 3 and are never disambiguated
- **Taxonomy:** C (precedence/ambiguity) + A
- **Severity:** Minor
- **Sides:**
  - `_orchestration.ts:107` (Step E.5): review *"rounds < cap → next round"*, *"Default cap: 3"* (this is `loop.maxRounds`, `types.ts:183`).
  - `_orchestration.ts:233` (H.5): handoff *"relays"* capped by `maxRelays` *"default 3"*.
  - Contrast: the goal loop explicitly disambiguates — `_orchestration.ts:116` *"rounds do NOT each cost a fresh relay."* The review-cycle loop makes no equivalent statement.
- **Scenario:** In a review-cycle stage a non-trivial fix routes to the implementer, which exhausts context and hands off (a relay) mid-round. Does that consume a review *round*, a *relay*, or both? Step E counts rounds; H.5 counts relays; both cap at 3 and the review-cycle text never says they are orthogonal (unlike Step L, which does). A LEAD may conflate them and terminate a loop after 3 relays that were really 1 review round.
- **Verified:** two same-valued caps; Step L has the disambiguating sentence, Step E does not.
- **Fix direction:** Add to Step E the goal-loop's clarification: a review round may span multiple worker relays; the round cap and `maxRelays` are independent counters.

---

## Checked and clean (no finding)
- **Single-writer invariant** — H.3:229, goal-iterate.ts:65, handoff.ts:62 all forbid workers writing run-state; worker writes are confined to blackboard artifacts (report files B:56, handoff docs, planning-context.md appends B.1.3). `goal-run.json` is LEAD-appended (Step L) and goal-iterate.ts:65 confirms the implementer does not write it. Consistent.
- **Author≠verifier statements** — Step C:80-82, review-cycle.ts:57, Step E.2/E.4:104-106, G.1.6:213 are mutually consistent once you read the two-tier routing (non-trivial→author-implementer; design-level→non-author fixer). No contradiction (Tier-C evaluate gap is filed separately as OR-4).
- **handoff.ts template vs H.3 contract** — return shape `HANDOFF { path, reason, completed, remaining }`, mandatory eliminated-hypotheses section for fixer/debugger, and triggers match across H.3:225-227 and handoff.ts:62/87. Same template; `retired-between-children` is an additional LEAD-initiated reason, not a contradiction.
- **auto.ts summaries vs playbook** — session threshold 0.5, review cap 3, ship-blocks-on-Blocker/Major, the three parallel-independence conditions, and author≠verifier all match between auto.ts guardrails and the playbook.
