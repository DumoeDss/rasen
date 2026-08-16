## MODIFIED Requirements

### Requirement: Stable project identity

Every Rasen project SHALL have a stable `projectId` recorded in its `rasen/config.yaml` (or `config.yml`). The identity SHALL survive repo moves and renames. For projects initialized before this capability existed, the first command that actually requires the machine home SHALL establish a `projectId` in the config file without discarding the file's other content and comments; commands that do not require the machine home SHALL NOT write into the repository.

When the machine project registry already holds an entry for the project's canonical root, that entry's `projectId` is the project's identity on this machine: a config with no `projectId` SHALL receive the registered identity rather than a newly minted one, and a config carrying a `projectId` that names a different project SHALL be reconciled toward the registered identity by the next command that establishes machine identity (including `rasen init`), preserving the config file's other content and comments. A fresh unique `projectId` SHALL be minted only when the machine registry holds no entry for the project's canonical root. Re-running `rasen init` on a project whose config identity and registered identity already agree SHALL preserve that identity unchanged.

Identity agreement SHALL be judged in the identity's canonical form (trimmed, case-insensitive): a config identity that differs from the registered one only in case or surrounding whitespace is the same project, and its config file SHALL be left unchanged. When the registry's own entries for the root disagree with each other, the system SHALL keep out of choosing: neither establishing nor reconciling identity SHALL adopt one of the conflicting claims, and the disagreement SHALL be surfaced by project registration together with its existing repair guidance.

#### Scenario: Init mints a projectId once

- **WHEN** `rasen init` runs in a project whose config has no `projectId` and the machine registry holds no entry for the project's path
- **THEN** a new unique `projectId` is written to the project config
- **AND** a subsequent `rasen init` leaves that `projectId` unchanged

#### Scenario: Legacy project acquires identity lazily

- **WHEN** a command that needs the machine home runs in a project whose config predates `projectId`
- **THEN** a `projectId` is added to the existing config file without discarding the file's other content and comments

#### Scenario: Read-only commands never dirty the repo

- **WHEN** a command that does not need the machine home (e.g. `rasen list`) runs in a project without a `projectId`
- **THEN** no file inside the repository is created or modified

#### Scenario: A registered path adopts its registered identity instead of minting

- **WHEN** a command that needs the machine home runs in a project whose config has no `projectId` while the machine registry holds an entry for the project's canonical path
- **THEN** the registry entry's `projectId` is written to the config file
- **AND** no second identity for the path is created

#### Scenario: A worktree run adopts the main checkout's identity

- **WHEN** a command that needs the machine home runs in a linked worktree of a repository whose main checkout is registered
- **THEN** the identity established in the worktree's config is the main checkout's registered `projectId`
- **AND** the registry gains no separate entry for the worktree path

#### Scenario: Path casing does not fork identity on case-insensitive filesystems

- **WHEN** a project at `E:\Work\My-App` is registered and a command that needs the machine home later runs from `e:\work\my-app` on a case-insensitive filesystem with no `projectId` in the config
- **THEN** the config receives the already-registered `projectId` (paths are canonicalized with platform path handling before registry lookup, never by hardcoded separator edits)

#### Scenario: Re-running init repairs a diverged identity

- **WHEN** `rasen init` runs in a project whose config carries a `projectId` different from the registry entry for the same canonical path
- **THEN** the config's `projectId` is reconciled to the registered identity while the file's other content and comments are preserved
- **AND** features that resolve the project's identity afterwards (learned-skills owner resolution, project space addressing) succeed without reporting a stale or conflicting identity

#### Scenario: The stale-identity guidance names a repair that works

- **WHEN** a feature refuses because the config and registry identities disagree and its message tells the user to run `rasen init`
- **THEN** running `rasen init` converges the config to the registered identity so the refusal no longer occurs

#### Scenario: A case-differing identity is left untouched

- **WHEN** a project's config records its `projectId` in uppercase and the registry records the same identity in lowercase
- **THEN** commands that establish machine identity recognize them as the same project
- **AND** the config file is left byte-identical (no rewrite for an identity that already agrees)

#### Scenario: A conflicted registry is never silently resolved

- **WHEN** the machine registry holds disagreeing live entries that resolve to the project's canonical root and a command establishes machine identity for it
- **THEN** no one claim's identity is adopted into the config over the others
- **AND** project registration surfaces the disagreement with guidance to repair the registry entries explicitly
