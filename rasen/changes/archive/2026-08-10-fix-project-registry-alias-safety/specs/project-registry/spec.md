## ADDED Requirements

### Requirement: Canonical registry aliases preserve proved home ownership
When multiple raw registry keys collapse to one platform-canonical project root, the registry SHALL preserve the direct canonical claimant when present, otherwise the unique live claimant's fixed identity and home. Missing aliases SHALL NOT replace a live claimant's fixed metadata, and a mutation SHALL fail closed before any registry or home change when live aliases disagree on normalized identity or assigned home.

#### Scenario: Direct claimant survives alias collapse
- **WHEN** a direct canonical registry entry and one or more path aliases collapse to the same live project root
- **THEN** reads and authorized repairs preserve the direct entry's project identity and assigned home regardless of raw key order

#### Scenario: Unique live alias outranks a missing alias
- **WHEN** no direct entry exists, one alias is live, and another alias for the same canonical claim is missing
- **THEN** canonical collapse preserves the live alias's fixed identity and home
- **AND** the missing alias cannot orphan or replace that home because its raw key sorts first

#### Scenario: Conflicting live aliases refuse mutation
- **WHEN** live aliases for one canonical claim disagree on normalized project identity or assigned home
- **THEN** registration or self-heal refuses to collapse or rebind the claim
- **AND** registry bytes and every existing home directory remain unchanged

#### Scenario: Windows aliases form one canonical claim
- **WHEN** registry keys differ only by Windows drive-letter case, separator spelling, or equivalent dot segments
- **THEN** they are evaluated as aliases of one canonical claim under the existing Windows path policy
- **AND** their insertion order does not decide which home survives

### Requirement: Read-only project-home resolution is canonical and non-creating
Every non-ensuring project-home probe SHALL use the same canonical main-entry lookup as project owner and planning resolution. It SHALL prefer a registered main-checkout entry over a legacy linked-worktree entry, use the direct worktree entry only when the main entry is unavailable, and create no config, registry claim, machine home, or directory.

#### Scenario: Legacy worktree entry cannot shadow the main home
- **WHEN** a linked worktree has both a registered canonical main entry and a legacy worktree-keyed entry naming a different home
- **THEN** a non-ensuring project-home probe returns the canonical main entry's home
- **AND** the registry and both recorded homes remain unchanged

#### Scenario: Surviving worktree retains its direct fallback
- **WHEN** the main checkout or its registry entry is unavailable and a surviving linked worktree has a direct registered entry
- **THEN** a non-ensuring project-home probe returns the direct entry's existing home without creating or rebinding state

#### Scenario: Alias-only self-heal does not recreate a missing home
- **WHEN** a read-only root-resolving command refreshes an already-owned alias-only canonical claim whose recorded home directory is absent
- **THEN** the command creates no machine-home directory and no new registry claim
- **AND** it does not mint or rewrite project config identity

#### Scenario: Config and canonical entry must agree
- **WHEN** a non-ensuring home probe finds a canonical registry entry whose normalized project identity differs from the root config identity
- **THEN** it returns no machine home from that inconsistent binding
- **AND** it leaves config, registry, and directories unchanged
