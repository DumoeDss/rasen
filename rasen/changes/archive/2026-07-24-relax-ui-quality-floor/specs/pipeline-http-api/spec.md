## MODIFIED Requirements

### Requirement: Draft validation endpoint dry-runs a definition without writing or spawning

The server SHALL serve `POST /api/v1/pipeline-validation` accepting `{ definition, space? }` and validating the body-carried draft in-process through the same rule chain the pipeline loader and execution preflight enforce — schema shape, duplicate stage ids, dangling `requires` references, dependency cycles (reporting the cycle path), parallel-group mutual independence, decompose-stage constraints, the composed-origin quality floor, and skill known/enabled checks against the installed skill inventory. The response SHALL be 200 with `{ valid, issues }` for BOTH valid and invalid drafts — invalidity is data, not a transport error — where each issue carries a severity (`error` or `warning`), a locator path into the definition (such as `/stages/2/skill`), and a message; a draft failing any error-severity rule reports `valid: false`. The endpoint SHALL report ALL discoverable issues rather than stopping at the first, SHALL write no file and spawn no subprocess, and SHALL NOT occupy the mutation bridge's concurrency slot. 400 SHALL be answered only when the body is not an object carrying a `definition`. The path is its own top-level path so that a pipeline named `validation` is never shadowed.

#### Scenario: Invalid draft reports all issues at 200

- **WHEN** a client posts a draft with a dependency cycle and a stage referencing an unknown skill
- **THEN** the response is 200 with `valid: false` and at least two error issues — one naming the cycle path and one locating the unknown skill by its stage's definition path

#### Scenario: Valid draft

- **WHEN** a client posts a draft that passes every rule
- **THEN** the response is 200 with `valid: true` and no error-severity issues

#### Scenario: Floor-free Canvas draft is valid

- **WHEN** a client posts an otherwise valid `origin: ui` draft that omits a reviewer-role stage, a review-cycle loop, or both
- **THEN** the response is 200 with `valid: true` and no quality-floor error issue

#### Scenario: Floor-free composed draft is invalid

- **WHEN** a client posts an `origin: composed` draft that omits a reviewer-role stage or a review-cycle loop
- **THEN** the response is 200 with `valid: false` and a quality-floor error issue naming the composed origin

#### Scenario: Validation is side-effect free and slot-free

- **WHEN** a validation request runs while a pipeline mutation subprocess is in flight
- **THEN** the validation answers normally (no 409), no file is written, and no subprocess is spawned

#### Scenario: Non-definition body rejected

- **WHEN** a client posts a body with no `definition` member
- **THEN** the response is 400 in the unified envelope
