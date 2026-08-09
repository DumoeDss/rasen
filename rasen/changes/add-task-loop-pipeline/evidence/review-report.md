# Pre-Landing Review: add-task-loop-pipeline

- Mode: dispatched, report-only, ONE_SHOT
- Branch: `dev/0.2.0`
- HEAD: `a1306828`
- Base: `main` (`origin/main` at `7006b0e7`)
- Scope: live uncommitted TaskLoop implementation and its tests/change artifacts
- Excluded as instructed: `rasen/config.yaml`, `.rasen/`, `rasen/changes/add-thing/`, `rasen/changes/ecp-v2-default-authoring-and-builtins/`, `rasen/specs/billing/`
- Greptile: no PR/comment set was available; triage skipped

## Scope Check

**REQUIREMENTS MISSING**

Intent: add an explicitly selected, reconciler-only, spec-free `task-loop` Pipeline with a frozen launch contract, real-artifact builder/fresh-critic iteration, exact evidence checks, and satisfaction-only delivery.

Delivered: the Pipeline, internal workflow, canonical input plumbing, GoalCycle integration, projections, localization, and a focused happy-path E2E exist; however, several mechanical trust and compatibility requirements are incomplete.

## Gate Summary

**VERDICT: FAIL**

Unique findings: **9** — **3 Blocker, 3 Major, 3 Minor, 0 Trivial**.

This change is not clean for gate purposes.

## Standards axis

- Findings: F1, F2, F3, F5, F7, F9
- Count: 3 Blocker, 1 Major, 2 Minor
- Worst: **Blocker** — untrusted/stale evidence can authorize delivery, physical path containment is bypassable, and the required repository test gate is not green.

## Spec axis

- Findings: F1, F2, F3, F4, F5, F6, F7, F8
- Count: 3 Blocker, 3 Major, 2 Minor
- Worst: **Blocker** — the implementation does not mechanically prove material workspace work or criterion-to-raw-evidence satisfaction before ship/archive.

## Findings

### F1 — [Blocker] Unrelated or stale evidence can produce a deliverable `satisfied` outcome

`src/core/change-run/internal/task-loop.ts:246-252` only checks that the completion carries at least one `EvidenceRef` and that each free-form criterion evidence string contains any frozen target as a substring. It does not bind each criterion to an evidence digest, verify that the referenced evidence belongs to the judge action, require its `treeDigest` to match the builder's `afterTree`/current workspace revision, or ensure the criterion's prose refers to that ref. The reused work contract in `src/core/change-run/internal/goal-cycle.ts:235-250` likewise accepts any two different SHA-looking strings and any shape-valid delta; it never compares them with the canonical workspace observation.

Consequently, a critic can submit one unrelated or old evidence ref, write `src/feature.ts` in every evidence sentence, and authorize ship/archive. The tests encode this weakness: `test/core/change-run/task-loop.test.ts:120` uses `[{}] as never`, while the E2E supplies fabricated tree digests and a static upload but still satisfies at `test/commands/pipeline-bugfix-e2e.test.ts:614`.

This violates the real-evidence requirements in `spec.md:72`, `spec.md:107`, `spec.md:112`, and the delivered-evidence requirement at `spec.md:138`.

Recommended fix: make criterion results carry explicit `evidenceDigests`; require a non-empty exact mapping for every frozen criterion; verify every ref's identity, Run/Action binding, target/schema, and current tree binding; validate builder `beforeTree`/`afterTree` and delta against canonical workspace observations; re-run the same validation before delivery. Add negative facade/E2E cases for unrelated refs, omitted mappings, stale trees, fabricated work revisions, and reused evidence.

### F2 — [Blocker] Both launch input and artifact targets lack physical path authorization

`src/core/change-run/internal/task-loop.ts:116-127` performs lexical `path.resolve`/`path.relative` containment only. A symlink, Windows junction, or reparse point inside the project that resolves outside it is accepted as an artifact target, so a workspace-write builder can be directed outside the authorized project root.

The hidden bridge has a second trust failure: `src/commands/pipeline.ts:214-224` accepts any caller-provided path, uses `statSync` followed by a separate following `readFileSync`, and neither restricts the file to the resolved TaskLoop ephemera directory nor rejects links/reparse points. This contradicts the design's bounded internal ephemera bridge and creates an avoidable host-file read/persistence seam.

Coverage only checks a lexical `..` escape and ordinary temporary files; it has no symlink, junction/reparse, parent-swap, no-follow, or authorized-ephemera case.

Recommended fix: authorize the bridge against the resolved change ephemera root and read one physically verified regular file with no-follow semantics; apply the repository's SafeRunPath-style physical containment to existing artifact targets and their existing ancestors, rejecting symlink/reparse traversal. Add Windows junction and Unix symlink tests plus a swap-resistant file-read test.

### F3 — [Blocker] The required repository test gate is not green

`rasen/changes/add-task-loop-pipeline/tasks.md:45` marks the full repository gate complete, but `evidence/verification.md:26-36` records two timeouts and a completed shard with **31 failures**, then states explicitly that the full suite is not represented as green. Only one named archive consumer was isolated and cleared; the remaining failures were not individually closed.

Per the canonical severity policy, an unresolved failing required gate is a Blocker even when the focused TaskLoop tests pass.

Recommended fix: triage the 31 failures to named pre-existing/environmental or branch-caused results, resolve branch-caused failures, and record one conclusive repository gate (or the repository's accepted deterministic shard matrix) before keeping task 6.1 checked.

### F4 — [Major] “Fresh critic” is neither session-fresh nor role-bound

`src/core/change-run/internal/task-loop.ts:319-337` stores prior `identityDigest` values, and `validateTaskLoopJudgment` compares only that aggregate digest at lines 218-223. Agent identity includes role/provider/runtime/adapter as well as `sessionIdentityDigest` (`src/core/change-run/internal/actors.ts:77-87`), so the same session can change another field and appear fresh. The validator also accepts a command/host actor or an agent claiming a non-reviewer role; no TaskLoop check binds the completion actor to the reviewer-bound admitted action.

The current tests vary the whole identity and never exercise same-session/different-metadata, non-agent, or wrong-role judgments. This leaves the central independent-context guarantee in `spec.md:88` unenforced.

Recommended fix: require `actor.kind === 'agent'`, bind its attested role/runtime to the admitted reviewer action/profile, and compare `sessionIdentityDigest` against the builder session and every prior TaskLoop critic session. Preserve full identity checks as an additional anti-spoof invariant. Add facade replay tests for all three rejection paths.

### F5 — [Major] Launch idempotency trusts a caller-supplied digest and breaks old empty-input Runs

The public start request exposes optional `launchRequestDigest` beside `pipeline` and `inputs` (`src/core/change-run/facade.ts:22-23`), but `src/core/change-run/internal/facade-runtime.ts:409-425` compares only the supplied digest (or the context's initial digest). It never recomputes the digest from the request nor proves that request Pipeline/inputs equal the frozen initial Record. A caller can therefore present changed fields with the old digest and receive `reused`; the test only supplies a deliberately different digest, so it does not cover this case.

There is also no compatibility path for Records created before this change: the old CLI stored `sha256(launchKey)`, while `src/commands/pipeline.ts:1135` now stores `digestLaunchIntent(...)`. Relaunching the same pre-change empty-input Run will conflict, despite task 1.4 explicitly requiring backward-compatible empty-input behavior (`tasks.md:6`). No legacy-record test exists.

Recommended fix: make one trusted layer derive the launch digest from normalized Pipeline/engine/inputs and reject any request/context mismatch; do not accept an independently caller-authored digest. Add a versioned compatibility check/migration for old empty-input digests, plus same-input, changed-input-with-spoofed-digest, changed-Pipeline, key-order, and legacy-record tests through the real facade/CLI.

### F6 — [Major] TaskLoop policy is selected by the string `task-loop`, not the exact built-in plan identity

`src/commands/pipeline.ts:1268-1277` invokes TaskLoop decoding based on the requested name, and `src/core/change-run/internal/task-loop.ts:292-297` enables all TaskLoop guards using only `plan.pipeline === 'task-loop' && record.pipeline === 'task-loop'`.

This conflicts with the repository's supported override rule: `src/core/templates/workflows/help.ts:92` states that a project Pipeline with a built-in name overrides the package Pipeline. A project/user `task-loop` override with a different DAG can therefore be misclassified, become permanently undeliverable if it has no goal loop, or run extra planning stages after a satisfied goal loop, defeating the exact built-in/spec-free lifecycle.

Recommended fix: either reserve `task-loop` against overrides or freeze/check trusted package provenance plus the exact iterate→ship→archive semantic shape/capability digest before enabling TaskLoop behavior. Add project- and user-shadowing tests that fail before work rather than silently changing lifecycle semantics.

### F7 — [Minor] Task-only result fields weaken every generic evaluate GoalCycle

`src/core/change-run/internal/goal-cycle.ts:175-182` adds optional `largestGap` and `passCondition` to the shared strict evaluate schema, and lines 317-325 preserve them for all evaluate GoalCycles. Existing goal Pipelines previously rejected those extra fields; they now accept and ignore them in progression. That is a generic wire-contract behavior change contrary to `spec.md:191`, which requires existing goal loops to preserve behavior.

The lowering test verifies declared capabilities only; no regression test asserts the old strict result contract remains strict.

Recommended fix: keep task feedback fields in a TaskLoop-specific result decoder/envelope, or make generic decoding plan-aware without widening non-TaskLoop validation. Add a generic evaluate negative test for task-only fields.

### F8 — [Minor] The required evidence report omits raw refs and has no executable regeneration path

The design says `task-loop-report.md` contains raw evidence references (`design.md:96`), but `src/core/change-run/internal/task-loop.ts:574-591` writes only contract digest, outcome, round, goal, and criterion prose. It omits the status section's raw evidence refs, largest gap, and pass condition. The test asserts only that the digest exists.

Additionally, projection write failures are swallowed in `src/core/change-run/internal/facade-runtime.ts:596-610`, while both delivery workflows require the report and instruct the agent to regenerate it (`ship.ts:46-48`, `archive-change.ts:59`); no CLI/facade regeneration Interface is exposed. A canonically satisfied Run can therefore reach an instruction that cannot be fulfilled mechanically after a write failure.

Recommended fix: serialize the canonical raw evidence digests and feedback fields into the report, expose an idempotent projection-regeneration path from the sealed plan/Record, and test missing, stale, write-failed, and edited report cases through ship/archive admission.

### F9 — [Minor] Root documentation is stale

`README.md:32` and `README.md:91` still define the Pipeline family as only `small-feature`, `bug-fix`, `full-feature`, and `auto-decompose`, and describe every loop as propose/implement/review/ship. The new explicit spec-free TaskLoop materially changes that user-facing description.

Recommended fix: add `task-loop` as the explicit-only spec-free `rasen-auto` path, distinguish it from `/rasen-goal`, and retain the warning that ordinary auto selection still defaults to `small-feature`.

## Code Path Coverage

```text
CODE PATH COVERAGE
==================
[+] Launch input bridge
    [TESTED] UTF-8 path with spaces/non-ASCII; malformed JSON/object
    [GAP] authorized ephemera containment, symlink/reparse, parent swap, size boundary

[+] Task contract
    [TESTED] required fields, duplicate IDs, lexical .. escape, freezing
    [GAP] physical symlink/junction escape and opaque-target validity

[+] Launch identity
    [TESTED] different caller-supplied digest conflicts
    [GAP] same canonical input reuse through CLI, changed input with spoofed digest,
          changed Pipeline with same digest, legacy empty-input Record compatibility

[+] Builder -> critic -> delivery
    [TESTED] one happy CLI journey; unit blocked/failed builder; unit exhaustion/cancel
    [GAP] canonical workspace revision binding, per-criterion raw-ref mapping, stale evidence,
          wrong-role/non-agent critic, same-session critic reuse, blocked judge,
          false-satisfaction/bar-mismatch/summary-only/cancel paths through real CLI

[+] Projection/report
    [TESTED] edited report cannot alter in-memory projected view
    [GAP] raw refs in report, missing/stale regeneration, write failure, delivery-side refusal

[+] Existing GoalCycle
    [TESTED] declared capability remains rasen-goal-iterate
    [GAP] shared evaluate result strictness and full goal-cycle regression behavior
```

## Confirmed requirements

- No new `rasen loop` command was added; only a hidden option on existing `pipeline start` was introduced.
- The workflow registry marks `rasen-task-loop` internal rather than user-invokable.
- Default/classifier code still returns only `bug-fix`, `full-feature`, or `small-feature`; focused CLI coverage confirms TaskLoop is not suggested.
- The built-in YAML contains only iterate→ship→archive and no ordinary gates, planner, retain, proposal, or spec stages.
- The happy-path E2E confirms no runtime proposal/design/specs/tasks/planning-context/goal-plan artifacts are created.
- Reconciler dependencies prevent the ordinary tail from becoming ready before a satisfied GoalCycle, and unit coverage confirms blocked/failed/exhausted/cancelled Records do not expose delivery actions.

## Review completion

Status: **DONE_WITH_CONCERNS**

No source, test, configuration, generated skill, or commit changes were made by this reviewer. The only write is this canonical report.
