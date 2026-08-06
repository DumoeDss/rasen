export * from './types.js';
export * from './diagnostics.js';

import { productionStorePlanningDependencies } from './internal/dependencies.js';
import {
  StorePlanningResolver,
  projectReadProjection,
} from './internal/resolver.js';

/** The sole production Store/project planning-scope resolver. */
export const StorePlanning = new StorePlanningResolver(
  productionStorePlanningDependencies
);

export { projectReadProjection };
