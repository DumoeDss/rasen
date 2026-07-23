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
  type EffectiveStageInputs,
} from '../pipeline-registry/index.js';
import {
  resolveConfigContext,
  contextProjectRef,
  contextStoreRef,
  firstQueryValue,
  pipelineResolutionBundle,
} from '../config-api/config-context.js';
import type { ConfigApiContext } from '../config-api/router.js';
import type { WirePipeline } from './wire-types.js';

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
