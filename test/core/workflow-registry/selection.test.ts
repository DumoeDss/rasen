import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadWorkflowCatalog, resolveWorkflowSelection } from '../../../src/core/workflow-registry/index.js';

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

  it('with the flag, pulls the expert named by requires.skills (hyphen dirName form)', () => {
    const catalog = loadWorkflowCatalog();
    const selected = resolveWorkflowSelection(catalog, ['auto-command'], {
      includeSkillDependencies: true,
    }).map((d) => d.id);
    expect(selected.sort()).toEqual(['auto-command', 'retain-command', 'review'].sort());
  });

  it('with the flag, review-cycle also pulls review; verify-enhanced-command pulls all five', () => {
    const catalog = loadWorkflowCatalog();

    const reviewCycleSelected = resolveWorkflowSelection(catalog, ['review-cycle'], {
      includeSkillDependencies: true,
    }).map((d) => d.id);
    expect(reviewCycleSelected.sort()).toEqual(['review', 'review-cycle'].sort());

    const verifyEnhancedSelected = resolveWorkflowSelection(catalog, ['verify-enhanced-command'], {
      includeSkillDependencies: true,
    }).map((d) => d.id);
    expect(verifyEnhancedSelected.sort()).toEqual(
      ['verify-enhanced-command', 'review', 'cso', 'qa', 'qa-only', 'design-review'].sort()
    );
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
});
