// Core Rasen logic will be implemented here
export {
  GLOBAL_CONFIG_DIR_NAME,
  GLOBAL_CONFIG_FILE_NAME,
  GLOBAL_DATA_DIR_NAME,
  type GlobalDataDirOptions,
  type GlobalConfig,
  type MachineRootRelocationCheck,
  getGlobalConfigDir,
  getGlobalConfigPath,
  getGlobalConfig,
  saveGlobalConfig,
  getGlobalDataDir,
  adoptLegacyMachineData,
  checkMachineRootRelocation
} from './global-config.js';

export * from './references.js';
export * from './store/index.js';
export * from './change-metadata/index.js';
export * from './planning-home.js';
export * from './workspace-root.js';
export * from './codex/index.js';
export * from './workflow-registry/index.js';
export * from './workflow-package/index.js';
export * from './workflow-library.js';
export * from './threshold-values.js';
export * from './threshold-schemes.js';
export * from './threshold-resolver.js';
export * from './runtime-adapters.js';
export * from './change-run/index.js';

// `change-run/contracts.ts` and `store/planning-identity.ts` both define an
// independent `ChangeInstanceId` brand for unrelated concepts (the durable
// Run Record engine's instance id vs. the Store-planning v2 stable identity),
// so the bare name is ambiguous across the two `export *` statements above.
// Nothing currently imports `ChangeInstanceId` from this top-level barrel, so
// this explicit re-export resolves the ambiguity in favor of the
// Store-planning v2 identity without changing either module or any existing
// caller — `change-run`'s own `ChangeInstanceId` stays importable from
// `./change-run/index.js` directly, unaffected.
export type { ChangeInstanceId } from './store/planning-identity.js';
