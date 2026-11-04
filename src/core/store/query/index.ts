/**
 * `store-aggregate-query` — the single public entry point.
 *
 * Consumers import the Module and its Interface types from here. Per-ref blob
 * reading, the memo, reference resolution, and grouping are internal.
 *
 * Nothing exported here can write. A query never asserts a state it cannot
 * prove and never throws on one; the MUTATION that touches the same references
 * — publishing an Execution Plan revision — refuses instead. Those are the two
 * correct expressions of one fail-closed invariant.
 */
export * from './types.js';
export {
  StoreAggregateQuery,
  StoreQueryModuleImpl,
  createStoreQueryByUid,
  type StoreQueryOptions,
} from './module.js';
export {
  STORE_QUERY_GIT_VERBS,
  nodeStoreQueryFileSystem,
  nodeStoreQueryGit,
  productionStoreQueryDependencies,
  withDeterministicStoreQueryClock,
  type StoreQueryDependencies,
  type StoreQueryFileSystem,
  type StoreQueryGit,
} from './dependencies.js';
export {
  RefReader,
  collectCommittedChanges,
  listProjectEntries,
  listTargetLineEntries,
  resolveQueryStore,
  resolveQueryStoreByUid,
  type CommittedChangeEvidence,
  type ProjectCatalogEntry,
  type ResolvedQueryStore,
  type StoreRefTarget,
  type TargetLineCatalogEntry,
} from './refs.js';
export {
  gatherReferenceEvidence,
  resolveChangeReference,
  type ReferenceEvidence,
  type ReferenceResolution,
} from './references.js';
export {
  collectIssues,
  divergenceOf,
  presentedDiagnostic,
  presentedIdentity,
  presentedRecord,
  presentedResolution,
  readRevision,
} from './issues-read.js';
