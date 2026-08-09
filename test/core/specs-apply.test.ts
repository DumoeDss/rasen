import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  analyzeSpecUpdates,
  applySpecs,
  findSpecUpdates,
  SpecReconciliationError,
  type SpecUpdate,
} from '../../src/core/specs-apply.js';

function requirement(name: string, scenario: string): string {
  return [
    `### Requirement: ${name}`,
    `The system SHALL implement ${name}.`,
    '',
    `#### Scenario: ${scenario}`,
    '- **WHEN** the behavior is exercised',
    '- **THEN** it succeeds',
  ].join('\n');
}

function mainSpec(...requirements: string[]): string {
  return [
    '# Capability',
    '',
    '## Purpose',
    '',
    'Exercise reconciliation.',
    '',
    '## Requirements',
    '',
    ...requirements.flatMap((value, index) =>
      index === requirements.length - 1 ? [value] : [value, '']
    ),
    '',
  ].join('\n');
}

function modifiedDelta(...requirements: string[]): string {
  return ['## MODIFIED Requirements', '', ...requirements.flatMap((value, index) =>
    index === requirements.length - 1 ? [value] : [value, '']
  ), ''].join('\n');
}

describe('spec reconciliation analysis', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'rasen-spec-reconciliation-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('reports every stale MODIFIED requirement across all capabilities', async () => {
    const changeDir = path.join(root, 'changes', 'aggregate-stale');
    const mainSpecsDir = path.join(root, 'specs');
    const capabilities = [
      { name: 'alpha', requirements: ['Alpha one', 'Alpha two', 'Alpha three'] },
      { name: 'beta', requirements: ['Beta one', 'Beta two'] },
    ];

    for (const capability of capabilities) {
      const targetDir = path.join(mainSpecsDir, capability.name);
      const deltaDir = path.join(changeDir, 'specs', capability.name);
      await fs.mkdir(targetDir, { recursive: true });
      await fs.mkdir(deltaDir, { recursive: true });
      await fs.writeFile(
        path.join(targetDir, 'spec.md'),
        mainSpec(
          ...capability.requirements.map(name =>
            requirement(name, `${name} existing scenario`)
          )
        )
      );
      await fs.writeFile(
        path.join(deltaDir, 'spec.md'),
        modifiedDelta(
          ...capability.requirements.map(name =>
            requirement(name, `${name} replacement scenario`)
          )
        )
      );
    }

    const updates = await findSpecUpdates(changeDir, mainSpecsDir);
    const analysis = await analyzeSpecUpdates(updates, 'aggregate-stale', {
      silent: true,
    });

    expect(analysis.prepared).toEqual([]);
    expect(analysis.issues).toHaveLength(5);
    expect(analysis.issues).toEqual(
      capabilities.flatMap(capability =>
        [...capability.requirements].sort().map(name =>
          expect.objectContaining({
            code: 'spec_modified_scenarios_missing',
            capability: capability.name,
            requirement: name,
            missingScenarios: [`${name} existing scenario`],
          })
        )
      )
    );
  });

  it('keeps independent stale-scenario failures when another delta is unreadable', async () => {
    const target = path.join(root, 'specs', 'healthy', 'spec.md');
    const staleSource = path.join(root, 'changes', 'mixed', 'specs', 'healthy', 'spec.md');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.mkdir(path.dirname(staleSource), { recursive: true });
    await fs.writeFile(target, mainSpec(requirement('Healthy rule', 'Existing behavior')));
    await fs.writeFile(
      staleSource,
      modifiedDelta(requirement('Healthy rule', 'Replacement behavior'))
    );

    const updates: SpecUpdate[] = [
      {
        source: path.join(root, 'changes', 'mixed', 'specs', 'broken', 'spec.md'),
        target: path.join(root, 'specs', 'broken', 'spec.md'),
        exists: true,
      },
      { source: staleSource, target, exists: true },
    ];
    const analysis = await analyzeSpecUpdates(updates, 'mixed', { silent: true });

    expect(analysis.prepared).toEqual([]);
    expect(analysis.issues).toEqual([
      expect.objectContaining({
        code: 'spec_reconciliation_failed',
        capability: 'broken',
      }),
      expect.objectContaining({
        code: 'spec_modified_scenarios_missing',
        capability: 'healthy',
        requirement: 'Healthy rule',
        missingScenarios: ['Existing behavior'],
      }),
    ]);
  });
  it('writes no canonical spec when any capability fails reconciliation', async () => {
    const changeName = 'atomic-reconciliation';
    const changeDir = path.join(root, 'rasen', 'changes', changeName);
    const mainSpecsDir = path.join(root, 'rasen', 'specs');
    const healthyTarget = path.join(mainSpecsDir, 'healthy', 'spec.md');
    const staleTarget = path.join(mainSpecsDir, 'stale', 'spec.md');
    const healthyContent = mainSpec(
      requirement('Healthy rule', 'Healthy scenario')
    );
    const staleContent = mainSpec(
      requirement('Stale rule', 'Scenario that must survive')
    );
    await fs.mkdir(path.dirname(healthyTarget), { recursive: true });
    await fs.mkdir(path.dirname(staleTarget), { recursive: true });
    await fs.mkdir(path.join(changeDir, 'specs', 'healthy'), {
      recursive: true,
    });
    await fs.mkdir(path.join(changeDir, 'specs', 'stale'), {
      recursive: true,
    });
    await fs.writeFile(healthyTarget, healthyContent);
    await fs.writeFile(staleTarget, staleContent);
    await fs.writeFile(
      path.join(changeDir, 'specs', 'healthy', 'spec.md'),
      modifiedDelta(requirement('Healthy rule', 'Healthy scenario'))
    );
    await fs.writeFile(
      path.join(changeDir, 'specs', 'stale', 'spec.md'),
      modifiedDelta(requirement('Stale rule', 'Replacement scenario'))
    );

    let caught: unknown;
    try {
      await applySpecs(root, changeName, { silent: true });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SpecReconciliationError);
    expect((caught as SpecReconciliationError).issues).toEqual([
      expect.objectContaining({
        code: 'spec_modified_scenarios_missing',
        capability: 'stale',
        missingScenarios: ['Scenario that must survive'],
      }),
    ]);
    await expect(fs.readFile(healthyTarget, 'utf8')).resolves.toBe(
      healthyContent
    );
    await expect(fs.readFile(staleTarget, 'utf8')).resolves.toBe(staleContent);
  });

});
