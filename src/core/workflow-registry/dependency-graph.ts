/**
 * Workflow dependency graph (ui-profile-polish design D7). Derives, for every
 * workflow in the catalog, its STRONG dependency closure (served transitively
 * closed so a UI can cascade without walking the graph) and its WEAK
 * enhancement associations (served inverted — the workflows each unit
 * enhances). All edges come from EXISTING registry data:
 *
 *   strong(U) = U.requires.workflows
 *             ∪ owner(U.requires.skills)
 *             ∪ { owner(stage.skill) : stage unconditional, stage ∈ a pipeline
 *                                       reachable from U.requires.pipelines }
 *   weak(U)   = { owner(stage.skill) : stage condition-gated }  −  strong(U)
 *
 * A stage is *unconditional* when it has no `condition` or `condition: 'always'`
 * (parallelGroup membership does not weaken it). `owner(skillName)` resolves via
 * the same dual-identity map (`portablePathCollisionKey` over `template.name`
 * and `dirName`) that `resolveWorkflowSelection` uses.
 *
 * The computation is deliberately fault-tolerant — the graph is advisory and
 * must never make a page error on a broken user pipeline: self-references are
 * dropped, cycles are tolerated (BFS with a visited set), and a pipeline that
 * fails to load or a skill with no owning catalog unit is skipped silently.
 */
import {
  createProductionCapabilityCatalogSnapshot,
  type DefinitionGraph,
  type DefinitionSourceV2,
} from '../pipeline-registry/definition.js';
import {
  loadPreparedPipelineByName,
  resolveChildPipelineName,
  type PreparedPipelineResolution,
} from '../pipeline-registry/resolver.js';
import type { PipelineYaml } from '../pipeline-registry/types.js';
import type { WorkflowCatalog } from './catalog.js';
import { portablePathCollisionKey } from './path-policy.js';

export interface WorkflowDependencyEntry {
  /** The workflow id this entry describes. */
  id: string;
  /** The transitive strong dependency closure (excludes `id`; each id once). */
  requires: string[];
  /** The workflow ids this unit weakly enhances (inverted weak edges). */
  enhances: string[];
}

export interface WorkflowDependencyGraph {
  entries: WorkflowDependencyEntry[];
}

/** Builds the dual-identity skill-name → owning-unit-id map (mirrors selection.ts). */
function buildSkillOwnerMap(catalog: WorkflowCatalog): Map<string, string> {
  const ownerByKey = new Map<string, string>();
  for (const definition of catalog.definitions) {
    for (const name of new Set([definition.skill.template.name, definition.skill.dirName])) {
      // First writer wins would be arbitrary on a collision; selection.ts lets
      // the last definition win, so mirror that for identical resolution.
      ownerByKey.set(portablePathCollisionKey(name), definition.id);
    }
  }
  return ownerByKey;
}

/** A stage runs unconditionally when it has no condition or an explicit `always`. */
function isUnconditional(condition: string | undefined): boolean {
  return condition === undefined || condition === 'always';
}

export type PipelineDependencySource = PipelineYaml | PreparedPipelineResolution;

function addCapabilityOwner(
  capabilityId: string,
  condition: string | undefined,
  selfId: string,
  ownerByKey: Map<string, string>,
  strong: Set<string>,
  weak: Set<string>
): void {
  const skillName = capabilityId.startsWith('skill:')
    ? capabilityId.slice('skill:'.length)
    : capabilityId;
  const owner = ownerByKey.get(portablePathCollisionKey(skillName));
  if (!owner || owner === selfId) return;
  if (isUnconditional(condition)) strong.add(owner);
  else weak.add(owner);
}

/** Collect exact capability ownership from the reachable authored-v2 graph. */
function collectDefinitionOwners(
  definition: DefinitionSourceV2,
  selfId: string,
  ownerByKey: Map<string, string>,
  strong: Set<string>,
  weak: Set<string>
): void {
  const declarations = new Map(
    definition.declarations.map((declaration) => [declaration.id, declaration])
  );
  const visitedDeclarations = new Set<string>();

  const visitGraph = (graph: DefinitionGraph, root: boolean): void => {
    const memberConditions = new Map<string, string>();
    if (root) {
      for (const node of graph.nodes) {
        if (node.kind !== 'FanOut') continue;
        for (const member of node.members) {
          memberConditions.set(member.id, member.condition);
        }
      }
    }

    for (const node of graph.nodes) {
      if (node.kind === 'AtomicStage') {
        addCapabilityOwner(
          node.capability.id,
          root ? memberConditions.get(node.id) : undefined,
          selfId,
          ownerByKey,
          strong,
          weak
        );
        continue;
      }
      if (node.kind !== 'CompositeRef' && node.kind !== 'BoundedLoop') continue;
      if (node.kind === 'BoundedLoop' && node.lifecycle.strategy.capability) {
        addCapabilityOwner(
          node.lifecycle.strategy.capability.id,
          undefined,
          selfId,
          ownerByKey,
          strong,
          weak
        );
      }
      const declarationId = node.kind === 'CompositeRef' ? node.declarationId : node.body;
      if (visitedDeclarations.has(declarationId)) continue;
      const declaration = declarations.get(declarationId);
      if (!declaration) continue;
      visitedDeclarations.add(declarationId);
      visitGraph(declaration.graph, false);
    }
  };

  visitGraph(definition.root, true);
}

/**
 * Walks a pipeline's stages (and, one level down, any decompose stage's child
 * pipeline — decompose children are themselves decompose-free) accumulating the
 * owning unit of each stage skill into `strong` (unconditional) or `weak`
 * (condition-gated). `owner === selfId` is dropped. A `visited` set over
 * pipeline names bounds recursion and tolerates cycles; an unloadable pipeline
 * is skipped.
 */
function collectPipelineOwners(
  pipelineName: string,
  selfId: string,
  ownerByKey: Map<string, string>,
  strong: Set<string>,
  weak: Set<string>,
  visited: Set<string>,
  projectRoot: string | undefined,
  loadPipeline: (name: string, projectRoot?: string) => PipelineDependencySource,
  ignoreLoadErrors: boolean
): void {
  if (visited.has(pipelineName)) return;
  visited.add(pipelineName);

  let pipeline;
  try {
    pipeline = loadPipeline(pipelineName, projectRoot);
  } catch (error) {
    if (ignoreLoadErrors) {
      return; // advisory graph: a broken/missing pipeline contributes nothing
    }
    throw error;
  }

  if ('prepared' in pipeline) {
    if (pipeline.prepared.authoredVersion === 2) {
      collectDefinitionOwners(
        pipeline.prepared.definition,
        selfId,
        ownerByKey,
        strong,
        weak
      );
      return;
    }
    pipeline = pipeline.prepared.authoredSource as PipelineYaml;
  }

  for (const stage of pipeline.stages) {
    if (stage.skill) {
      const owner = ownerByKey.get(portablePathCollisionKey(stage.skill));
      if (owner && owner !== selfId) {
        if (isUnconditional(stage.condition)) strong.add(owner);
        else weak.add(owner);
      }
    }
    if (stage.kind === 'decompose') {
      collectPipelineOwners(
        resolveChildPipelineName(stage),
        selfId,
        ownerByKey,
        strong,
        weak,
        visited,
        projectRoot,
        loadPipeline,
        ignoreLoadErrors
      );
    }
  }
}

/** Direct strong + weak edges for one unit, before transitive closure/inversion. */
function directEdges(
  id: string,
  catalog: WorkflowCatalog,
  ownerByKey: Map<string, string>,
  projectRoot: string | undefined,
  loadPipeline: Parameters<typeof collectPipelineOwners>[7]
): { strong: Set<string>; weak: Set<string> } {
  const definition = catalog.get(id)!;
  const strong = new Set<string>();
  const weak = new Set<string>();

  for (const workflowId of definition.requires.workflows) {
    if (workflowId !== id && catalog.has(workflowId)) strong.add(workflowId);
  }
  for (const skillName of definition.requires.skills) {
    const owner = ownerByKey.get(portablePathCollisionKey(skillName));
    if (owner && owner !== id) strong.add(owner);
  }
  const visited = new Set<string>();
  for (const pipelineName of definition.requires.pipelines) {
    collectPipelineOwners(
      pipelineName,
      id,
      ownerByKey,
      strong,
      weak,
      visited,
      projectRoot,
      loadPipeline,
      true
    );
  }

  // A unit that is strongly required is never merely a weak enhancer of the
  // same parent (design D7: weak = weak − strong).
  for (const s of strong) weak.delete(s);
  return { strong, weak };
}

export interface WorkflowPipelineCapabilityOwnerOptions {
  loadPipeline?: (name: string, projectRoot?: string) => PipelineDependencySource;
}

/**
 * Resolves every catalog unit that owns a capability reachable from the
 * pipelines required by `workflowIds`. Unlike the advisory dependency graph,
 * this authoritative install/enablement seam includes conditional members and
 * fails when a declared required pipeline cannot be loaded or prepared.
 */
export function collectWorkflowPipelineCapabilityOwnerIds(
  catalog: WorkflowCatalog,
  workflowIds: readonly string[],
  projectRoot?: string,
  options: WorkflowPipelineCapabilityOwnerOptions = {}
): string[] {
  const ownerByKey = buildSkillOwnerMap(catalog);
  const enabledSkillNames = new Set(
    catalog.definitions.map((definition) => definition.skill.template.name)
  );
  const capabilityCatalog = createProductionCapabilityCatalogSnapshot(
    catalog.definitions,
    enabledSkillNames
  );
  const loadPipeline = options.loadPipeline ?? ((name: string, root?: string) =>
    loadPreparedPipelineByName(name, root, { catalog: capabilityCatalog }));
  const owners = new Set<string>();
  const visited = new Set<string>();

  for (const workflowId of workflowIds) {
    const definition = catalog.get(workflowId);
    if (!definition) continue;
    for (const pipelineName of definition.requires.pipelines) {
      // The same set is intentional: installation must include both
      // unconditional and condition-gated capability owners so every branch
      // the selected driver can dispatch is available.
      collectPipelineOwners(
        pipelineName,
        workflowId,
        ownerByKey,
        owners,
        owners,
        visited,
        projectRoot,
        loadPipeline,
        false
      );
    }
  }

  return catalog.definitions
    .filter((definition) => owners.has(definition.id))
    .map((definition) => definition.id);
}

/**
 * Computes the advisory workflow dependency graph for the given catalog. The
 * result carries one entry per catalog unit with its transitive strong closure
 * and the inverted weak (enhances) associations. `projectRoot` scopes pipeline
 * resolution to a project's own pipelines when relevant; omit for the global
 * (user + package) catalog.
 */
export function computeWorkflowDependencyGraph(
  catalog: WorkflowCatalog,
  projectRoot?: string,
  options: {
    loadPipeline?: Parameters<typeof collectPipelineOwners>[7];
  } = {}
): WorkflowDependencyGraph {
  const ownerByKey = buildSkillOwnerMap(catalog);
  const enabledSkillNames = new Set(
    catalog.definitions.map((definition) => definition.skill.template.name)
  );
  const capabilityCatalog = createProductionCapabilityCatalogSnapshot(
    catalog.definitions,
    enabledSkillNames
  );
  const loadPipeline = options.loadPipeline ?? ((name: string, root?: string) =>
    loadPreparedPipelineByName(name, root, { catalog: capabilityCatalog }));

  const directStrong = new Map<string, Set<string>>();
  const directWeak = new Map<string, Set<string>>();
  for (const definition of catalog.definitions) {
    const { strong, weak } = directEdges(
      definition.id,
      catalog,
      ownerByKey,
      projectRoot,
      loadPipeline
    );
    directStrong.set(definition.id, strong);
    directWeak.set(definition.id, weak);
  }

  // Transitive strong closure per unit — BFS over directStrong edges, cycle-
  // tolerant (visited set), self excluded.
  const closureOf = (start: string): string[] => {
    const seen = new Set<string>();
    const queue = [...(directStrong.get(start) ?? [])];
    while (queue.length > 0) {
      const next = queue.shift()!;
      if (next === start || seen.has(next)) continue;
      seen.add(next);
      for (const dep of directStrong.get(next) ?? []) {
        if (dep !== start && !seen.has(dep)) queue.push(dep);
      }
    }
    return [...seen].sort();
  };
  const strongClosure = new Map<string, Set<string>>();
  for (const definition of catalog.definitions) {
    strongClosure.set(definition.id, new Set(closureOf(definition.id)));
  }

  // Invert weak edges into `enhances`, subtracting the TRANSITIVE strong closure
  // (not just direct strong, t7): a unit already required — even indirectly —
  // is a hard dependency, never merely an enhancer, so it must not appear in
  // both `requires` and `enhances`.
  const enhancesByUnit = new Map<string, Set<string>>();
  for (const definition of catalog.definitions) {
    enhancesByUnit.set(definition.id, new Set());
  }
  for (const definition of catalog.definitions) {
    const closure = strongClosure.get(definition.id)!;
    for (const enhancerId of directWeak.get(definition.id) ?? []) {
      if (closure.has(enhancerId)) continue;
      enhancesByUnit.get(enhancerId)?.add(definition.id);
    }
  }

  const entries: WorkflowDependencyEntry[] = catalog.definitions.map((definition) => ({
    id: definition.id,
    requires: [...strongClosure.get(definition.id)!].sort(),
    enhances: [...(enhancesByUnit.get(definition.id) ?? [])].sort(),
  }));

  return { entries };
}
