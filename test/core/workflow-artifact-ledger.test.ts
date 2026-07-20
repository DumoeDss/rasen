import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  importWorkflow,
  scaffoldWorkflow,
  scanWorkflowUsage,
} from '../../src/core/workflow-library.js';
import {
  getWorkflowArtifactLedgerPath,
  hasWorkflowArtifactLedgerDrift,
  readWorkflowArtifactLedger,
  syncWorkflowArtifactLedger,
} from '../../src/core/workflow-artifact-ledger.js';
import { loadWorkflowCatalog } from '../../src/core/workflow-registry/index.js';

describe('workflow artifact ledger', () => {
  let home: string;
  let project: string;
  let originalEnv: NodeJS.ProcessEnv;
  const originalCwd = process.cwd();

  beforeEach(() => {
    originalEnv = { ...process.env };
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-ledger-home-'));
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-ledger-project-'));
    process.env.RASEN_HOME = home;
    fs.mkdirSync(path.join(project, 'rasen'), { recursive: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env = originalEnv;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  });

  async function installWorkflow(id: string): Promise<void> {
    const draft = scaffoldWorkflow(id, path.join(home, 'drafts', id));
    const manifestPath = path.join(draft, 'workflow.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace(
        '  sidecars: []',
        '  sidecars: ["references/checklist.md"]'
      )
    );
    fs.mkdirSync(path.join(draft, 'references'), { recursive: true });
    fs.writeFileSync(path.join(draft, 'references', 'checklist.md'), 'checklist\n');
    await importWorkflow(draft);
  }

  function materialize(id: string): { skill: string; sidecar: string; directory: string } {
    const definition = loadWorkflowCatalog().get(id)!;
    const directory = path.join(project, '.claude', 'skills', definition.skill.dirName);
    const skill = path.join(directory, 'SKILL.md');
    const sidecar = path.join(directory, 'references', 'checklist.md');
    fs.mkdirSync(path.dirname(sidecar), { recursive: true });
    fs.writeFileSync(skill, 'generated skill\n');
    fs.writeFileSync(sidecar, 'checklist\n');
    return { skill, sidecar, directory };
  }

  it('records source, digest, generated files, and detects content drift', async () => {
    await installWorkflow('team-ledger');
    const artifacts = materialize('team-ledger');

    syncWorkflowArtifactLedger(project, 'claude', ['team-ledger'], 'skills');

    const ledger = readWorkflowArtifactLedger(project)!;
    expect(ledger.workflows).toEqual(['team-ledger']);
    expect(ledger.tools.claude.workflows['team-ledger']).toMatchObject({
      source: expect.stringContaining('team-ledger'),
      digest: expect.stringMatching(/^sha256:/),
    });
    expect(ledger.tools.claude.workflows['team-ledger'].files).toHaveLength(2);
    expect(scanWorkflowUsage('team-ledger', { projectRoot: project })).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'ledger' })])
    );
    const nested = path.join(project, 'src', 'nested');
    fs.mkdirSync(nested, { recursive: true });
    process.chdir(nested);
    expect(scanWorkflowUsage('team-ledger')).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'ledger' })])
    );
    expect(hasWorkflowArtifactLedgerDrift(project, ['claude'], ['team-ledger'], 'skills')).toBe(false);

    fs.writeFileSync(artifacts.skill, 'locally changed\n');
    expect(hasWorkflowArtifactLedgerDrift(project, ['claude'], ['team-ledger'], 'skills')).toBe(true);
  });

  it('removes only unchanged managed files when a workflow is deselected', async () => {
    await installWorkflow('team-cleanup');
    const artifacts = materialize('team-cleanup');
    const unmanaged = path.join(artifacts.directory, 'notes.md');
    fs.writeFileSync(unmanaged, 'keep me\n');
    syncWorkflowArtifactLedger(project, 'claude', ['team-cleanup'], 'skills');

    const result = syncWorkflowArtifactLedger(project, 'claude', [], 'skills');

    expect(result.removedFiles).toBe(2);
    expect(fs.existsSync(artifacts.skill)).toBe(false);
    expect(fs.existsSync(artifacts.sidecar)).toBe(false);
    expect(fs.readFileSync(unmanaged, 'utf8')).toBe('keep me\n');
    expect(fs.existsSync(getWorkflowArtifactLedgerPath(project))).toBe(false);
  });

  it('preserves a managed path after the user changes its content', async () => {
    await installWorkflow('team-modified');
    const artifacts = materialize('team-modified');
    syncWorkflowArtifactLedger(project, 'claude', ['team-modified'], 'skills');
    fs.writeFileSync(artifacts.sidecar, 'user-owned replacement\n');

    syncWorkflowArtifactLedger(project, 'claude', [], 'skills');

    expect(fs.existsSync(artifacts.skill)).toBe(false);
    expect(fs.readFileSync(artifacts.sidecar, 'utf8')).toBe('user-owned replacement\n');
  });

  it('does not trust a tampered ledger to delete an unmanaged file', async () => {
    await installWorkflow('team-tampered');
    const artifacts = materialize('team-tampered');
    const unmanaged = path.join(artifacts.directory, 'notes.md');
    fs.writeFileSync(unmanaged, 'keep me\n');
    syncWorkflowArtifactLedger(project, 'claude', ['team-tampered'], 'skills');

    const ledgerPath = getWorkflowArtifactLedgerPath(project);
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) as {
      tools: { claude: { workflows: Record<string, { files: unknown[] }> } };
    };
    ledger.tools.claude.workflows['team-tampered'].files.push({
      scope: 'project',
      path: path.relative(project, unmanaged).split(path.sep).join('/'),
      sha256: `sha256:${createHash('sha256').update(fs.readFileSync(unmanaged)).digest('hex')}`,
    });
    fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

    const result = syncWorkflowArtifactLedger(project, 'claude', [], 'skills');

    expect(result.removedFiles).toBe(2);
    expect(fs.readFileSync(unmanaged, 'utf8')).toBe('keep me\n');
  });

  it.runIf(process.platform !== 'win32')('refuses cleanup through a symlinked parent', async () => {
    await installWorkflow('team-symlink');
    const artifacts = materialize('team-symlink');
    syncWorkflowArtifactLedger(project, 'claude', ['team-symlink'], 'skills');
    const relocated = path.join(home, 'relocated-skill');
    fs.renameSync(artifacts.directory, relocated);
    fs.symlinkSync(relocated, artifacts.directory, 'dir');

    const result = syncWorkflowArtifactLedger(project, 'claude', [], 'skills');

    expect(result.removedFiles).toBe(0);
    expect(fs.existsSync(path.join(relocated, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(relocated, 'references', 'checklist.md'))).toBe(true);
  });
});
