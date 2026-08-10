/**
 * Test-only construction seam. It is deliberately not exported from the
 * package's core entry point, so production consumers cannot configure the
 * filesystem/registry/context/Git authority behind StorePlanning.
 */
export { StorePlanningResolver as createStorePlanningResolverForTesting } from './internal/resolver.js';
export type {
  CheckoutRole,
  ProjectRegistrySnapshotEntry,
  ProjectIdentityClaimantSnapshot,
  StorePlanningDependencies,
  StorePlanningFileSystem,
  StoreRegistrySnapshotEntry,
} from './internal/dependencies.js';
export {
  nodeStorePlanningFileSystem,
  productionStorePlanningDependencies,
} from './internal/dependencies.js';
