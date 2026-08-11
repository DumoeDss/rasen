/**
 * `store-layout-v2-migration` — the single public entry point.
 *
 * Nothing outside this directory imports the internals: callers consume the
 * Module Interface, the item/state types, and the stable error-code union.
 */
export * from './types.js';
export {
  StoreLayoutMigration,
  StoreLayoutMigrationModuleInstance as StoreLayoutMigrationModuleImpl,
  type StoreLayoutMigrationOptions,
} from './module.js';
export {
  productionStoreLayoutMigrationDependencies,
  withDeterministicIdentity,
  type LayoutMigrationCheckpoint,
  type StoreLayoutMigrationDependencies,
} from './dependencies.js';
export {
  migrationReceiptPath,
  migrationReceiptsDir,
  serializeMigrationReceipt,
  readMigrationReceipt,
  queryLegacyCoordinatorConversion,
  withMigrationReceiptPhase,
  type MigrationReceipt,
  type MigrationReceiptV2,
  type AnyMigrationReceipt,
  type MigrationReceiptReadResult,
  type LegacyCoordinatorConversionQuery,
} from './receipt.js';
export {
  MIGRATION_STAGING_RELATIVE,
  readRecoveryManifest,
  type LegacyRecoveryManifest,
  type PreparedRecoveryManifest,
  type RecoveryManifest,
  type RecoveryOperation,
} from './apply.js';
// The read-only diagnostic surface. Both doctors call THIS one function, so
// `rasen doctor` and `rasen store doctor` cannot report different codes or
// different repairs for the same Store (design D13, task 10.4).
export {
  diagnoseLayoutMigration,
  flatPlanningTreePath,
  type LayoutMigrationDiagnosticsInput,
} from './diagnostics.js';
