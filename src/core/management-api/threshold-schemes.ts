/**
 * Installation-wide threshold scheme management.
 *
 * Scheme storage and validation stay in the threshold core. This HTTP layer
 * only supplies operation semantics (create versus update), error mapping,
 * and registry-derived preset/runtime catalog data.
 */
import type * as http from 'node:http';

import { MODEL_PRESETS } from '../model-presets.js';
import {
  DEFAULT_HANDOFF_CONFIG,
  DEFAULT_REUSE_CONFIG,
} from '../pipeline-registry/index.js';
import { PROBE_RUNTIMES } from '../runtime-adapters.js';
import {
  createThresholdScheme,
  deleteThresholdScheme,
  listThresholdSchemes,
  ThresholdSchemeError,
  type ThresholdScheme,
  updateThresholdScheme,
} from '../threshold-schemes.js';
import type {
  ThresholdPresetSeed,
  ThresholdSchemeCatalogResponse,
  ThresholdSchemeMutationRequest,
  ThresholdSchemeMutationResponse,
} from './wire-types.js';

type SendError = (
  res: http.ServerResponse,
  status: number,
  code: string,
  message: string,
  fix?: string
) => void;
type SendJson = (res: http.ServerResponse, status: number, body: unknown) => void;

function presetSeeds(): ThresholdPresetSeed[] {
  return MODEL_PRESETS.map((preset) => ({
    id: preset.match[0],
    match: [...preset.match],
    contextWindow: preset.contextWindow,
    seed: {
      handoff: preset.handoffThreshold ?? DEFAULT_HANDOFF_CONFIG.threshold,
      reuse: preset.reuseThreshold ?? DEFAULT_REUSE_CONFIG.threshold,
    },
    sources: {
      handoff: preset.handoffThreshold === undefined ? 'default' : 'preset',
      reuse: preset.reuseThreshold === undefined ? 'default' : 'preset',
    },
  }));
}

export function thresholdSchemeCatalog(): ThresholdSchemeCatalogResponse {
  return {
    schemes: listThresholdSchemes(),
    presets: presetSeeds(),
    bindingRows: [...PROBE_RUNTIMES, 'default'],
  };
}

export function handleThresholdSchemeCatalog(
  res: http.ServerResponse,
  sendError: SendError,
  sendJson: SendJson
): void {
  try {
    sendJson(res, 200, thresholdSchemeCatalog());
  } catch (error) {
    sendError(
      res,
      500,
      'internal_error',
      error instanceof Error ? error.message : String(error)
    );
  }
}

function parseMutation(body: unknown): ThresholdSchemeMutationRequest | null {
  if (typeof body !== 'object' || body === null) return null;
  const candidate = body as Record<string, unknown>;
  if (candidate.op === 'delete' && typeof candidate.name === 'string') {
    return { op: 'delete', name: candidate.name };
  }
  if (
    (candidate.op === 'create' || candidate.op === 'update') &&
    typeof candidate.name === 'string' &&
    typeof candidate.scheme === 'object' &&
    candidate.scheme !== null
  ) {
    return {
      op: candidate.op,
      name: candidate.name,
      scheme: candidate.scheme as ThresholdScheme,
    };
  }
  return null;
}

function mapSchemeError(
  res: http.ServerResponse,
  error: unknown,
  sendError: SendError
): void {
  if (error instanceof ThresholdSchemeError) {
    if (error.code === 'lock_timeout') {
      sendError(
        res,
        423,
        'lock_timeout',
        error.message,
        'Retry shortly. If contention persists, inspect the lock file named in the message. Only after confirming that no Rasen process is actively mutating this scheme should you remove that lock file manually.'
      );
      return;
    }
    sendError(
      res,
      error.code === 'not_found' ? 404 : error.code === 'already_exists' ? 409 : 400,
      error.code === 'already_exists' ? 'conflict' : error.code,
      error.message
    );
    return;
  }
  sendError(
    res,
    500,
    'internal_error',
    error instanceof Error ? error.message : String(error)
  );
}

export function handleThresholdSchemeMutation(
  res: http.ServerResponse,
  body: unknown,
  sendError: SendError,
  sendJson: SendJson
): void {
  const request = parseMutation(body);
  if (!request) {
    sendError(
      res,
      400,
      'invalid_input',
      'Request must be create/update with a name and complete scheme, or delete with a name.'
    );
    return;
  }

  try {
    let response: ThresholdSchemeMutationResponse;
    if (request.op === 'delete') {
      deleteThresholdScheme(request.name);
      response = { op: 'delete', deleted: request.name };
      sendJson(res, 200, response);
      return;
    }

    const scheme =
      request.op === 'create'
        ? createThresholdScheme(request.name, request.scheme)
        : updateThresholdScheme(request.name, request.scheme);
    response = {
      op: request.op,
      name: request.name,
      scheme,
    };
    sendJson(res, request.op === 'create' ? 201 : 200, response);
  } catch (error) {
    mapSchemeError(res, error, sendError);
  }
}
