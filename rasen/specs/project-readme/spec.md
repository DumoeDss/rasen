# project-readme Specification

## Purpose

This spec defines the content contract for the rasen project README — the brand narrative and taglines it must carry, the fork-lineage declaration, install guidance, capability overview, telemetry disclosure, and licensing/alignment notes a first-time visitor needs to decide whether to install rasen.

## Requirements

### Requirement: Brand hero and spiral narrative
The README SHALL open with rasen's brand identity: both taglines verbatim — `Rasen — loops that ascend` and `「不是循环，是螺旋」` — and a one-line statement of what rasen is, followed by the narrative arc that spec is the origin, loops are the form, each turn ascends, and the loop breaks through to a goal.

#### Scenario: Taglines present verbatim
- **WHEN** the README is opened
- **THEN** it contains the exact strings `Rasen — loops that ascend` and `「不是循环，是螺旋」` near the top, before the install section

#### Scenario: Narrative arc conveyed
- **WHEN** a first-time reader reads the opening section
- **THEN** it presents the spec → loops → ascend (harness) → breakthrough (goal) progression as rasen's mental model

### Requirement: Fork lineage and non-affiliation declaration
The README SHALL state that rasen is forked from OpenSpec (MIT) by Fission-AI, is independently maintained by Sayo, and is not affiliated with Fission-AI.

#### Scenario: Lineage stated
- **WHEN** a reader looks for the project's origin
- **THEN** the README declares it is a fork of OpenSpec (MIT) by Fission-AI, independently maintained by Sayo, not affiliated with Fission-AI

### Requirement: Install instructions
The README SHALL provide install guidance for the rasen package: the global install command `npm i -g @atelierai/rasen`, the Node.js `>=20.19.0` requirement, and the chrome-use prerequisites (Google Chrome, Node 22+, Chrome started with remote debugging, first-connection Allow prompt). Command examples SHALL use the `rasen` command, show the workspace it creates as `rasen/`, and show slash commands with the `rasen-` prefix. The README SHALL NOT instruct users to uninstall an existing OpenSpec installation.

#### Scenario: Global install command
- **WHEN** a visitor decides to install
- **THEN** the README shows `npm i -g @atelierai/rasen` as the primary install command
- **AND** states Node.js `>=20.19.0` is required
- **AND** does not tell the reader to uninstall `@fission-ai/openspec` or any other OpenSpec install first

#### Scenario: chrome-use prerequisites listed
- **WHEN** a reader wants to use the chrome-use expert
- **THEN** the README lists Google Chrome, Node 22+, remote-debugging launch, and the first-connection Allow prompt

#### Scenario: CLI, workspace, and command naming are consistent
- **WHEN** the README shows an initialization example
- **THEN** it invokes the `rasen` command (e.g., `rasen init`)
- **AND** refers to the created workspace directory as `rasen/` and to slash commands with the `rasen-` prefix

### Requirement: Core capabilities overview
The README SHALL give a concise overview of rasen's core capabilities: the spec-driven workflow, the rasen pipeline family, harness autonomous iteration, goal-loop, chrome-use, and handoff.

#### Scenario: Capabilities enumerated
- **WHEN** a reader skims for what rasen does
- **THEN** the README describes the spec-driven workflow, the pipeline family, harness autonomous iteration (`/rasen-auto`), goal-driven iteration (`/rasen-goal`), chrome-use, and handoff/relay

### Requirement: Telemetry disclosure and opt-out
The README SHALL disclose the anonymous usage telemetry: that it sends only command name, version, an anonymous UUID, and OS/Node version (no paths, arguments, or project data), and how to opt out via `RASEN_TELEMETRY=0` or `DO_NOT_TRACK=1`, with automatic disable in CI.

#### Scenario: Privacy contract stated
- **WHEN** a privacy-conscious reader looks for what is collected
- **THEN** the README states that only command, version, an anonymous UUID, and OS/Node version are sent, and nothing else

#### Scenario: Opt-out documented
- **WHEN** a reader wants to disable telemetry
- **THEN** the README documents `RASEN_TELEMETRY=0`, `DO_NOT_TRACK=1`, and automatic disable under CI

### Requirement: License, alignment, and CI status
The README SHALL note the MIT license with dual copyright (`OpenSpec Contributors` and `Sayo`), state that rasen's workflow semantics are aligned with upstream OpenSpec v1.5.0 while its namespaces (CLI, commands, skills, workspace directory) are independent, and display a CI status badge pointing at the fork's `ci.yml` workflow.

#### Scenario: License and alignment noted
- **WHEN** a reader checks licensing and provenance
- **THEN** the README states MIT with both copyright holders
- **AND** describes the upstream relationship as workflow-semantics alignment with v1.5.0, with independent naming (not layout-identical)

#### Scenario: CI badge present and repointed
- **WHEN** the README is rendered
- **THEN** it shows a CI badge whose link targets the fork's repository (`DumoeDss/rasen`) `ci.yml` workflow
- **AND** it does not display upstream `@fission-ai/openspec` npm, downloads, or stars badges

### Requirement: Coexistence with upstream OpenSpec documented
The README SHALL state that rasen installs alongside upstream OpenSpec without conflict — distinct binary (`rasen`), distinct slash-command namespace (`/rasen-*`), distinct skill directories (`rasen-*`), and distinct workspace directory (`rasen/`) — and SHALL document `rasen migrate` as the copy-only path for adopting an existing `openspec/` workspace, noting the original directory is never modified.

#### Scenario: Coexistence stated
- **WHEN** a reader who already uses OpenSpec evaluates rasen
- **THEN** the README states both tools can be installed and used in the same project simultaneously
- **AND** lists the four separated namespaces (binary, commands, skills, workspace)

#### Scenario: Migration path documented
- **WHEN** a reader wants to move an existing OpenSpec project to rasen
- **THEN** the README documents `rasen migrate` as a copy-only migration that leaves `openspec/` untouched
