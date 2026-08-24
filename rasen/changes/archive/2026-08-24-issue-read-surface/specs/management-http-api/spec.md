# management-http-api Delta — issue-read-surface

## ADDED Requirements

### Requirement: The Store aggregate projection paths serve Issue status, attention, and review reads

The management API SHALL serve the Issue projection reads — the Issue list with each Issue's
derived status, one Issue's full projection read (its status, its delivery evidence, and its
review view together), and the store-wide needs-attention scan with its optional single-Issue
narrowing — over paths scoped to a Store's stable identity, under the management security
posture. Each path SHALL be a passthrough of the same core composition the command line
prints: the server SHALL NOT maintain its own derivation, translation layer, or cached copy of
any projected fact, and the same read taken over the API and from the command line SHALL
report the same facts, including reported problems.

#### Scenario: Projection reads are available over the API

- **WHEN** a client requests a Store's Issue projections, one Issue's projection, or the
  Store's attention scan
- **THEN** each is served from its own Store-scoped path as the composition's own payload —
  the list carrying each Issue's status beside its summary, the single-Issue read carrying
  status, delivery, and review together, and the attention scan carrying its scanned entries,
  items, and counts

#### Scenario: The API and the command line derive the same facts

- **WHEN** the same projection read is taken over the API and from the command line against
  the same Store evidence
- **THEN** both report the same payload content — the same axes, nodes, lanes, delta,
  acceptance, delivery, review, and attention facts, and the same reported problems

#### Scenario: Review rides the single-Issue read

- **WHEN** a client requests one Issue's projection
- **THEN** the response carries the Issue's review view — determination, threads, and
  verification summary — beside its status and delivery, derived from the same status on the
  same read, and no separate review derivation exists server-side

#### Scenario: Attention narrowing to an unknown Issue is refused

- **WHEN** a client narrows the attention scan to an Issue identifier that is not in the
  scanned set
- **THEN** the request is refused with a not-found status and the store's own refusal code in
  the error envelope, rather than answered with an empty scan

### Requirement: A projection read derives fresh and reports its channels honestly

Every projection read SHALL re-derive its payload from Store evidence at request time: the
server SHALL hold no cache, snapshot, or second state between requests, SHALL NOT mutate
anything, and SHALL NOT take a lock. The two reporting channels SHALL stay disjoint as the
command line keeps them: a refusal is an error response carrying the store's own code in the
shared error envelope, while unreadable or incomplete evidence is a successful payload
carrying its problem reports — the server SHALL NOT convert one channel into the other. The
payload SHALL carry its run-state visibility fact so a consumer always knows whether live-run
evidence was in scope for the derivation.

#### Scenario: A mutation between two reads is reflected without invalidation

- **WHEN** the same projection path is requested, the Store's evidence changes, and the path
  is requested again
- **THEN** the second response reflects the changed evidence with no invalidation or refresh
  step in between, because nothing was cached

#### Scenario: A projection read never mutates

- **WHEN** any projection path is called repeatedly
- **THEN** no file in the Store, no run-state file, and no index is created, modified, or
  removed

#### Scenario: Refusals carry the store's own codes

- **WHEN** a projection read is refused — an unknown Issue, an incomplete scope, or an
  unreadable store ref
- **THEN** the response is an error in the shared envelope whose code is the store's own
  refusal code, mapped to a client-fault or upstream-fault HTTP status, never a generic
  server error

#### Scenario: Unreadable evidence is not a refusal

- **WHEN** a projection read encounters evidence that exists but cannot be read — an
  unreadable plan, a divergent record, an unsearched ref
- **THEN** the response is successful and carries the incompleteness in its payload — its
  problem reports, its completeness flag, and its unsearched refs — exactly as the command
  line reports them

#### Scenario: Run-state visibility is disclosed, never fabricated

- **WHEN** the server cannot resolve an execution root for live run-state probing
- **THEN** the payload's run-state visibility reports that none was in scope and the
  projection degrades to committed evidence only, rather than fabricating or omitting the
  fact
