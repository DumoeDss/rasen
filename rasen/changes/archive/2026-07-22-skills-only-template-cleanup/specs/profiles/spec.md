## MODIFIED Requirements

### Requirement: Drift detection evaluates the desired selection as its dependency closure

Profile drift detection SHALL evaluate the desired workflow selection as its full dependency closure — the selection plus every expert required by a selected workflow's skill-dependency closure — before deciding whether an installed artifact is unexpected. Because a stored profile is intentionally not closure-expanded (a stored profile is not auto-expanded with closure-pulled experts) while installed experts are governed by the resolved profile plus dependency closure, the detector SHALL reconcile the two by closing the desired selection itself, using the same closure resolution as the install and removal seams. Consequently a closure-required expert that is present on disk SHALL NOT be reported as drift, and drift detection SHALL give the same result whether its caller passes the raw selection or an already-closure-resolved selection.

#### Scenario: Closure-required expert on disk is not drift for a custom profile

- **WHEN** a custom profile selects pipeline workflows without explicitly listing the experts those workflows require, the project is installed to match, and drift is evaluated against the stored (un-expanded) selection
- **THEN** the installed closure-required experts (e.g. the quality experts pulled in by the selected workflows) SHALL NOT be reported as drift, and no sync/drift warning SHALL be raised

#### Scenario: Detection is independent of whether the caller pre-resolved the closure

- **WHEN** drift is evaluated for the same project once with the raw stored selection and once with the closure-resolved selection
- **THEN** both evaluations SHALL return the same result

#### Scenario: A genuinely orphaned expert is still drift

- **WHEN** a built-in expert is installed on disk that is neither in the resolved profile's expert set nor required by any selected workflow's dependency closure
- **THEN** drift detection SHALL still report it, so real deselections continue to trigger sync

### Requirement: Config changes applied via update command
The existing `rasen update` command SHALL apply the current global config to a project. See `specs/cli-update/spec.md` for detailed update behavior.

#### Scenario: Config changes require explicit project sync
- **WHEN** user updates the profile or workflow selection via `rasen profile`
- **THEN** the global config SHALL be updated immediately
- **AND** project files SHALL remain unchanged until `rasen update` is run for that project
