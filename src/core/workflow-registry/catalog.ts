import type {
  InvalidWorkflowRecord,
  WorkflowDefinition,
} from './types.js';

export class WorkflowCatalogError extends Error {
  constructor(
    message: string,
    readonly code: 'duplicate_id' | 'duplicate_skill' | 'duplicate_command'
  ) {
    super(message);
    this.name = 'WorkflowCatalogError';
  }
}

export class WorkflowCatalog {
  readonly definitions: readonly WorkflowDefinition[];
  readonly invalid: readonly InvalidWorkflowRecord[];
  private readonly byId = new Map<string, WorkflowDefinition>();
  private readonly bySkillName = new Map<string, WorkflowDefinition>();
  private readonly byCommandId = new Map<string, WorkflowDefinition>();

  constructor(
    definitions: readonly WorkflowDefinition[],
    invalid: readonly InvalidWorkflowRecord[] = []
  ) {
    this.definitions = [...definitions];
    this.invalid = [...invalid];

    for (const definition of definitions) {
      const existingId = this.byId.get(definition.id);
      if (existingId) {
        throw new WorkflowCatalogError(
          `Workflow ID "${definition.id}" is defined by both ${existingId.source} and ${definition.source} sources`,
          'duplicate_id'
        );
      }
      this.byId.set(definition.id, definition);

      const skillName = definition.skill.template.name;
      const existingSkill = this.bySkillName.get(skillName);
      if (existingSkill) {
        throw new WorkflowCatalogError(
          `Skill name "${skillName}" is used by workflows "${existingSkill.id}" and "${definition.id}"`,
          'duplicate_skill'
        );
      }
      this.bySkillName.set(skillName, definition);

      const commandId = definition.command?.content.id;
      if (commandId) {
        const existingCommand = this.byCommandId.get(commandId);
        if (existingCommand) {
          throw new WorkflowCatalogError(
            `Command ID "${commandId}" is used by workflows "${existingCommand.id}" and "${definition.id}"`,
            'duplicate_command'
          );
        }
        this.byCommandId.set(commandId, definition);
      }
    }
  }

  get(id: string): WorkflowDefinition | undefined {
    return this.byId.get(id);
  }

  getBySkillName(name: string): WorkflowDefinition | undefined {
    return this.bySkillName.get(name);
  }

  getByCommandId(id: string): WorkflowDefinition | undefined {
    return this.byCommandId.get(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }
}

