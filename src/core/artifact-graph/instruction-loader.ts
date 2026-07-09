import { WORKSPACE_DIR_NAME } from '../config.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getSchemaDir, resolveSchema } from './resolver.js';
import { ArtifactGraph } from './graph.js';
import { detectCompleted } from './state.js';
import { resolveArtifactOutputs } from './outputs.js';
import { readChangeMetadata, resolveSchemaForChange } from '../../utils/change-metadata.js';
import { FileSystemUtils } from '../../utils/file-system.js';
import {
  buildActionContext,
  buildNextSteps,
  summarizePlanningHome,
  type ActionContext,
  type PlanningHomeSummary,
} from '../change-status-policy.js';
import { readProjectConfig, validateConfigRules, type ProjectConfig } from '../project-config.js';
import type { ReferenceIndexEntry } from '../references.js';
import type { PlanningHome } from '../planning-home.js';
import type { ChangeMetadata } from '../change-metadata/index.js';
import { parseTestPlan } from '../parsers/requirement-blocks.js';
import type { Artifact, CompletedSet } from './types.js';

// Session-level cache for validation warnings (avoid repeating same warnings)
const shownWarnings = new Set<string>();

/**
 * Error thrown when loading a template fails.
 */
export class TemplateLoadError extends Error {
  constructor(
    message: string,
    public readonly templatePath: string
  ) {
    super(message);
    this.name = 'TemplateLoadError';
  }
}

/**
 * Change context containing graph, completion state, and metadata.
 */
export interface ChangeContext {
  /** The artifact dependency graph */
  graph: ArtifactGraph;
  /** Set of completed artifact IDs */
  completed: CompletedSet;
  /** Schema name being used */
  schemaName: string;
  /** Change name */
  changeName: string;
  /** Path to the change directory */
  changeDir: string;
  /** Project root directory */
  projectRoot: string;
  /** Resolved planning home for this change */
  planningHome?: PlanningHome;
  /** Parsed change metadata, when present */
  metadata?: ChangeMetadata;
}

export interface LoadChangeContextOptions {
  changeDir?: string;
  planningHome?: PlanningHome;
}

/**
 * Enriched instructions for creating an artifact.
 */
export interface ArtifactInstructions {
  /** Change name */
  changeName: string;
  /** Artifact ID */
  artifactId: string;
  /** Schema name */
  schemaName: string;
  /** Full path to change directory */
  changeDir: string;
  /** Resolved planning home for this change */
  planningHome?: PlanningHomeSummary;
  /** Output path pattern (e.g., "proposal.md") */
  outputPath: string;
  /** Absolute output path or glob pattern resolved under the change directory */
  resolvedOutputPath: string;
  /** Existing concrete output files for this artifact */
  existingOutputPaths: string[];
  /** Artifact description */
  description: string;
  /** Guidance on how to create this artifact (from schema instruction field) */
  instruction: string | undefined;
  /** Project context from config (constraints/background for AI, not to be included in output) */
  context: string | undefined;
  /** Artifact-specific rules from config (constraints for AI, not to be included in output) */
  rules: string[] | undefined;
  /** Global quality rules from config (constraints for AI, not to be included in output) */
  qualityRules: string[] | undefined;
  /** Enhance skill to invoke after creating this artifact */
  enhance: string | undefined;
  /** Provider skill that generates this artifact */
  provider: string | undefined;
  /** Artifact ID to read structured context from */
  contextFrom: string | undefined;
  /** Structured context content from referenced artifact (if available) */
  structuredContext: string | undefined;
  /** Referenced-store index (read-only upstream context; omitted when no references are declared) */
  references?: ReferenceIndexEntry[];
  /** Template content (structure to follow - this IS the output format) */
  template: string;
  /** Dependencies with completion status and paths */
  dependencies: DependencyInfo[];
  /** Artifacts that become available after completing this one */
  unlocks: string[];
}

/**
 * Dependency information including path and description.
 */
export interface DependencyInfo {
  /** Artifact ID */
  id: string;
  /** Whether the dependency is completed */
  done: boolean;
  /** Relative output path of the dependency (e.g., "proposal.md") */
  path: string;
  /** Description of the dependency artifact */
  description: string;
}

/**
 * Status of a single artifact in the workflow.
 */
export interface ArtifactStatus {
  /** Artifact ID */
  id: string;
  /** Output path pattern */
  outputPath: string;
  /** Status: done, ready, or blocked */
  status: 'done' | 'ready' | 'blocked';
  /** Missing dependencies (only for blocked) */
  missingDeps?: string[];
}

/**
 * Formatted change status.
 */
export interface ChangeStatus {
  /** Change name */
  changeName: string;
  /** Schema name */
  schemaName: string;
  /** Planning home facts (generated skills derive the archive dir
   * from planningHome.changesDir - a published agent contract). */
  planningHome?: PlanningHomeSummary;
  /** Full path to the change root */
  changeRoot: string;
  /** Absolute artifact path details keyed by artifact ID */
  artifactPaths: Record<string, ArtifactPathSummary>;
  /** Plain-language next steps for users and agents */
  nextSteps: string[];
  /** Machine-readable action constraints for agents */
  actionContext: ActionContext;
  /** Whether all artifacts are complete */
  isComplete: boolean;
  /** Artifact IDs required before apply phase (from schema's apply.requires) */
  applyRequires: string[];
  /** Status of each artifact */
  artifacts: ArtifactStatus[];
}

export interface ArtifactPathSummary {
  outputPath: string;
  resolvedOutputPath: string;
  existingOutputPaths: string[];
}

/**
 * Loads a template from a schema's templates directory.
 *
 * @param schemaName - Schema name (e.g., "spec-driven")
 * @param templatePath - Relative path within the templates directory (e.g., "proposal.md")
 * @param projectRoot - Optional project root for project-local schema resolution
 * @returns The template content
 * @throws TemplateLoadError if the template cannot be loaded
 */
export function loadTemplate(
  schemaName: string,
  templatePath: string,
  projectRoot?: string
): string {
  const schemaDir = getSchemaDir(schemaName, projectRoot);
  if (!schemaDir) {
    throw new TemplateLoadError(
      `Schema '${schemaName}' not found`,
      templatePath
    );
  }

  const templatePathOnDisk = path.join(schemaDir, 'templates', templatePath);

  if (!fs.existsSync(templatePathOnDisk)) {
    throw new TemplateLoadError(
      `Template not found: ${templatePathOnDisk}`,
      templatePathOnDisk
    );
  }

  const fullPath = FileSystemUtils.canonicalizeExistingPath(templatePathOnDisk);

  try {
    return fs.readFileSync(fullPath, 'utf-8');
  } catch (err) {
    const ioError = err instanceof Error ? err : new Error(String(err));
    throw new TemplateLoadError(
      `Failed to read template: ${ioError.message}`,
      fullPath
    );
  }
}

/**
 * Loads change context combining graph and completion state.
 *
 * Schema resolution order:
 * 1. Explicit schemaName parameter (if provided)
 * 2. Schema from .openspec.yaml metadata (if exists in change directory)
 * 3. Default 'spec-driven'
 *
 * @param projectRoot - Project root directory
 * @param changeName - Change name
 * @param schemaName - Optional schema name override. If not provided, auto-detected from metadata.
 * @returns Change context with graph, completed set, and metadata
 */
export function loadChangeContext(
  projectRoot: string,
  changeName: string,
  schemaName?: string,
  options: LoadChangeContextOptions = {}
): ChangeContext {
  const changeDir = FileSystemUtils.canonicalizeExistingPath(
    options.changeDir ?? path.join(projectRoot, WORKSPACE_DIR_NAME, 'changes', changeName)
  );

  const metadata = readChangeMetadata(changeDir, projectRoot) ?? undefined;
  const resolvedSchemaName = resolveSchemaForChange(changeDir, schemaName, projectRoot, {
    metadata: metadata ?? null,
  });

  const schema = resolveSchema(resolvedSchemaName, projectRoot);
  const graph = ArtifactGraph.fromSchema(schema);
  const completed = detectCompleted(graph, changeDir);

  return {
    graph,
    completed,
    schemaName: resolvedSchemaName,
    changeName,
    changeDir,
    projectRoot,
    ...(options.planningHome ? { planningHome: options.planningHome } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

/**
 * Generates enriched instructions for creating an artifact.
 *
 * Instruction injection order:
 * 1. <context> - Project context from config (if present)
 * 2. <rules> - Artifact-specific rules from config (if present)
 * 3. <quality-rules> - Global quality rules from config (if present)
 * 4. <enhance> - Enhance skill directive (if artifact has enhance field)
 * 5. <provider> - Provider skill directive (if artifact has provider field)
 * 6. <structured-context> - Content from referenced artifact (if context-from is set and artifact is done)
 * 7. <template> - Schema's template content
 *
 * @param context - Change context
 * @param artifactId - Artifact ID to generate instructions for
 * @param projectRoot - Project root directory (for reading config)
 * @returns Enriched artifact instructions
 * @throws Error if artifact not found
 */
export interface GenerateInstructionsOptions {
  /** Pre-read project config; suppresses the internal read (no double read). */
  projectConfig?: ProjectConfig | null;
  /** Referenced-store index assembled at the command boundary. */
  references?: ReferenceIndexEntry[];
}

export function generateInstructions(
  context: ChangeContext,
  artifactId: string,
  projectRoot?: string,
  options: GenerateInstructionsOptions = {}
): ArtifactInstructions {
  const artifact = context.graph.getArtifact(artifactId);
  if (!artifact) {
    throw new Error(`Artifact '${artifactId}' not found in schema '${context.schemaName}'`);
  }

  const templateContent = loadTemplate(context.schemaName, artifact.template, context.projectRoot);
  const dependencies = getDependencyInfo(artifact, context.graph, context.completed);
  const unlocks = getUnlockedArtifacts(context.graph, artifactId);

  // Use projectRoot from context if not explicitly provided
  const effectiveProjectRoot = projectRoot ?? context.projectRoot;

  // Use the pre-read config when provided; otherwise read it here.
  let projectConfig = options.projectConfig ?? null;
  if (options.projectConfig === undefined && effectiveProjectRoot) {
    try {
      projectConfig = readProjectConfig(effectiveProjectRoot);
    } catch {
      // If config read fails, continue without config
    }
  }

  // Validate rules artifact IDs if config has rules (only once per session)
  if (projectConfig?.rules) {
    const validArtifactIds = new Set(context.graph.getAllArtifacts().map((a) => a.id));
    const warnings = validateConfigRules(
      projectConfig.rules,
      validArtifactIds,
      context.schemaName
    );

    // Show each unique warning only once per session
    for (const warning of warnings) {
      if (!shownWarnings.has(warning)) {
        console.warn(warning);
        shownWarnings.add(warning);
      }
    }
  }

  // Extract context and rules as separate fields (not prepended to template)
  const configContext = projectConfig?.context?.trim() || undefined;
  const rulesForArtifact = projectConfig?.rules?.[artifactId];
  const configRules = rulesForArtifact && rulesForArtifact.length > 0 ? rulesForArtifact : undefined;

  // Extract quality-rules from config
  const qualityRules = projectConfig?.['quality-rules'] && projectConfig['quality-rules'].length > 0
    ? projectConfig['quality-rules']
    : undefined;

  // Extract enhance, provider, context-from from artifact definition
  const enhance = artifact.enhance || undefined;
  const provider = artifact.provider || undefined;
  const contextFrom = artifact['context-from'] || undefined;

  // Load structured context from referenced artifact if available
  let structuredContext: string | undefined;
  if (contextFrom && context.completed.has(contextFrom)) {
    const refArtifact = context.graph.getArtifact(contextFrom);
    if (refArtifact) {
      const refPath = path.join(context.changeDir, refArtifact.generates);
      try {
        if (fs.existsSync(refPath)) {
          const content = fs.readFileSync(refPath, 'utf-8');
          // If referenced artifact generates specs (glob pattern), parse as test plan
          if (refArtifact.generates.includes('specs')) {
            const plan = parseTestPlan(content, refArtifact.id);
            structuredContext = JSON.stringify(plan, null, 2);
          } else {
            structuredContext = content;
          }
        }
      } catch {
        // If reading fails, continue without structured context
      }
    }
  }

  return {
    changeName: context.changeName,
    artifactId: artifact.id,
    schemaName: context.schemaName,
    changeDir: context.changeDir,
    planningHome: summarizePlanningHome(context.planningHome),
    outputPath: artifact.generates,
    resolvedOutputPath: path.join(context.changeDir, artifact.generates),
    existingOutputPaths: resolveArtifactOutputs(context.changeDir, artifact.generates),
    description: artifact.description,
    instruction: artifact.instruction,
    context: configContext,
    rules: configRules,
    qualityRules,
    enhance,
    provider,
    contextFrom,
    structuredContext,
    ...(options.references !== undefined ? { references: options.references } : {}),
    template: templateContent,
    dependencies,
    unlocks,
  };
}

/**
 * Gets dependency info including paths and descriptions.
 */
function getDependencyInfo(
  artifact: Artifact,
  graph: ArtifactGraph,
  completed: CompletedSet
): DependencyInfo[] {
  return artifact.requires.map(id => {
    const depArtifact = graph.getArtifact(id);
    return {
      id,
      done: completed.has(id),
      path: depArtifact?.generates ?? id,
      description: depArtifact?.description ?? '',
    };
  });
}

/**
 * Gets artifacts that become available after completing the given artifact.
 */
function getUnlockedArtifacts(graph: ArtifactGraph, artifactId: string): string[] {
  const unlocks: string[] = [];

  for (const artifact of graph.getAllArtifacts()) {
    if (artifact.requires.includes(artifactId)) {
      unlocks.push(artifact.id);
    }
  }

  return unlocks.sort();
}

/**
 * Formats the status of all artifacts in a change.
 *
 * @param context - Change context
 * @returns Formatted change status
 */
export function formatChangeStatus(
  context: ChangeContext,
  options: { storeId?: string; storeType?: 'store' | 'project' } = {}
): ChangeStatus {
  // Load schema to get apply phase configuration
  const schema = resolveSchema(context.schemaName, context.projectRoot);
  const applyRequires = schema.apply?.requires ?? schema.artifacts.map(a => a.id);

  const artifacts = context.graph.getAllArtifacts();
  const ready = new Set(context.graph.getNextArtifacts(context.completed));
  const blocked = context.graph.getBlocked(context.completed);

  const artifactPaths: Record<string, ArtifactPathSummary> = {};
  const artifactStatuses: ArtifactStatus[] = artifacts.map(artifact => {
    artifactPaths[artifact.id] = {
      outputPath: artifact.generates,
      resolvedOutputPath: path.join(context.changeDir, artifact.generates),
      existingOutputPaths: resolveArtifactOutputs(context.changeDir, artifact.generates),
    };

    if (context.completed.has(artifact.id)) {
      return {
        id: artifact.id,
        outputPath: artifact.generates,
        status: 'done' as const,
      };
    }

    if (ready.has(artifact.id)) {
      return {
        id: artifact.id,
        outputPath: artifact.generates,
        status: 'ready' as const,
      };
    }

    return {
      id: artifact.id,
      outputPath: artifact.generates,
      status: 'blocked' as const,
      missingDeps: blocked[artifact.id] ?? [],
    };
  });

  // Sort by build order for consistent output
  const buildOrder = context.graph.getBuildOrder();
  const orderMap = new Map(buildOrder.map((id, idx) => [id, idx]));
  artifactStatuses.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
  const isComplete = context.graph.isComplete(context.completed);
  const artifactIds = artifactStatuses.map((artifact) => artifact.id);

  return {
    changeName: context.changeName,
    schemaName: context.schemaName,
    planningHome: summarizePlanningHome(context.planningHome),
    changeRoot: context.changeDir,
    artifactPaths,
    isComplete,
    applyRequires,
    nextSteps: buildNextSteps({
      changeName: context.changeName,
      artifactStatuses,
      allArtifactsComplete: isComplete,
      ...(options.storeId ? { storeId: options.storeId } : {}),
      ...(options.storeType ? { storeType: options.storeType } : {}),
    }),
    actionContext: buildActionContext({
      projectRoot: context.projectRoot,
      artifactIds,
    }),
    artifacts: artifactStatuses,
  };
}
