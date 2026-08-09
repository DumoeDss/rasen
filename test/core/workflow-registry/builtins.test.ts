import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { resolvePipelinePath } from '../../../src/core/pipeline-registry/resolver.js';
import { ALL_WORKFLOWS, CORE_WORKFLOWS } from '../../../src/core/profiles.js';
import {
  BUILT_IN_WORKFLOW_IDS,
  CORE_WORKFLOW_IDS,
  WorkflowCatalog,
  computeBuiltInWorkflowDigest,
  getBuiltInCatalogDefinitions,
  getBuiltInExpertDefinitions,
  getBuiltInWorkflowDefinitions,
  getExpertSkillDefinitions,
} from '../../../src/core/workflow-registry/index.js';

const fixturePath = fileURLToPath(
  new URL('../../fixtures/workflow-registry/builtins-v1.json', import.meta.url)
);

describe('built-in workflow catalog', () => {
  it('preserves the public built-in catalog order and mappings (workflows + experts)', () => {
    // Digests deliberately exclude `kind` (see `digestBuiltIn`/`digestExpert` preimages),
    // so projecting it here is safe: this is a catalog-shape fixture, not a digest fixture.
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const actual = getBuiltInCatalogDefinitions().map((definition) => ({
      id: definition.id,
      skillName: definition.skill.template.name,
      dirName: definition.skill.dirName,
      kind: definition.kind,
    }));

    expect(actual).toEqual(fixture);
    expect(ALL_WORKFLOWS).toBe(BUILT_IN_WORKFLOW_IDS);
    expect(CORE_WORKFLOWS).toBe(CORE_WORKFLOW_IDS);
  });

  it('indexes IDs and skill names', () => {
    const definitions = getBuiltInWorkflowDefinitions();
    const catalog = new WorkflowCatalog(definitions);
    const apply = catalog.get('apply');

    expect(apply?.source).toBe('built-in');
    expect(catalog.getBySkillName('rasen-apply-change')).toBe(apply);
  });

  it('includes host sidecars in built-in workflow files and digest freshness', () => {
    const propose = getBuiltInWorkflowDefinitions().find((definition) => definition.id === 'propose')!;
    const sidecars = propose.files.map(({ path, sha256 }) => ({ path, sha256 }));

    expect(sidecars.map((file) => file.path)).toEqual(expect.arrayContaining([
      'references/codebase-design/README.md',
      'references/codebase-design/DEEPENING.md',
      'references/codebase-design/DESIGN-IT-TWICE.md',
    ]));
    expect(computeBuiltInWorkflowDigest(
      propose.id,
      propose.skill.dirName,
      propose.skill.template,
      sidecars
    )).toBe(propose.digest);

    const changed = sidecars.map((file, index) => index === 0
      ? { ...file, sha256: `sha256:${'0'.repeat(64)}` }
      : file);
    expect(computeBuiltInWorkflowDigest(
      propose.id,
      propose.skill.dirName,
      propose.skill.template,
      changed
    )).not.toBe(propose.digest);
  });

  it('folds the 12 surviving experts into the built-in catalog as kind:expert members', () => {
    const workflowIds = new Set(getBuiltInWorkflowDefinitions().map((definition) => definition.id));
    const experts = getBuiltInExpertDefinitions();

    expect(experts).toHaveLength(12);
    expect(experts.every((expert) => expert.kind === 'expert')).toBe(true);
    expect(experts.every((expert) => expert.source === 'built-in')).toBe(true);
    expect(experts.some((expert) => workflowIds.has(expert.id))).toBe(false);
    expect(experts.map((expert) => expert.id)).toEqual([
      'benchmark', 'careful', 'chrome-use', 'codex', 'cso', 'design-consultation',
      'design-review', 'investigate', 'office-hours', 'qa', 'review', 'workflow-author',
    ]);
    expect(experts.find((expert) => expert.id === 'workflow-author')?.files.map((file) => file.path))
      .toEqual(expect.arrayContaining([
        'references/workflow-review/README.md',
        'references/workflow-review/checklist.md',
      ]));

    // `getExpertSkillDefinitions` stays a catalog-backed filter shape (least
    // caller churn) — same ids/names, just the older narrower shape.
    const legacyIds = new Set(getExpertSkillDefinitions().map((definition) => definition.id));
    expect(legacyIds).toEqual(new Set(experts.map((expert) => expert.id)));
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
    expect(byId.get('goal-judge')).toBe('internal');
    expect(byId.get('task-loop')).toBe('internal');
    expect(byId.get('goal-report')).toBe('internal');
    expect(byId.get('review-fix')).toBe('internal');
    expect(byId.get('retain-command')).toBe('internal');
    expect(byId.get('direction')).toBe('task');
    expect(byId.get('propose')).toBe('task');
    expect(byId.get('apply')).toBe('task');
  });

  it('registers Direction as a dependency-free task outside the core profile', () => {
    const direction = getBuiltInWorkflowDefinitions().find(
      (definition) => definition.id === 'direction'
    );
    expect(direction).toMatchObject({
      id: 'direction',
      kind: 'task',
      skill: {
        dirName: 'rasen-direction',
        template: { name: 'rasen-direction' },
      },
      requires: {
        workflows: [],
        skills: [],
        pipelines: [],
        schemas: [],
      },
    });
    expect(CORE_WORKFLOW_IDS as readonly string[]).not.toContain('direction');
  });

  it('produces well-formed, stable digests for both workflows and experts', () => {
    const digestPattern = /^sha256:[0-9a-f]{64}$/;
    for (const definition of getBuiltInCatalogDefinitions()) {
      expect(definition.digest).toMatch(digestPattern);
    }

    // Same-process recompute must be deterministic (no timestamps/randomness
    // leaking into either preimage).
    const first = getBuiltInCatalogDefinitions().map((definition) => definition.digest);
    const second = getBuiltInCatalogDefinitions().map((definition) => definition.digest);
    expect(second).toEqual(first);
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
      workflows: ['review-fix'],
      skills: ['rasen-review'],
      pipelines: [],
      schemas: [],
    });
    expect(byId.get('verify-enhanced-command')?.requires).toEqual({
      workflows: [],
      skills: ['rasen-review', 'rasen-cso', 'rasen-qa', 'rasen-design-review'],
      pipelines: [],
      schemas: [],
    });
    expect(byId.get('ship-command')?.requires).toEqual({
      workflows: ['retain-command'],
      skills: [],
      pipelines: [],
      schemas: [],
    });
    expect(byId.get('auto-command')?.requires).toEqual({
      workflows: ['retain-command'],
      skills: ['rasen-review', 'rasen-task-loop'],
      pipelines: ['small-feature', 'full-feature', 'bug-fix', 'auto-decompose', 'task-loop'],
      schemas: [],
    });
    expect(byId.get('goal-command')?.requires).toEqual({
      workflows: ['goal-judge'],
      skills: [],
      pipelines: ['goal-loop-measure', 'goal-loop-evaluate', 'goal-loop-research'],
      schemas: [],
    });

    const knownWorkflowIds = new Set(definitions.map((definition) => definition.id));
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
      // A declared workflow dependency (e.g. auto-command -> retain-command)
      // must resolve to a real built-in workflow id.
      for (const workflow of definition.requires.workflows) {
        expect(
          knownWorkflowIds.has(workflow),
          `${definition.id} requires.workflows "${workflow}" should resolve to a real workflow`
        ).toBe(true);
      }
      expect(definition.requires.schemas).toEqual([]);
    }
  });
});

