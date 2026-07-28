## MODIFIED Requirements

### Requirement: Pipeline detail exposes execution support

Canvas Pipeline detail SHALL render `availableEngines` and exact
`reconcilerSupport { supported, reason, profileDigest }` returned by management
from the shared prepared support analyzer. It SHALL keep
LEGACY_NORMALIZED/legacy execution information distinct and SHALL disable
reconciler start for unsupported profiles rather than guessing from Pipeline
name.

#### Scenario: Canvas matches CLI show

- **WHEN** the same prepared Pipeline is opened in Canvas and CLI show without
  an intervening source/config change
- **THEN** engine availability, support reason, and profile digest match
- **AND** unsupported support state explains why reconciler start is unavailable

#### Scenario: Legacy normalization remains separate

- **WHEN** a Pipeline carries legacy executionMode or LEGACY_NORMALIZED warning
- **THEN** Canvas preserves that compatibility information separately
- **AND** it uses reconcilerSupport alone to enable reconciler start
