## MODIFIED Requirements

### Requirement: The editor validates drafts and maps issues onto the canvas

The editor SHALL offer a validate action and SHALL always validate before saving, posting the current draft to the draft-validation endpoint. Returned issues SHALL be presented in an issues list carrying each issue's severity and message, and each issue whose locator path resolves to a stage SHALL be marked on that stage's card (and on the named field when its properties panel is open) with a select-the-stage affordance from the list; issues that resolve to no stage SHALL still appear in the list, never dropped. Error-severity issues SHALL block saving; warnings SHALL not. The `origin: ui` stamp records Canvas provenance only: an otherwise valid UI-assembled draft SHALL NOT receive a quality-floor issue merely because it lacks a reviewer-role stage, a review-cycle loop stage, or both.

#### Scenario: Issues land on their stages

- **WHEN** validation returns an error whose path points into the third stage's skill field
- **THEN** the third stage's card is marked, the issues list shows the message, and selecting the issue selects that stage

#### Scenario: Floor-free Canvas draft remains valid

- **WHEN** the user validates or attempts to save an otherwise valid UI-assembled draft with no reviewer-role stage, no review-cycle loop stage, or both
- **THEN** validation reports no quality-floor error for those omissions and saving may proceed

#### Scenario: Ordinary validation errors still block

- **WHEN** a UI-assembled draft has an error-severity issue from any remaining schema, graph, decompose, or skill validation rule
- **THEN** the issue is shown and no save request is sent

#### Scenario: Warnings do not block

- **WHEN** validation returns only warning-severity issues
- **THEN** the issues are listed, the affected stages are marked, and saving proceeds
