## Context

W5, the final portfolio child, gated on W3. Verified blast radius (design-doc premises re-confirmed during portfolio planning): `gate: 'vet'` lives in 3 built-in pipeline YAMLs (`goal-loop-{measure,evaluate,research}` `define-goal`), the Zod union (`pipeline-registry/types.ts` StageSchema), the wire literal (`config-api/wire-types.ts` `gate: false | true | 'vet'`), one display branch (`pipeline.ts`), and 7 agent-facing template-prose blocks. Spec-side, after W3 archives: the vet requirement and the gate-widening requirement live in `autopilot-gate-policy` main text; one vet sentence lives in W3's mask requirement; the vet-distinguishable scenario lives in W3's `pipeline-http-api` inventory requirement. `config-http-api` and `config-ui-package`'s gates-inventory requirement are already vet-free (W3 removed/migrated them). The telemetry payload is exactly five fields (`telemetry/index.ts:190-194`): `command`, `version`, `distinctId` (anonymous random UUID), `os` (process.platform), `node_version` (process.versions.node); environment kill-switches (`RASEN_TELEMETRY=0`, `DO_NOT_TRACK=1`, CI) resolve as env-override above every scope.

## Goals / Non-Goals

**Goals:**
- No gate type exists that configuration cannot control; `define-goal` becomes an ordinary (default-on) gate.
- Existing user pipeline YAML carrying `gate: vet` keeps loading forever — coerced, warned, never errored.
- Agent-facing prose and machine behavior change together — no template still claims a gate cannot be auto-approved.
- The telemetry toggle carries its own disclosure: the real payload, verbatim, plus the scope and env-override facts.

**Non-Goals:**
- No change to mask precedence, per-stage families, run-state, or any W3 machinery beyond deleting the vet exception.
- No telemetry behavior change of any kind — disclosure only.
- No UI localization (English copy, per the portfolio's W2 finding).

## Decisions

**D1 — Legacy coercion at the schema boundary, one warning per pipeline, and the literal survives in exactly one place.**
`StageSchema`'s gate becomes `z.boolean()` with a preprocessing step that maps the literal string `'vet'` to `true` and emits a warning naming the pipeline and stage ("gate: 'vet' is no longer a distinct gate type; reading it as gate: true — every gate is now individually controllable via pipelines.<name>.gates.<stage>"), deduplicated per pipeline per process (a module-level warned-set — same shape as other one-time warnings in the codebase). Hard-erroring was rejected by the ratified design: it would break every installed user library that copied the goal-loop pattern. Consequence recorded honestly: the design doc's "no `'vet'` literal remains in `src/`" success criterion is refined to "no `'vet'` literal outside the single legacy-coercion shim", and the guard test encodes exactly that (a source-tree grep asserting the only match is the shim file's coercion site).

**D2 — Templates change in the same commit as the schema, with per-template golden-hash repastes.**
The seven prose blocks are instructions the LEAD executes at runtime; dropping the carve-out in code while templates still order the agent to honour vet would keep the behavior alive in the worst possible way (enforced by prose, invisible to code review). Each touched template triggers a golden-hash repaste in `skill-templates-parity.test.ts` — run the test, copy actuals from the failure output, one repaste per template. The rewritten prose does not merely delete vet mentions: where a block explained "vet gates always pause", it now states the actual rule (gates resolve per the mask; `define-goal` pauses by default and is configurable like any stage).

**D3 — Spec surface: two stacked deltas + one ADDED-only, and one pure removal.**
- `autopilot-gate-policy`: (a) "A vet gate is never auto-approved" — REMOVED outright, no successor; the Reason/Migration text carries the autonomy consequence and the per-stage restoration recipe. (b) "Existing boolean gate configuration parses unchanged" — REMOVED+ADDED as "Legacy vet gate values read as ordinary gates" (the widening-compat requirement inverts into the narrowing-compat requirement). (c) W3's "Gate policy is a mask over per-stage gate configuration" — REMOVED+ADDED as "Gate policy is a mask over every stage gate", byte-identical minus the vet sentence. The RENAMED delta form was checked and rejected for all three: it is name-only (content must be unchanged), and every one of these changes content.
- `pipeline-http-api`: W3's inventory requirement REMOVED+ADDED with the declared gate narrowed to boolean and the vet scenario dropped; every other scenario carries verbatim.
- `config-ui-package`: ADDED-only "Telemetry payload disclosure on the Privacy surface" — order-independent with W2's and W3's pending deltas to that spec (touches no shared requirement).

**D4 — The disclosure is an isolated component keyed to one dot-path, not a ConfigEntryRow feature.**
A `TelemetryDisclosure` component renders beside the `telemetry.enabled` row when the Privacy tab shows it — the row component gains only a "render extra content for key X" seam (or the page composes it beside the row), not a generalized per-key help system. Rationale: exactly one key needs this today; a generic help framework is speculative surface, and an isolated component keeps W5's UI diff orthogonal to W2's row internals (W2 is landed by the time W5 applies, so no churn either way — this just minimizes the intersection). Content is a static English list of the five fields with one sentence each for global-only scope and env-override precedence; a parity test imports nothing from telemetry code but pins the five field names against a fixture that mirrors `telemetry/index.ts` (with a comment pointing maintenance at both sites).

## Risks / Trade-offs

- [Unattended `define-goal` under `autopilot.gates: off` runs arbitrary measure commands] → The ratified trade (design doc states it verbatim); mitigations: default is on, per-stage `on` restores the pause with one value, and the Pipelines page shows every gate. Recorded in the proposal and CHANGELOG — not re-litigated here.
- [A user library depends on vet's semantics (pause even under off)] → Their YAML now reads as `true`: pauses under the default, auto-approves under `off` unless they set the per-stage instance. The one-time warning names the exact replacement key. This is the designed behavior change, surfaced at load time rather than silently.
- [Golden-hash repastes across up to five template files invite copy slip] → One repaste per failing template from the test's own output; the parity test itself is the guard — a wrong hash cannot pass.
- [Disclosure drifts from the real payload if telemetry fields change] → The parity test fails on any field-name drift, pointing at both sites.
- [W3's ADDED texts shift during its review while W5 is pending] → Same stacked-delta discipline as every prior child: pre-archive verbatim re-check task; the LEAD's archive chain already sequences W3 → W5.

## Open Questions

- None blocking.
