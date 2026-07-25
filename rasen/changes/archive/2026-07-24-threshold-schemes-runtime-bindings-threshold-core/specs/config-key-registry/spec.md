## MODIFIED Requirements

### Requirement: Wildcard configuration key families including the pipeline runtime namespace

The registry SHALL support wildcard key families: entries declaring a fixed-shape dot-path pattern with literal and placeholder segments, the scopes instances may be set in, a value type with constraints, a display group, and optionally a default. A key path SHALL match a family exactly when its segment count equals the pattern's and every literal segment matches; each placeholder segment SHALL be validated structurally as a conservative identifier (letters, digits, hyphen, underscore) and, when a family declares a placeholder validator, against that family-specific rule. Without a family-specific rule, a placeholder SHALL NOT be validated against the existence of any pipeline, stage, role, or other referent—a well-formed instance for an unknown referent is accepted and inert. A path matching a family's literals but not its shape SHALL be rejected with a message naming the family's pattern. Family instances SHALL validate their values against the family's declared type and constraints in every declared scope, exactly like fixed keys.

The registry SHALL declare six families:

- `featureFlags.<name>` — boolean, global scope only, default false: its existing behavior is preserved byte-for-byte through the general mechanism, with no parallel special case remaining.
- `pipelines.<name>.gates.<stage>` — enum `on` | `off`, settable at global, store, and project scope.
- `pipelines.<name>.models.<stage>` — a model id (any non-empty string, no allow-list), settable at global, store, and project scope.
- `pipelines.<name>.handoff.<stage>` — the dual-form threshold (a fraction, or `{ remainingTokens: N }`), settable at global, store, and project scope.
- `pipelines.<name>.runtimes.<role>` — enum `claude` | `codex`, settable at global, store, and project scope.
- `thresholds.bindings.<runtime>` — a saved threshold scheme name, settable at global, store, and project scope; `<runtime>` accepts the probe-capable runtime IDs plus the reserved literal `default`, and the allowed values are enumerated from the machine's saved scheme filenames at validation time.

The four `pipelines.*` families and the `thresholds.bindings.*` family SHALL declare no default value: an unset instance is absent, not defaulted. A set instance SHALL round-trip through the configuration schema of every scope its family declares (the global config and a planning root's `rasen/config.yaml` both admit the corresponding block), and instance values failing validation on disk SHALL be reported as warnings and ignored, never rewritten. A syntactically valid binding value whose scheme is absent locally SHALL remain available as a dangling reference for resolution-time warning and fallback. Effective resolution SHALL surface every set instance as an entry carrying its full instance key, its per-scope raw values, and the standard precedence (project over store over global) gated by the family's scopes; the family definition itself SHALL remain visible as a template entry.

#### Scenario: Runtime family instance validates in all three scopes

- **WHEN** `pipelines.small-feature.runtimes.reviewer` is validated for scope `global`, `store`, or `project` with value `codex`
- **THEN** the key and value are accepted, and a value outside `claude`/`codex` is rejected naming the allowed values

#### Scenario: Pipelines family instance validates in all three scopes

- **WHEN** `pipelines.small-feature.gates.propose` is validated for scope `global`, `store`, or `project` with value `on`
- **THEN** the key and value are accepted, and a value outside `on`/`off` is rejected naming the allowed values

#### Scenario: Wrong-shape family path is rejected naming the pattern

- **WHEN** `pipelines.small-feature.runtimes` (missing the role segment) or `pipelines.small-feature.gates.propose.extra` is validated in any scope
- **THEN** validation rejects it with a message naming the family's shape

#### Scenario: Unknown referents are accepted structurally

- **WHEN** `pipelines.no-such-pipeline.runtimes.no-such-role` is set to `claude` in a declared scope
- **THEN** the write is accepted (a well-formed instance for an unknown referent is inert), and a placeholder segment containing a character outside letters, digits, hyphen, or underscore is rejected

#### Scenario: Threshold family accepts the dual form

- **WHEN** `pipelines.bug-fix.handoff.review` is set to `0.6` or to `{"remainingTokens": 60000}` at any of global, store, or project scope
- **THEN** both forms are accepted, and `1.5` is rejected naming the range and the alternate absolute form

#### Scenario: featureFlags behavior is unchanged through the general mechanism

- **WHEN** `featureFlags.someFlag` is validated with a boolean at global scope, with a non-boolean value, with a third segment, or at store scope
- **THEN** the boolean is accepted, the non-boolean is rejected, the third segment is rejected, and the store scope is rejected as not settable—identical to the behavior before the family mechanism existed

#### Scenario: Set instances resolve with per-scope values and precedence

- **WHEN** `pipelines.small-feature.gates.propose` is set to `off` globally and `on` in a project's config
- **THEN** effective resolution reports an entry for that instance with both raw scope values and the effective value `on` from the project layer

#### Scenario: Unset instances are absent, not defaulted

- **WHEN** no layer sets any `pipelines.*` or `thresholds.bindings.*` instance
- **THEN** effective resolution reports no instance entries for those families (only the family template entries), and no instance reports a default value

#### Scenario: Instance round-trips through each scope's schema

- **WHEN** the test suite runs
- **THEN** a test asserts a set instance of each family round-trips through the configuration schema of every scope the family declares, so the registry and the schemas cannot drift silently

#### Scenario: Binding placeholder uses the runtime capability registry

- **WHEN** `thresholds.bindings.claude`, `thresholds.bindings.codex`, `thresholds.bindings.default`, and `thresholds.bindings.zed` are validated
- **THEN** the probe-capable runtime paths and `default` are accepted, while audit-only `zed` is rejected with an actionable placeholder message

#### Scenario: Family-specific validation does not affect existing placeholders

- **WHEN** an unknown but structurally valid pipeline, stage, role, or feature-flag placeholder is validated
- **THEN** it remains accepted and inert exactly as before

#### Scenario: Binding values enumerate saved schemes dynamically

- **WHEN** scheme `focused` is saved after one validation pass and a later write validates `thresholds.bindings.codex: focused`
- **THEN** the later write accepts `focused` without restarting the process
- **AND** an unknown scheme name is rejected with the current allowed values

#### Scenario: Absent scheme directory yields no dynamic values

- **WHEN** the schemes directory is absent or cannot be enumerated
- **THEN** binding value enumeration returns an empty list without crashing configuration inspection
