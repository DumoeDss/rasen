## ADDED Requirements

### Requirement: Review carries a Standards axis and a Spec axis
The `review` skill SHALL express its review along two axes, reported side by side and never reranked or merged: a **Standards axis** (does the diff follow the repo's documented standards plus the Fowler smell baseline) and a **Spec axis** (does the diff faithfully implement the originating OpenSpec change). The existing checklist-driven two-pass review SHALL be preserved as the Standards axis content (surgical augmentation, not a restructure). This is adapted from grill `code-review` (MIT) and SHALL carry an attribution note.

#### Scenario: Both axes present and reported separately
- **WHEN** `skills/gstack/review/SKILL.md` is regenerated and inspected
- **THEN** it SHALL describe a Standards axis and a Spec axis
- **AND** it SHALL instruct presenting them under separate side-by-side headings without merging or reranking findings

#### Scenario: Spec axis targets the OpenSpec change
- **WHEN** the Spec axis instructions are inspected
- **THEN** the spec source SHALL be the originating OpenSpec change's `proposal.md` / `tasks.md`
- **AND** the axis SHALL check for missing/partial requirements, scope creep, and wrong-looking implementations
- **AND** there SHALL be no reference to `/setup-matt-pocock-skills` or `docs/agents/issue-tracker.md`

#### Scenario: Parallel-worker orchestration
- **WHEN** the two-axis mechanism is inspected
- **THEN** the skill SHALL offer running the two axes as parallel `Agent` workers so they do not pollute each other's context

### Requirement: Fowler smell baseline in the review checklist
The Fowler 12-smell baseline SHALL be added to `skills/gstack/review/checklist.md` (the Standards content store read by review), as judgement-call heuristics, with the rules that a documented repo standard overrides the baseline and that anything tooling enforces is skipped. It SHALL NOT be duplicated in the review tmpl.

#### Scenario: Baseline present in checklist, not duplicated
- **WHEN** `skills/gstack/review/checklist.md` is inspected
- **THEN** it SHALL list the Fowler smells (e.g. Mysterious Name, Duplicated Code, Feature Envy, Data Clumps, Primitive Obsession, Shotgun Surgery, Divergent Change, Speculative Generality, Message Chains, Middle Man, Refused Bequest, Repeated Switches)
- **AND** it SHALL state that documented repo standards override the baseline and tooling-enforced items are skipped
- **AND** the review tmpl SHALL NOT restate the smell list

### Requirement: Review structure and registration preserved
The absorption SHALL be surgical: review's existing step structure, checklist sidecar contract, registration, and skill count SHALL be unchanged.

#### Scenario: No structural or registration drift
- **WHEN** the review skill's step headers and `getSkillTemplates()` entry are inspected
- **THEN** the existing Step 1–5 structure SHALL remain
- **AND** the `openspec-gstack-review` registration and all skill counts SHALL be unchanged
