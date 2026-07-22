## ADDED Requirements

### Requirement: Changes listing reports portfolio-container membership

`GET /api/v1/changes` SHALL report, per change, its portfolio-container membership as an optional additive fact so a client can group changes into Tasks without re-scanning the workspace. A change SHALL be reported as belonging to portfolio container `P` when `P` is the longest sibling change directory such that `P` contains a `planning-context.md` file and the change's name equals `P` or begins with `P` followed by a hyphen; a change with no such container SHALL carry no membership. This fact SHALL be derived read-only from the workspace filesystem — enumerating change directories and checking for `planning-context.md` — and SHALL create, mint, or modify no registry entry, identity, or directory. It SHALL be an additive field: a client that ignores it sees the same flat listing as before, and its absence on a change means the change is not part of any portfolio.

This requirement adds the membership fact only; it does not change which changes are enumerated (still `getActiveChangeIds`, requiring a `proposal.md`), so a portfolio container that holds only `planning-context.md` and no `proposal.md` is itself absent from the listing while its child changes each report it as their container.

#### Scenario: Child change reports its portfolio container

- **WHEN** the changes directory holds active changes `redesign-api` and `redesign-shell` alongside a directory `redesign/` containing a `planning-context.md` and no `proposal.md`
- **THEN** the listing includes `redesign-api` and `redesign-shell`, each reporting portfolio membership `redesign`, and does not include `redesign` itself as a change

#### Scenario: Bare change reports no membership

- **WHEN** an active change has no sibling container directory whose name is a prefix of its name and that holds a `planning-context.md`
- **THEN** the change is listed with no portfolio membership

#### Scenario: Longest matching container wins

- **WHEN** an active change's name would match more than one candidate container prefix each holding a `planning-context.md`
- **THEN** the change reports membership in the container with the longest matching name

#### Scenario: Membership derivation has no side effects

- **WHEN** the listing computes portfolio membership for a space
- **THEN** no registry file, project identity, or directory is created or modified as a side effect of answering the request
