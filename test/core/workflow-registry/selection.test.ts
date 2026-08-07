import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  loadWorkflowCatalog,
  resolveEffectiveWorkflowInstallSelection,
  resolveWorkflowSelection,
} from '../../../src/core/workflow-registry/index.js';
import { resolveDesiredWorkflowSelection } from '../../../src/core/profiles.js';
import {
  createProductionCapabilityCatalogSnapshot,
  type DefinitionSourceV2,
} from '../../../src/core/pipeline-registry/definition.js';
import { loadPreparedPipelineByName } from '../../../src/core/pipeline-registry/resolver.js';

function collectCapabilityIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectCapabilityIds);
  if (value === null || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const capability = record.capability;
  const own =
    capability !== null && typeof capability === 'object' && !Array.isArray(capability)
      ? [(capability as { id: string }).id]
      : [];
  return own.concat(Object.values(record).flatMap(collectCapabilityIds));
}

function enabledProductionCatalog(profile: 'core' | 'custom', roots?: string[]) {
  const workflowCatalog = loadWorkflowCatalog();
  const { ids } = resolveDesiredWorkflowSelection(
    workflowCatalog,
    profile,
    roots,
    true
  );
  const enabledIds = new Set(ids);
  const enabledSkillNames = new Set(
    workflowCatalog.definitions
      .filter((definition) => enabledIds.has(definition.id))
      .map((definition) => definition.skill.template.name)
  );
  return {
    workflowCatalog,
    enabledSkillNames,
    capabilityCatalog: createProductionCapabilityCatalogSnapshot(
      workflowCatalog.definitions,
      enabledSkillNames
    ),
  };
}

function expectEveryCapabilityEnabled(
  definition: DefinitionSourceV2,
  enabledSkillNames: ReadonlySet<string>
): void {
  for (const capabilityId of collectCapabilityIds(definition).filter((id) =>
    id.startsWith('skill:')
  )) {
    expect(enabledSkillNames.has(capabilityId.slice('skill:'.length)), capabilityId).toBe(true);
  }
}

/**
 * `resolveWorkflowSelection`'s opt-in `includeSkillDependencies` closure
 * (design.md D3, the expert-install-flip flip core). Reads the real built-in
 * catalog (no user workflows dir is needed for these fixtures) — per the
 * RASEN_HOME test-isolation convention, set (never delete) it so resolution
 * cannot fall through to the real machine home.
 */
describe('resolveWorkflowSelection includeSkillDependencies', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-selection-test-'));
    originalEnv = { ...process.env };
    process.env.RASEN_HOME = tempDir;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('default (workflow-only) path pulls only workflow deps (retain-command), not skill experts', () => {
    const catalog = loadWorkflowCatalog();
    const selected = resolveWorkflowSelection(catalog, ['auto-command']).map((d) => d.id);
    // auto-command's requires.workflows names the internal retention runner,
    // which is always resolved; review (a requires.skills expert) is not.
    expect(selected.sort()).toEqual(['auto-command', 'retain-command'].sort());
    expect(selected).not.toContain('review');
  });

  it('ship-only closure includes the retention runner exactly once', () => {
    const catalog = loadWorkflowCatalog();
    const selected = resolveWorkflowSelection(catalog, ['ship-command']).map((definition) => definition.id);

    expect(selected).toEqual(expect.arrayContaining(['ship-command', 'retain-command']));
    expect(selected.filter((id) => id === 'retain-command')).toHaveLength(1);
  });

  it('the effective install set adds the compatibility runner and deduplicates auto/ship paths', () => {
    const catalog = loadWorkflowCatalog();
    const compatibilityOnly = resolveEffectiveWorkflowInstallSelection(catalog, []).map(
      (definition) => definition.id
    );
    const duplicatePaths = resolveEffectiveWorkflowInstallSelection(
      catalog,
      ['auto-command', 'ship-command', 'retain-command']
    ).map((definition) => definition.id);

    expect(compatibilityOnly).toEqual(['retain-command']);
    expect(duplicatePaths).toEqual(
      expect.arrayContaining(['auto-command', 'ship-command', 'retain-command', 'review'])
    );
    expect(duplicatePaths.filter((id) => id === 'retain-command')).toHaveLength(1);
  });

  it('with the flag, pulls the expert named by requires.skills (hyphen dirName form)', () => {
    const catalog = loadWorkflowCatalog();
    const selected = resolveWorkflowSelection(catalog, ['auto-command'], {
      includeSkillDependencies: true,
    }).map((d) => d.id);
    expect(selected.sort()).toEqual(['auto-command', 'retain-command', 'review'].sort());
  });

  it('with the flag, review-cycle pulls its write-capable fix phase and review expert; verify-enhanced-command pulls one QA identity', () => {
    const catalog = loadWorkflowCatalog();

    const reviewCycleSelected = resolveWorkflowSelection(catalog, ['review-cycle'], {
      includeSkillDependencies: true,
    }).map((d) => d.id);
    expect(reviewCycleSelected.sort()).toEqual(['review', 'review-cycle', 'review-fix'].sort());

    const verifyEnhancedSelected = resolveWorkflowSelection(catalog, ['verify-enhanced-command'], {
      includeSkillDependencies: true,
    }).map((d) => d.id);
    expect(verifyEnhancedSelected.sort()).toEqual(
      ['verify-enhanced-command', 'review', 'cso', 'qa', 'design-review'].sort()
    );
  });

  it('the goal driver pulls its authoritative read-only judge workflow', () => {
    const catalog = loadWorkflowCatalog();
    const selected = resolveWorkflowSelection(catalog, ['goal-command']).map((d) => d.id);

    expect(selected).toEqual(expect.arrayContaining(['goal-command', 'goal-judge']));
  });

  it('a root that is itself an expert id resolves directly (no special-casing needed for expert roots)', () => {
    const catalog = loadWorkflowCatalog();
    const selected = resolveWorkflowSelection(catalog, ['propose', 'review'], {
      includeSkillDependencies: true,
    }).map((d) => d.id);
    expect(selected.sort()).toEqual(['propose', 'review'].sort());
  });

  it('does not pull benchmark for any workflow (no requires.skills names it — profile default only)', () => {
    const catalog = loadWorkflowCatalog();
    const selected = resolveWorkflowSelection(
      catalog,
      ['auto-command', 'review-cycle', 'verify-enhanced-command'],
      { includeSkillDependencies: true }
    ).map((d) => d.id);
    expect(selected).not.toContain('benchmark');
  });

  it('the production core/auto install set prepares every required pipeline with every capability enabled', () => {
    const { workflowCatalog, enabledSkillNames, capabilityCatalog } =
      enabledProductionCatalog('core');
    const auto = workflowCatalog.get('auto-command');
    expect(auto).toBeDefined();

    for (const pipelineName of auto!.requires.pipelines) {
      const prepared = loadPreparedPipelineByName(pipelineName, undefined, {
        catalog: capabilityCatalog,
      }).prepared;
      expect(prepared.capability.executable, pipelineName).toBe(true);
      expectEveryCapabilityEnabled(prepared.definition, enabledSkillNames);
    }
  });

  it('a custom goal-command install set prepares goal-loop-measure with every capability enabled', () => {
    const { enabledSkillNames, capabilityCatalog } = enabledProductionCatalog(
      'custom',
      ['goal-command']
    );
    const prepared = loadPreparedPipelineByName('goal-loop-measure', undefined, {
      catalog: capabilityCatalog,
    }).prepared;

    expect(prepared.capability.executable).toBe(true);
    expectEveryCapabilityEnabled(prepared.definition, enabledSkillNames);
  });
});
