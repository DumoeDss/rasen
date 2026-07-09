# opsx-ship-command Specification (delta)

## ADDED Requirements

### Requirement: Ship stamps the delivery chain and embeds store review material

Ship SHALL source its PR-body proposal read from the CLI-resolved change root (status JSON `changeRoot`) in every mode, and in store mode (`root.store_id` present in the status payload) SHALL perform the `sha-cross-stamping` capability's PR-body embedding: proposal Why/What plus delta spec content in collapsed sections, stamped with the store path and store repo HEAD SHA (dirty tree and non-git store stamped honestly), recording the store identity and SHA in the ship log alongside the existing commit/tree stamps. Under in-ship timing, ship SHALL complete the chain record itself (the archive outcome and the commit SHA, which is the ship commit).

#### Scenario: Proposal read is store-safe

- **WHEN** the generated ship workflow builds a PR body
- **THEN** it SHALL read the proposal from the status JSON's `changeRoot`, not a repo-relative literal path

#### Scenario: Store-mode ship log carries the store stamp

- **WHEN** ship delivers a store-rooted change in `pr` mode
- **THEN** the ship log SHALL record the store identity and the store repo HEAD SHA in addition to the code commit and tree fingerprint
- **AND** the PR body SHALL carry the embedded review material with the same stamps

#### Scenario: In-ship ship writes the full chain

- **WHEN** ship runs under `in-ship` timing
- **THEN** the ship log SHALL record the archive outcome and identify the ship commit as the archive commit, leaving nothing for a later archive append
