## Why

In a real `/opsx:office-hours` session the skill behaved as a one-way interrogation state machine: the user asked twice for the plan to be explained first, but the skill mechanically re-issued the AskUserQuestion option menu; the user's third protest ("answer my question first, stop blindly asking me questions") was misread as impatience and tripped the escape hatch straight into writing the design doc. The skill has no state for "the user asked a question back," and its only pressure-release valve (the escape hatch) means "fast-forward past the questions" — the opposite of the user's request for more discussion.

## What Changes

- Add a **Dialogue Override** section to the shared expert PREAMBLE (`_shared.ts`): AskUserQuestion is a decision tool, not a conversation tool. Before each call, check the user's previous message — if it contains a question, a request to explain/discuss, or free-text that is not a clean option selection, pause the state machine and answer in prose (no options, no RECOMMENDATION, no Completeness), keep discussing until the user signals to proceed, then resume the original phase without skipping ahead. Forbid combining "answer the question + advance the phase" in one turn. "Answer me first / let's discuss / repeated follow-ups" means *more* dialogue and never triggers fast-forward. Re-ground restatements only after a genuine long gap — no repeated template openers in continuous conversation. This benefits all expert skills that embed the PREAMBLE.
- **Scope `Completeness X/10`** in the AskUserQuestion Format: apply it only to shortcut-vs-complete-implementation decisions, not to discussion-type forks.
- **Tighten the office-hours escape hatch** (Startup and Builder modes): only explicit skip signals ("just do it" / "skip" / "stop asking, just write it") may trigger it; a user question or request to explain always routes to Dialogue Override instead. Add a hard gate to Phase 5: the sole precondition for writing the design doc is an explicit approval of an approach in Phase 4 — complaints, silence, and questions are not approval.
- Add a fourth **Interview discipline** rule: "Answer before you ask." The user's question is the highest-priority input; answering it precedes advancing the question list.
- Add a **Consultation posture** to office-hours: when the user opens with a concrete design plus "what do you think / is there a better way," skip generative questioning, deliver analysis prose directly, discuss peer-to-peer, and only after the discussion converges ask whether to distill it into a design doc. The doc is a byproduct of discussion, not the terminus of a flow.

## Capabilities

### New Capabilities
- `expert-dialogue-override`: Shared expert-skill dialogue rules carried in the PREAMBLE — pause the AskUserQuestion state machine and answer in prose when the user asks a question or requests discussion; scope the Completeness score to shortcut-vs-complete decisions. Applies to every expert skill that embeds the PREAMBLE.
- `office-hours-dialogue`: Office-hours-specific dialogue behavior — answer-before-you-ask interview discipline, escape-hatch semantics limited to explicit skip signals, a hard approval gate before writing the design doc, and a Consultation posture for users arriving with a concrete design.

### Modified Capabilities
<!-- rasen/specs is empty (openspec→rasen migration in progress); no live capabilities have requirements changing. Both capabilities above are introduced fresh. -->

## Impact

- **Source of truth (edited):** `src/core/templates/experts/_shared.ts` (PREAMBLE — new Dialogue Override section, Completeness scoping in AskUserQuestion Format), `src/core/templates/experts/office-hours.ts` (Interview discipline 4th rule, escape hatch tightening in Startup + Builder, Phase 5 hard gate, new Consultation posture).
- **Blast radius:** The PREAMBLE is shared by 14 hash-pinned expert templates (benchmark, codebase-design, codex, cso, design-consultation, design-review, investigate, navigator, office-hours, prototype, qa, qa-only, review, tdd). Every PREAMBLE-embedding template's generated output changes.
- **Golden master:** `test/core/templates/skill-templates-parity.test.ts` — both `EXPECTED_FUNCTION_HASHES` and `EXPECTED_GENERATED_SKILL_CONTENT_HASHES` entries for the affected templates must be recomputed and updated (no auto-updater; hashes are hardcoded constants).
- **Generated artifacts:** Installed `.claude/skills/*` are regenerated via `node dist/cli/index.js update`. No behavior change beyond the new prose.
- **Out of scope:** Other skills' conversational flows (they inherit the PREAMBLE benefit passively), `design-consultation` redesign, and the workflow-command layer (`workflows/office-hours.ts`) six-question flow.
