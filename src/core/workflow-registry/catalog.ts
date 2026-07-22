import type {
  InvalidWorkflowRecord,
  WorkflowDefinition,
  WorkflowDiagnostic,
} from './types.js';
import { portablePathCollisionKey } from './path-policy.js';

export class WorkflowCatalogError extends Error {
  constructor(
    message: string,
    readonly code: 'duplicate_id' | 'duplicate_skill'
  ) {
    super(message);
    this.name = 'WorkflowCatalogError';
  }
}

export class WorkflowCatalog {
  readonly definitions: readonly WorkflowDefinition[];
  readonly invalid: readonly InvalidWorkflowRecord[];
  readonly diagnostics: readonly WorkflowDiagnostic[];
  private readonly byId = new Map<string, WorkflowDefinition>();
  private readonly bySkillName = new Map<string, WorkflowDefinition>();

  constructor(
    definitions: readonly WorkflowDefinition[],
    invalid: readonly InvalidWorkflowRecord[] = [],
    diagnostics: readonly WorkflowDiagnostic[] = []
  ) {
    this.definitions = [...definitions];
    this.invalid = [...invalid];
    this.diagnostics = [...diagnostics];

    for (const definition of definitions) {
      const existingId = this.byId.get(definition.id);
      if (existingId) {
        throw new WorkflowCatalogError(
          `Workflow ID "${definition.id}" is defined by both ${existingId.source} and ${definition.source} sources`,
          'duplicate_id'
        );
      }
      this.byId.set(definition.id, definition);

      for (const skillName of new Set([
        definition.skill.template.name,
        definition.skill.dirName,
      ])) {
        const key = portablePathCollisionKey(skillName);
        const existingSkill = this.bySkillName.get(key);
        if (existingSkill && existingSkill !== definition) {
          throw new WorkflowCatalogError(
            `Skill identity "${skillName}" is used by workflows "${existingSkill.id}" and "${definition.id}"`,
            'duplicate_skill'
          );
        }
        this.bySkillName.set(key, definition);
      }
    }
  }

  get(id: string): WorkflowDefinition | undefined {
    return this.byId.get(id);
  }

  getBySkillName(name: string): WorkflowDefinition | undefined {
    return this.bySkillName.get(portablePathCollisionKey(name));
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }
}
