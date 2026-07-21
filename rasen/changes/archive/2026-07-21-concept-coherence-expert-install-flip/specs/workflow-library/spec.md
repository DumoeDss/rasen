## REMOVED Requirements

### Requirement: Expert installation is unchanged in this round

**Reason**: Superseded — this change performs exactly the install-semantics flip that 6a deferred. Experts move from unconditional installation to profile-default plus dependency-closure installation.
**Migration**: Existing installs are protected by the non-regressive expert-selection migration (see the `profiles` and `cli-update` capabilities): until a user explicitly re-selects experts, every built-in expert continues to be installed exactly as before.

## ADDED Requirements

### Requirement: Expert installation is profile-default plus dependency closure

The set of experts installed into a project SHALL be the experts named by the resolved profile selection, together with the dependency closure of every selected workflow's `requires.skills`. Experts SHALL NOT be installed unconditionally. A workflow's `requires.skills` reference SHALL be resolved through either skill identity form (the colon `template.name` form or the hyphen `dirName` form) so a required expert is pulled regardless of which form the workflow declares.

#### Scenario: Profile-default experts are installed

- **WHEN** a profile resolving to a given expert set is installed via `rasen init` or `rasen update`
- **THEN** exactly the experts in that profile's default expert set (plus any pulled by dependency closure) SHALL be installed
- **AND** experts outside that set SHALL NOT be installed, unless a selected workflow requires them

#### Scenario: Dependency closure pulls required experts

- **WHEN** a selected workflow declares an expert in its `requires.skills` (for example `auto-command`, `review-cycle`, or `verify-enhanced-command` requiring `review`)
- **AND** the resolved profile does not otherwise name that expert
- **THEN** the required expert SHALL still be installed
- **AND** this SHALL hold whether the workflow declares the colon or hyphen skill-identity form

#### Scenario: Deselected expert is installed only when referenced

- **WHEN** an expert is neither in the resolved profile's expert set nor pulled by any selected workflow's `requires.skills`
- **THEN** that expert SHALL NOT be installed
- **AND** an install already present on disk SHALL be removable on the next update (subject to the deletion/refcount guard)

### Requirement: A referenced expert cannot be pruned

An expert that is referenced by any selected workflow's dependency closure SHALL remain installed even when the active profile does not name it, and SHALL be protected from deletion by the workflow refcount guard. Built-in experts SHALL remain non-deletable regardless of any flag.

#### Scenario: Closure-required expert survives a lean profile

- **WHEN** a lean profile omits an expert that a selected workflow requires
- **THEN** the expert SHALL be installed and retained
- **AND** an attempt to delete it while the referring workflow is installed SHALL be refused, naming the referrer
