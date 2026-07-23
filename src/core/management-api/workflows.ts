/**
 * Read endpoints for the workflow library (workflow-http-api design D3):
 *   GET /api/v1/workflows              — listing, mirrors `workflow list --json`
 *   GET /api/v1/workflows/<id>         — detail, mirrors `workflow show --json`
 *   GET /api/v1/workflow-validation    — validation, mirrors `workflow validate --json`
 *
 * Every read is computed in-process from a FRESH `loadWorkflowCatalog()` at
 * request time (spec: "Fresh read per request"), reusing the exact same
 * library helpers the CLI commands use (`createWorkflowUsageContext`,
 * `scanWorkflowUsage`, `workflowDefinitionForJson`, `validateWorkflowInput`)
 * so the page and the CLI never diverge. The server writes nothing here —
 * validation installs nothing (spec: "Read-only guarantee").
 */
import * as path from 'node:path';

import {
  createWorkflowUsageContext,
  scanWorkflowUsage,
  validateWorkflowInput,
  workflowDefinitionForJson,
} from '../workflow-library.js';
import { loadWorkflowCatalog } from '../workflow-registry/index.js';
import type {
  WorkflowDetailResponse,
  WorkflowListResponse,
  WorkflowValidationResponse,
} from './wire-types.js';

export type WorkflowReadResult<T> =
  | { ok: true; response: T }
  | { ok: false; status: number; code: string; message: string };

/**
 * `GET /api/v1/workflows` (design D3 / task 2.1). Fresh catalog read; every
 * entry shaped exactly like `workflow list --json`, using the same
 * machine-level usage context `list` uses (`createWorkflowUsageContext(catalog)`
 * with no projectRoot override — it resolves the server's own cwd project,
 * matching a `workflow list` run from the same place), plus the invalid
 * records and catalog-level diagnostics.
 */
export function handleWorkflowsList(): WorkflowReadResult<WorkflowListResponse> {
  const catalog = loadWorkflowCatalog();
  const usageContext = createWorkflowUsageContext(catalog);
  const workflows = catalog.definitions.map((definition) => {
    const usage =
      definition.source === 'user' ? scanWorkflowUsage(definition.id, {}, usageContext) : [];
    return {
      id: definition.id,
      source: definition.source,
      sourcePath: definition.sourcePath ?? null,
      digest: definition.digest,
      kind: definition.kind,
      skillName: definition.skill.template.name,
      title: definition.title ?? null,
      unused: definition.source === 'user' && usage.length === 0,
    };
  });
  const invalid = catalog.invalid.map((record) => ({
    id: record.id,
    source: record.source,
    sourcePath: record.sourcePath,
    valid: false as const,
    diagnostics: record.diagnostics,
  }));
  return { ok: true, response: { workflows, invalid, diagnostics: [...catalog.diagnostics] } };
}

/**
 * `GET /api/v1/workflows/<id>` (design D3 / task 2.2). Mirrors
 * `workflow show --json`: the full definition plus known usage referrers. An
 * id in neither the valid nor invalid catalog yields 404.
 */
export function handleWorkflowDetail(id: string): WorkflowReadResult<WorkflowDetailResponse> {
  const catalog = loadWorkflowCatalog();
  const definition = catalog.get(id);
  if (!definition) {
    return { ok: false, status: 404, code: 'workflow_not_found', message: `Workflow "${id}" was not found.` };
  }
  const usageContext = createWorkflowUsageContext(catalog);
  const usage = scanWorkflowUsage(id, {}, usageContext);
  return {
    ok: true,
    response: {
      workflow: workflowDefinitionForJson(definition) as unknown as WorkflowDetailResponse['workflow'],
      usage,
    },
  };
}

/**
 * `GET /api/v1/workflow-validation?target=<value>` (design D3 / task 2.3).
 * The target is either an installed workflow id (valid or invalid) or an
 * absolute path to a draft directory / package. A target that is neither a
 * catalog id nor an absolute path is rejected with 400 — the endpoint never
 * probes relative filesystem locations. Read-only: `validateWorkflowInput`
 * validates a package into a discarded temp dir and installs nothing.
 *
 * @param projectRoot The launch project root, used as the validation's project
 * context exactly as the CLI uses `findRepoPlanningRootSync(cwd) ?? cwd`.
 */
export function handleWorkflowValidation(
  target: unknown,
  projectRoot: string
): WorkflowReadResult<WorkflowValidationResponse> {
  if (typeof target !== 'string' || target.length === 0) {
    return { ok: false, status: 400, code: 'invalid_input', message: 'target must be a non-empty string.' };
  }
  const catalog = loadWorkflowCatalog();
  const isCatalogId = catalog.has(target) || catalog.invalid.some((record) => record.id === target);
  if (!isCatalogId && !path.isAbsolute(target)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_input',
      message: 'target must be an installed workflow id or an absolute path.',
    };
  }
  const validation = validateWorkflowInput(target, { projectRoot });
  return { ok: true, response: { validation } };
}
