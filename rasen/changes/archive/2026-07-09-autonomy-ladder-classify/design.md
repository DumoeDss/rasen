## Context

`/rasen:auto` selects its pipeline in the auto template's "Select the pipeline" section (`src/core/templates/workflows/auto.ts`): explicit selector (`--pipeline <name>` or a leading known-pipeline token) wins, otherwise the default is `small-feature` with an explicit no-auto-escalate rule. `rasen pipeline classify` (`src/commands/pipeline.ts`) is a deterministic whole-word keyword heuristic (bug-fix keywords > full-feature keywords > `small-feature` default) whose JSON output is `{ suggested, matched, available }` and is documented as advisory-only.

This change is rung 1 of the autonomy ladder decided with the user on 2026-07-10 (see the portfolio's `planning-context.md`): make classify's suggestion adoptable as the LEAD's decision — behind an opt-in, because the project is on 0.1.x and default behavior must not move until the user flips it for 0.2.0.

An exact precedent exists: the autopilot gate policy (`--no-gate` flag + `autopilot.gates` config + built-in default, resolved by `resolveAutopilotGatePolicy` in `src/core/project-config.ts`, specced in `rasen/specs/autopilot-gate-policy/spec.md`). This design deliberately clones that axis's shape.

## Goals / Non-Goals

**Goals:**
- Opt-in automatic pipeline selection: when enabled and no explicit selector is present, the LEAD adopts the classify suggestion instead of hard-defaulting to `small-feature`.
- Keep the three invariants: default OFF (0.1.x behavior byte-identical when not opted in), explicit selection always wins, `small-feature` fallback when classify is unavailable or unhelpful.
- Enrich the classify JSON contract just enough for responsible adoption: a `basis` field distinguishing a keyword-driven suggestion from the fallback default.

**Non-Goals:**
- No version bump; flipping the default to auto-select is a future 0.2.0 decision owned by the user.
- No change to the classify heuristic itself (keywords, priority order) — only its output contract.
- No run-state schema change: the chosen pipeline is already persisted in run-state at run start, and resume reads the recorded pipeline rather than re-selecting, so the selection policy needs no persistence.
- Rung 2 (LEAD-composed pipelines from the stage library) is the sibling change `autonomy-ladder-compose`.
- Rung 3 (runtime free-form DAG) is **rejected**, not deferred: it would break resume and the audit trail, and runtime dynamism is already covered by decompose (runtime fan-out) and goal-loop (runtime iteration).

## Decisions

### D1. Opt-in shape = flag + config key, cloned from the gate-policy axis

`--auto-select` on `/rasen:auto` and `autopilot.selection: classify | manual` in `rasen/config.yaml`, resolved with precedence **run flag > project config > built-in default (`manual`)** via a new `resolveAutopilotSelectionPolicy(config, autoSelectFlag)` beside `resolveAutopilotGatePolicy` in `src/core/project-config.ts`, returning `{ effective, source }` with the same `'flag' | 'config' | 'default'` source vocabulary.

- *Why both flag and config*: the flag serves one-off unattended runs; the config key lets a project opt in durably. This is exactly the split the gate policy already established, so users learn one pattern.
- *Why values `classify | manual` rather than a boolean*: leaves room for rung 2 to add `compose` as a third policy value without a schema break, and `manual` names today's behavior explicitly.
- *Alternative considered — flag only*: rejected; a project that wants auto-select would have to pass the flag on every invocation, and the gate-policy precedent already normalized the config layer.
- *Alternative considered — reuse `autopilot.gates`-style separate top-level key*: rejected; `autopilot` is documented in `project-config.ts` as the extensible map for future autopilot fields — this is that future field.

### D2. Explicit selector sits ABOVE the policy, not inside it

The selection order becomes: (1) explicit selector (`--pipeline` / leading known-pipeline token) — always wins, classify is never consulted, regardless of policy; (2) policy `classify` → adopt the classify suggestion; (3) policy `manual` (default) → `small-feature`, exactly today's text. The policy only governs the no-explicit-selector branch.

- *Why*: "explicit wins" is a portfolio invariant (已拍板) and matches the existing template's rule 1 verbatim; folding it into the policy resolution would make `--pipeline x --auto-select` ambiguous. As specified, that combination is well-defined: explicit wins, `--auto-select` is inert.

### D3. Classify enrichment = one `basis` field, not a confidence score

`rasen pipeline classify --json` adds `basis: 'keyword' | 'default'` (`keyword` when any indicator matched; `default` when the suggestion is the unmatched fallback). Human output gains a corresponding line. `suggested`/`matched`/`available` are unchanged — additive, backward compatible.

- *Why this is needed for adoption*: an adopting LEAD must distinguish "classify affirmatively suggested bug-fix (matched: fix)" from "classify defaulted to small-feature because nothing matched". Today that distinction is only implicit in `matched.length`; making it a named field turns the adoption contract into something the template (and specs) can state directly: adopt a `keyword`-basis suggestion with its indicators displayed; treat a `default`-basis result as the fallback it is.
- *Why not numeric confidence or a reason string*: the heuristic is a deterministic whole-word keyword match — a number would be fake precision, and `matched` already IS the reason (the template renders it, e.g. "auto-selected bug-fix (matched: fix, crash)").

### D4. Adoption and fallback semantics in the template

In the auto template's "Select the pipeline" section, when the policy resolves to `classify` and no explicit selector is present:
1. Run `rasen pipeline classify "<task>" --json`.
2. If it returns a `suggested` pipeline that appears in `available` → adopt it. Display the adoption with source and basis (e.g. `Pipeline: bug-fix (auto-selected, matched: fix)` / `Pipeline: small-feature (auto-selected, default basis)`), and let the user change it before proceeding — the existing DISPLAY-and-allow-change behavior is kept, adoption changes the starting value, not the user's authority.
3. If the command fails, returns no suggestion, or suggests a pipeline not in `available` → fall back to `small-feature` and display the fallback and its cause.

The resolved selection policy is displayed at run start alongside the gate policy line (e.g. `Selection policy: classify (flag)`), so an opted-in run is never silent about why it picked a pipeline.

- *Why "suggested must be in available"*: `available` is computed from the live registry in the same command; a mismatch can only mean a registry/heuristic inconsistency, and the safe move is the invariant fallback rather than dispatching an unloadable pipeline name.
- *No auto-escalation beyond adoption*: the LEAD adopts exactly the classify output; it never bumps a suggestion "up" (e.g. small-feature → full-feature by its own judgment). That keeps the decision auditable and deterministic. This replaces — under opt-in only — the current blanket "do NOT auto-escalate" rule, which remains verbatim for the default/manual path.

### D5. Config parsing follows the warn-and-drop convention

`autopilot.selection` parses inside the existing `autopilot` block in `project-config.ts`: a value other than `classify`/`manual` warns and drops that field while siblings (`gates`) still parse; an absent key falls through to the built-in default. Identical convention to `autopilot.gates`, including the Zod schema `.describe` documentation.

### D6. Template regeneration via build → update; parity hash updated by hand

`auto.ts` is a template source: after editing, run the build and regenerate installed skill/command copies via the update flow, then update the recorded hash in `test/core/templates/skill-templates-parity.test.ts` (the parity test pins template bytes; the new hash is pasted manually per established procedure).

## Risks / Trade-offs

- **[Heuristic quality]** The keyword heuristic is crude; adopting it may pick `bug-fix` for a task that merely mentions "fix". → Mitigation: opt-in default-off; the adopted choice is displayed with its matched indicators and remains user-changeable before any stage runs; explicit selector bypasses it entirely.
- **[Template-only enforcement]** Adoption/fallback logic lives in the LEAD template (prose), not code, so conformance depends on the LEAD following instructions. → Mitigation: same trust model as every other auto-template rule (gates, tiers); the CLI side (`basis` field, resolver function) is code-tested, and the template's rules are pinned by content assertions in `test/commands/auto.test.ts`.
- **[Config typo silently disables opt-in]** `autopilot.selection: clasify` drops to default `manual` with only a console warning. → Mitigation: warn-and-drop is the established convention for this config block (`autopilot.gates` behaves identically); the run-start `Selection policy:` display makes the effective policy visible.
- **[Sibling-change contention]** `autonomy-ladder-compose` edits the same auto.ts section next. → Mitigation: serial DAG (compose depends on classify); this change keeps the section's structure (numbered choice order + policy paragraph) so compose can extend rather than rewrite; the policy value space (`classify | manual`) was chosen so compose can add `compose` as a value.

## Migration Plan

Purely additive; no migration. Absent flag and config key, behavior is byte-identical to today (`manual` default). Rollback = revert the commit; no persisted state references the new policy (run-state is unchanged by design).

## Open Questions

None. The opt-in shape, invariants, and enrichment scope were settled with the user (portfolio planning-context, 2026-07-10); rung-3 rejection is recorded as a Non-Goal.
