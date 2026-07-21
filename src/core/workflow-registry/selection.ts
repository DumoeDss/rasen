import type { WorkflowCatalog } from './catalog.js';
import { portablePathCollisionKey } from './path-policy.js';
import type { WorkflowDefinition } from './types.js';

export class WorkflowSelectionError extends Error {
  constructor(
    message: string,
    readonly code: 'unknown_workflow' | 'dependency_cycle'
  ) {
    super(message);
    this.name = 'WorkflowSelectionError';
  }
}

export interface ResolveWorkflowSelectionOptions {
  /**
   * Opt-in (default off): after the `requires.workflows` closure, also walk
   * every selected definition's `requires.skills` and include the catalog
   * unit each one resolves to (dual skill-identity form — colon
   * `template.name` or hyphen `dirName` — via `portablePathCollisionKey`,
   * mirroring the delete-guard's usage scan in `workflow-library.ts`).
   *
   * This is how a selected workflow's required experts (e.g.
   * `auto-command`/`review-cycle` -> `review`) get pulled into an install
   * set. It must stay opt-in: this resolver is also used by profile
   * normalization/export, which must keep listing exactly the ids the user
   * chose — widening it unconditionally would inject closure-pulled experts
   * into serialized profile snapshots. Only the install/remove/drift
   * desired-set computation passes `true`.
   */
  includeSkillDependencies?: boolean;
}

/** Resolve roots and required workflows in deterministic catalog order. */
export function resolveWorkflowSelection(
  catalog: WorkflowCatalog,
  roots: readonly string[],
  options: ResolveWorkflowSelectionOptions = {}
): WorkflowDefinition[] {
  const selected = new Set<string>();
  const visiting: string[] = [];

  const visit = (id: string): void => {
    const definition = catalog.get(id);
    if (!definition) {
      throw new WorkflowSelectionError(`Unknown workflow ID "${id}"`, 'unknown_workflow');
    }
    const cycleIndex = visiting.indexOf(id);
    if (cycleIndex >= 0) {
      const cycle = [...visiting.slice(cycleIndex), id];
      throw new WorkflowSelectionError(
        `Workflow dependency cycle: ${cycle.join(' -> ')}`,
        'dependency_cycle'
      );
    }
    if (selected.has(id)) return;

    visiting.push(id);
    for (const dependency of definition.requires.workflows) visit(dependency);
    visiting.pop();
    selected.add(id);
  };

  for (const root of roots) visit(root);

  if (options.includeSkillDependencies) {
    const skillIdentityToId = new Map<string, string>();
    for (const definition of catalog.definitions) {
      for (const name of new Set([definition.skill.template.name, definition.skill.dirName])) {
        skillIdentityToId.set(portablePathCollisionKey(name), definition.id);
      }
    }
    for (const definition of catalog.definitions) {
      if (!selected.has(definition.id)) continue;
      for (const skillName of definition.requires.skills) {
        const dependencyId = skillIdentityToId.get(portablePathCollisionKey(skillName));
        if (dependencyId) selected.add(dependencyId);
      }
    }
  }

  return catalog.definitions.filter((definition) => selected.has(definition.id));
}

/**
 * Splits a stored workflow-root list into ids the catalog still recognizes
 * and ids it does not (e.g. a retired built-in like `ff` left over in a
 * persisted `custom` profile). Intended for the boundary that reads
 * persisted, possibly-outdated config — callers should warn on `unknown`
 * and pass `known` on to {@link resolveWorkflowSelection}, which stays
 * strict for freshly authored input.
 */
export function filterKnownWorkflowRoots(
  catalog: WorkflowCatalog,
  roots: readonly string[]
): { known: string[]; unknown: string[] } {
  const known: string[] = [];
  const unknown: string[] = [];
  for (const root of roots) {
    if (catalog.has(root)) {
      known.push(root);
    } else {
      unknown.push(root);
    }
  }
  return { known, unknown };
}

