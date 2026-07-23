/**
 * Space/config resolution seam shared by both HTTP route groups
 * (unify-pipeline-http-api design D4): the space/project addressing that
 * resolves a request's optional `space`/`project` selectors into a
 * `ConfigContext`, the `resolveEffectiveConfig` options it resolves with, and
 * the per-space pipeline-resolution bundle built on top of it. Extracted out
 * of `config-api/router.ts` (moved, not copied) so `management-api/pipelines.ts`
 * consumes the SAME definitions the config router does — one seam, two
 * consumers.
 */
import {
  resolveConfigStoreLayer,
  resolveHandoffThresholdLayers,
  resolveModelConfigLayers,
  type ResolveEffectiveConfigOptions,
  type StoreConfigLayer,
} from '../effective-config.js';
import { readProjectConfig, resolveAutopilotGatePolicy } from '../project-config.js';
import { getGlobalConfig } from '../global-config.js';
import type { EffectiveStageInputs } from '../pipeline-registry/index.js';
import { resolveProjectSelector, resolveSpaceSelector } from './project-addressing.js';
import type { ConfigApiContext } from './router.js';
import type { ProjectRef, StoreLayerRef } from './wire-types.js';

interface ProjectContextOk {
  ok: true;
  root: string | undefined;
  ref: ProjectRef | null;
}
interface ProjectContextErr {
  ok: false;
  status: number;
  code: string;
  message: string;
  fix?: string;
}

/**
 * Resolves the `project` selector (explicit id/root, or the server's launch
 * project when omitted) shared by every read and write endpoint (D4).
 */
async function resolveProjectContext(
  selector: string | undefined,
  context: ConfigApiContext
): Promise<ProjectContextOk | ProjectContextErr> {
  if (selector === undefined || selector === '') {
    return { ok: true, root: context.launchProjectRoot ?? undefined, ref: context.launchProjectRef };
  }
  const resolved = await resolveProjectSelector(selector);
  if (!resolved) {
    return {
      ok: false,
      status: 404,
      code: 'project_not_found',
      message: `No registered project matches "${selector}".`,
      fix: 'Open the project with the CLI once (run any `rasen` command inside it to register it), then retry.',
    };
  }
  return { ok: true, root: resolved.root, ref: resolved.ref };
}

/**
 * A resolved config context (design D6): either a project context (a project
 * root, its ref, and the store layer it inherits — if any) or a store context
 * (a store's own root addressed directly as a space). Every read and write
 * endpoint resolves one of these from the optional `space`/`project`
 * selectors.
 */
export type ConfigContext =
  | { kind: 'project'; root: string | undefined; ref: ProjectRef | null; storeLayer: StoreConfigLayer | null }
  | { kind: 'store'; storeId: string; storeRoot: string };

export type ConfigContextResult = { ok: true; context: ConfigContext } | ProjectContextErr;

/**
 * Resolves the config context from the optional `space` and `project`
 * selectors (design D6). Both present -> 400 `bad_request` (one addressing
 * mode per request). `space` resolves via `resolveSpaceSelector` (its
 * `invalid_space`/`space_not_found`/`space_unavailable` errors pass through):
 * a store space becomes a store context; a project space behaves exactly like
 * `?project=`. A bare `project` selector (or neither) resolves the project
 * context and awaits `resolveConfigStoreLayer` so inheritance applies to every
 * project-addressed read.
 */
export async function resolveConfigContext(
  projectSelector: string | undefined,
  spaceSelector: string | undefined,
  context: ConfigApiContext
): Promise<ConfigContextResult> {
  const hasProject = projectSelector !== undefined && projectSelector !== '';
  const hasSpace = spaceSelector !== undefined && spaceSelector !== '';
  if (hasProject && hasSpace) {
    return {
      ok: false,
      status: 400,
      code: 'bad_request',
      message: 'Pass either "project" or "space", not both.',
      fix: 'Use one addressing mode per request.',
    };
  }

  if (hasSpace) {
    const resolved = await resolveSpaceSelector(spaceSelector!);
    if (!resolved.ok) {
      return { ok: false, status: resolved.status, code: resolved.code, message: resolved.message };
    }
    const space = resolved.space;
    if (space.type === 'store') {
      return { ok: true, context: { kind: 'store', storeId: space.id, storeRoot: space.root } };
    }
    const storeLayer = await resolveConfigStoreLayer(space.root);
    return {
      ok: true,
      context: {
        kind: 'project',
        root: space.root,
        ref: { projectId: space.id, name: space.name, root: space.root },
        storeLayer,
      },
    };
  }

  const projectCtx = await resolveProjectContext(projectSelector, context);
  if (!projectCtx.ok) return projectCtx;
  const storeLayer = await resolveConfigStoreLayer(projectCtx.root);
  return { ok: true, context: { kind: 'project', root: projectCtx.root, ref: projectCtx.ref, storeLayer } };
}

/**
 * The `resolveEffectiveConfig` options a context resolves with (design D3).
 * The API always opts into wildcard families so family template entries and
 * set instances are first-class in every list/get/re-resolve response (D4/D5).
 */
export function contextResolveOptions(context: ConfigContext): ResolveEffectiveConfigOptions {
  if (context.kind === 'store') {
    return { store: { storeId: context.storeId, storeRoot: context.storeRoot }, includeWildcards: true };
  }
  return { projectRoot: context.root, store: context.storeLayer, includeWildcards: true };
}

/** The store-layer reference reported in a response body (design D6). */
export function contextStoreRef(context: ConfigContext): StoreLayerRef | null {
  if (context.kind === 'store') return { id: context.storeId, root: context.storeRoot };
  return context.storeLayer ? { id: context.storeLayer.storeId, root: context.storeLayer.storeRoot } : null;
}

/** The project reference reported in a response body — null for a store context. */
export function contextProjectRef(context: ConfigContext): ProjectRef | null {
  return context.kind === 'project' ? context.ref : null;
}

/** Reads the first value of a query-string parameter, or undefined when absent. */
export function firstQueryValue(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name);
  return value === null ? undefined : value;
}

/**
 * The per-root resolution bundle a space's pipelines resolve their effective
 * per-stage values against. Derived from a resolved config context so the
 * pipeline registry root, the config-family instance layer, the model/handoff
 * layers, and the autopilot.gates mask base all address the SAME space (design
 * D1): a store space resolves the store's own root as both the pipeline
 * registry root and the store config layer; a project space uses its root with
 * the inherited store layer.
 */
export interface PipelineResolutionBundle {
  pipelineRoot: string | undefined;
  effOptions: ResolveEffectiveConfigOptions;
  inputsBase: Omit<EffectiveStageInputs, 'overrides'>;
}

export function pipelineResolutionBundle(context: ConfigContext): PipelineResolutionBundle {
  const globalConfig = getGlobalConfig();
  if (context.kind === 'store') {
    const { storeId, storeRoot } = context;
    // A store space reads the store's own config as the store layer (mirroring
    // resolveEffectiveConfig's store context), so model/handoff/base sources
    // report `store` consistently with the family-instance sources.
    const storeConfig = readProjectConfig(storeRoot);
    const basePolicy = resolveAutopilotGatePolicy(null, false, globalConfig, storeConfig);
    return {
      pipelineRoot: storeRoot,
      effOptions: { store: { storeId, storeRoot } },
      inputsBase: {
        basePolicy,
        configLayers: resolveHandoffThresholdLayers(undefined, storeRoot),
        modelLayers: resolveModelConfigLayers(undefined, storeRoot),
      },
    };
  }

  const root = context.root;
  const storeLayer = context.storeLayer;
  const storeRoot = storeLayer?.storeRoot;
  const projectConfig = root ? readProjectConfig(root) : null;
  const storeConfig = storeRoot ? readProjectConfig(storeRoot) : null;
  const basePolicy = resolveAutopilotGatePolicy(projectConfig, false, globalConfig, storeConfig);
  return {
    pipelineRoot: root,
    effOptions: { projectRoot: root, store: storeLayer },
    inputsBase: {
      basePolicy,
      configLayers: resolveHandoffThresholdLayers(root, storeRoot),
      modelLayers: resolveModelConfigLayers(root, storeRoot),
    },
  };
}
