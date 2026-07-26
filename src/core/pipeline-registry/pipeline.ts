import * as fs from 'node:fs';
import { stringify as stringifyYaml } from 'yaml';
import {
  createCapabilityCatalogSnapshot,
  DefinitionReadError,
  EcpDefinitionModule,
  type CapabilityCatalogSnapshot,
} from './definition.js';
import { validateLegacyPipelineDefinition } from './legacy-validation.js';
import { parsePipelineSourceDocument } from './source-document.js';
import { PipelineYamlSchema, type PipelineYaml } from './types.js';

export { parsePipelineSourceDocument } from './source-document.js';

export class PipelineValidationError extends Error {
  readonly path?: string;
  override readonly cause?: unknown;

  constructor(
    message: string,
    readonly code = 'pipeline_invalid',
    options: { readonly path?: string; readonly cause?: unknown } = {}
  ) {
    super(message);
    this.name = 'PipelineValidationError';
    this.path = options.path;
    this.cause = options.cause;
  }
}

/**
 * Converts authoritative preparation diagnostics into the stable execution
 * admission error contract. Product entry points and recursive decompose
 * selection share this conversion so code/path identity cannot diverge.
 */
export function pipelineValidationErrorFromDefinitionReadError(
  error: DefinitionReadError,
  options: {
    readonly prefix?: string;
    readonly cause?: unknown;
    readonly fallbackPath?: string;
  } = {}
): PipelineValidationError {
  const first = error.diagnostics[0];
  const code = first?.code ?? 'pipeline_invalid';
  const path = first?.path ?? options.fallbackPath;
  const detail =
    error.diagnostics.length > 0
      ? error.diagnostics
          .map(
            (diagnostic) =>
              `[${diagnostic.code}] ${diagnostic.path}: ${diagnostic.message}`
          )
          .join('; ')
      : '[pipeline_invalid] Pipeline definition preparation failed.';
  return new PipelineValidationError(
    `${options.prefix ?? 'Pipeline definition preparation failed'}: ${detail}`,
    code,
    {
      path,
      cause: options.cause ?? error,
    }
  );
}

/**
 * Loads and validates a pipeline from a YAML file.
 */
export function loadPipeline(filePath: string): PipelineYaml {
  const content = fs.readFileSync(filePath, 'utf-8');
  return parsePipeline(content);
}

/**
 * Parses and validates a pipeline from YAML content.
 */
export function parsePipeline(
  yamlContent: string,
  catalog?: CapabilityCatalogSnapshot
): PipelineYaml {
  let source: unknown = yamlContent;
  try {
    source = parsePipelineSourceDocument(yamlContent);
  } catch {
    // Keep malformed syntax on the authoritative preparation path, which
    // converts parser failures into DefinitionReadError diagnostics.
  }
  const explicitVersion =
    source !== null && typeof source === 'object' && !Array.isArray(source)
      ? (source as { version?: unknown }).version
      : undefined;
  if (explicitVersion === 2 && !catalog) {
    throw new PipelineValidationError(
      'Pipeline Definition version 2 requires an authoritative frozen capability catalog before legacy runtime selection.',
      'pipeline_capability_catalog_required'
    );
  }
  const prepared = EcpDefinitionModule.prepare(
    source,
    catalog ?? createCapabilityCatalogSnapshot([])
  );
  if (!prepared.ok) {
    throw pipelineValidationErrorFromDefinitionReadError(prepared.error, {
      prefix: 'Invalid pipeline definition',
    });
  }
  if (prepared.value.authoredVersion !== 1) {
    const reason =
      prepared.value.capability.unavailableReason ??
      'pipeline_runtime_unavailable';
    throw new PipelineValidationError(
      `Pipeline Definition version 2 has a valid plan, but no complete runtime owner is available (${reason}).`,
      reason
    );
  }

  // The legacy parser/runtime contract is selected only after authoritative
  // preparation identified authored v1.
  return validatePreparedLegacyPipeline(
    prepared.value.authoredSource as PipelineYaml
  );
}

/**
 * Runs the legacy-only structural/runtime policy checks after the authoritative
 * Definition preparation seam has already selected authored v1.
 *
 * Callers that already hold a PreparedDefinition use this entry point to avoid
 * parsing and preparing the same source a second time.
 */
export function validatePreparedLegacyPipeline(
  pipeline: PipelineYaml
): PipelineYaml {
  const [firstIssue] = validateLegacyPipelineDefinition(pipeline);
  if (firstIssue) {
    throw new PipelineValidationError(firstIssue.message, firstIssue.code);
  }

  return pipeline;
}

/**
 * Emits the canonical YAML projection of an already validated Pipeline
 * definition. Re-running the schema normalizer is intentional: every public
 * writer (scaffold, save, export) gets the same defaults and content-version
 * stamp instead of maintaining its own serialization rules.
 */
export function serializePipelineYaml(pipeline: PipelineYaml): string {
  return stringifyYaml(PipelineYamlSchema.parse(pipeline));
}

/**
 * Validates that every stage's `skill` exists in the provided set of known
 * skill names. Kept as a SEPARATE function that accepts an injected set so it
 * is unit-testable without the skill registry; the CLI/validate layer wires
 * the full catalog separately from the active profile's effective selection.
 *
 * @throws PipelineValidationError if any stage references an unknown skill.
 */
export function validatePipelineSkills(
  pipeline: PipelineYaml,
  knownSkillNames: Set<string>,
  enabledSkillNames: Set<string> = knownSkillNames
): void {
  for (const stage of pipeline.stages) {
    // decompose stages are LEAD-interpreted fan-out points, not leaf skill
    // calls, so they carry no `skill` to validate.
    if (stage.kind === 'decompose') continue;
    if (!stage.skill || !knownSkillNames.has(stage.skill)) {
      throw new PipelineValidationError(
        `Stage '${stage.id}' references unknown skill: '${stage.skill ?? '(missing)'}'`,
        'pipeline_skill_unknown'
      );
    }
    if (!enabledSkillNames.has(stage.skill)) {
      throw new PipelineValidationError(
        `Stage '${stage.id}' references known but disabled skill: '${stage.skill}'`,
        'pipeline_skill_disabled'
      );
    }
  }
}

/** One issue reported by `validatePipelineDraft` (pipeline-definition-api). */
export interface PipelineValidationIssue {
  severity: 'error' | 'warning';
  /** A JSON-pointer-ish locator into the definition, e.g. `/stages/2/skill`. Structural errors with no single field locus use `/stages` or `/`. */
  path: string;
  message: string;
}

/**
 * In-process, issue-collecting dry-run of a draft pipeline definition
 * (pipeline-definition-api `POST /api/v1/pipeline-validation`). Unlike
 * `parsePipeline` (which throws on the FIRST failure), this collects EVERY
 * discoverable issue: one Zod issue per schema violation (each with its own
 * path), then each structural check below in its own try/catch (a structural
 * check itself still only reports its first violation — the same behavior
 * `parsePipeline` exhibits for that check — so `parsePipeline` rejecting a
 * fixture always implies this collector reports at least one error over the
 * same fixture, and vice versa), then a skill known/enabled issue per
 * offending stage. Never throws on an invalid draft — invalidity is data.
 */
export function validatePipelineDraft(
  definition: unknown,
  skillSets: { knownSkillNames: Set<string>; enabledSkillNames: Set<string> }
): PipelineValidationIssue[] {
  const issues: PipelineValidationIssue[] = [];
  const explicitVersion =
    definition !== null &&
    typeof definition === 'object' &&
    !Array.isArray(definition)
      ? (definition as { version?: unknown }).version
      : undefined;
  if (explicitVersion !== undefined && explicitVersion !== 1) {
    const prepared = EcpDefinitionModule.prepare(
      definition,
      createCapabilityCatalogSnapshot([])
    );
    if (!prepared.ok) {
      return prepared.error.diagnostics.map((item) => ({
        severity: item.severity,
        path: item.path,
        message: item.message,
      }));
    }
    // A valid v2 Definition belongs to the shared preparation validator, not
    // the legacy flat-DAG collector.
    return [];
  }

  const result = PipelineYamlSchema.safeParse(definition);
  if (!result.success) {
    for (const issue of result.error.issues) {
      issues.push({
        severity: 'error',
        path: issue.path.length > 0 ? `/${issue.path.join('/')}` : '/',
        message: issue.message,
      });
    }
    return issues;
  }

  const pipeline = result.data;
  return validatePreparedLegacyPipelineDraft(pipeline, skillSets);
}

/**
 * Collects legacy-only structural and skill issues after Definition
 * preparation has already normalized and admitted authored v1.
 */
export function validatePreparedLegacyPipelineDraft(
  pipeline: PipelineYaml,
  skillSets: { knownSkillNames: Set<string>; enabledSkillNames: Set<string> }
): PipelineValidationIssue[] {
  const issues: PipelineValidationIssue[] = [];
  for (const diagnostic of validateLegacyPipelineDefinition(pipeline)) {
    issues.push({
      severity: 'error',
      path: diagnostic.path,
      message: diagnostic.message,
    });
  }
  issues.push(...collectLegacyPipelineSkillIssues(pipeline, skillSets));
  return issues;
}

export function collectLegacyPipelineSkillIssues(
  pipeline: PipelineYaml,
  skillSets: { knownSkillNames: Set<string>; enabledSkillNames: Set<string> }
): PipelineValidationIssue[] {
  const issues: PipelineValidationIssue[] = [];
  for (const [index, stage] of pipeline.stages.entries()) {
    // decompose stages carry no `skill` to validate (see validatePipelineSkills).
    if (stage.kind === 'decompose') continue;
    if (!stage.skill || !skillSets.knownSkillNames.has(stage.skill)) {
      issues.push({
        severity: 'error',
        path: `/stages/${index}/skill`,
        message: `Stage '${stage.id}' references unknown skill: '${stage.skill ?? '(missing)'}'`,
      });
      continue;
    }
    if (!skillSets.enabledSkillNames.has(stage.skill)) {
      issues.push({
        severity: 'error',
        path: `/stages/${index}/skill`,
        message: `Stage '${stage.id}' references known but disabled skill: '${stage.skill}'`,
      });
    }
  }
  return issues;
}
