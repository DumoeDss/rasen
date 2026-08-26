## MODIFIED Requirements

### Requirement: Issue dispatch decomposes a Store Issue into a reviewable plan

When the dispatch target is a Store Issue, `/rasen-auto` SHALL drive the Issue-dispatch path: the
LEAD decomposes the Issue's work into a decomposition document — one intent node per proposed
piece of work, each naming its target project and target line, its dependency edges, a `required`
or `optional` lifecycle, a suggested pipeline, and a decomposition rationale and/or uncertainty —
publishes it as the Issue's next Execution Plan revision through `rasen store issue plan
--from-decomposition`, reports the revision review-ready with its revision ordinal and node count,
and STOPS. The LEAD SHALL NOT fan out child changes, create child worktrees, or start any node
before the plan is confirmed; revising the plan and confirming execution are the human's flow. This
pause is deliberately distinct from the change-level decompose stage's LEAD-self-audit behavior:
an Issue dispatch's revision is the review surface, so publishing it and stopping IS the review
point. Target projects in a decomposition document are the decomposer's proposals, gated at
publication by the planning-member rule; the system SHALL NOT auto-route work to a project.

After the human confirms — running `rasen store issue confirm` over the reviewed revision, with
whatever new revisions their review authored through the existing publication channels — the
LEAD SHALL continue the dispatch by driving confirmed nodes through their launch contracts: for
each launchable node the confirm step reported, run `rasen store issue start --node <id>` and
execute the emitted contract's pipeline from its working directory, honoring the dependency
frontier so a downstream node waits for completed work. The LEAD SHALL treat the operator's
confirm as the green light and the revision as the scope — no node outside the confirmed
revision's wanted work is started, and a revision published after confirmation SHALL be
confirmed in turn before its new work starts.

#### Scenario: The LEAD publishes the decomposition and stops

- **WHEN** `/rasen-auto` addresses a Store Issue and the LEAD has produced a decomposition document
- **THEN** the Issue's next Execution Plan revision is published from the document
- **AND** the run reports the revision review-ready with its ordinal and node count, and starts no node

#### Scenario: No fan-out before confirmation

- **WHEN** a decomposition has been published as a revision
- **THEN** no child change, child worktree, or pipeline run has been created for it
- **AND** the Issue's phase reads `planning`, because the revision names only intent nodes

#### Scenario: The LEAD continues after the human confirms

- **WHEN** the operator has run `rasen store issue confirm` over the reviewed revision
- **THEN** the LEAD may drive each launchable node the confirm step reported through its `store issue start` launch contract
- **AND** nodes whose dependencies' work is not complete are not started, and no node outside the confirmed revision's wanted work is started

#### Scenario: The change-level decompose stage keeps its behavior

- **WHEN** `/rasen-auto` addresses a change-level task rather than a Store Issue
- **THEN** the existing decompose-stage evaluation and LEAD self-audit apply unchanged
- **AND** nothing in the Issue-dispatch path alters the change-level fan-out behavior
