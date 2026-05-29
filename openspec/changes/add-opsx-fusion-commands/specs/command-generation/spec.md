# command-generation Specification

## Purpose
Registers the new OPSX fusion workflow commands in the command generation system so they are installed by `openspec init`.

## MODIFIED Requirements

### Requirement: Workflow Skill Template Registration

`getSkillTemplates()` SHALL include entries for the five new OPSX workflow commands.

#### Scenario: Office-hours skill template registered

- **WHEN** `getSkillTemplates()` is called
- **THEN** the returned list SHALL include an entry for the office-hours workflow skill
- **AND** the entry SHALL reference `getOfficeHoursCommandSkillTemplate()` from `workflows/office-hours.ts`

#### Scenario: Verify-enhanced skill template registered

- **WHEN** `getSkillTemplates()` is called
- **THEN** the returned list SHALL include an entry for the verify-enhanced workflow skill
- **AND** the entry SHALL reference `getVerifyEnhancedSkillTemplate()` from `workflows/verify-enhanced.ts`

#### Scenario: Ship skill template registered

- **WHEN** `getSkillTemplates()` is called
- **THEN** the returned list SHALL include an entry for the ship workflow skill
- **AND** the entry SHALL reference `getShipCommandSkillTemplate()` from `workflows/ship.ts`

#### Scenario: Retro skill template registered

- **WHEN** `getSkillTemplates()` is called
- **THEN** the returned list SHALL include an entry for the retro workflow skill
- **AND** the entry SHALL reference `getRetroCommandSkillTemplate()` from `workflows/retro.ts`

#### Scenario: Auto skill template registered

- **WHEN** `getSkillTemplates()` is called
- **THEN** the returned list SHALL include an entry for the auto workflow skill
- **AND** the entry SHALL reference `getAutoCommandSkillTemplate()` from `workflows/auto.ts`

### Requirement: Workflow Command Template Registration

`getCommandTemplates()` SHALL include entries for the five new OPSX workflow commands.

#### Scenario: Office-hours command template registered

- **WHEN** `getCommandTemplates()` is called
- **THEN** the returned list SHALL include an entry for the office-hours command
- **AND** the entry SHALL reference `getOpsxOfficeHoursCommandTemplate()` from `workflows/office-hours.ts`

#### Scenario: Verify-enhanced command template registered

- **WHEN** `getCommandTemplates()` is called
- **THEN** the returned list SHALL include an entry for the verify-enhanced command
- **AND** the entry SHALL reference `getOpsxVerifyEnhancedCommandTemplate()` from `workflows/verify-enhanced.ts`

#### Scenario: Ship command template registered

- **WHEN** `getCommandTemplates()` is called
- **THEN** the returned list SHALL include an entry for the ship command
- **AND** the entry SHALL reference `getOpsxShipCommandTemplate()` from `workflows/ship.ts`

#### Scenario: Retro command template registered

- **WHEN** `getCommandTemplates()` is called
- **THEN** the returned list SHALL include an entry for the retro command
- **AND** the entry SHALL reference `getOpsxRetroCommandTemplate()` from `workflows/retro.ts`

#### Scenario: Auto command template registered

- **WHEN** `getCommandTemplates()` is called
- **THEN** the returned list SHALL include an entry for the auto command
- **AND** the entry SHALL reference `getOpsxAutoCommandTemplate()` from `workflows/auto.ts`

### Requirement: Init Installation of New Commands

New workflow commands SHALL be installed by `openspec init` alongside existing OPSX commands.

#### Scenario: New commands generated during init

- **WHEN** user runs `openspec init`
- **THEN** the five new workflow commands (office-hours, verify-enhanced, ship, retro, auto) SHALL be generated into `.claude/commands/`
- **AND** the corresponding skill files SHALL be generated into `.claude/skills/`
- **AND** existing OPSX commands SHALL remain unchanged

#### Scenario: Update regenerates new commands

- **WHEN** user runs `openspec update`
- **THEN** the five new workflow commands SHALL be regenerated alongside existing commands
- **AND** any updates to template content SHALL be reflected in the regenerated files
