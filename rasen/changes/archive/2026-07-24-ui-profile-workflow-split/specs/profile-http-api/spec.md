# profile-http-api Delta Specification

## Purpose

Expose the named workflow-profile registry (built-in `full`/`core` plus user-saved definitions) over the management HTTP API, so the browser UI can list, create, modify, and delete profile definitions with exactly the CLI's validation and reserved-name rules.

## ADDED Requirements

### Requirement: Profiles are listed over the management API

The management API SHALL offer an authenticated read that lists every available profile: the built-in `full` and `core` profiles and every saved user profile, each with its name, whether it is built-in, and its workflow membership list. A saved profile file that cannot be parsed SHALL still appear in the listing, carrying its error instead of a membership list, so a broken definition is visible rather than silently absent.

#### Scenario: Listing includes built-ins and saved profiles

- **WHEN** a client requests the profile listing while two user profiles are saved
- **THEN** the response contains `full` and `core` marked built-in plus both saved profiles with their workflow lists

#### Scenario: Broken saved profile surfaces its error

- **WHEN** a saved profile file on disk is invalid
- **THEN** the listing includes that profile's name with an error description and no membership list

### Requirement: Saved profiles are created, updated, and deleted over the management API

The management API SHALL offer authenticated mutations to create a new saved profile, replace an existing saved profile's workflow membership, and delete a saved profile. Mutations SHALL enforce the same rules as the CLI: profile names follow the CLI's name pattern with `full`, `core`, and `custom` reserved; a create SHALL be refused when the name already exists; an update SHALL be refused for a missing or built-in name; membership lists naming unknown workflow ids SHALL be refused with the message naming the offending id. A successful create or update SHALL persist through the same storage the CLI reads and SHALL return the normalized definition — the stored list after dependency-closure expansion — so the client renders exactly what was saved.

#### Scenario: Create persists a CLI-visible profile

- **WHEN** a client creates a profile with a valid new name and known workflow ids
- **THEN** the profile is saved to the shared profile storage, `rasen profile list` shows it, and the response carries the normalized membership list

#### Scenario: Normalization is returned to the client

- **WHEN** a client saves a membership list that omits a workflow required by another selected workflow's dependency closure
- **THEN** the response's normalized list includes the required workflow

#### Scenario: Reserved and duplicate names are refused

- **WHEN** a client tries to create a profile named `core`, or to create a profile whose name already exists
- **THEN** the mutation is refused with the reserved-name or already-exists error and nothing is written

#### Scenario: Delete removes only saved profiles

- **WHEN** a client deletes a saved profile
- **THEN** the profile file is removed and a subsequent listing no longer contains it; deleting `full` or `core` is refused

#### Scenario: Deleting a locked profile leaves spaces degraded gracefully

- **WHEN** a client deletes a saved profile that some space's configuration locks
- **THEN** the delete succeeds, and that space's next apply falls back to the user-wide profile with the existing unresolvable-lock warning, exactly as after a CLI delete
