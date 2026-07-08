## ADDED Requirements

### Requirement: Single Package-Manager Source of Truth

The repository SHALL declare pnpm as its sole package manager through package metadata and SHALL NOT track an npm `package-lock.json`, so that contributors and CI resolve exactly one lockfile (`pnpm-lock.yaml`) and one pnpm version.

#### Scenario: No npm lockfile is tracked

- **WHEN** the repository is checked out
- **THEN** no `package-lock.json` exists at the repository root
- **AND** `.gitignore` ignores a root `package-lock.json` so it cannot be reintroduced accidentally

#### Scenario: pnpm version is declared in package metadata

- **WHEN** CI provisions pnpm via `pnpm/action-setup@v4`
- **THEN** the pnpm version is read from the `packageManager` field in `package.json` rather than a hardcoded `version:` pin in each workflow step

#### Scenario: Frozen install still succeeds

- **WHEN** `pnpm install --frozen-lockfile` runs after the package-manager declaration is added
- **THEN** the install succeeds against the existing `pnpm-lock.yaml` without re-resolving dependencies
