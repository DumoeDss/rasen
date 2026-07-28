## ADDED Requirements

### Requirement: Navigator routes boundaries to the base runtime

Navigator SHALL describe the edit-boundary facility as
`rasen agent edit-boundary set|status|clear`, SHALL concisely define
`hard`, `soft`, and `unsupported`, and SHALL not list `rasen-freeze`,
`rasen-guard`, or `rasen-unfreeze` as available skills.

#### Scenario: Safety routing contains no retired skill

- **WHEN** the generated navigator is inspected
- **THEN** boundary guidance SHALL point to the base runtime commands
- **AND** no retired boundary skill name or invocation SHALL appear
