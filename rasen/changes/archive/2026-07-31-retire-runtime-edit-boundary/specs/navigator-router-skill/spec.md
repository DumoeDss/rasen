## ADDED Requirements

### Requirement: Navigator routes scope control without a runtime boundary

Navigator's current safety map SHALL contain no freeze/unfreeze or runtime
edit-boundary route. It SHALL direct destructive-command caution to
`rasen-careful`, root-cause isolation and declared affected-area work to
`rasen-investigate`, and changed-file/diff checking to the applicable review
or verification workflow. It SHALL not describe any of those routes as
mechanical write denial.

#### Scenario: Safety routing uses remaining controls

- **WHEN** a user asks navigator how to avoid accidental scope creep
- **THEN** navigator SHALL identify investigation scope declaration and
  changed-file review as the applicable workflow
- **AND** SHALL distinguish those controls from destructive-command caution
  and managed sandbox execution

#### Scenario: Retired route is absent

- **WHEN** the generated navigator `SKILL.md` is inspected
- **THEN** no `freeze`, `unfreeze`, `guard`, or `rasen agent edit-boundary`
  route or invocation SHALL appear
- **AND** navigator SHALL make no hard, soft, or unsupported edit-boundary
  enforcement claim
