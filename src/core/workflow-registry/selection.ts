import type { WorkflowCatalog } from './catalog.js';
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

/** Resolve roots and required workflows in deterministic catalog order. */
export function resolveWorkflowSelection(
  catalog: WorkflowCatalog,
  roots: readonly string[]
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

