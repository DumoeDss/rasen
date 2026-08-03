## MODIFIED Requirements

### Requirement: Denied-edit honesty in Fix-First flows

The Fix-First / fix-loop guidance carried in the PREAMBLE SHALL verify whether
each attempted write actually landed by inspecting the tool result and current
diff. A write that did not land SHALL be reported as an un-applied finding,
never as `[AUTO-FIXED]`, and SHALL NOT be silently dropped. Before a mutating
standalone expert reports completion, it SHALL inspect the changed-file set
against the task's declared scope and SHALL report an unexplained unexpected
file as unresolved out-of-scope work. This contract SHALL use observable write
and diff evidence without requiring or claiming a freeze/guard/runtime
edit-boundary.

#### Scenario: Failed write is not reported as fixed

- **WHEN** a standalone Fix-First flow attempts a write and the tool result or
  current diff shows that the intended change did not land
- **THEN** the generated PREAMBLE SHALL require the fix to be reported as
  un-applied
- **AND** SHALL prohibit `[AUTO-FIXED]` and silent omission

#### Scenario: Unexpected changed file remains unresolved

- **WHEN** a mutating standalone expert's final changed-file inspection finds
  a file outside the declared task scope without a recorded justification
- **THEN** the generated PREAMBLE SHALL require it to be reported as unresolved
  out-of-scope work
- **AND** SHALL NOT infer safety or completion from an absent boundary denial
