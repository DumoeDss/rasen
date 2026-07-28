# bundle-consent-content-binding Specification

## Purpose
When a bundle import asks for user consent, the exact content the user confirmed is bound by content digest and file identity across the async consent window. A file or symlink swap during consent is detected and refused rather than importing unconfirmed content.
## Requirements
### Requirement: A bundle previewed for consent is bound to its file identity across the consent window

When bootstrap previews a knowledge bundle for user consent, the system SHALL capture the bundle file's identity at preview time. After consent is received and before the bundle is applied, the system SHALL verify that the file's identity has not changed. A file swap (content replacement, symlink retargeting) during the consent window SHALL be detected and the import SHALL be refused — the system SHALL NOT apply content the user did not preview and consent to.

#### Scenario: A bundle file swap during consent is refused

- **WHEN** a bundle is previewed, user consent is requested, and the file at the bundle path is replaced with different content before consent returns
- **THEN** the post-consent identity check detects the change
- **AND** the import is refused with a diagnostic naming the bundle path and stating the file changed during consent

#### Scenario: A bundle that did not change during consent is applied normally

- **WHEN** a bundle is previewed, consent is received, and the file at the bundle path is unchanged
- **THEN** the import proceeds and applies the previewed content

#### Scenario: A symlink swap during consent is detected

- **WHEN** a bundle path is a symlink and the symlink target is changed between preview and apply
- **THEN** the identity check detects the change through file stat differences
- **AND** the import is refused

