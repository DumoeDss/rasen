import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { loadPipelineByName } from '../../../src/core/pipeline-registry/index.js';
import { validatePipelineForExecution } from '../../../src/core/pipeline-registry/execution-validation.js';
import {
  getArchiveChangeSkillTemplate,
  getShipCommandSkillTemplate,
  getTaskLoopSkillTemplate,
} from '../../../src/core/templates/skill-templates.js';
import { getBuiltInWorkflowDefinitions } from '../../../src/core/workflow-registry/builtins.js';

describe('task-loop built-in workflow and pipeline', () => {
  it('passes the production execution preflight with the auto dependency closure', async () => {
    const previousHome = process.env.RASEN_HOME;
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-task-loop-preflight-'));
    process.env.RASEN_HOME = tempHome;
    fs.writeFileSync(
      path.join(tempHome, 'config.json'),
      JSON.stringify({
        profile: 'custom',
        workflows: ['auto-command', 'ship-command', 'archive'],
        retention: 'codify',
        expertSelectionExplicit: true,
      })
    );
    try {
      await expect(
        validatePipelineForExecution(loadPipelineByName('task-loop'))
      ).resolves.toBeUndefined();
    } finally {
      if (previousHome === undefined) delete process.env.RASEN_HOME;
      else process.env.RASEN_HOME = previousHome;
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('defines only iterate -> ship -> archive with no ordinary gates or planning stages', () => {
    const pipeline = loadPipelineByName('task-loop');

    expect(pipeline.stages.map((stage) => stage.id)).toEqual([
      'iterate',
      'ship',
      'archive',
    ]);
    expect(pipeline.stages.map((stage) => stage.requires)).toEqual([
      [],
      ['iterate'],
      ['ship'],
    ]);
    expect(pipeline.stages.every((stage) => stage.gate !== true)).toBe(true);
    expect(pipeline.stages[0]).toEqual(
      expect.objectContaining({
        skill: 'rasen-task-loop',
        role: 'implementer',
        loop: expect.objectContaining({
          kind: 'goal',
          gate: { kind: 'evaluate' },
          runArtifact: 'task-loop-run.json',
        }),
      })
    );
  });

  it('ships an internal phase-specific template without making it selectable', () => {
    const template = getTaskLoopSkillTemplate();
    expect(template.name).toBe('rasen-task-loop');
    expect(template.instructions).toContain('taskLoop.phase');
    expect(template.instructions).toContain('real artifact targets');
    expect(template.instructions).toContain('largestGap');
    expect(template.instructions).toContain('passCondition');

    const workflow = getBuiltInWorkflowDefinitions().find(
      (definition) => definition.id === 'task-loop'
    );
    expect(workflow).toEqual(expect.objectContaining({ kind: 'internal' }));
  });

  it('makes canonical Task Loop satisfaction a non-bypassable delivery precondition', () => {
    const ship = getShipCommandSkillTemplate().instructions;
    const archive = getArchiveChangeSkillTemplate().instructions;

    for (const instructions of [ship, archive]) {
      expect(instructions).toContain('task-loop-report.md');
      expect(instructions).toContain('task_loop_delivery_guard');
      expect(instructions).toContain('outcome === satisfied');
      expect(instructions.toLowerCase()).toContain('no-gate');
      expect(instructions.toLowerCase()).toContain('cannot override');
    }
    expect(ship).toContain('If no tasks file exists');
    expect(archive).toContain('If no tasks file exists');
  });
});
