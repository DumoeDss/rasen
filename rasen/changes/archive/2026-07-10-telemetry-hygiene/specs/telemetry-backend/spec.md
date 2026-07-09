## MODIFIED Requirements

### Requirement: Two-Layer Aggregate Query

The telemetry backend's aggregate reads SHALL draw from a hot layer (Analytics
Engine, for windows within its retention) and a cold layer (the durable rollup
store, for windows extending beyond that retention or covering all history), and
SHALL annotate each aggregate response with the layer that produced it, so a
maintainer can tell whether numbers are fine-grained recent data or day-grained
historical aggregates. Both layers, and the rollup/backfill queries that
populate the cold layer, SHALL exclude a defined set of synthetic and junk
events (an explicit list of known non-CLI command values, a reserved
placeholder anonymous identifier reserved for synthetic test traffic, and any
command carrying a defined synthetic-probe prefix) from every aggregate, so
that maintainer-facing usage numbers reflect only genuine CLI usage. This
exclusion applies unconditionally, independent of any other test-traffic
filter a caller may toggle, and SHALL NOT be satisfied by deleting or
modifying the underlying Analytics Engine data, which is append-only —
only the aggregate query results are filtered.

#### Scenario: Recent window served from the hot layer

- **WHEN** an aggregate is requested for a window within the Analytics Engine
  retention (for example the last 7 or 30 days)
- **THEN** the result is computed from Analytics Engine and annotated with a hot
  data source

#### Scenario: All-history window served from the cold layer

- **WHEN** an aggregate is requested for all history or a window extending past
  the Analytics Engine retention
- **THEN** the result is computed from the durable rollup store and annotated
  with a cold data source

#### Scenario: Cold layer read requires no identifiers

- **WHEN** an aggregate is served from the cold layer
- **THEN** it is derived only from stored aggregate counts, with no per-user or
  per-request identifier involved

#### Scenario: Synthetic and junk events are excluded from hot-layer aggregates

- **WHEN** an aggregate is computed from the hot layer (Analytics Engine)
- **THEN** events whose command value is in the known junk-command list, whose
  anonymous identifier is the reserved synthetic-test placeholder, or whose
  command carries the synthetic-probe prefix are excluded from the result,
  regardless of any other test-traffic filter setting

#### Scenario: Synthetic and junk events are excluded from cold-layer aggregates

- **WHEN** an aggregate is computed from the cold layer (the rollup store)
- **THEN** rows whose command value is in the known junk-command list, or whose
  command carries the synthetic-probe prefix, are excluded from the result

#### Scenario: Rollup and backfill aggregation exclude synthetic and junk events

- **WHEN** the daily rollup or the historical backfill aggregates events from
  Analytics Engine into the rollup store
- **THEN** events matching the junk-command list, the reserved synthetic
  identifier, or the synthetic-probe prefix are not aggregated into the rollup
  store

#### Scenario: Hot-layer exclusion never deletes or mutates raw data

- **WHEN** the hygiene exclusion is applied to a hot-layer query
- **THEN** the underlying Analytics Engine data is unchanged — only the query
  result omits the excluded events, consistent with Analytics Engine being
  append-only and never deleted or modified by this backend
