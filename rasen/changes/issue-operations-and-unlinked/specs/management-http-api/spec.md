# management-http-api Delta — issue-operations-and-unlinked

## ADDED Requirements

### Requirement: The Store Change-to-Issue link path reports provable association

The management API SHALL serve one Store-scoped read that joins every active and archived Change
occurrence to the latest readable Execution Plans that name its stable Change instance. Each entry
SHALL carry its Change occurrence and proven Issue links plus a closed association of `linked`,
`unlinked`, or `unknown` and a closed eligibility reason. `unlinked`/attachable SHALL require a
complete scan, one stable unambiguous Change instance, and zero proven links. The path SHALL derive
fresh on every request from the existing Store aggregate and Execution Plan reads and SHALL hold no
cache, index, persisted link, or alternate Issue truth.

#### Scenario: Linked and unlinked entries share one fresh read

- **WHEN** a client requests a Store's Change-to-Issue links
- **THEN** the response includes active and archived Change occurrences with their exact evidence,
  proven Issue links, association, and attachability

#### Scenario: A complete zero-link scan reports unlinked

- **WHEN** one stable Change instance has no node in any latest readable Issue plan and every required
  ref and plan was searched
- **THEN** its entry reports `unlinked` and `attachable`

#### Scenario: An incomplete scan reports unknown

- **WHEN** a candidate has no proven link but a latest plan, ref, identity, or claimant set prevents
  a complete absence conclusion
- **THEN** its entry reports `unknown` with the exact eligibility reason, completeness flag,
  unsearched refs, and problems

#### Scenario: A proven link survives unrelated incompleteness

- **WHEN** a readable latest plan names a Change instance while some unrelated Store evidence is
  unreadable
- **THEN** that Change reports `linked` with the proven Issue link and the response separately reports
  its aggregate incompleteness

#### Scenario: Repeated link reads never mutate

- **WHEN** the link path is called repeatedly
- **THEN** no Store file, run-state file, client cache, or index is created, modified, or removed

### Requirement: Plan publication can be conditioned on the observed revision

The management API's Execution Plan publication request SHALL accept an optional expected revision:
an omitted field preserves the existing unconditional-next-revision behavior, `null` means the
caller observed no plan, and a canonical revision id means the caller observed that latest revision.
The request SHALL pass this precondition to the Store Issue mutation and SHALL return a conflict in
the shared error envelope when it is stale. The request's node mirror SHALL carry every field the
plan schema admits so a read-modify-publish client can preserve the graph without dropping lifecycle,
reason, suggestion, rationale, or uncertainty fields.

#### Scenario: Omitted expectation remains backward compatible

- **WHEN** a caller publishes a valid plan without an expected revision
- **THEN** the next immutable revision is published under the existing behavior

#### Scenario: Null expectation accepts only no plan

- **WHEN** a caller submits expected revision `null`
- **THEN** publication succeeds only when the Issue still has no plan revision

#### Scenario: Matching expectation publishes the next revision

- **WHEN** a caller names the current latest revision and submits a valid complete plan
- **THEN** the next revision is published with that revision as `supersedes`

#### Scenario: Stale expectation is a conflict

- **WHEN** the latest revision differs from the submitted expectation
- **THEN** the API returns a conflict with the Store's revision-conflict code and writes no revision

#### Scenario: Full node fields round-trip through the request

- **WHEN** a read-modify-publish request resubmits existing nodes carrying lifecycle, reason,
  suggestion, rationale, or uncertainty
- **THEN** the published revision preserves each admitted field verbatim after canonical validation
