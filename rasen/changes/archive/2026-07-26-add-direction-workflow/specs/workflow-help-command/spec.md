## ADDED Requirements

### Requirement: Help distinguishes Direction from Change and goal-loop work

The help router SHALL route explicit long-lived product-direction, Roadmap
selection, and evidence-reconciliation requests to `rasen-direction`. It SHALL
explain that Direction is optional and SHALL continue routing ordinary bugs and
features to the Change lifecycle and bounded measurable/evaluable/research
iteration to `rasen-goal`.

#### Scenario: Long-lived workstream request

- **WHEN** a user asks to establish a North Star or Target State, select the
  next Roadmap slice, align multiple Changes to long-term direction, or
  reconcile completed work with a Roadmap
- **THEN** help SHALL name `rasen-direction` as the single next action

#### Scenario: Ordinary feature request remains direct

- **WHEN** a user asks to deliver a normal bug fix or small feature without a
  long-lived direction need
- **THEN** help SHALL route to the existing Change/manual or autonomous flow
- **AND** it SHALL NOT require `rasen-direction`

#### Scenario: Goal loop remains distinct

- **WHEN** a user wants to iterate toward a measurable threshold, evaluation
  rubric, or research report
- **THEN** help SHALL route to `rasen-goal`
- **AND** it SHALL distinguish that bounded loop from Direction Target State
