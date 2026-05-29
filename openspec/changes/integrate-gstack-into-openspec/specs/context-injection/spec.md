# Delta Spec: context-injection

**Change:** integrate-gstack-into-openspec
**Modifies:** openspec/specs/context-injection/spec.md

## ADDED Requirements

### Requirement: Quality-rules injection ordering
The system SHALL inject quality-rules after rules and before template in the instruction output.

#### Scenario: Full injection order
- **WHEN** instructions are generated with context, rules, and quality-rules all present
- **THEN** injection order is: `<context>` → `<rules>` → `<quality-rules>` → `<template>`

#### Scenario: Quality-rules without rules
- **WHEN** instructions are generated with context and quality-rules but no rules
- **THEN** injection order is: `<context>` → `<quality-rules>` → `<template>`
