/**
 * `GET`/`POST /api/v1/pipelines` handlers, moved into the management route
 * group from `config-api/router.ts` (unify-pipeline-http-api design D3): the
 * whitelist, the mutation bridge, and every sibling domain endpoint already
 * live management-side — this closes the one remaining dependency inversion
 * (config-api importing the management-side mutation bridge across the
 * boundary). Consumes the shared config-resolution seam
 * (`config-api/config-context.ts`) exactly like the config router does; no
 * resolution logic is reimplemented here.
 */
import type * as http from 'node:http';

import {
  freezeProductionPreparedPipelineRegistry,
  createProductionCapabilityCatalogSnapshot,
  EcpDefinitionModule,
  resolvePipelineStageOverrides,
  resolveEffectiveStage,
  resolvePipelineReuseConfig,
  resolvePipelineRoleRuntimes,
  resolvePipelineExecutionSkillSets,
  projectPreparedPipelineExecutionView,
  collectLegacyPipelineSkillIssues,
  PipelineYamlSchema,
  StageRoleSchema,
  AgentRuntimeSchema,
  VerifyPolicySchema,
  StageKindSchema,
  LOOP_KIND_VALUES,
  type AgentRuntime,
  type CapabilityCatalogSnapshot,
  type DefinitionDiagnostic,
  type EffectiveStageInputs,
  type PipelineExecutionOptions,
  type PipelineYaml,
  type PreparedDefinition,
  type PreparedPipelineExecutionView,
  type StageRole,
} from '../pipeline-registry/index.js';
import { isPortableWorkflowId, loadWorkflowCatalog } from '../workflow-registry/index.js';
import {
  resolveConfigContext,
  contextProjectRef,
  contextStoreRef,
  firstQueryValue,
  pipelineResolutionBundle,
} from '../config-api/config-context.js';
import type { ConfigApiContext } from '../config-api/router.js';
import type {
  PipelineCatalogResponse,
  PipelineDetailResponse,
  PipelineValidationIssue,
  PipelineValidationResponse,
  WireDefinitionPreparation,
  WirePipeline,
} from './wire-types.js';
import { detectHostRuntime, type DetectedHostRuntime } from '../runtime-adapters.js';

function managementHost(context: ConfigApiContext): DetectedHostRuntime {
  return context.hostRuntime ?? detectHostRuntime();
}

function compatibilityBoundaryFields(info: {
  compatibilityBoundary?: WirePipeline['compatibilityBoundary'];
}): Pick<WirePipeline, 'compatibilityBoundary'> {
  return info.compatibilityBoundary
    ? { compatibilityBoundary: info.compatibilityBoundary }
    : {};
}

function wireStagesFromPreparedView(
  view: PreparedPipelineExecutionView
): WirePipeline['stages'] {
  return view.stages.map((stage) => ({
    id: stage.id,
    role: stage.role,
    skill: stage.capability.id.startsWith('skill:')
      ? stage.capability.id.slice('skill:'.length)
      : stage.capability.id,
    gate: stage.gate,
    effectiveGate: stage.effectiveGate,
    effectiveModel: stage.model,
    effectiveEffort: stage.effort,
    effectiveHandoff: {
      value: stage.handoff.threshold,
      source: stage.handoff.source,
      ...(stage.handoff.binding ? { binding: stage.handoff.binding } : {}),
      ...(stage.handoff.diagnostics
        ? { diagnostics: stage.handoff.diagnostics }
        : {}),
    },
    effectiveRuntime: stage.runtime,
    dispatchMode: stage.dispatchMode,
    bridge: stage.bridge,
    nodePath: stage.nodePath,
    profilePath: stage.profilePath,
    requires: [...stage.requires],
    capability: { ...stage.capability },
    workspace: stage.workspace,
    verifyPolicy: stage.verifyPolicy,
    leadReview: stage.leadReview,
    effectiveSandbox: stage.sandbox,
    sessionReuse: stage.sessionReuse,
    inference: stage.inference,
  }));
}

function wireExecutionViewFields(
  view: PreparedPipelineExecutionView
): Pick<
  WirePipeline,
  | 'stages'
  | 'buildOrder'
  | 'capabilityPaths'
  | 'policyPaths'
  | 'boundedLoops'
  | 'availableEngines'
  | 'reconcilerSupport'
> {
  return {
    stages: wireStagesFromPreparedView(view),
    buildOrder: [...view.buildOrder],
    capabilityPaths: view.capabilityPaths,
    policyPaths: view.policyPaths,
    boundedLoops: view.boundedLoops,
    availableEngines: view.availableEngines,
    reconcilerSupport: view.reconcilerSupport,
  };
}

function diagnosticForWire(
  diagnostic: DefinitionDiagnostic
): PipelineValidationIssue {
  const { related, ...fields } = diagnostic;
  return {
    ...fields,
    ...(related
      ? { related: related.map((item) => ({ path: item.path, message: item.message })) }
      : {}),
  };
}

async function resolvePreparationCatalog(
  projectRoot: string | undefined,
  reporter: PipelineExecutionOptions['reporter'] = false
): Promise<{
  catalog: CapabilityCatalogSnapshot;
  knownSkillNames: Set<string>;
  enabledSkillNames: Set<string>;
}> {
  const workflowCatalog = loadWorkflowCatalog({ projectRoot });
  const skillSets = await resolvePipelineExecutionSkillSets(projectRoot, {
    reporter,
    workflowCatalog,
  });
  return {
    ...skillSets,
    catalog: createProductionCapabilityCatalogSnapshot(
      workflowCatalog.definitions,
      skillSets.enabledSkillNames
    ),
  };
}

function preparationForWire(
  prepared: PreparedDefinition,
  additionalDiagnostics: readonly DefinitionDiagnostic[] = []
): WireDefinitionPreparation & { authoredVersion: 1 | 2 } {
  return {
    authoredVersion: prepared.authoredVersion,
    normalizedVersion: prepared.normalizedVersion,
    definitionValid: prepared.capability.definitionValid,
    diagnostics: [...additionalDiagnostics, ...prepared.warnings].map(
      diagnosticForWire
    ),
    digests: { ...prepared.digests },
    planAvailable: prepared.capability.planAvailable,
    executable: prepared.capability.executable,
    executionMode: prepared.capability.executionMode,
    ...(prepared.capability.unavailableReason
      ? { unavailableReason: prepared.capability.unavailableReason }
      : {}),
  };
}

function preparationFields(
  preparation: WireDefinitionPreparation
): Pick<
  WirePipeline,
  | 'authoredVersion'
  | 'normalizedVersion'
  | 'definitionValid'
  | 'planAvailable'
  | 'executable'
  | 'executionMode'
  | 'unavailableReason'
> {
  return {
    authoredVersion: preparation.authoredVersion,
    normalizedVersion: preparation.normalizedVersion,
    definitionValid: preparation.definitionValid,
    planAvailable: preparation.planAvailable,
    executable: preparation.executable,
    executionMode: preparation.executionMode,
    ...(preparation.unavailableReason
      ? { unavailableReason: preparation.unavailableReason }
      : {}),
  };
}

export interface ManagementDefinitionPreparation {
  readonly response: PipelineValidationResponse;
  readonly prepared?: PreparedDefinition;
}

/**
 * One management-side preparation seam shared by draft validation and save
 * admission. The returned wire response is deliberately reusable verbatim so
 * failed saves cannot drift from validation diagnostics.
 */
export async function preparePipelineDefinitionForManagement(
  definition: unknown,
  projectRoot?: string,
  reporter: PipelineExecutionOptions['reporter'] = false
): Promise<ManagementDefinitionPreparation> {
  const { catalog, knownSkillNames, enabledSkillNames } =
    await resolvePreparationCatalog(projectRoot, reporter);
  const result = EcpDefinitionModule.prepare(definition, catalog);
  if (!result.ok) {
    const submittedVersion =
      typeof definition === 'object' &&
      definition !== null &&
      'version' in definition &&
      typeof (definition as { version?: unknown }).version === 'number'
        ? (definition as { version: number }).version
        : 1;
    const legacySkillIssues =
      submittedVersion === 1
        ? (() => {
            const parsed = PipelineYamlSchema.safeParse(definition);
            return parsed.success
              ? collectLegacyPipelineSkillIssues(parsed.data, {
                  knownSkillNames,
                  enabledSkillNames,
                })
              : [];
          })()
        : [];
    const diagnostics = [
      ...result.error.diagnostics.map(diagnosticForWire),
      ...legacySkillIssues,
    ];
    const preparation: WireDefinitionPreparation = {
      authoredVersion: submittedVersion,
      normalizedVersion: 2,
      definitionValid: false,
      diagnostics,
      planAvailable: false,
      executable: false,
      executionMode: 'unavailable',
    };
    return {
      response: {
        valid: false,
        issues: [...preparation.diagnostics],
        preparation,
      },
    };
  }

  const preparation = preparationForWire(result.value);
  const skillIssues =
    result.value.authoredVersion === 1
      ? collectLegacyPipelineSkillIssues(
          result.value.authoredSource as PipelineYaml,
          { knownSkillNames, enabledSkillNames }
        )
      : [];
  const responsePreparation = {
    ...preparation,
    definitionValid: skillIssues.length === 0,
    diagnostics: [...preparation.diagnostics, ...skillIssues],
    ...(skillIssues.length > 0
      ? {
          planAvailable: false,
          executable: false,
          executionMode: 'unavailable' as const,
        }
      : {}),
  };
  return {
    prepared: result.value,
    response: {
      valid: skillIssues.length === 0,
      issues: [...responsePreparation.diagnostics],
      preparation: responsePreparation,
    },
  };
}

/**
 * Pipelines inventory endpoint (pipeline-http-api): the pipelines available to
 * the addressed space, each stage reporting its declared gate PLUS its effective
 * gate/model/handoff/runtime with the layer that supplied each — computed
 * through the same in-process resolvers `rasen pipeline show` uses
 * (`resolvePipelineStageOverrides` + `resolveEffectiveStage`), no resolution
 * reimplemented here. A pipeline that fails to (re)load between the listing and
 * load calls (e.g. deleted mid-request) is skipped rather than failing the whole
 * response.
 *
 * `sendError` is the caller's (the management router's own, unified) error
 * helper — passed in so this module produces no envelope of its own.
 */
export async function handleListPipelines(
  res: http.ServerResponse,
  url: URL,
  context: ConfigApiContext,
  sendError: (res: http.ServerResponse, status: number, code: string, message: string, fix?: string) => void,
  sendJson: (res: http.ServerResponse, status: number, body: unknown) => void
): Promise<void> {
  const ctx = await resolveConfigContext(
    firstQueryValue(url, 'project'),
    firstQueryValue(url, 'space'),
    context
  );
  if (!ctx.ok) {
    sendError(res, ctx.status, ctx.code, ctx.message, ctx.fix);
    return;
  }

  const bundle = pipelineResolutionBundle(ctx.context);
  const host = managementHost(context);
  const registry = await freezeProductionPreparedPipelineRegistry(
    bundle.pipelineRoot,
    { reporter: false }
  );
  const infos = registry.list();
  const pipelines: WirePipeline[] = [];
  for (const info of infos) {
    const prepared = info.prepared;
    if (!prepared) {
      const diagnostics = (info.diagnostics ?? []).map(diagnosticForWire);
      pipelines.push({
        name: info.name,
        description: info.description,
        provenance: info.source === 'package' ? 'built-in' : 'user',
        sourceLayer: info.source,
        ...compatibilityBoundaryFields(info),
        stages: [],
        authoredVersion: info.authoredVersion ?? 1,
        normalizedVersion: 2,
        definitionValid: false,
        planAvailable: false,
        executable: false,
        executionMode: 'unavailable',
        diagnostics,
      });
      continue;
    }
    const preparation = preparationForWire(prepared);
    if (prepared.authoredVersion === 2) {
      const overrides = resolvePipelineStageOverrides(
        prepared.authoredSource.name,
        bundle.effOptions
      );
      const view = projectPreparedPipelineExecutionView(
        prepared,
        registry.catalog,
        { ...bundle.inputsBase, overrides, host }
      );
      pipelines.push({
        name: prepared.authoredSource.name,
        description: prepared.authoredSource.description ?? '',
        provenance: info.source === 'package' ? 'built-in' : 'user',
        sourceLayer: info.source,
        ...compatibilityBoundaryFields(info),
        ...wireExecutionViewFields(view),
        ...preparationFields(preparation),
      });
      continue;
    }
    const pipeline = prepared.authoredSource as PipelineYaml;
    const overrides = resolvePipelineStageOverrides(pipeline.name, bundle.effOptions);
    const inputs: EffectiveStageInputs = {
      ...bundle.inputsBase,
      overrides,
      host,
    };
    const view = projectPreparedPipelineExecutionView(
      prepared,
      registry.catalog,
      inputs
    );
    const effectiveStages = pipeline.stages.map((stage) =>
      resolveEffectiveStage(stage, pipeline, inputs)
    );
    const resolvedRoleRuntimes = resolvePipelineRoleRuntimes(
      pipeline,
      overrides,
      host
    );
    const runtimes = Object.fromEntries(
      Object.entries(resolvedRoleRuntimes).map(([role, resolved]) => [
        role,
        resolved.runtime,
      ])
    ) as Record<StageRole, AgentRuntime>;
    pipelines.push({
      name: pipeline.name,
      description: pipeline.description ?? '',
      provenance: info.source === 'package' ? 'built-in' : 'user',
      sourceLayer: info.source,
      ...compatibilityBoundaryFields(info),
      ...wireExecutionViewFields(view),
      roleRuntimes: Object.fromEntries(
        Object.entries(resolvedRoleRuntimes).map(([role, resolved]) => [
          role,
          { value: resolved.runtime, source: resolved.source },
        ])
      ) as WirePipeline['roleRuntimes'],
      effectiveReuse: resolvePipelineReuseConfig(pipeline, {
        ...bundle.inputsBase.thresholdContext,
        runtimes,
      }),
      stages: effectiveStages.map((eff) => {
        return {
          id: eff.id,
          role: eff.role,
          skill: eff.skill,
          gate: eff.declaredGate,
          effectiveGate: { value: eff.gate.effective, source: eff.gate.source },
          effectiveModel: { value: eff.model.value, source: eff.model.source },
          effectiveEffort: { value: eff.effort.value, source: eff.effort.source },
          effectiveHandoff: {
            value: eff.handoff.threshold,
            source: eff.handoff.source,
            ...(eff.handoff.binding ? { binding: eff.handoff.binding } : {}),
            ...(eff.handoff.diagnostics
              ? { diagnostics: eff.handoff.diagnostics }
              : {}),
          },
          effectiveRuntime: { value: eff.runtime.value, source: eff.runtime.source },
          dispatchMode: eff.dispatchMode,
          bridge: eff.bridge ?? null,
          inference: eff.inference && eff.model.value
            ? {
                broker: 'omnicross',
                upstream: eff.inference.upstream,
                runtime: eff.runtime.value,
                model: eff.model.value,
              }
            : null,
        };
      }),
      ...preparationFields(preparation),
    });
  }
  sendJson(res, 200, {
    project: contextProjectRef(ctx.context),
    store: contextStoreRef(ctx.context),
    pipelines,
  });
}

/**
 * Pipeline detail endpoint (pipeline-definition-api): the resolved view (the
 * SAME per-pipeline shape the inventory reports) PLUS the declared definition
 * (round-trippable through `save`) and an `editable` flag (false for built-ins,
 * which are still returned read-only as save-as templates). `name` is the
 * already percent-decoded, one-segment path id the router matched.
 */
export async function handlePipelineDetail(
  res: http.ServerResponse,
  url: URL,
  name: string,
  context: ConfigApiContext,
  sendError: (res: http.ServerResponse, status: number, code: string, message: string, fix?: string) => void,
  sendJson: (res: http.ServerResponse, status: number, body: unknown) => void
): Promise<void> {
  if (!isPortableWorkflowId(name)) {
    sendError(res, 400, 'invalid_input', 'Pipeline name is not a valid identifier.');
    return;
  }

  const ctx = await resolveConfigContext(
    firstQueryValue(url, 'project'),
    firstQueryValue(url, 'space'),
    context
  );
  if (!ctx.ok) {
    sendError(res, ctx.status, ctx.code, ctx.message, ctx.fix);
    return;
  }

  const bundle = pipelineResolutionBundle(ctx.context);
  const host = managementHost(context);
  const registry = await freezeProductionPreparedPipelineRegistry(
    bundle.pipelineRoot,
    { reporter: false }
  );
  let directlyPrepared: PreparedDefinition | undefined;
  try {
    directlyPrepared = registry.load(name).prepared;
  } catch {
    // The direct winning-source read is authoritative. Invalid definitions are
    // projected below from the reserved inventory entry; a genuinely absent
    // name remains a 404.
  }
  const info = registry.list().find(
    (entry) => entry.name === name
  );
  if (!info) {
    sendError(res, 404, 'not_found', `No pipeline named "${name}".`);
    return;
  }

  const prepared = directlyPrepared ?? info.prepared;
  if (!prepared) {
    if (!info.diagnostics) {
      sendError(res, 404, 'not_found', `No pipeline named "${name}".`);
      return;
    }
    const authoredDefinition = info.authoredDefinition ?? {};
    const diagnostics = info.diagnostics.map(diagnosticForWire);
    const preparation: WireDefinitionPreparation = {
      authoredVersion: info.authoredVersion ?? 1,
      normalizedVersion: 2,
      definitionValid: false,
      diagnostics,
      planAvailable: false,
      executable: false,
      executionMode: 'unavailable',
    };
    const response = {
      pipeline: {
        name: info.name,
        description: info.description,
        provenance: info.source === 'package' ? 'built-in' : 'user',
        sourceLayer: info.source,
        ...compatibilityBoundaryFields(info),
        stages: [],
        ...preparationFields(preparation),
        diagnostics,
      },
      definition: authoredDefinition,
      preparation,
      editable: info.source !== 'package',
    } satisfies Omit<PipelineDetailResponse, 'definition'> & {
      definition: unknown;
    };
    sendJson(res, 200, response);
    return;
  }
  const preparation = preparationForWire(prepared);
  let resolvedView: WirePipeline;
  if (prepared.authoredVersion === 2) {
    const overrides = resolvePipelineStageOverrides(
      prepared.authoredSource.name,
      bundle.effOptions
    );
    const view = projectPreparedPipelineExecutionView(
      prepared,
      registry.catalog,
      { ...bundle.inputsBase, overrides, host }
    );
    resolvedView = {
      name: prepared.authoredSource.name,
      description: prepared.authoredSource.description ?? '',
      provenance: info.source === 'package' ? 'built-in' : 'user',
      sourceLayer: info.source,
      ...compatibilityBoundaryFields(info),
      ...wireExecutionViewFields(view),
      ...preparationFields(preparation),
    };
  } else {
    const pipeline = prepared.authoredSource as PipelineYaml;
    const overrides = resolvePipelineStageOverrides(
      pipeline.name,
      bundle.effOptions
    );
    const inputs: EffectiveStageInputs = {
      ...bundle.inputsBase,
      overrides,
      host,
    };
    const view = projectPreparedPipelineExecutionView(
      prepared,
      registry.catalog,
      inputs
    );
    const effectiveStages = pipeline.stages.map((stage) =>
      resolveEffectiveStage(stage, pipeline, inputs)
    );
    const resolvedRoleRuntimes = resolvePipelineRoleRuntimes(
      pipeline,
      overrides,
      host
    );
    const runtimes = Object.fromEntries(
      Object.entries(resolvedRoleRuntimes).map(([role, resolved]) => [
        role,
        resolved.runtime,
      ])
    ) as Record<StageRole, AgentRuntime>;
    resolvedView = {
      name: pipeline.name,
      description: pipeline.description ?? '',
      provenance: info.source === 'package' ? 'built-in' : 'user',
      sourceLayer: info.source,
      ...compatibilityBoundaryFields(info),
      ...wireExecutionViewFields(view),
      roleRuntimes: Object.fromEntries(
        Object.entries(resolvedRoleRuntimes).map(([role, resolved]) => [
          role,
          { value: resolved.runtime, source: resolved.source },
        ])
      ) as WirePipeline['roleRuntimes'],
      effectiveReuse: resolvePipelineReuseConfig(pipeline, {
        ...bundle.inputsBase.thresholdContext,
        runtimes,
      }),
      stages: effectiveStages.map((eff) => ({
        id: eff.id,
        role: eff.role,
        skill: eff.skill,
        gate: eff.declaredGate,
        effectiveGate: { value: eff.gate.effective, source: eff.gate.source },
        effectiveModel: { value: eff.model.value, source: eff.model.source },
        effectiveEffort: { value: eff.effort.value, source: eff.effort.source },
        effectiveHandoff: {
          value: eff.handoff.threshold,
          source: eff.handoff.source,
          ...(eff.handoff.binding ? { binding: eff.handoff.binding } : {}),
          ...(eff.handoff.diagnostics
            ? { diagnostics: eff.handoff.diagnostics }
            : {}),
        },
        effectiveRuntime: {
          value: eff.runtime.value,
          source: eff.runtime.source,
        },
        dispatchMode: eff.dispatchMode,
        bridge: eff.bridge ?? null,
        inference: eff.inference && eff.model.value
          ? {
              broker: 'omnicross',
              upstream: eff.inference.upstream,
              runtime: eff.runtime.value,
              model: eff.model.value,
            }
          : null,
      })),
      ...preparationFields(preparation),
    };
  }

  // ECP-5 (task 6.1): the Canvas `EngineSupportPanel` renders whatever this
  // endpoint reports. Passing `null` here made it report
  // `execution_profile_unavailable` for EVERY pipeline — a panel that shipped,
  // was unit-tested, and could never display a supported verdict. Discovery
  // resolves the same capability bindings the launch profile resolves.
  const response = {
    pipeline: resolvedView,
    definition: prepared.authoredSource,
    preparation,
    editable: info.source !== 'package',
  };
  sendJson(res, 200, response);
}

/**
 * Draft validation endpoint (pipeline-definition-api): in-process dry-run of a
 * body-carried draft definition through the SAME rule chain the loader and
 * execution preflight enforce (`validatePipelineDraft`), collecting every
 * issue rather than throwing at the first. Writes no file, spawns no
 * subprocess, and never occupies the mutation bridge's slot. 200 for both a
 * valid and an invalid draft; 400 only when the body carries no `definition`.
 */
export async function handlePipelineValidation(
  res: http.ServerResponse,
  body: unknown,
  context: ConfigApiContext,
  sendError: (res: http.ServerResponse, status: number, code: string, message: string, fix?: string) => void,
  sendJson: (res: http.ServerResponse, status: number, body: unknown) => void
): Promise<void> {
  if (typeof body !== 'object' || body === null || !('definition' in body)) {
    sendError(res, 400, 'invalid_input', 'Request body must be an object carrying a "definition" member.');
    return;
  }
  const { definition, space } = body as { definition: unknown; space?: unknown };
  if (space !== undefined && typeof space !== 'string') {
    sendError(res, 400, 'invalid_input', 'space must be a string.');
    return;
  }

  const ctx = await resolveConfigContext(undefined, space, context);
  if (!ctx.ok) {
    sendError(res, ctx.status, ctx.code, ctx.message, ctx.fix);
    return;
  }
  const bundle = pipelineResolutionBundle(ctx.context);

  const warnings: PipelineValidationResponse['issues'] = [];
  const prepared = await preparePipelineDefinitionForManagement(
    definition,
    bundle.pipelineRoot,
    (notice) => {
      if (notice.kind !== 'unknown-profile-workflows') return;
      warnings.push({
        severity: 'warning',
        path: '/',
        message: `Dropping unknown workflow id(s) from stored profile: ${notice.workflowIds.join(', ')}`,
      });
    }
  );
  const response: PipelineValidationResponse = {
    ...prepared.response,
    issues: [...warnings, ...prepared.response.issues],
  };
  sendJson(res, 200, response);
}

/** Conventional freeform `condition` labels offered as suggestions (the field itself stays freeform). */
const CONDITION_LABEL_SUGGESTIONS = [
  'always',
  'security-relevant',
  'performance-sensitive',
  'ui',
  'non-ui',
];

/**
 * Pipeline catalog endpoint (pipeline-definition-api): the assembly vocabulary
 * for the pipeline canvas — installed skills, enum vocabularies, and gate/
 * handoff constraints — sourced entirely from the same definitions the
 * pipeline loader enforces. In-process, space-independent (no `?space=`).
 */
export async function handlePipelineCatalog(
  res: http.ServerResponse,
  context: ConfigApiContext,
  sendJson: (res: http.ServerResponse, status: number, body: unknown) => void
): Promise<void> {
  const projectRoot = context.launchProjectRoot ?? process.cwd();
  const workflowCatalog = loadWorkflowCatalog({ projectRoot });
  const { enabledSkillNames } = await resolvePipelineExecutionSkillSets(
    projectRoot,
    { reporter: false, workflowCatalog }
  );
  const capabilityCatalog = createProductionCapabilityCatalogSnapshot(
    workflowCatalog.definitions,
    enabledSkillNames
  );
  const capabilityById = new Map(
    capabilityCatalog.descriptors.map((descriptor) => [descriptor.id, descriptor])
  );

  const skills = workflowCatalog.definitions.map((definition) => {
    const id = definition.skill.template.name;
    const capability = capabilityById.get(`skill:${id}`);
    return {
      id,
      description: definition.skill.template.description,
      enabled: enabledSkillNames.has(id),
      ...(capability
        ? {
            capability: {
              id: capability.id,
              version: capability.version,
              inputs: capability.inputs,
              artifacts: capability.artifacts,
              outcomes: capability.outcomes,
            },
          }
        : {}),
    };
  });

  const response: PipelineCatalogResponse = {
    roles: [...StageRoleSchema.options],
    skills,
    runtimes: [...AgentRuntimeSchema.options],
    stageKinds: [...StageKindSchema.options],
    loopKinds: [...LOOP_KIND_VALUES],
    verifyPolicies: [...VerifyPolicySchema.options],
    conditionLabels: [...CONDITION_LABEL_SUGGESTIONS],
    gate: { default: false },
    handoff: { fractionRange: [0, 1], remainingTokensGt: 0 },
  };
  sendJson(res, 200, response);
}
