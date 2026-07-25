## ADDED Requirements

### Requirement: An unavailable planning Store stops the command instead of degrading

When a project declares a Store for configuration inheritance and that Store cannot be resolved on this machine, the command SHALL stop and report the expected Store, the reason it cannot be used, and a copy-pasteable repair command. It SHALL NOT resolve configuration as though the project had declared no Store. The reasons SHALL be distinguished: not registered on this machine, missing Store metadata, a checkout carrying a different Store identity, an unhealthy Store root, an ambiguous alias, and an unreadable declaration. A project that declares no Store at all SHALL be unaffected and SHALL resolve exactly as before. Root and path comparisons SHALL be canonical, so a Windows root differing only by drive-letter case or separator form still matches and is not mistaken for a different Store.

#### Scenario: Unregistered Store stops the command

- **WHEN** a project with local planning declares `store: nowhere` and no Store `nowhere` is registered
- **THEN** the command fails, naming the declared Store, stating it is not available on this machine, and printing the command that would make it available
- **AND** it does not report configuration resolved from project, global, and default layers only

#### Scenario: Unreadable declaration stops the command

- **WHEN** a project's Store declaration cannot be read as a Store reference
- **THEN** the command fails naming the config file and the problem, with the repair command for fixing the declaration

#### Scenario: No declaration resolves as before

- **WHEN** a project declares no Store at all
- **THEN** configuration resolves from project, global, and default layers with no Store layer, no diagnostic, and no failure

#### Scenario: Registered root matches canonically on Windows

- **WHEN** the Store registry records the Store root with a different drive-letter case or separator form than the resolved declaration path
- **THEN** the Store is still recognized, its layer applies, and no identity mismatch is reported on that basis

#### Scenario: Diagnosis remains available while resolution fails

- **WHEN** a project's declared Store is unavailable for any of the reasons above
- **THEN** `rasen doctor` and `rasen store doctor` still run and report the full diagnosis with its repair command
- **AND** neither command writes, clones, registers, or repairs anything

#### Scenario: Machine scope and Store listing remain available while resolution fails

- **WHEN** a project's declared Store is unavailable and the user reads configuration at machine scope, or lists the Stores registered on this machine
- **THEN** both commands succeed, because neither resolves a project layer and so no Store layer applies
- **AND** the same configuration read at project scope still stops with the reason and the repair command

## MODIFIED Requirements

### Requirement: Root selection reports inheritance instead of ignoring the pointer

When root selection encounters a planning-shaped root that declares a well-formed `store:` pointer, it SHALL no longer warn that the declaration is ignored. If the declared Store resolves, the notice SHALL state that planning stays local, that configuration inherits from that Store, and whether the Store was resolved by its permanent identity or by its display alias. If the declared Store cannot be resolved, the command SHALL report that the declaration cannot be used on this machine, name the reason, and print the repair command, rather than proceeding with the declaration silently inactive. Every notice SHALL be localized in every supported CLI locale.

#### Scenario: Inheriting notice for a registered store

- **WHEN** a command resolves a planning-shaped root whose config declares a Store and that Store is registered
- **THEN** the emitted notice names the Store and states that configuration inherits from it (not that the declaration is ignored)
- **AND** the notice states whether the permanent identity or the display alias was what resolved

#### Scenario: Inactive-pointer warning for an unregistered store

- **WHEN** the declared Store is not registered on the machine
- **THEN** the command reports that the declared Store cannot be used on this machine, names the reason, and prints the repair command
- **AND** it does not continue as though the project had declared no Store

#### Scenario: Behavior change is called out in the changelog

- **WHEN** a user reads the release notes for the version introducing this capability
- **THEN** the changelog states that a project declaring `store:` alongside local planning now inherits configuration from that Store where it previously did not
- **AND** the changelog states that a declared Store which cannot be resolved now stops the command instead of resolving as though no Store were declared

## REMOVED Requirements

### Requirement: Inactive inheritance degrades without failing

**Reason**: Silently dropping the Store layer for an unresolvable Store makes a mis-registered, renamed, or not-yet-cloned Store indistinguishable from a project that never declared one — the project then runs on global and default values that look legitimate. Replaced by "An unavailable planning Store stops the command instead of degrading", which reports the expected Store, the reason, and a repair command.

**Migration**: A project that declares a Store which is not registered on this machine now fails instead of resolving without a Store layer. Run `rasen doctor` to see the reason and the repair command; register the declared Store's checkout, correct the declaration, or remove the `store:` line to make the project genuinely Store-less. The canonical-path matching behavior of the removed requirement is preserved verbatim in the replacement.
