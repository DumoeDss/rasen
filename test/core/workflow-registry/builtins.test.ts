import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ALL_WORKFLOWS, CORE_WORKFLOWS } from '../../../src/core/profiles.js';
import {
  BUILT_IN_WORKFLOW_IDS,
  CORE_WORKFLOW_IDS,
  WorkflowCatalog,
  getBuiltInWorkflowDefinitions,
  getExpertSkillDefinitions,
} from '../../../src/core/workflow-registry/index.js';

const fixturePath = fileURLToPath(
  new URL('../../fixtures/workflow-registry/builtins-v1.json', import.meta.url)
);

describe('built-in workflow catalog', () => {
  it('preserves the public built-in order and mappings', () => {
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const actual = getBuiltInWorkflowDefinitions().map((definition) => ({
      id: definition.id,
      skillName: definition.skill.template.name,
      dirName: definition.skill.dirName,
      commandId: definition.command?.content.id ?? null,
    }));

    expect(actual).toEqual(fixture);
    expect(ALL_WORKFLOWS).toBe(BUILT_IN_WORKFLOW_IDS);
    expect(CORE_WORKFLOWS).toBe(CORE_WORKFLOW_IDS);
  });

  it('indexes IDs, skill names, and command IDs', () => {
    const definitions = getBuiltInWorkflowDefinitions();
    const catalog = new WorkflowCatalog(definitions);
    const apply = catalog.get('apply');

    expect(apply?.source).toBe('built-in');
    expect(catalog.getBySkillName('rasen-apply-change')).toBe(apply);
    expect(catalog.getByCommandId('apply')).toBe(apply);
    expect(catalog.getByCommandId('goal-plan')).toBeUndefined();
  });

  it('keeps always-installed expert skills outside the workflow catalog', () => {
    const catalogSkillNames = new Set(
      getBuiltInWorkflowDefinitions().map((definition) => definition.skill.template.name)
    );
    const experts = getExpertSkillDefinitions();

    expect(experts).not.toHaveLength(0);
    expect(experts.every((expert) => !catalogSkillNames.has(expert.template.name))).toBe(true);
  });

  it('fails fast when an indexed identity is duplicated', () => {
    const [first] = getBuiltInWorkflowDefinitions();
    expect(() => new WorkflowCatalog([first, { ...first }])).toThrow(/Workflow ID/);
  });
});

