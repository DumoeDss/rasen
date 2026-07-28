# store-remote-credential-hygiene Specification

## Purpose
Clone remotes carried in shared Store metadata and project pointers MUST NOT embed credentials in userinfo, query, or fragment. Credential-bearing remotes are rejected before any write, and rejected values are never echoed in full.
## Requirements
### Requirement: Store metadata and pointers reject remotes carrying credentials in query or fragment

A remote URL that carries a non-empty query string or fragment SHALL be treated as credential-bearing. Store metadata and project pointer write paths SHALL reject such a remote before anything is written, with a diagnostic that names the credential-free alternative. This SHALL apply in addition to the existing userinfo-credential detection: a credential in any of userinfo, query, or fragment is sufficient to reject.

#### Scenario: A remote with a credential-bearing query parameter is rejected

- **WHEN** a Store metadata or pointer write receives `https://host.example.com/repo.git?access_token=secret`
- **THEN** the write is refused before anything is persisted
- **AND** the error names the remote in a redacted form that does not contain the secret value
- **AND** the error describes how to pass a credential-free remote

#### Scenario: A remote with a signed-URL query is rejected

- **WHEN** a Store metadata or pointer write receives `https://storage.example.com/repo.git?Signature=abc123&Expires=9999999999`
- **THEN** the write is refused before anything is persisted
- **AND** the error does not contain the signature or expiry value

#### Scenario: A remote with a fragment is rejected

- **WHEN** a Store metadata or pointer write receives `https://host.example.com/repo.git#token=secret`
- **THEN** the write is refused before anything is persisted
- **AND** the error does not contain the fragment value

#### Scenario: A remote with userinfo AND query credentials is rejected

- **WHEN** a Store metadata or pointer write receives `https://token@host.example.com/repo.git?private_token=xyz`
- **THEN** the write is refused before anything is persisted
- **AND** the error redacts both the userinfo and the query string, echoing neither

#### Scenario: A plain HTTPS remote with no query or fragment is accepted

- **WHEN** a Store metadata or pointer write receives `https://host.example.com/repo.git`
- **THEN** the remote is accepted and no credential error is raised

#### Scenario: An SSH remote is accepted

- **WHEN** a Store metadata or pointer write receives `ssh://git@host.example.com/repo.git` or `git@github.com:org/repo.git`
- **THEN** the remote is accepted and no credential error is raised

### Requirement: A rejected or redacted remote is never echoed in full

When a remote is rendered in any human-readable output, JSON field, clone-failure diagnostic, or error message, and that remote carries credentials in any position (userinfo, query, or fragment), the rendered form SHALL NOT contain the raw credential value. The query string and fragment SHALL be replaced with a redaction marker; the userinfo SHALL be replaced with a redaction marker.

#### Scenario: A query-string credential is not echoed in diagnostics

- **WHEN** a remote carrying `?access_token=secret` is rendered in an error message or diagnostic
- **THEN** the output does not contain the literal string `access_token=secret`
- **AND** the output shows the query position was redacted

#### Scenario: A userinfo credential is not echoed alongside a query credential

- **WHEN** a remote carrying both userinfo and query credentials is rendered
- **THEN** neither the userinfo password nor the query parameter value appears in the output
- **AND** both positions are shown as redacted

#### Scenario: A credential-free remote renders unchanged

- **WHEN** a remote with no credentials (no userinfo secret, no query, no fragment) is rendered
- **THEN** the remote appears verbatim in the output

