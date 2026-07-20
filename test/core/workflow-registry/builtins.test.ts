import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { resolvePipelinePath } from '../../../src/core/pipeline-registry/resolver.js';
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

  it('assigns driver/internal/task kinds per portfolio decision #1', () => {
    const byId = new Map(getBuiltInWorkflowDefinitions().map((definition) => [definition.id, definition.kind]));

    expect(byId.get('auto-command')).toBe('driver');
    expect(byId.get('goal-command')).toBe('driver');
    expect(byId.get('goal-plan')).toBe('internal');
    expect(byId.get('goal-iterate')).toBe('internal');
    expect(byId.get('goal-report')).toBe('internal');
    expect(byId.get('propose')).toBe('task');
    expect(byId.get('apply')).toBe('task');
  });

  it('does not change the digest when kind is added or changed', () => {
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const actual = getBuiltInWorkflowDefinitions().map((definition) => ({
      id: definition.id,
      skillName: definition.skill.template.name,
      dirName: definition.skill.dirName,
      commandId: definition.command?.content.id ?? null,
    }));

    // kind is catalog metadata and is deliberately excluded from digestBuiltIn's
    // preimage, so the golden fixture (which does not project kind) stays exact.
    expect(actual).toEqual(fixture);
  });

  it('populates the audited requires edges and keeps them resolvable', () => {
    const definitions = getBuiltInWorkflowDefinitions();
    const byId = new Map(definitions.map((definition) => [definition.id, definition]));
    const knownSkillIdentities = new Set(
      getExpertSkillDefinitions().flatMap((expert) => [expert.template.name, expert.dirName])
    );
    for (const definition of definitions) {
      knownSkillIdentities.add(definition.skill.template.name);
      knownSkillIdentities.add(definition.skill.dirName);
    }

    expect(byId.get('review-cycle')?.requires).toEqual({
      workflows: [],
      skills: ['rasen-review'],
      pipelines: [],
      schemas: [],
    });
    expect(byId.get('verify-enhanced-command')?.requires).toEqual({
      workflows: [],
      skills: ['rasen-review', 'rasen-cso', 'rasen-qa', 'rasen-design-review', 'rasen-qa-only'],
      pipelines: [],
      schemas: [],
    });
    expect(byId.get('auto-command')?.requires).toEqual({
      workflows: [],
      skills: ['rasen-review'],
      pipelines: ['small-feature', 'full-feature', 'bug-fix', 'auto-decompose'],
      schemas: [],
    });
    expect(byId.get('goal-command')?.requires).toEqual({
      workflows: [],
      skills: [],
      pipelines: ['goal-loop-measure', 'goal-loop-evaluate', 'goal-loop-research'],
      schemas: [],
    });

    for (const definition of definitions) {
      for (const skill of definition.requires.skills) {
        expect(
          knownSkillIdentities.has(skill),
          `${definition.id} requires.skills "${skill}" should resolve to a real skill`
        ).toBe(true);
      }
      for (const pipeline of definition.requires.pipelines) {
        expect(
          resolvePipelinePath(pipeline),
          `${definition.id} requires.pipelines "${pipeline}" should resolve to a real pipeline`
        ).not.toBeNull();
      }
      expect(definition.requires.workflows).toEqual([]);
      expect(definition.requires.schemas).toEqual([]);
    }
  });
});

