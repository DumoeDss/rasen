## ADDED Requirements

### Requirement: Commands that cannot resolve a Store name bootstrap as the repair

A command that fails because a declared Store is not available on this machine SHALL name `rasen bootstrap` as the repair, and the command it names SHALL resolve unambiguously on this machine — the permanent identity when the Store's display name matches more than one Store here, the display name otherwise. A command that fails because a declared Store has no recorded remote and no supplied path SHALL state that a path or remote is required, because bootstrap cannot infer a location either and MUST NOT suggest it can. A checkout that turns out to be a different Store SHALL fail without writing anything, and SHALL NOT name bootstrap, because bootstrap cannot repair a mismatched identity. Diagnosis SHALL remain read-only and SHALL report bootstrap readiness by composing the same facts the bootstrap command's check mode reports, with copy-pasteable repairs, so that one surface answers "what does this machine still need?"

#### Scenario: An unavailable Store points at bootstrap

- **WHEN** an ordinary command fails because a declared Store is not available on this machine
- **THEN** the failure names `rasen bootstrap` as the repair
- **AND** the command it names can be pasted and resolves to the same project

#### Scenario: The repair names an unambiguous selector

- **WHEN** an ordinary command prints a repair naming bootstrap for a Store whose display name matches more than one Store on this machine
- **THEN** the printed command names the Store's permanent identity
- **AND** pasting it runs bootstrap against the project that declared it

#### Scenario: An unlocatable Store asks for a path or remote

- **WHEN** an ordinary command fails because a declared Store has no recorded remote and no supplied path
- **THEN** the failure states that a path or remote is required
- **AND** it does not name bootstrap, because bootstrap cannot infer a location from a name, a sibling directory, or a path another machine recorded

#### Scenario: A mismatched checkout writes nothing

- **WHEN** the checkout registered for a declared Store carries a different identity
- **THEN** the command fails and the registry and the Store's metadata are both unchanged
- **AND** the failure does not name bootstrap, because a mismatched identity is not a gap bootstrap can close

#### Scenario: Diagnosis reports readiness without changing anything

- **WHEN** diagnosis runs on a machine that is not fully bootstrapped
- **THEN** it reports each unmet requirement with a copy-pasteable repair
- **AND** no file under the project, any Store, or the machine data directory is modified

#### Scenario: Diagnosis composes the same checks bootstrap performs

- **WHEN** diagnosis reports bootstrap readiness for a project
- **THEN** every Store the project declares is reflected in the readiness result
- **AND** a Store that bootstrap would classify as missing is reported as missing by diagnosis, with the same repair bootstrap itself would print

#### Scenario: Diagnosis and bootstrap agree

- **WHEN** the same project is reported by `rasen doctor` and by `rasen bootstrap --check`
- **THEN** both name the same Stores as missing and the same repairs for each
