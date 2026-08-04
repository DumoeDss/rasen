/**
 * Effective-configuration resolution: merges the default, global, project,
 * and environment-override layers into per-key values with source metadata.
 *
 * This is the reusable seam (design D5 of the `unified-config-layer`
 * change): the interactive `rasen config` editor and the non-TTY effective
 * view render `EffectiveConfigEntry[]` from here — they compute nothing
 * themselves. The planned `unified-config-api` sibling wraps this same
 * module (plus `updateProjectConfigKey`/`saveGlobalConfig`) in HTTP
 * handlers, so no command-layer logic should need duplicating there.
 */
import { getNestedValue } from './config-schema.js';
import {
  CONFIG_KEY_REGISTRY,
  collectFamilyInstancePaths,
  validateConfigValue,
  type ConfigKeyDefinition,
} from './config-keys.js';
import {
  getGlobalConfig,
  readGlobalConfigSnapshot,
  type GlobalConfigFileReader,
  type GlobalConfigFileStatus,
} from './global-config.js';
import {
  classifyOpenSpecDir,
  readProjectConfig,
  storePointerProblem,
  type ProjectConfig,
  type StorePointerRead,
} from './project-config.js';
import type { RegisteredStoreEntry } from './store/registry.js';
import type { StorePathOptions } from './store/foundation.js';
import { StoreError } from './store/errors.js';
import {
  assertNeverStoreBinding,
  describeUnavailableStore,
  primaryRepair,
  resolveStoreBinding,
  type ResolvedStoreBinding,
  type StoreBindingDeclaration,
  type UnavailableStoreBinding,
} from './store/identity.js';
import { isTelemetryEnvDisabled } from '../telemetry/index.js';
import {
  thresholdSchema,
  type ThresholdValue,
  type StageRole,
  type ModelConfigLayers,
  type EffortConfigLayers,
  LEAF_EFFORTS,
  type LeafEffort,
} from './pipeline-registry/types.js';
import { parseCliLocale } from '../utils/locale.js';
import { FileSystemUtils } from '../utils/file-system.js';
import * as path from 'node:path';
import type { ConfigDiagnosticReporter } from './config-diagnostics.js';
import { PROBE_RUNTIMES, hasRuntimeCapability } from './runtime-adapters.js';
import { validateThresholdSchemeName } from './threshold-schemes.js';
import type {
  ThresholdBindingLayers,
  ThresholdBindings,
} from './threshold-resolver.js';

const STAGE_ROLES = ['planner', 'implementer', 'reviewer', 'fixer', 'shipper'] as const satisfies readonly StageRole[];

export type ConfigSource = 'default' | 'global' | 'store' | 'project' | 'env-override';

/** The store contributing a project's inherited configuration layer (design D1). */
export interface StoreConfigLayer {
  storeId: string;
  /** Canonical store root; its own `rasen/config.yaml` is the store layer. */
  storeRoot: string;
  /** The store's permanent identity; absent for a store that has none yet. */
  storeUid?: string;
  /** Whether the permanent identity or the display alias did the resolving. */
  resolvedBy?: 'uid' | 'alias';
}

/** Canonicalizes an existing path; falls back to `path.resolve` for a path not on disk. */
function canonicalizeOrResolve(target: string): string {
  try {
    return FileSystemUtils.canonicalizeExistingPath(target);
  } catch {
    return path.resolve(target);
  }
}

/**
 * True when `root` is itself one of the registered stores' roots (canonical,
 * Windows-safe comparison). The no-transitivity guard shared by
 * `resolveConfigStoreLayer` (rule 3 — a store root never inherits from its own
 * `store:` field) and the root-selection notice, so the two can never disagree
 * on the self-store case (design D5's notice/resolver-agree invariant).
 */
export function isRegisteredStoreRoot(
  root: string,
  stores: readonly RegisteredStoreEntry[]
): boolean {
  const canonicalRoot = canonicalizeOrResolve(root);
  return stores.some(
    (candidate) =>
      candidate.type === 'store' && canonicalizeOrResolve(candidate.storeRoot) === canonicalRoot
  );
}

/**
 * Bridges the on-disk declaration shape (`readStorePointer`) to the resolver's
 * declaration input, so the resolver stays free of a project-config dependency
 * and the two can never disagree on what a declaration means.
 */
export function storeBindingDeclarationFrom(
  pointer: StorePointerRead
): StoreBindingDeclaration {
  switch (pointer.shape) {
    case 'absent':
      return { form: 'absent' };
    case 'alias':
      return { form: 'alias', id: pointer.value as string };
    case 'durable': {
      const durable = pointer.durable as { uid: string; id?: string; remote?: string };
      return {
        form: 'durable',
        uid: durable.uid,
        ...(durable.id !== undefined ? { id: durable.id } : {}),
        ...(durable.remote !== undefined ? { remote: durable.remote } : {}),
      };
    }
    case 'malformed':
      return {
        form: 'malformed',
        problem: storePointerProblem(pointer.malformed ?? 'non_string'),
        filePath: pointer.filePath,
      };
  }
}

/**
 * The tri-state a project's configuration inheritance edge resolves to. There
 * is deliberately no nullable form: `absent` (the project declares no store)
 * is the ONLY state that legitimately resolves with no store layer, and
 * `unavailable` can never be collapsed into it.
 */
export type ConfigStoreLayerResolution =
  | { kind: 'absent' }
  | { kind: 'resolved'; layer: StoreConfigLayer; binding: ResolvedStoreBinding }
  | { kind: 'unavailable'; binding: UnavailableStoreBinding };

/**
 * Resolves the single store layer a project's configuration inherits from
 * (design D1 of the store-config-scope change). Rules, in order:
 *  1. No `projectRoot` -> `absent`.
 *  2. `classifyOpenSpecDir(projectRoot)`: no local planning shape -> `absent`
 *     (a config-only pointer repo needs no store layer — its root already
 *     resolves TO the store), no `store:` declaration -> `absent`.
 *  3. `projectRoot` is itself a registered store's root -> `absent`. This
 *     makes the no-transitivity rule mechanical (a store's own `store:` field
 *     is ignored) and kills the self-pointing edge case.
 *  4. Otherwise the shared identity resolver decides: `resolved` with the
 *     canonical store root, or `unavailable` with its reason and repair.
 *
 * A declared store that cannot be used is NEVER folded into "no store layer" —
 * that fall-through is the bug this shape exists to make unrepresentable.
 *
 * Async because the store registry read is async; the sync layer resolvers
 * take the resolved store root/config as a parameter rather than repeating
 * this read. Path comparisons are canonical (Windows-safe). `pathOptions`
 * overrides the machine store-registry location for testing; it defaults to
 * the real machine root.
 */
export async function resolveConfigStoreLayer(
  projectRoot: string | null | undefined,
  pathOptions: StorePathOptions = {}
): Promise<ConfigStoreLayerResolution> {
  if (!projectRoot) return { kind: 'absent' };

  const { hasPlanningShape, pointer } = classifyOpenSpecDir(projectRoot);
  if (!hasPlanningShape) return { kind: 'absent' };

  const binding = await resolveStoreBinding({
    declaration: storeBindingDeclarationFrom(pointer),
    projectRoot,
    ...pathOptions,
  });

  if (binding.kind === 'absent') return { kind: 'absent' };
  if (binding.kind === 'unavailable') return { kind: 'unavailable', binding };

  return {
    kind: 'resolved',
    binding,
    layer: {
      storeId: binding.store.id,
      storeRoot: binding.store.root,
      ...(binding.store.uid !== undefined ? { storeUid: binding.store.uid } : {}),
      resolvedBy: binding.resolvedBy,
    },
  };
}

/** The fail-closed error every non-diagnostic surface raises for a broken edge. */
export function unavailableStoreError(binding: UnavailableStoreBinding): StoreError {
  return new StoreError(describeUnavailableStore(binding), binding.diagnostics[0]?.code ?? 'store_unavailable', {
    target: binding.diagnostics[0]?.target ?? 'store.pointer',
    fix: primaryRepair(binding),
  });
}

/**
 * Fail-closed adapter for every surface that must NOT proceed on a broken
 * inheritance edge (design D4). Returns the layer, or null when the project
 * genuinely declares no store; throws otherwise. The read-only diagnostic
 * surfaces (`rasen doctor`, `rasen store doctor`, `rasen store list`,
 * `rasen config --scope global`, `rasen init`'s pointer guard) deliberately do
 * not call this — they are how a user learns the edge is broken.
 */
export async function requireConfigStoreLayer(
  projectRoot: string | null | undefined,
  pathOptions: StorePathOptions = {}
): Promise<StoreConfigLayer | null> {
  const resolution = await resolveConfigStoreLayer(projectRoot, pathOptions);
  switch (resolution.kind) {
    case 'absent':
      return null;
    case 'resolved':
      return resolution.layer;
    case 'unavailable':
      throw unavailableStoreError(resolution.binding);
    default:
      // A future resolution kind must be handled explicitly here, not fall
      // silently into "no store layer" — the bug this shape exists to kill.
      return assertNeverStoreBinding(resolution);
  }
}

export interface EffectiveConfigEntry {
  definition: ConfigKeyDefinition;
  /** The effective value after merging all layers. */
  value: unknown;
  /** The highest-precedence layer that produced `value`. */
  source: ConfigSource;
  /** Raw per-layer values, before merge. */
  scopeValues: { global?: unknown; store?: unknown; project?: unknown };
  /**
   * The fully-qualified instance path for a wildcard family instance entry
   * (e.g. `pipelines.small-feature.gates.propose`). Absent on fixed keys and
   * on a family's template entry — for those, `definition.key` is the identity.
   */
  instanceKey?: string;
}

export interface ResolveEffectiveConfigOptions {
  /** Explicit project root; when omitted, only environment/global/default layers contribute. */
  projectRoot?: string;
  /**
   * The active store inheritance layer (design D1/D3): for a project context,
   * the store it inherits from; for a store space, the store itself (with no
   * `projectRoot`). Omitted or null means no store layer contributes.
   *
   * A `ConfigStoreLayerResolution` is also accepted so a caller can hand the
   * tri-state straight through; an `unavailable` one throws rather than
   * resolving as though the project had no store.
   */
  store?: StoreConfigLayer | ConfigStoreLayerResolution | null;
  /** Optional locale-aware diagnostic sink supplied by a presentation layer. */
  reporter?: ConfigDiagnosticReporter;
  /**
   * When true, wildcard families contribute entries: one template entry per
   * family plus one entry per set instance (design D4). Default false keeps
   * the CLI surfaces (the interactive editor and the non-TTY effective view)
   * byte-identical — they never rendered family entries and still don't. The
   * config HTTP API opts in so a client can read/write instances by path.
   */
  includeWildcards?: boolean;
}

/**
 * Resolves an environment-override value for a registry key, if any applies.
 * Today only `telemetry.enabled`'s environment kill-switches
 * (`RASEN_TELEMETRY=0`, `DO_NOT_TRACK=1`, CI) surface here — the single
 * source of truth for what counts as a kill-switch lives in
 * `src/telemetry/index.ts` so this module and `isTelemetryEnabled()` can
 * never disagree.
 */
function resolveEnvOverride(definition: ConfigKeyDefinition): { value: unknown } | undefined {
  if (definition.key === 'language') {
    const language = parseCliLocale(process.env.RASEN_LANG);
    if (language) return { value: language };
  }
  if (definition.key === 'telemetry.enabled' && isTelemetryEnvDisabled()) {
    return { value: false };
  }
  return undefined;
}

export type { GlobalConfigFileStatus } from './global-config.js';

export interface EffectiveConfigResolution {
  entries: EffectiveConfigEntry[];
  globalConfigStatus: GlobalConfigFileStatus;
  globalConfig: Record<string, unknown>;
}

/** Narrow I/O seam used to prove one coherent global-file read deterministically. */
export interface EffectiveConfigIo {
  readGlobalConfigFile?: GlobalConfigFileReader;
}

/**
 * Merges default + global + store + project + environment-override layers
 * into per-key effective values with source metadata, for every non-wildcard
 * key in the config-key registry. Precedence per key: env-override > project
 * (when project-scoped and a project root resolves) > store (when store-scoped
 * and a store layer is active — see `resolveConfigStoreLayer`) > global >
 * default. A layer contributes to a key only when the key's registry scopes
 * include that layer's scope. Pure and synchronous; safe to call with no
 * project root or store layer (global-only contexts resolve from environment,
 * global, and default layers only). When a store space is addressed directly
 * (`options.store` set with no `projectRoot`), the store's own config occupies
 * the store layer and the project layer is empty (design D3).
 */
/**
 * Normalizes the `store` option. An `unavailable` tri-state throws here rather
 * than degrading to "no store layer" — the guard is on the merge itself, so a
 * caller that forgets to fail closed still cannot report global/default values
 * for a project whose declared store is broken.
 */
export function toStoreConfigLayer(
  store: StoreConfigLayer | ConfigStoreLayerResolution | null | undefined
): StoreConfigLayer | null {
  if (!store) return null;
  if (!('kind' in store)) return store;
  switch (store.kind) {
    case 'absent':
      return null;
    case 'resolved':
      return store.layer;
    case 'unavailable':
      throw unavailableStoreError(store.binding);
  }
}

export function resolveEffectiveConfigWithMetadata(
  options: ResolveEffectiveConfigOptions = {},
  io: EffectiveConfigIo = {}
): EffectiveConfigResolution {
  const storeLayer = toStoreConfigLayer(options.store);
  const globalSnapshot = readGlobalConfigSnapshot(
    { reporter: options.reporter },
    io.readGlobalConfigFile
  );
  const globalConfig = globalSnapshot.config as unknown as Record<string, unknown>;
  const rawGlobalConfig = globalSnapshot.raw;
  const projectConfig: ProjectConfig | null = options.projectRoot
    ? readProjectConfig(options.projectRoot, { reporter: options.reporter })
    : null;
  const projectConfigRecord = projectConfig as unknown as Record<string, unknown> | null;
  // The store layer is the store's own `rasen/config.yaml`, read once and
  // already resiliently validated by `readProjectConfig` (design D2) — no
  // re-validation pass, unlike the raw global JSON read.
  const storeConfig: ProjectConfig | null = storeLayer
    ? readProjectConfig(storeLayer.storeRoot, { reporter: options.reporter })
    : null;
  const storeConfigRecord = storeConfig as unknown as Record<string, unknown> | null;

  const entries: EffectiveConfigEntry[] = [];

  for (const definition of CONFIG_KEY_REGISTRY) {
    if (definition.wildcard) {
      // A key family has no single "the" value. When the caller opts in
      // (the config API), emit a template entry for the family plus one entry
      // per set instance; otherwise skip it entirely, exactly as before.
      if (!options.includeWildcards) continue;
      entries.push(
        ...resolveWildcardFamilyEntries(
          definition,
          rawGlobalConfig,
          storeConfigRecord,
          projectConfigRecord
        )
      );
      continue;
    }

    // `rawGlobalValue` decides whether the global layer contributed anything
    // (undefined = never set); `mergedGlobalValue` is the value to REPORT
    // once it has (normalized the same way every other consumer of
    // getGlobalConfig() sees it, e.g. legacy `delivery` value mapping).
    const rawGlobalValue = definition.scopes.includes('global')
      ? getNestedValue(rawGlobalConfig, definition.key)
      : undefined;
    const mergedGlobalValue = definition.scopes.includes('global')
      ? getNestedValue(globalConfig, definition.key)
      : undefined;
    const storeValue =
      definition.scopes.includes('store') && storeConfigRecord
        ? getNestedValue(storeConfigRecord, definition.key)
        : undefined;
    const projectValue =
      definition.scopes.includes('project') && projectConfigRecord
        ? getNestedValue(projectConfigRecord, definition.key)
        : undefined;

    const envOverride = resolveEnvOverride(definition);

    let value: unknown;
    let source: ConfigSource;
    if (envOverride !== undefined) {
      value = envOverride.value;
      source = 'env-override';
    } else if (projectValue !== undefined) {
      value = projectValue;
      source = 'project';
    } else if (storeValue !== undefined) {
      value = storeValue;
      source = 'store';
    } else if (rawGlobalValue !== undefined) {
      value = mergedGlobalValue;
      source = 'global';
    } else {
      value = definition.defaultValue;
      source = 'default';
    }

    entries.push({
      definition,
      value,
      source,
      scopeValues: { global: rawGlobalValue, store: storeValue, project: projectValue },
    });
  }

  return {
    entries,
    globalConfigStatus: globalSnapshot.status,
    globalConfig,
  };
}

export function resolveEffectiveConfig(
  options: ResolveEffectiveConfigOptions = {}
): EffectiveConfigEntry[] {
  return resolveEffectiveConfigWithMetadata(options).entries;
}

/**
 * Builds the effective-config entries for one wildcard family (design D4): a
 * template entry (definition metadata, no effective value) followed by one
 * entry per instance path set in any contributing layer the family's scopes
 * admit. Instance paths are collected from the raw global config, the store
 * layer, and the project layer (scope-gated), then each resolves through the
 * standard `project > store > global` precedence (no env layer maps to a
 * family instance). The global layer is raw JSON with no schema gate, so an
 * invalid global leaf is re-validated and dropped with a warning; the store
 * and project layers arrive already resiliently validated by
 * `readProjectConfig`. An instance whose only value fails validation is not
 * emitted (it is effectively unset).
 */
function resolveWildcardFamilyEntries(
  definition: ConfigKeyDefinition,
  rawGlobalConfig: Record<string, unknown>,
  storeConfigRecord: Record<string, unknown> | null,
  projectConfigRecord: Record<string, unknown> | null
): EffectiveConfigEntry[] {
  const entries: EffectiveConfigEntry[] = [];

  // Template entry: what documents the family's existence when nothing is set.
  entries.push({ definition, value: undefined, source: 'default', scopeValues: {} });

  const usesGlobal = definition.scopes.includes('global');
  const usesStore = definition.scopes.includes('store') && storeConfigRecord !== null;
  const usesProject = definition.scopes.includes('project') && projectConfigRecord !== null;

  const instancePaths = new Set<string>([
    ...(usesGlobal ? collectFamilyInstancePaths(definition, rawGlobalConfig) : []),
    ...(usesStore ? collectFamilyInstancePaths(definition, storeConfigRecord) : []),
    ...(usesProject ? collectFamilyInstancePaths(definition, projectConfigRecord) : []),
  ]);

  for (const instanceKey of [...instancePaths].sort()) {
    // The global layer is unvalidated on read; a bad leaf is dropped (warned),
    // mirroring `validateGlobalHandoffRoles`. Store/project leaves were already
    // dropped-if-invalid by `readProjectConfig`, so they are trusted as-is.
    let globalValue: unknown;
    if (usesGlobal) {
      const raw = getNestedValue(rawGlobalConfig, instanceKey);
      if (raw !== undefined) {
        // Binding writes are registry-mediated and therefore require an
        // existing scheme, but resilient reads deliberately preserve a
        // syntactically valid dangling name so the configuration heals when
        // that machine-local scheme is restored.
        const validationError =
          definition.key === 'thresholds.bindings.<runtime>' && typeof raw === 'string'
            ? validateThresholdSchemeName(raw)
            : validateConfigValue(definition, raw, 'global');
        if (validationError === null) {
          globalValue = raw;
        } else {
          console.warn(
            `Invalid '${instanceKey}' in the global config (${definition.description}); ignoring it.`
          );
        }
      }
    }
    const storeValue = usesStore ? getNestedValue(storeConfigRecord!, instanceKey) : undefined;
    const projectValue = usesProject ? getNestedValue(projectConfigRecord!, instanceKey) : undefined;

    let value: unknown;
    let source: ConfigSource;
    if (projectValue !== undefined) {
      value = projectValue;
      source = 'project';
    } else if (storeValue !== undefined) {
      value = storeValue;
      source = 'store';
    } else if (globalValue !== undefined) {
      value = globalValue;
      source = 'global';
    } else {
      continue; // no valid value at any layer — effectively unset
    }

    entries.push({
      definition,
      value,
      source,
      instanceKey,
      scopeValues: { global: globalValue, store: storeValue, project: projectValue },
    });
  }

  return entries;
}

/** Threshold values from the project/store/global config layers, for `resolveStageHandoffConfig` and the `rasen agent context` probe. */
export interface HandoffThresholdLayers {
  projectThreshold?: ThresholdValue;
  storeThreshold?: ThresholdValue;
  globalThreshold?: ThresholdValue;
  projectRoles?: Partial<Record<StageRole, ThresholdValue>>;
  storeRoles?: Partial<Record<StageRole, ThresholdValue>>;
  globalRoles?: Partial<Record<StageRole, ThresholdValue>>;
}

/**
 * Re-validates a raw `handoff.roles` map (from the global config's raw JSON,
 * which has no schema gate on read) against the dual-form threshold schema,
 * dropping any invalid per-role value with a warning — mirrors the scalar
 * `handoff.threshold` re-validation below. Project config roles need no
 * re-validation here (`readProjectConfig` already drops invalid role
 * thresholds resiliently during parsing).
 */
function validateGlobalHandoffRoles(
  raw: Partial<Record<StageRole, unknown>> | undefined
): Partial<Record<StageRole, ThresholdValue>> | undefined {
  if (!raw) return undefined;
  const result: Partial<Record<StageRole, ThresholdValue>> = {};
  for (const role of STAGE_ROLES) {
    const rawValue = raw[role];
    if (rawValue === undefined) continue;
    const parsed = thresholdSchema('threshold').safeParse(rawValue);
    if (parsed.success) {
      result[role] = parsed.data;
    } else {
      console.warn(
        `Invalid 'handoff.roles.${role}' in the global config (must be a number in (0, 1], or an object { remainingTokens: <positive integer> }, got ${JSON.stringify(rawValue)}); ignoring it.`
      );
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Resolves the `handoff.threshold` project/store/global config layers, shared
 * by `resolveStageHandoffConfig` call sites (pipeline resolution) and
 * `rasen agent context`'s threshold reporting, so the two consumers can
 * never drift on what "the configured threshold" means. The optional
 * `storeRoot` (resolved via `resolveConfigStoreLayer`) contributes the store
 * layer between project and global. Dual-form: a bare
 * fraction in (0, 1], or the absolute `{ remainingTokens: N }` headroom form
 * (validated via the same `thresholdSchema()` builder pipeline-registry
 * uses, so the two never drift on what a valid threshold looks like).
 *
 * `readProjectConfig()` already drops an invalid project threshold
 * resiliently (with a warning) during parsing, so `projectConfig.handoff`
 * never carries an invalid value here. `getGlobalConfig()` has no such
 * schema gate on read (it's a raw JSON.parse + merge), so a hand-edited
 * invalid global value is re-validated here, dropped with a warning rather
 * than silently reaching resolution as an unusable threshold.
 */
export function resolveHandoffThresholdLayers(
  projectRoot?: string | null,
  storeRoot?: string | null
): HandoffThresholdLayers {
  const globalConfig = getGlobalConfig();
  const projectConfig = projectRoot ? readProjectConfig(projectRoot) : null;
  // The store config is the store root's own `rasen/config.yaml` — already
  // resiliently validated by `readProjectConfig` (design D2), like the
  // project layer, so it needs no re-validation pass.
  const storeConfig = storeRoot ? readProjectConfig(storeRoot) : null;

  const rawGlobalThreshold = globalConfig.handoff?.threshold;
  let globalThreshold: ThresholdValue | undefined;
  if (rawGlobalThreshold === undefined) {
    globalThreshold = undefined;
  } else {
    const parsed = thresholdSchema('threshold').safeParse(rawGlobalThreshold);
    if (parsed.success) {
      globalThreshold = parsed.data;
    } else {
      console.warn(
        `Invalid 'handoff.threshold' in the global config (must be a number in (0, 1], or an object { remainingTokens: <positive integer> }, got ${JSON.stringify(rawGlobalThreshold)}); ignoring it.`
      );
      globalThreshold = undefined;
    }
  }

  return {
    projectThreshold: projectConfig?.handoff?.threshold,
    storeThreshold: storeConfig?.handoff?.threshold,
    globalThreshold,
    projectRoles: projectConfig?.handoff?.roles,
    storeRoles: storeConfig?.handoff?.roles,
    globalRoles: validateGlobalHandoffRoles(globalConfig.handoff?.roles),
  };
}

function validateBindingMap(
  raw: unknown,
  scope: 'global' | 'store' | 'project'
): ThresholdBindings | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    console.warn(`Invalid 'thresholds.bindings' in ${scope} config (must be an object); ignoring it.`);
    return undefined;
  }
  const bindings: ThresholdBindings = {};
  for (const [runtime, scheme] of Object.entries(raw as Record<string, unknown>)) {
    if (
      (runtime === 'default' || hasRuntimeCapability(runtime, 'canProbeContext')) &&
      typeof scheme === 'string' &&
      validateThresholdSchemeName(scheme) === null
    ) {
      bindings[runtime as keyof ThresholdBindings] = scheme;
    } else {
      console.warn(
        `Invalid 'thresholds.bindings.${runtime}' in ${scope} config (runtime must be default or one of ${PROBE_RUNTIMES.join(', ')} and value must be a valid scheme name); ignoring it.`
      );
    }
  }
  return bindings;
}

/**
 * Expose raw, non-collapsed binding rows at every scope. Explicit runtime and
 * default rows remain distinct so the pure resolver can apply row-first order.
 */
export function resolveThresholdBindingLayers(
  projectRoot?: string | null,
  storeRoot?: string | null
): ThresholdBindingLayers {
  const globalConfig = getGlobalConfig();
  const projectConfig = projectRoot ? readProjectConfig(projectRoot) : null;
  const storeConfig = storeRoot ? readProjectConfig(storeRoot) : null;
  return {
    project: validateBindingMap(projectConfig?.thresholds?.bindings, 'project'),
    store: validateBindingMap(storeConfig?.thresholds?.bindings, 'store'),
    global: validateBindingMap(globalConfig.thresholds?.bindings, 'global'),
  };
}

/**
 * Re-validates a raw global `models.default` value (the global config has no
 * schema gate on read), dropping a non-string or empty value with a warning.
 */
function validateGlobalModelDefault(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === 'string' && raw.length > 0) return raw;
  console.warn(
    `Invalid 'models.default' in the global config (must be a non-empty string, got ${JSON.stringify(raw)}); ignoring it.`
  );
  return undefined;
}

/** Re-validates a raw global `models.roles` map, dropping any invalid per-role value with a warning — mirrors `validateGlobalHandoffRoles`. */
function validateGlobalModelRoles(
  raw: Partial<Record<StageRole, unknown>> | undefined
): Partial<Record<StageRole, string>> | undefined {
  if (!raw) return undefined;
  const result: Partial<Record<StageRole, string>> = {};
  for (const role of STAGE_ROLES) {
    const rawValue = raw[role];
    if (rawValue === undefined) continue;
    if (typeof rawValue === 'string' && rawValue.length > 0) {
      result[role] = rawValue;
    } else {
      console.warn(
        `Invalid 'models.roles.${role}' in the global config (must be a non-empty string, got ${JSON.stringify(rawValue)}); ignoring it.`
      );
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Resolves the `models.default`/`models.roles.<role>` project/store/global
 * config layers, sibling of `resolveHandoffThresholdLayers` for the per-agent
 * model axis. The optional `storeRoot` (resolved via `resolveConfigStoreLayer`)
 * contributes the store layer between project and global.
 * `readProjectConfig()` already drops invalid project/store model fields
 * resiliently (with a warning) during parsing; the global config's raw
 * `models` block (no schema gate on read) is re-validated here. A model id
 * at any layer is an opaque string used as-is — no allow-list rejection.
 */
export function resolveModelConfigLayers(
  projectRoot?: string | null,
  storeRoot?: string | null
): ModelConfigLayers {
  const globalConfig = getGlobalConfig();
  const projectConfig = projectRoot ? readProjectConfig(projectRoot) : null;
  const storeConfig = storeRoot ? readProjectConfig(storeRoot) : null;

  return {
    projectRoles: projectConfig?.models?.roles,
    projectDefault: projectConfig?.models?.default,
    storeRoles: storeConfig?.models?.roles,
    storeDefault: storeConfig?.models?.default,
    globalRoles: validateGlobalModelRoles(globalConfig.models?.roles),
    globalDefault: validateGlobalModelDefault(globalConfig.models?.default),
  };
}

function isLeafEffort(value: unknown): value is LeafEffort {
  return typeof value === 'string' && LEAF_EFFORTS.includes(value as LeafEffort);
}

function validateGlobalEffortDefault(raw: unknown): LeafEffort | undefined {
  if (raw === undefined) return undefined;
  if (isLeafEffort(raw)) return raw;
  console.warn(
    `Invalid 'efforts.default' in the global config (must be one of ${LEAF_EFFORTS.join(', ')}, got ${JSON.stringify(raw)}); ignoring it.`
  );
  return undefined;
}

function validateGlobalEffortRoles(
  raw: Partial<Record<StageRole, unknown>> | undefined
): Partial<Record<StageRole, LeafEffort>> | undefined {
  if (!raw) return undefined;
  const result: Partial<Record<StageRole, LeafEffort>> = {};
  for (const role of STAGE_ROLES) {
    const rawValue = raw[role];
    if (rawValue === undefined) continue;
    if (isLeafEffort(rawValue)) {
      result[role] = rawValue;
    } else {
      console.warn(
        `Invalid 'efforts.roles.${role}' in the global config (must be one of ${LEAF_EFFORTS.join(', ')}, got ${JSON.stringify(rawValue)}); ignoring it.`
      );
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** Resolves generic leaf reasoning-effort policy without inventing a runtime default. */
export function resolveEffortConfigLayers(
  projectRoot?: string | null,
  storeRoot?: string | null
): EffortConfigLayers {
  const globalConfig = getGlobalConfig();
  const projectConfig = projectRoot ? readProjectConfig(projectRoot) : null;
  const storeConfig = storeRoot ? readProjectConfig(storeRoot) : null;
  return {
    projectRoles: projectConfig?.efforts?.roles,
    projectDefault: projectConfig?.efforts?.default,
    storeRoles: storeConfig?.efforts?.roles,
    storeDefault: storeConfig?.efforts?.default,
    globalRoles: validateGlobalEffortRoles(globalConfig.efforts?.roles),
    globalDefault: validateGlobalEffortDefault(globalConfig.efforts?.default),
  };
}
