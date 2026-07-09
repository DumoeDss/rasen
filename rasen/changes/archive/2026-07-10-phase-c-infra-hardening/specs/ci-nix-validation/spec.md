## MODIFIED Requirements

### Requirement: Nix Flake Build Validation

The CI system SHALL validate that the Nix flake builds successfully on every pull request and push to main, and this validation SHALL fail when `flake.nix`'s recorded `pnpmDeps.hash` no longer matches the dependency set pinned by `pnpm-lock.yaml`, so a stale pnpm hash cannot merge undetected.

#### Scenario: Successful flake build

- **WHEN** a pull request or push to main is made
- **THEN** the CI SHALL execute `nix build` and verify it completes with exit code 0
- **AND** the build output SHALL contain the rasen binary

#### Scenario: Flake build failure

- **WHEN** the Nix flake configuration is broken
- **THEN** the CI job SHALL fail with a non-zero exit code
- **AND** the CI SHALL prevent merging of the pull request

#### Scenario: Stale pnpm dependency hash fails the build

- **WHEN** `pnpm-lock.yaml` changes such that `flake.nix`'s recorded `pnpmDeps.hash` no longer matches the fetched dependency set
- **THEN** the `nix build` step SHALL fail because `fetchPnpmDeps` re-fetches against the lockfile and detects the hash mismatch
- **AND** the Nix validation job SHALL therefore fail, blocking merge until the hash is regenerated (via `scripts/update-flake.sh` on a Nix host)

#### Scenario: Multi-platform support check

- **WHEN** the flake declares support for multiple systems
- **THEN** the CI SHALL validate the flake builds on at least Linux (x86_64-linux)
