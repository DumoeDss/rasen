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
//
// This barrel is re-exported by `src/index.ts`, which IS the package's
// published entry (`package.json` `exports["."]`), so the bare name is public
// API. Until the Store-planning contract existed it could only mean
// change-run's brand; letting the new brand take it over would silently change
// what an external `import type { ChangeInstanceId } from '@atelierai/rasen'`
// resolves to — a different and mutually incompatible brand under an unchanged
// name. Both are therefore named explicitly: the published name keeps the
// meaning it already had, and the Store-planning v2 identity gets its own
// unambiguous name here (it also stays importable, unaliased, from
// `./store/planning-foundation.js` directly).
export type { ChangeInstanceId } from './change-run/index.js';
export type { ChangeInstanceId as StorePlanningChangeInstanceId } from './store/planning-identity.js';
