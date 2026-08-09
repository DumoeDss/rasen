import { createHash } from 'node:crypto';
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

function addedDelta(...requirements: string[]): string {
  return [
    '## ADDED Requirements',
    '',
    ...requirements.flatMap((value, index) =>
      index === requirements.length - 1 ? [value] : [value, '']
    ),
    '',
  ].join('\n');
}

describe('spec reconciliation analysis', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'rasen-spec-reconciliation-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('rejects root-level and non-canonical recursive delta paths', async () => {
    const changeDir = path.join(root, 'changes', 'invalid-paths');
    const rootLevel = path.join(changeDir, 'specs', 'spec.md');
    const nonCanonical = path.join(
      changeDir,
      'specs',
      'Platform Area',
      'routing',
      'spec.md'
    );
    await fs.mkdir(path.dirname(rootLevel), { recursive: true });
    await fs.mkdir(path.dirname(nonCanonical), { recursive: true });
    await fs.writeFile(rootLevel, addedDelta(requirement('Root', 'Root')));
    await fs.writeFile(
      nonCanonical,
      addedDelta(requirement('Nested', 'Nested'))
    );

    const discovery = await findSpecUpdates(
      changeDir,
      path.join(root, 'specs')
    );

    expect(discovery.updates).toEqual([]);
    expect(discovery.issues).toEqual([
      expect.objectContaining({
        code: 'spec_delta_path_invalid',
        source: nonCanonical,
      }),
      expect.objectContaining({
        code: 'spec_delta_path_invalid',
        source: rootLevel,
      }),
    ]);
  });

  it('preserves full recursive capability identity for duplicate leaf names', async () => {
    const changeName = 'nested-identity';
    const changeDir = path.join(root, 'rasen', 'changes', changeName);
    for (const capability of ['area-a/auth', 'area-b/auth']) {
      const source = path.join(
        changeDir,
        'specs',
        ...capability.split('/'),
        'spec.md'
      );
      await fs.mkdir(path.dirname(source), { recursive: true });
      await fs.writeFile(
        source,
        addedDelta(
          requirement(
            `${capability} requirement`,
            `${capability} scenario`
          )
        )
      );
    }

    const result = await applySpecs(root, changeName, { silent: true });

    expect(result.capabilities.map(entry => entry.capability).sort()).toEqual([
      'area-a/auth',
      'area-b/auth',
    ]);
    for (const capability of ['area-a/auth', 'area-b/auth']) {
      await expect(
        fs.readFile(
          path.join(
            root,
            'rasen',
            'specs',
            ...capability.split('/'),
            'spec.md'
          ),
          'utf8'
        )
      ).resolves.toContain(`### Requirement: ${capability} requirement`);
    }
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

  it('binds prepared fingerprints to the exact analyzed bytes', async () => {
    const target = path.join(root, 'specs', 'snapshot', 'spec.md');
    const source = path.join(
      root,
      'changes',
      'snapshot',
      'specs',
      'snapshot',
      'spec.md'
    );
    const targetContent = mainSpec(
      requirement('Snapshot rule', 'Stable scenario')
    );
    const sourceContent = modifiedDelta(
      requirement('Snapshot rule', 'Stable scenario')
    );
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.mkdir(path.dirname(source), { recursive: true });
    await fs.writeFile(target, targetContent);
    await fs.writeFile(source, sourceContent);

    const discovery = await findSpecUpdates(
      path.join(root, 'changes', 'snapshot'),
      path.join(root, 'specs')
    );
    const analysis = await analyzeSpecUpdates(discovery, 'snapshot', {
      silent: true,
    });

    expect(analysis.issues).toEqual([]);
    expect(analysis.prepared).toHaveLength(1);
    expect(analysis.prepared[0]).toMatchObject({
      sourceSha256: createHash('sha256').update(sourceContent).digest('hex'),
      targetPrecondition: {
        state: 'file',
        sha256: createHash('sha256').update(targetContent).digest('hex'),
      },
    });

    await fs.writeFile(source, `${sourceContent}\nmutated`);
    await fs.writeFile(target, `${targetContent}\nmutated`);
    expect(analysis.prepared[0].sourceSha256).toBe(
      createHash('sha256').update(sourceContent).digest('hex')
    );
    expect(analysis.prepared[0].targetPrecondition).toEqual({
      state: 'file',
      sha256: createHash('sha256').update(targetContent).digest('hex'),
    });
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
        capability: 'broken',
        exists: true,
      },
      { source: staleSource, target, capability: 'healthy', exists: true },
    ];
    const analysis = await analyzeSpecUpdates(
      { updates, issues: [] },
      'mixed',
      { silent: true }
    );

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

  it.skipIf(process.platform === 'win32')(
    'blocks every write when a nested delta directory is unreadable',
    async () => {
      const changeName = 'unreadable-discovery';
      const changeDir = path.join(root, 'rasen', 'changes', changeName);
      const mainSpecsDir = path.join(root, 'rasen', 'specs');
      const healthyTarget = path.join(mainSpecsDir, 'healthy', 'spec.md');
      const healthySource = path.join(
        changeDir,
        'specs',
        'healthy',
        'spec.md'
      );
      const restrictedDir = path.join(changeDir, 'specs', 'nested', 'blocked');
      const healthyContent = mainSpec(
        requirement('Healthy rule', 'Healthy scenario')
      );
      await fs.mkdir(path.dirname(healthyTarget), { recursive: true });
      await fs.mkdir(path.dirname(healthySource), { recursive: true });
      await fs.mkdir(restrictedDir, { recursive: true });
      await fs.writeFile(healthyTarget, healthyContent);
      await fs.writeFile(
        healthySource,
        modifiedDelta(requirement('Healthy rule', 'Healthy scenario'))
      );
      await fs.writeFile(
        path.join(restrictedDir, 'spec.md'),
        addedDelta(requirement('Blocked rule', 'Blocked scenario'))
      );
      await fs.chmod(restrictedDir, 0o000);

      let caught: unknown;
      try {
        await applySpecs(root, changeName, { silent: true });
      } catch (error) {
        caught = error;
      } finally {
        await fs.chmod(restrictedDir, 0o700);
      }

      expect(caught).toBeInstanceOf(SpecReconciliationError);
      expect((caught as SpecReconciliationError).issues).toContainEqual(
        expect.objectContaining({
          code: 'spec_delta_discovery_failed',
          source: restrictedDir,
        })
      );
      await expect(fs.readFile(healthyTarget, 'utf8')).resolves.toBe(
        healthyContent
      );
    }
  );

  it.skipIf(process.platform === 'win32')(
    'does not replace an unreadable canonical spec as a new capability',
    async () => {
      const changeName = 'unreadable-canonical';
      const changeDir = path.join(root, 'rasen', 'changes', changeName);
      const target = path.join(root, 'rasen', 'specs', 'protected', 'spec.md');
      const source = path.join(
        changeDir,
        'specs',
        'protected',
        'spec.md'
      );
      const original = mainSpec(requirement('Existing rule', 'Existing path'));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.mkdir(path.dirname(source), { recursive: true });
      await fs.writeFile(target, original);
      await fs.writeFile(
        source,
        addedDelta(requirement('New rule', 'New path'))
      );
      await fs.chmod(target, 0o200);

      let caught: unknown;
      try {
        await applySpecs(root, changeName, { silent: true });
      } catch (error) {
        caught = error;
      } finally {
        await fs.chmod(target, 0o600);
      }

      expect(caught).toBeInstanceOf(SpecReconciliationError);
      expect((caught as SpecReconciliationError).issues).toContainEqual(
        expect.objectContaining({ code: 'spec_target_read_failed' })
      );
      await expect(fs.readFile(target, 'utf8')).resolves.toBe(original);
    }
  );

  it('combines duplicate preflight defects with independent stale scenarios', async () => {
    const target = path.join(root, 'specs', 'combined', 'spec.md');
    const source = path.join(
      root,
      'changes',
      'combined',
      'specs',
      'combined',
      'spec.md'
    );
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.mkdir(path.dirname(source), { recursive: true });
    await fs.writeFile(
      target,
      mainSpec(
        requirement('Rule A', 'A survives'),
        requirement('Rule B', 'B survives')
      )
    );
    await fs.writeFile(
      source,
      modifiedDelta(
        requirement('Rule A', 'A replacement one'),
        requirement('Rule A', 'A replacement two'),
        requirement('Rule B', 'B replacement')
      )
    );

    const analysis = await analyzeSpecUpdates(
      {
        updates: [{ source, target, capability: 'combined', exists: true }],
        issues: [],
      },
      'combined',
      { silent: true }
    );

    expect(analysis.issues).toEqual([
      expect.objectContaining({
        code: 'spec_delta_duplicate_modified',
        requirement: 'Rule A',
      }),
      expect.objectContaining({
        code: 'spec_modified_scenarios_missing',
        requirement: 'Rule A',
        missingScenarios: ['A survives'],
      }),
      expect.objectContaining({
        code: 'spec_modified_scenarios_missing',
        requirement: 'Rule A',
        missingScenarios: ['A survives'],
      }),
      expect.objectContaining({
        code: 'spec_modified_scenarios_missing',
        requirement: 'Rule B',
        missingScenarios: ['B survives'],
      }),
    ]);
  });

  it('requires every duplicate-named canonical scenario block to survive', async () => {
    const target = path.join(root, 'specs', 'duplicates', 'spec.md');
    const source = path.join(
      root,
      'changes',
      'duplicates',
      'specs',
      'duplicates',
      'spec.md'
    );
    const duplicateScenarios = [
      '### Requirement: Retry rule',
      'The system SHALL preserve every retry behavior.',
      '',
      '#### Scenario: Retry',
      '- **WHEN** the first retry path runs',
      '- **THEN** the first outcome is retained',
      '',
      '#### Scenario: Retry',
      '- **WHEN** the second retry path runs',
      '- **THEN** the second outcome is retained',
    ].join('\n');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.mkdir(path.dirname(source), { recursive: true });
    await fs.writeFile(target, mainSpec(duplicateScenarios));
    await fs.writeFile(
      source,
      modifiedDelta(requirement('Retry rule', 'Retry'))
    );

    const analysis = await analyzeSpecUpdates(
      {
        updates: [{ source, target, capability: 'duplicates', exists: true }],
        issues: [],
      },
      'duplicates',
      { silent: true }
    );

    expect(analysis.issues).toContainEqual(
      expect.objectContaining({
        code: 'spec_modified_scenarios_missing',
        requirement: 'Retry rule',
        missingScenarios: ['Retry'],
      })
    );
  });

});
