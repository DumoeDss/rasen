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
  listPipelinesWithInfo,
  loadPipelineByName,
  resolvePipelineStageOverrides,
  resolveEffectiveStage,
  resolvePipelineExecutionSkillSets,
  validatePipelineDraft,
  StageRoleSchema,
  AgentRuntimeSchema,
  VerifyPolicySchema,
  StageKindSchema,
  LOOP_KIND_VALUES,
  type EffectiveStageInputs,
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
  PipelineValidationResponse,
  WirePipeline,
} from './wire-types.js';

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
  const infos = listPipelinesWithInfo(bundle.pipelineRoot);
  const pipelines: WirePipeline[] = [];
  for (const info of infos) {
    let pipeline;
    try {
      pipeline = loadPipelineByName(info.name, bundle.pipelineRoot);
    } catch {
      continue;
    }
    const overrides = resolvePipelineStageOverrides(pipeline.name, bundle.effOptions);
    const inputs: EffectiveStageInputs = { ...bundle.inputsBase, overrides };
    pipelines.push({
      name: pipeline.name,
      description: pipeline.description ?? '',
      provenance: info.source === 'package' ? 'built-in' : 'user',
      sourceLayer: info.source,
      stages: pipeline.stages.map((stage) => {
        const eff = resolveEffectiveStage(stage, pipeline, inputs);
        return {
          id: eff.id,
          role: eff.role,
          skill: eff.skill,
          gate: eff.declaredGate,
          effectiveGate: { value: eff.gate.effective, source: eff.gate.source },
          effectiveModel: { value: eff.model.value, source: eff.model.source },
          effectiveHandoff: { value: eff.handoff.threshold, source: eff.handoff.source },
          effectiveRuntime: { value: eff.runtime.value, source: eff.runtime.source },
        };
      }),
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
  const info = listPipelinesWithInfo(bundle.pipelineRoot).find((entry) => entry.name === name);
  if (!info) {
    sendError(res, 404, 'not_found', `No pipeline named "${name}".`);
    return;
  }

  let pipeline;
  try {
    pipeline = loadPipelineByName(name, bundle.pipelineRoot);
  } catch {
    sendError(res, 404, 'not_found', `No pipeline named "${name}".`);
    return;
  }

  const overrides = resolvePipelineStageOverrides(pipeline.name, bundle.effOptions);
  const inputs: EffectiveStageInputs = { ...bundle.inputsBase, overrides };
  const resolvedView: WirePipeline = {
    name: pipeline.name,
    description: pipeline.description ?? '',
    provenance: info.source === 'package' ? 'built-in' : 'user',
    sourceLayer: info.source,
    stages: pipeline.stages.map((stage) => {
      const eff = resolveEffectiveStage(stage, pipeline, inputs);
      return {
        id: eff.id,
        role: eff.role,
        skill: eff.skill,
        gate: eff.declaredGate,
        effectiveGate: { value: eff.gate.effective, source: eff.gate.source },
        effectiveModel: { value: eff.model.value, source: eff.model.source },
        effectiveHandoff: { value: eff.handoff.threshold, source: eff.handoff.source },
        effectiveRuntime: { value: eff.runtime.value, source: eff.runtime.source },
      };
    }),
  };

  const response: PipelineDetailResponse = {
    pipeline: resolvedView,
    definition: pipeline,
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
  const { knownSkillNames, enabledSkillNames } = await resolvePipelineExecutionSkillSets(
    bundle.pipelineRoot,
    {
      reporter: (notice) => {
        warnings.push({
          severity: 'warning',
          path: '/',
          message: `Dropping unknown workflow id(s) from stored profile: ${notice.workflowIds.join(', ')}`,
        });
      },
    }
  );

  const issues = [...warnings, ...validatePipelineDraft(definition, { knownSkillNames, enabledSkillNames })];
  const valid = !issues.some((issue) => issue.severity === 'error');
  const response: PipelineValidationResponse = { valid, issues };
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
  const { enabledSkillNames } = await resolvePipelineExecutionSkillSets(projectRoot, { reporter: false });
  const workflowCatalog = loadWorkflowCatalog();

  const skills = workflowCatalog.definitions.map((definition) => ({
    id: definition.skill.template.name,
    description: definition.skill.template.description,
    enabled: enabledSkillNames.has(definition.skill.template.name),
  }));

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
