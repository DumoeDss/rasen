## ADDED Requirements

### Requirement: Node Version Range Coverage

CI SHALL verify the declared supported Node version range (`engines.node >= 20.19.0`) at both ends: the existing per-OS legs run at the floor version, and at least one additional leg runs at the current Node major on Linux, so a break specific to a newer Node runtime is caught without exploding the matrix to a full OS × version grid.

#### Scenario: Floor version covered on every OS

- **WHEN** the `test_matrix` job runs
- **THEN** the `ubuntu-latest`, `macos-latest`, and `windows-latest` legs run the test suite on the `engines.node` floor version (20.19.0)

#### Scenario: Current Node major covered on Linux

- **WHEN** the `test_matrix` job runs
- **THEN** at least one additional `ubuntu-latest` leg runs the test suite on the current Node major (a version newer than the floor)
- **AND** that leg has a distinct matrix `label` so its status check name does not collide with the floor Linux leg

#### Scenario: Added leg does not touch the Windows flake surface

- **WHEN** the node-version coverage leg is added
- **THEN** it runs on Linux with the standard Linux vitest worker cap, and the Windows leg retains its reduced worker cap, so the added coverage does not aggravate the known Windows locked-handle flakiness
