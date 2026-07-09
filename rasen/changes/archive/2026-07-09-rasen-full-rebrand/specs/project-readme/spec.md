## MODIFIED Requirements

### Requirement: Install instructions
The README SHALL provide install guidance for the rasen package: the global install command `npm i -g rasen`, the Node.js `>=20.19.0` requirement, and the chrome-use prerequisites (Google Chrome, Node 22+, Chrome started with remote debugging, first-connection Allow prompt). Command examples SHALL use the `rasen` command, show the workspace it creates as `rasen/`, and show slash commands with the `rasen:` prefix. The README SHALL NOT instruct users to uninstall an existing OpenSpec installation.

#### Scenario: Global install command
- **WHEN** a visitor decides to install
- **THEN** the README shows `npm i -g rasen` as the primary install command
- **AND** states Node.js `>=20.19.0` is required
- **AND** does not tell the reader to uninstall `@fission-ai/openspec` or any other OpenSpec install first

#### Scenario: chrome-use prerequisites listed
- **WHEN** a reader wants to use the chrome-use expert
- **THEN** the README lists Google Chrome, Node 22+, remote-debugging launch, and the first-connection Allow prompt

#### Scenario: CLI, workspace, and command naming are consistent
- **WHEN** the README shows an initialization example
- **THEN** it invokes the `rasen` command (e.g., `rasen init`)
- **AND** refers to the created workspace directory as `rasen/` and to slash commands with the `rasen:` prefix

### Requirement: Core capabilities overview
The README SHALL give a concise overview of rasen's core capabilities: the spec-driven workflow, the rasen pipeline family, harness autonomous iteration, goal-loop, chrome-use, and handoff.

#### Scenario: Capabilities enumerated
- **WHEN** a reader skims for what rasen does
- **THEN** the README describes the spec-driven workflow, the pipeline family, harness autonomous iteration (`/rasen:auto`), goal-driven iteration (`/rasen:goal`), chrome-use, and handoff/relay

### Requirement: License, alignment, and CI status
The README SHALL note the MIT license with dual copyright (`OpenSpec Contributors` and `DumoeDss`), state that rasen's workflow semantics are aligned with upstream OpenSpec v1.5.0 while its namespaces (CLI, commands, skills, workspace directory) are independent, and display a CI status badge pointing at the fork's `ci.yml` workflow.

#### Scenario: License and alignment noted
- **WHEN** a reader checks licensing and provenance
- **THEN** the README states MIT with both copyright holders
- **AND** describes the upstream relationship as workflow-semantics alignment with v1.5.0, with independent naming (not layout-identical)

#### Scenario: CI badge present and repointed
- **WHEN** the README is rendered
- **THEN** it shows a CI badge whose link targets the fork's repository (`DumoeDss/rasen`) `ci.yml` workflow
- **AND** it does not display upstream `@fission-ai/openspec` npm, downloads, or stars badges

## ADDED Requirements

### Requirement: Coexistence with upstream OpenSpec documented
The README SHALL state that rasen installs alongside upstream OpenSpec without conflict — distinct binary (`rasen`), distinct slash-command namespace (`/rasen:*`), distinct skill directories (`rasen-*`), and distinct workspace directory (`rasen/`) — and SHALL document `rasen migrate` as the copy-only path for adopting an existing `openspec/` workspace, noting the original directory is never modified.

#### Scenario: Coexistence stated
- **WHEN** a reader who already uses OpenSpec evaluates rasen
- **THEN** the README states both tools can be installed and used in the same project simultaneously
- **AND** lists the four separated namespaces (binary, commands, skills, workspace)

#### Scenario: Migration path documented
- **WHEN** a reader wants to move an existing OpenSpec project to rasen
- **THEN** the README documents `rasen migrate` as a copy-only migration that leaves `openspec/` untouched
