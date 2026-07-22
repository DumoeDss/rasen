import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs, existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { runCLI } from '../helpers/run-cli.js';
import { FileSystemUtils } from '../../src/utils/file-system.js';

describe('artifact-workflow CLI commands', () => {
  let tempDir: string;
  let changesDir: string;

  const canonical = (targetPath: string): string => FileSystemUtils.canonicalizeExistingPath(targetPath);

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rasen-artifact-workflow-'));
    changesDir = path.join(tempDir, 'rasen', 'changes');
    await fs.mkdir(changesDir, { recursive: true });
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  /**
   * Gets combined output from CLI result (ora outputs to stdout).
   */
  function getOutput(result: { stdout: string; stderr: string }): string {
    return result.stdout + result.stderr;
  }

  /**
   * Normalizes path separators to forward slashes for cross-platform assertions.
   */
  function normalizePaths(str: string): string {
    return str.replace(/\\/g, '/');
  }

  /**
   * Creates a test change with the specified artifacts completed.
   * Note: An "active" change requires at least a proposal.md file to be detected.
   * If no artifacts are specified, we create an empty proposal to make it detectable.
   */
  async function createTestChange(
    changeName: string,
    artifacts: ('proposal' | 'design' | 'specs' | 'tasks')[] = []
  ): Promise<string> {
    const changeDir = path.join(changesDir, changeName);
    await fs.mkdir(changeDir, { recursive: true });

    // Always create proposal.md for the change to be detected as active
    // Content varies based on whether 'proposal' is in artifacts list
    const proposalContent = artifacts.includes('proposal')
      ? '## Why\nTest proposal content that is long enough.\n\n## What Changes\n- **test:** Something'
      : '## Why\nMinimal proposal.\n\n## What Changes\n- **test:** Placeholder';
    await fs.writeFile(path.join(changeDir, 'proposal.md'), proposalContent);

    if (artifacts.includes('design')) {
      await fs.writeFile(path.join(changeDir, 'design.md'), '# Design\n\nTechnical design.');
    }

    if (artifacts.includes('specs')) {
      // specs artifact uses glob pattern "specs/*.md" - files directly in specs/ directory
      const specsDir = path.join(changeDir, 'specs');
      await fs.mkdir(specsDir, { recursive: true });
      await fs.writeFile(path.join(specsDir, 'test-spec.md'), '## Purpose\nTest spec.');
    }

    if (artifacts.includes('tasks')) {
      await fs.writeFile(path.join(changeDir, 'tasks.md'), '## Tasks\n- [ ] Task 1');
    }

    return changeDir;
  }

  describe('status command', () => {
    it('shows status for scaffolded change without proposal.md', async () => {
      // Create empty change directory (no proposal.md)
      const changeDir = path.join(changesDir, 'scaffolded-change');
      await fs.mkdir(changeDir, { recursive: true });

      const result = await runCLI(['status', '--change', 'scaffolded-change'], { cwd: tempDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('scaffolded-change');
      expect(result.stdout).toContain('0/4 artifacts complete');
    });

    it('shows status for a change with proposal only', async () => {
      // createTestChange always creates proposal.md, so this has 1 artifact complete
      await createTestChange('minimal-change');

      const result = await runCLI(['status', '--change', 'minimal-change'], { cwd: tempDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('minimal-change');
      expect(result.stdout).toContain('spec-driven');
      expect(result.stdout).toContain('1/4 artifacts complete');
    });

    it('shows status for a change with proposal and design', async () => {
      await createTestChange('partial-change', ['proposal', 'design']);

      const result = await runCLI(['status', '--change', 'partial-change'], { cwd: tempDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('2/4 artifacts complete');
      expect(result.stdout).toContain('[x]');
    });

    it('outputs JSON when --json flag is used', async () => {
      await createTestChange('json-change', ['proposal', 'design']);

      const result = await runCLI(['status', '--change', 'json-change', '--json'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');

      const json = JSON.parse(result.stdout);
      expect(json.changeName).toBe('json-change');
      expect(json.schemaName).toBe('spec-driven');
      expect(json.isComplete).toBe(false);
      expect(Array.isArray(json.artifacts)).toBe(true);
      expect(json.artifacts).toHaveLength(4);

      const proposalArtifact = json.artifacts.find((a: any) => a.id === 'proposal');
      expect(proposalArtifact.status).toBe('done');
    });

    it('shows complete status when all artifacts are done', async () => {
      await createTestChange('complete-change', ['proposal', 'design', 'specs', 'tasks']);

      const result = await runCLI(['status', '--change', 'complete-change'], { cwd: tempDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('4/4 artifacts complete');
      expect(result.stdout).toContain('All artifacts complete!');
    });

    it('exits gracefully when no changes exist', async () => {
      const result = await runCLI(['status'], { cwd: tempDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No active changes');
      expect(result.stdout).toContain('rasen new change');
    });

    it('exits gracefully with JSON when no changes exist', async () => {
      const result = await runCLI(['status', '--json'], { cwd: tempDir });
      expect(result.exitCode).toBe(0);

      const json = JSON.parse(result.stdout);
      expect(json.changes).toEqual([]);
      expect(json.message).toBe('No active changes.');
    });

    it('errors when --change is missing and lists available changes', async () => {
      await createTestChange('some-change');

      const result = await runCLI(['status'], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain('Missing required option --change');
      expect(output).toContain('some-change');
    });

    it('errors for unknown change name and lists available changes', async () => {
      await createTestChange('existing-change');

      const result = await runCLI(['status', '--change', 'nonexistent'], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain("Change 'nonexistent' not found");
      expect(output).toContain('existing-change');
    });

    it('supports --schema option', async () => {
      await createTestChange('schema-change');

      const result = await runCLI(['status', '--change', 'schema-change', '--schema', 'spec-driven'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('spec-driven');
    });

    it('errors for unknown schema', async () => {
      await createTestChange('test-change');

      const result = await runCLI(['status', '--change', 'test-change', '--schema', 'unknown'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain("Schema 'unknown' not found");
    });

    it('rejects path traversal in change name', async () => {
      const result = await runCLI(['status', '--change', '../foo'], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain('Invalid change name');
    });

    it('rejects absolute path in change name', async () => {
      const result = await runCLI(['status', '--change', '/etc/passwd'], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain('Invalid change name');
    });

    it('rejects slashes in change name', async () => {
      const result = await runCLI(['status', '--change', 'foo/bar'], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain('Invalid change name');
    });
  });

  describe('instructions command', () => {
    it('shows instructions for proposal on scaffolded change', async () => {
      // Create empty change directory (no proposal.md)
      const changeDir = path.join(changesDir, 'scaffolded-change');
      await fs.mkdir(changeDir, { recursive: true });

      const result = await runCLI(['instructions', 'proposal', '--change', 'scaffolded-change'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('<artifact id="proposal"');
      expect(result.stdout).toContain('proposal.md');
      expect(result.stdout).toContain('<template>');
    });

    it('shows instructions for design artifact', async () => {
      await createTestChange('instr-change');

      const result = await runCLI(['instructions', 'design', '--change', 'instr-change'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('<artifact id="design"');
      expect(result.stdout).toContain('design.md');
      expect(result.stdout).toContain('<template>');
    });

    it('shows blocked warning for artifact with unmet dependencies', async () => {
      // tasks depends on design and specs, which are not done yet
      await createTestChange('blocked-change');

      const result = await runCLI(['instructions', 'tasks', '--change', 'blocked-change'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('<warning>');
      expect(result.stdout).toContain('status="missing"');
    });

    it('outputs JSON for instructions', async () => {
      await createTestChange('json-instr', ['proposal']);

      const result = await runCLI(['instructions', 'design', '--change', 'json-instr', '--json'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');

      const json = JSON.parse(result.stdout);
      expect(json.artifactId).toBe('design');
      expect(json.outputPath).toContain('design.md');
      expect(typeof json.template).toBe('string');
      expect(Array.isArray(json.dependencies)).toBe(true);
    });

    it('errors when artifact argument is missing', async () => {
      await createTestChange('test-change');

      const result = await runCLI(['instructions', '--change', 'test-change'], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain('Missing required argument <artifact>');
      expect(output).toContain('Valid artifacts');
    });

    it('errors for unknown artifact', async () => {
      await createTestChange('test-change');

      const result = await runCLI(['instructions', 'unknown-artifact', '--change', 'test-change'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain("Artifact 'unknown-artifact' not found");
      expect(output).toContain('Valid artifacts');
    });
  });

  describe('templates command', () => {
    it('shows template paths for default schema', async () => {
      const result = await runCLI(['templates'], { cwd: tempDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Schema: spec-driven');
      expect(result.stdout).toContain('proposal:');
      expect(result.stdout).toContain('design:');
      expect(result.stdout).toContain('specs:');
      expect(result.stdout).toContain('tasks:');
    });

    it('shows template paths for specified schema', async () => {
      const result = await runCLI(['templates', '--schema', 'spec-driven'], { cwd: tempDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Schema: spec-driven');
      expect(result.stdout).toContain('proposal:');
      expect(result.stdout).toContain('design:');
    });

    it('outputs JSON mapping of templates', async () => {
      const result = await runCLI(['templates', '--json'], { cwd: tempDir });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');

      const json = JSON.parse(result.stdout);
      expect(json.proposal).toBeDefined();
      expect(json.proposal.path).toContain('proposal.md');
      expect(json.proposal.source).toBe('package');
    });

    it('errors for unknown schema', async () => {
      const result = await runCLI(['templates', '--schema', 'nonexistent'], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain("Schema 'nonexistent' not found");
    });
  });

  describe('new change command', () => {
    it('creates a new change directory', async () => {
      const result = await runCLI(['new', 'change', 'my-new-feature'], { cwd: tempDir });
      expect(result.exitCode).toBe(0);
      const output = getOutput(result);
      expect(output).toContain("Created change 'my-new-feature'");

      const changeDir = path.join(changesDir, 'my-new-feature');
      const stat = await fs.stat(changeDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it('rejects --initiative and writes no change', async () => {
      const result = await runCLI(
        ['new', 'change', 'linked-change', '--initiative', 'billing-launch'],
        { cwd: tempDir }
      );
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain('--initiative is no longer supported');
      await expect(fs.stat(path.join(changesDir, 'linked-change'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    });

    it('rejects --areas and writes no affected-area metadata', async () => {
      const result = await runCLI(['new', 'change', 'area-change', '--areas', 'api'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain('--areas is no longer supported');
      await expect(fs.stat(path.join(changesDir, 'area-change'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    });

    it('keeps --goal as ordinary metadata without switching schema', async () => {
      const result = await runCLI(
        ['new', 'change', 'goal-change', '--goal', 'Improve billing'],
        { cwd: tempDir }
      );
      expect(result.exitCode).toBe(0);

      const metadata = await fs.readFile(
        path.join(changesDir, 'goal-change', '.openspec.yaml'),
        'utf-8'
      );
      expect(metadata).toContain('schema: spec-driven');
      expect(metadata).toContain('goal: Improve billing');
      expect(metadata).not.toContain('affected_areas');
      expect(metadata).not.toContain('initiative');
    });

    it('creates README.md when --description is provided', async () => {
      const result = await runCLI(
        ['new', 'change', 'described-feature', '--description', 'This is a test feature'],
        { cwd: tempDir }
      );
      expect(result.exitCode).toBe(0);

      const readmePath = path.join(changesDir, 'described-feature', 'README.md');
      const content = await fs.readFile(readmePath, 'utf-8');
      expect(content).toContain('described-feature');
      expect(content).toContain('This is a test feature');
    });

    it('creates proposal.md when --proposal is provided, making the change active', async () => {
      const result = await runCLI(
        ['new', 'change', 'submitted-feature', '--proposal', 'Add feature Y'],
        { cwd: tempDir }
      );
      expect(result.exitCode).toBe(0);

      const proposalPath = path.join(changesDir, 'submitted-feature', 'proposal.md');
      const content = await fs.readFile(proposalPath, 'utf-8');
      expect(content).toContain('submitted-feature');
      expect(content).toContain('Add feature Y');

      const { getActiveChangeIds } = await import('../../src/utils/item-discovery.js');
      const activeIds = await getActiveChangeIds(tempDir);
      expect(activeIds).toContain('submitted-feature');
    });

    it('creates no proposal.md without --proposal (unchanged behavior)', async () => {
      const result = await runCLI(['new', 'change', 'unsubmitted-feature'], { cwd: tempDir });
      expect(result.exitCode).toBe(0);

      const proposalPath = path.join(changesDir, 'unsubmitted-feature', 'proposal.md');
      expect(existsSync(proposalPath)).toBe(false);
    });

    it('errors on an empty or whitespace-only --proposal instead of silently skipping it (review m2)', async () => {
      const emptyResult = await runCLI(
        ['new', 'change', 'empty-proposal-feature', '--proposal', ''],
        { cwd: tempDir }
      );
      expect(emptyResult.exitCode).toBe(1);
      expect(getOutput(emptyResult)).toContain('--proposal must not be empty');
      expect(existsSync(path.join(changesDir, 'empty-proposal-feature'))).toBe(false);

      const whitespaceResult = await runCLI(
        ['new', 'change', 'whitespace-proposal-feature', '--proposal', '   '],
        { cwd: tempDir }
      );
      expect(whitespaceResult.exitCode).toBe(1);
      expect(existsSync(path.join(changesDir, 'whitespace-proposal-feature'))).toBe(false);
    });

    it('errors for invalid change name with spaces', async () => {
      const result = await runCLI(['new', 'change', 'invalid name'], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain('Error');
    });

    it('errors for duplicate change name', async () => {
      await createTestChange('existing-change');

      const result = await runCLI(['new', 'change', 'existing-change'], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain('exists');
    });

    it('errors when name argument is missing', async () => {
      const result = await runCLI(['new', 'change'], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
    });
  });

  describe('instructions apply command', () => {
    it('shows apply instructions for spec-driven schema with tasks', async () => {
      await createTestChange('apply-change', ['proposal', 'design', 'specs', 'tasks']);

      const result = await runCLI(['instructions', 'apply', '--change', 'apply-change'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('## Apply: apply-change');
      expect(result.stdout).toContain('Schema: spec-driven');
      expect(result.stdout).toContain('### Context Files');
      expect(result.stdout).toContain('### Instruction');
    });

    it('shows blocked state when required artifacts are missing', async () => {
      // Only create proposal - missing tasks (required by spec-driven apply block)
      await createTestChange('blocked-apply', ['proposal']);

      const result = await runCLI(['instructions', 'apply', '--change', 'blocked-apply'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Blocked');
      expect(result.stdout).toContain('Missing artifacts: tasks');
    });

    it('outputs JSON for apply instructions', async () => {
      await createTestChange('json-apply', ['proposal', 'design', 'specs', 'tasks']);

      const result = await runCLI(
        ['instructions', 'apply', '--change', 'json-apply', '--json'],
        { cwd: tempDir }
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');

      const json = JSON.parse(result.stdout);
      const expectedProposalPath = canonical(path.join(changesDir, 'json-apply', 'proposal.md'));
      const expectedSpecPath = canonical(path.join(changesDir, 'json-apply', 'specs', 'test-spec.md'));
      expect(json.changeName).toBe('json-apply');
      expect(json.schemaName).toBe('spec-driven');
      expect(json.state).toBe('ready');
      expect(json.contextFiles).toBeDefined();
      expect(typeof json.contextFiles).toBe('object');
      expect(json.contextFiles.proposal).toEqual([expectedProposalPath]);
      expect(json.contextFiles.specs).toEqual([expectedSpecPath]);
    });

    it('resolves single-star glob artifacts consistently between status and apply', async () => {
      const schemaDir = path.join(tempDir, 'rasen', 'schemas', 'glob-test');
      const templatesDir = path.join(schemaDir, 'templates');
      await fs.mkdir(templatesDir, { recursive: true });

      await fs.writeFile(
        path.join(schemaDir, 'schema.yaml'),
        `name: glob-test
version: 1
description: Test schema for single-star globs
artifacts:
  - id: specs
    generates: specs/*/spec.md
    description: Nested specs
    template: spec.md
    requires: []
apply:
  requires: [specs]
  instruction: Ready when specs exist.
`
      );
      await fs.writeFile(path.join(templatesDir, 'spec.md'), '# Spec\n');

      const changeDir = path.join(changesDir, 'single-star-glob');
      const specPath = path.join(changeDir, 'specs', 'single-star-glob', 'spec.md');
      await fs.mkdir(path.dirname(specPath), { recursive: true });
      await fs.writeFile(path.join(changeDir, '.openspec.yaml'), 'schema: glob-test\n');
      await fs.writeFile(specPath, '# Nested spec\n');

      const statusResult = await runCLI(['status', '--change', 'single-star-glob', '--json'], {
        cwd: tempDir,
      });
      expect(statusResult.exitCode).toBe(0);
      const statusJson = JSON.parse(statusResult.stdout);
      expect(statusJson.artifacts).toEqual([
        {
          id: 'specs',
          outputPath: 'specs/*/spec.md',
          status: 'done',
        },
      ]);

      const applyResult = await runCLI(
        ['instructions', 'apply', '--change', 'single-star-glob', '--json'],
        { cwd: tempDir }
      );
      expect(applyResult.exitCode).toBe(0);
      const applyJson = JSON.parse(applyResult.stdout);
      const resolvedSpecPath = canonical(specPath);
      expect(applyJson.state).toBe('ready');
      expect(applyJson.missingArtifacts).toBeUndefined();
      expect(applyJson.contextFiles).toEqual({
        specs: [resolvedSpecPath],
      });
    });

    it('shows schema instruction from apply block', async () => {
      await createTestChange('instr-apply', ['proposal', 'design', 'specs', 'tasks']);

      const result = await runCLI(['instructions', 'apply', '--change', 'instr-apply'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);
      // Should show the instruction from spec-driven schema apply block
      expect(result.stdout).toContain('work through pending tasks');
    });

    it('shows all_done state when all tasks are complete', async () => {
      const changeDir = await createTestChange('done-apply', [
        'proposal',
        'design',
        'specs',
        'tasks',
      ]);
      // Overwrite tasks with all completed
      await fs.writeFile(
        path.join(changeDir, 'tasks.md'),
        '## Tasks\n- [x] Task 1\n- [x] Task 2'
      );

      const result = await runCLI(['instructions', 'apply', '--change', 'done-apply'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('complete ✓');
      expect(result.stdout).toContain('ready to be archived');
    });

    it('uses spec-driven schema apply configuration', async () => {
      // Create a spec-driven style change with all artifacts
      await createTestChange('apply-schema-test', ['proposal', 'design', 'specs', 'tasks']);

      const result = await runCLI(
        ['instructions', 'apply', '--change', 'apply-schema-test', '--schema', 'spec-driven'],
        { cwd: tempDir }
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Schema: spec-driven');
    });

    it('spec-driven schema uses apply block configuration', async () => {
      // Verify that spec-driven schema uses its apply block (requires: [tasks])
      await createTestChange('apply-config-test', ['proposal', 'design', 'specs', 'tasks']);

      const result = await runCLI(
        ['instructions', 'apply', '--change', 'apply-config-test', '--json'],
        { cwd: tempDir }
      );
      expect(result.exitCode).toBe(0);

      const json = JSON.parse(result.stdout);
      // spec-driven schema has apply block with requires: [tasks], so should be ready
      expect(json.schemaName).toBe('spec-driven');
      expect(json.state).toBe('ready');
    });

    it('fallback: requires all artifacts when schema has no apply block', async () => {
      // Create a minimal schema without an apply block in user schemas dir
      const userDataDir = path.join(tempDir, 'user-data');
      const noApplySchemaDir = path.join(userDataDir, 'rasen', 'schemas', 'no-apply');
      const templatesDir = path.join(noApplySchemaDir, 'templates');
      await fs.mkdir(templatesDir, { recursive: true });

      // Minimal schema with 2 artifacts, no apply block
      const schemaContent = `
name: no-apply
version: 1
description: Test schema without apply block
artifacts:
  - id: first
    generates: first.md
    description: First artifact
    template: first.md
    requires: []
  - id: second
    generates: second.md
    description: Second artifact
    template: second.md
    requires: [first]
`;
      await fs.writeFile(path.join(noApplySchemaDir, 'schema.yaml'), schemaContent);
      await fs.writeFile(path.join(templatesDir, 'first.md'), '# First\n');
      await fs.writeFile(path.join(templatesDir, 'second.md'), '# Second\n');

      // Create a change with only the first artifact (missing second)
      const changeDir = path.join(changesDir, 'no-apply-test');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(path.join(changeDir, 'first.md'), '# First artifact content');

      // Run with XDG_DATA_HOME pointing to our temp user data dir
      const result = await runCLI(
        ['instructions', 'apply', '--change', 'no-apply-test', '--schema', 'no-apply', '--json'],
        {
          cwd: tempDir,
          env: { XDG_DATA_HOME: userDataDir },
        }
      );
      expect(result.exitCode).toBe(0);

      const json = JSON.parse(result.stdout);
      // Without apply block, fallback requires ALL artifacts - second is missing
      expect(json.schemaName).toBe('no-apply');
      expect(json.state).toBe('blocked');
      expect(json.missingArtifacts).toContain('second');
    });

    it('fallback: ready when all artifacts exist for schema without apply block', async () => {
      // Create a minimal schema without an apply block
      const userDataDir = path.join(tempDir, 'user-data-2');
      const noApplySchemaDir = path.join(userDataDir, 'rasen', 'schemas', 'no-apply-full');
      const templatesDir = path.join(noApplySchemaDir, 'templates');
      await fs.mkdir(templatesDir, { recursive: true });

      const schemaContent = `
name: no-apply-full
version: 1
description: Test schema without apply block
artifacts:
  - id: only
    generates: only.md
    description: Only artifact
    template: only.md
    requires: []
`;
      await fs.writeFile(path.join(noApplySchemaDir, 'schema.yaml'), schemaContent);
      await fs.writeFile(path.join(templatesDir, 'only.md'), '# Only\n');

      // Create a change with the artifact present
      const changeDir = path.join(changesDir, 'no-apply-full-test');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(path.join(changeDir, 'only.md'), '# Content');

      const result = await runCLI(
        ['instructions', 'apply', '--change', 'no-apply-full-test', '--schema', 'no-apply-full', '--json'],
        {
          cwd: tempDir,
          env: { XDG_DATA_HOME: userDataDir },
        }
      );
      expect(result.exitCode).toBe(0);

      const json = JSON.parse(result.stdout);
      // All artifacts exist, should be ready with default instruction
      expect(json.schemaName).toBe('no-apply-full');
      expect(json.state).toBe('ready');
      expect(json.instruction).toContain('All required artifacts complete');
    });
  });

  describe('nextWorkflows (design D1/D3/D4, workflow-next-steps spec)', () => {
    /**
     * Points a CLI invocation at an isolated machine home carrying the
     * given profile, so the installed-workflow set (design D5) resolves
     * to that profile's selection instead of the harness's default `full`.
     */
    async function coreProfileEnv(): Promise<NodeJS.ProcessEnv> {
      const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rasen-core-profile-home-'));
      await fs.writeFile(path.join(homeDir, 'config.json'), JSON.stringify({ profile: 'core' }));
      return { RASEN_HOME: homeDir };
    }

    it('apply --json: all_done under the default (full) profile resolves to verify', async () => {
      const changeDir = await createTestChange('next-full-apply', ['proposal', 'design', 'specs', 'tasks']);
      await fs.writeFile(path.join(changeDir, 'tasks.md'), '## Tasks\n- [x] Task 1');

      const result = await runCLI(
        ['instructions', 'apply', '--change', 'next-full-apply', '--json'],
        { cwd: tempDir }
      );
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.state).toBe('all_done');
      expect(json.nextWorkflows).toEqual([{ workflow: 'verify', reason: expect.any(String) }]);
    });

    it('apply --json: all_done under a core profile skips to archive, never naming an uninstalled workflow', async () => {
      const changeDir = await createTestChange('next-core-apply', ['proposal', 'design', 'specs', 'tasks']);
      await fs.writeFile(path.join(changeDir, 'tasks.md'), '## Tasks\n- [x] Task 1');

      const result = await runCLI(
        ['instructions', 'apply', '--change', 'next-core-apply', '--json'],
        { cwd: tempDir, env: await coreProfileEnv() }
      );
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.state).toBe('all_done');
      expect(json.nextWorkflows).toEqual([{ workflow: 'archive', reason: expect.any(String) }]);
      expect(json.nextWorkflows[0].workflow).not.toBe('verify');
      expect(json.nextWorkflows[0].workflow).not.toBe('ship-command');
    });

    it('apply --json: blocked state points at the continuation', async () => {
      await createTestChange('next-blocked-apply', ['proposal']);

      const result = await runCLI(
        ['instructions', 'apply', '--change', 'next-blocked-apply', '--json'],
        { cwd: tempDir }
      );
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.state).toBe('blocked');
      expect(json.nextWorkflows).toEqual([{ workflow: 'continue', reason: expect.any(String) }]);
    });

    it('apply --json: ready (mid-implementation) state has no forward step', async () => {
      await createTestChange('next-ready-apply', ['proposal', 'design', 'specs', 'tasks']);

      const result = await runCLI(
        ['instructions', 'apply', '--change', 'next-ready-apply', '--json'],
        { cwd: tempDir }
      );
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.state).toBe('ready');
      expect(json.nextWorkflows).toEqual([]);
    });

    it('apply text output: prints a trailing Next: hint with the -command suffix stripped', async () => {
      const changeDir = await createTestChange('next-hint-apply', ['proposal', 'design', 'specs', 'tasks']);
      await fs.writeFile(path.join(changeDir, 'tasks.md'), '## Tasks\n- [x] Task 1');

      const result = await runCLI(['instructions', 'apply', '--change', 'next-hint-apply'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/Next: verify — /);
    });

    it('status --json: complete artifacts resolve to apply', async () => {
      await createTestChange('next-status-complete', ['proposal', 'design', 'specs', 'tasks']);

      const result = await runCLI(['status', '--change', 'next-status-complete', '--json'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.isComplete).toBe(true);
      expect(json.nextWorkflows).toEqual([{ workflow: 'apply', reason: expect.any(String) }]);
      // The pre-existing artifact-authoring string array stays untouched.
      expect(Array.isArray(json.nextSteps)).toBe(true);
    });

    it('status --json: incomplete artifacts have no nextWorkflows entry', async () => {
      await createTestChange('next-status-pending', ['proposal']);

      const result = await runCLI(['status', '--change', 'next-status-pending', '--json'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.isComplete).toBe(false);
      expect(json.nextWorkflows).toEqual([]);
    });

    it('status text output: prints a trailing Next: hint when a next workflow resolves', async () => {
      await createTestChange('next-status-hint', ['proposal', 'design', 'specs', 'tasks']);

      const result = await runCLI(['status', '--change', 'next-status-hint'], { cwd: tempDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/Next: apply — /);
    });
  });

  describe('workDir exposure (design change-work-dir)', () => {
    async function writeConfig(root: string): Promise<void> {
      await fs.writeFile(path.join(root, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    }

    it('status --json carries workDir for a registered project', async () => {
      await writeConfig(tempDir);
      await createTestChange('workdir-status-change');
      const globalDataDir = path.join(tempDir, 'global-data-registered');

      // First mint identity via the ensure surface (instructions), then
      // confirm status (probe-only) picks it up without minting itself.
      await runCLI(['instructions', 'proposal', '--change', 'workdir-status-change'], {
        cwd: tempDir,
        env: { XDG_DATA_HOME: globalDataDir },
      });

      const result = await runCLI(
        ['status', '--change', 'workdir-status-change', '--json'],
        { cwd: tempDir, env: { XDG_DATA_HOME: globalDataDir } }
      );
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(typeof json.workDir).toBe('string');
      expect(normalizePaths(json.workDir)).toContain('workdir-status-change/work');
    });

    it('status --json omits workDir for an unregistered project, with zero writes', async () => {
      await createTestChange('workdir-status-unreg');
      const globalDataDir = path.join(tempDir, 'global-data-unreg');

      const result = await runCLI(
        ['status', '--change', 'workdir-status-unreg', '--json'],
        { cwd: tempDir, env: { XDG_DATA_HOME: globalDataDir } }
      );
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.workDir).toBeUndefined();
      // Probe-only: no registry directory created, and no config.yaml was
      // ever written for this unregistered project.
      expect(existsSync(path.join(globalDataDir, 'rasen', 'projects'))).toBe(false);
      expect(existsSync(path.join(tempDir, 'rasen', 'config.yaml'))).toBe(false);
    });

    it('instructions --json mints identity on first call and carries workDir', async () => {
      await writeConfig(tempDir);
      await createTestChange('workdir-instr-change');
      const globalDataDir = path.join(tempDir, 'global-data-mint');

      const configPathBefore = await fs.readFile(
        path.join(tempDir, 'rasen', 'config.yaml'),
        'utf-8'
      );
      expect(configPathBefore).not.toContain('projectId');

      const result = await runCLI(
        ['instructions', 'proposal', '--change', 'workdir-instr-change', '--json'],
        { cwd: tempDir, env: { XDG_DATA_HOME: globalDataDir } }
      );
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(typeof json.workDir).toBe('string');
      expect(normalizePaths(json.workDir)).toContain('workdir-instr-change/work');

      const configPathAfter = await fs.readFile(
        path.join(tempDir, 'rasen', 'config.yaml'),
        'utf-8'
      );
      expect(configPathAfter).toContain('projectId');
      expect(existsSync(path.join(globalDataDir, 'rasen', 'projects'))).toBe(true);
    });

    it('instructions apply --json carries workDir (parity with instructions)', async () => {
      await writeConfig(tempDir);
      await createTestChange('workdir-apply-change', ['proposal', 'design', 'specs', 'tasks']);
      const globalDataDir = path.join(tempDir, 'global-data-apply');

      const result = await runCLI(
        ['instructions', 'apply', '--change', 'workdir-apply-change', '--json'],
        { cwd: tempDir, env: { XDG_DATA_HOME: globalDataDir } }
      );
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(typeof json.workDir).toBe('string');
      expect(normalizePaths(json.workDir)).toContain('workdir-apply-change/work');
    });

    it('context --json carries machineHome for a registered project and omits it otherwise', async () => {
      await writeConfig(tempDir);
      const globalDataDir = path.join(tempDir, 'global-data-context');

      const unregistered = await runCLI(['context', '--json'], {
        cwd: tempDir,
        env: { XDG_DATA_HOME: globalDataDir },
      });
      expect(unregistered.exitCode).toBe(0);
      const unregisteredJson = JSON.parse(unregistered.stdout);
      expect(unregisteredJson.root.machineHome).toBeUndefined();

      await createTestChange('workdir-context-change');
      await runCLI(['instructions', 'proposal', '--change', 'workdir-context-change'], {
        cwd: tempDir,
        env: { XDG_DATA_HOME: globalDataDir },
      });

      const registered = await runCLI(['context', '--json'], {
        cwd: tempDir,
        env: { XDG_DATA_HOME: globalDataDir },
      });
      expect(registered.exitCode).toBe(0);
      const registeredJson = JSON.parse(registered.stdout);
      expect(typeof registeredJson.root.machineHome).toBe('string');
    });

    // Review finding F1: a corrupt machine-global registry.json must never
    // brick a change-scoped command — resolveChangeWorkDir/resolveProjectHome
    // probes degrade to the field simply being absent, not a thrown error.
    describe('corrupt machine-global registry.json (F1 regression)', () => {
      async function registerAndCorruptRegistry(
        changeName: string,
        globalDataDir: string
      ): Promise<void> {
        await writeConfig(tempDir);
        await createTestChange(changeName);
        // Mint identity first so the registry file actually exists.
        await runCLI(['instructions', 'proposal', '--change', changeName], {
          cwd: tempDir,
          env: { XDG_DATA_HOME: globalDataDir },
        });
        const registryPath = path.join(globalDataDir, 'rasen', 'projects', 'registry.json');
        await fs.writeFile(registryPath, '{not valid json');
      }

      it('status --json still succeeds with workDir simply absent', async () => {
        const globalDataDir = path.join(tempDir, 'global-data-corrupt-status');
        await registerAndCorruptRegistry('workdir-corrupt-status', globalDataDir);

        const result = await runCLI(
          ['status', '--change', 'workdir-corrupt-status', '--json'],
          { cwd: tempDir, env: { XDG_DATA_HOME: globalDataDir } }
        );
        expect(result.exitCode).toBe(0);
        const json = JSON.parse(result.stdout);
        expect(json.workDir).toBeUndefined();
        expect(json.changeName).toBe('workdir-corrupt-status');
      });

      it('instructions --json still succeeds with workDir simply absent', async () => {
        const globalDataDir = path.join(tempDir, 'global-data-corrupt-instr');
        await registerAndCorruptRegistry('workdir-corrupt-instr', globalDataDir);

        const result = await runCLI(
          ['instructions', 'proposal', '--change', 'workdir-corrupt-instr', '--json'],
          { cwd: tempDir, env: { XDG_DATA_HOME: globalDataDir } }
        );
        expect(result.exitCode).toBe(0);
        const json = JSON.parse(result.stdout);
        expect(json.workDir).toBeUndefined();
        expect(json.artifactId).toBe('proposal');
      });

      it('context --json still succeeds with machineHome simply absent', async () => {
        const globalDataDir = path.join(tempDir, 'global-data-corrupt-context');
        await registerAndCorruptRegistry('workdir-corrupt-context', globalDataDir);

        const result = await runCLI(['context', '--json'], {
          cwd: tempDir,
          env: { XDG_DATA_HOME: globalDataDir },
        });
        expect(result.exitCode).toBe(0);
        const json = JSON.parse(result.stdout);
        expect(json.root.machineHome).toBeUndefined();
      });
    });
  });

  describe('archive.timing exposure (design externalize-artifacts-archive-timing)', () => {
    it('status --json exposes the configured archive.timing', async () => {
      await fs.writeFile(
        path.join(tempDir, 'rasen', 'config.yaml'),
        'schema: spec-driven\narchive:\n  timing: in-ship\n'
      );
      await createTestChange('archive-timing-configured');

      const result = await runCLI(
        ['status', '--change', 'archive-timing-configured', '--json'],
        { cwd: tempDir }
      );
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.archive).toEqual({
        timing: 'in-ship',
        destination: 'in-repo',
        // canonical() (realpathSync under the hood) only resolves paths that
        // exist on disk; the archive/ subdirectory is never created by
        // `status`, so canonicalizing the full joined path silently falls
        // back to path.resolve() and misses macOS's /var -> /private/var
        // symlink. Production instead canonicalizes the always-existing
        // root first, then joins the subpath onto that — mirror that order.
        archiveDir: path.join(canonical(tempDir), 'rasen', 'changes', 'archive'),
      });
    });

    it('status --json exposes on-merge as the default when unconfigured', async () => {
      await fs.writeFile(path.join(tempDir, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
      await createTestChange('archive-timing-default');

      const result = await runCLI(
        ['status', '--change', 'archive-timing-default', '--json'],
        { cwd: tempDir }
      );
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.archive).toEqual({
        timing: 'on-merge',
        destination: 'in-repo',
        // See the sibling test above for why the root is canonicalized
        // before joining, not the full (non-existent) archive/ path.
        archiveDir: path.join(canonical(tempDir), 'rasen', 'changes', 'archive'),
      });
      // Existing payload fields remain present alongside the new one.
      expect(json.changeName).toBe('archive-timing-default');
      expect(json.schemaName).toBe('spec-driven');
    });

    it('status human output includes an Archive timing line', async () => {
      await fs.writeFile(path.join(tempDir, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
      await createTestChange('archive-timing-text');

      const result = await runCLI(['status', '--change', 'archive-timing-text'], { cwd: tempDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Archive timing: on-merge');
    });
  });

  describe('archive.destination exposure (design externalize-artifacts-archive-dest)', () => {
    it('status --json exposes the configured external destination and its resolved archiveDir', async () => {
      const globalDataDir = path.join(tempDir, 'global-data-archive-dest-external');
      await fs.writeFile(
        path.join(tempDir, 'rasen', 'config.yaml'),
        'schema: spec-driven\narchive:\n  destination: external\n'
      );
      await createTestChange('archive-dest-external');

      // Register the project's machine home first (status is a read-only
      // probe and never mints identity itself — design D2/D6).
      const registerResult = await runCLI(['instructions', 'proposal', '--change', 'archive-dest-external', '--json'], {
        cwd: tempDir,
        env: { XDG_DATA_HOME: globalDataDir },
      });
      expect(registerResult.exitCode).toBe(0);

      const result = await runCLI(
        ['status', '--change', 'archive-dest-external', '--json'],
        { cwd: tempDir, env: { XDG_DATA_HOME: globalDataDir } }
      );
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.archive.destination).toBe('external');
      expect(json.archive.archiveDir).toBeDefined();
      expect(path.isAbsolute(json.archive.archiveDir)).toBe(true);
      expect(json.archive.archiveDir).not.toBe(path.join(tempDir, 'rasen', 'changes', 'archive'));
    });

    it('status --json omits archiveDir for an unresolvable external destination without minting identity', async () => {
      const globalDataDir = path.join(tempDir, 'global-data-archive-dest-unresolvable');
      await fs.writeFile(
        path.join(tempDir, 'rasen', 'config.yaml'),
        'schema: spec-driven\narchive:\n  destination: external\n'
      );
      await createTestChange('archive-dest-unresolved');

      const result = await runCLI(
        ['status', '--change', 'archive-dest-unresolved', '--json'],
        { cwd: tempDir, env: { XDG_DATA_HOME: globalDataDir } }
      );
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.archive.destination).toBe('external');
      expect(json.archive.archiveDir).toBeUndefined();
      // A read-only probe must never mint identity or write to the registry.
      expect(existsSync(path.join(globalDataDir, 'projects'))).toBe(false);
    });

    it('status --json omits archiveDir for the prune destination', async () => {
      await fs.writeFile(
        path.join(tempDir, 'rasen', 'config.yaml'),
        'schema: spec-driven\narchive:\n  destination: prune\n'
      );
      await createTestChange('archive-dest-prune');

      const result = await runCLI(
        ['status', '--change', 'archive-dest-prune', '--json'],
        { cwd: tempDir }
      );
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.archive).toEqual({ timing: 'on-merge', destination: 'prune' });
    });

    it('status human output includes an Archive destination line', async () => {
      await fs.writeFile(path.join(tempDir, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
      await createTestChange('archive-dest-text');

      const result = await runCLI(['status', '--change', 'archive-dest-text'], { cwd: tempDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Archive destination: in-repo');
    });
  });

  describe('help text', () => {
    it('status command help shows description', async () => {
      const result = await runCLI(['status', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Display artifact completion status');
    });

    it('instructions command help shows description', async () => {
      const result = await runCLI(['instructions', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Output enriched instructions');
    });

    it('templates command help shows description', async () => {
      const result = await runCLI(['templates', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Show resolved template paths');
    });

    it('new command help shows description', async () => {
      const result = await runCLI(['new', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Create new items');
    });
  });

  describe('experimental command (deprecated alias for init)', () => {
    it('shows deprecation notice', async () => {
      const result = await runCLI(['experimental', '--tool', 'claude'], { cwd: tempDir });
      // May succeed or fail depending on setup, but should show deprecation notice
      const output = getOutput(result);
      expect(output).toContain('deprecated');
    });

    it('errors for unknown tool', async () => {
      const result = await runCLI(['experimental', '--tool', 'unknown-tool'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain('Invalid tool(s): unknown-tool');
    });

    it('errors for tool without skillsDir', async () => {
      // Using 'agents' which doesn't have skillsDir configured
      const result = await runCLI(['experimental', '--tool', 'agents'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain('Invalid tool(s): agents');
    });

    it('creates skills for Claude tool', async () => {
      const result = await runCLI(['experimental', '--tool', 'claude'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);
      const output = normalizePaths(getOutput(result));
      expect(output).toContain('Claude Code');
      expect(output).toContain('.claude/');

      // Verify skill files were created
      const skillFile = path.join(tempDir, '.claude', 'skills', 'rasen-explore', 'SKILL.md');
      const stat = await fs.stat(skillFile);
      expect(stat.isFile()).toBe(true);
    });

    it('creates skills for Codex tool', async () => {
      const codexHome = path.join(tempDir, '.codex-home');
      const result = await runCLI(['experimental', '--tool', 'codex'], {
        cwd: tempDir,
        env: { CODEX_HOME: codexHome },
      });
      expect(result.exitCode).toBe(0);
      const output = normalizePaths(getOutput(result));
      expect(output).toContain('Codex');
      expect(output).toContain('.codex/');

      // Verify skill files were created
      const skillFile = path.join(tempDir, '.codex', 'skills', 'rasen-explore', 'SKILL.md');
      const stat = await fs.stat(skillFile);
      expect(stat.isFile()).toBe(true);

      // Skills-only delivery (command-generation retired): no command file
      // is written under CODEX_HOME/prompts for any tool, including Codex.
      const commandFile = path.join(codexHome, 'prompts', 'rasen-explore.md');
      await expect(fs.access(commandFile)).rejects.toThrow();
    });

    it('rejects Cursor tool as recognized but not yet adapted', async () => {
      const result = await runCLI(['experimental', '--tool', 'cursor'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain('recognized but not yet adapted');
    });

    it('rejects Windsurf tool as recognized but not yet adapted', async () => {
      const result = await runCLI(['experimental', '--tool', 'windsurf'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain('recognized but not yet adapted');
    });
  });

  describe('project config integration', () => {
    describe('new change uses config schema', () => {
      it('creates change with schema from project config', async () => {
        // Create project config with spec-driven schema
        // Note: changesDir is already at tempDir/rasen/changes (created in beforeEach)
        await fs.writeFile(
          path.join(tempDir, 'rasen', 'config.yaml'),
          'schema: spec-driven\n'
        );

        // Create a new change without specifying schema
        const result = await runCLI(['new', 'change', 'test-change'], { cwd: tempDir, timeoutMs: 30000 });
        expect(result.exitCode).toBe(0);

        // Verify the change was created with spec-driven schema
        const metadataPath = path.join(changesDir, 'test-change', '.openspec.yaml');
        const metadata = await fs.readFile(metadataPath, 'utf-8');
        expect(metadata).toContain('schema: spec-driven');
      }, 60000);

      it('CLI schema overrides config schema', async () => {
        // Create project config with spec-driven schema
        // Note: openspec directory already exists (from changesDir creation in beforeEach)
        await fs.writeFile(
          path.join(tempDir, 'rasen', 'config.yaml'),
          'schema: spec-driven\n'
        );

        // Create change with explicit schema
        const result = await runCLI(
          ['new', 'change', 'override-test', '--schema', 'spec-driven'],
          { cwd: tempDir, timeoutMs: 30000 }
        );
        expect(result.exitCode).toBe(0);

        // Verify the change uses the CLI-specified schema
        const metadataPath = path.join(changesDir, 'override-test', '.openspec.yaml');
        const metadata = await fs.readFile(metadataPath, 'utf-8');
        expect(metadata).toContain('schema: spec-driven');
      }, 60000);
    });

    describe('instructions command with config', () => {
      it('injects context and rules from config into instructions', async () => {
        // Create project config with context and rules
        // Note: openspec directory already exists (from changesDir creation in beforeEach)
        await fs.writeFile(
          path.join(tempDir, 'rasen', 'config.yaml'),
          `schema: spec-driven
context: |
  Tech stack: TypeScript, React
  API style: RESTful
rules:
  proposal:
    - Include rollback plan
    - Identify affected teams
`
        );

        // Create a test change
        await createTestChange('config-test');

        // Get instructions for proposal
        const result = await runCLI(
          ['instructions', 'proposal', '--change', 'config-test'],
          { cwd: tempDir, timeoutMs: 30000 }
        );
        expect(result.exitCode).toBe(0);

        // Verify context is injected
        expect(result.stdout).toContain('Tech stack: TypeScript, React');
        expect(result.stdout).toContain('API style: RESTful');

        // Verify rules are injected for proposal
        expect(result.stdout).toContain('Include rollback plan');
        expect(result.stdout).toContain('Identify affected teams');
      }, 60000);

      it('does not inject rules for non-matching artifact', async () => {
        // Create project config with rules only for proposal
        // Note: openspec directory already exists (from changesDir creation in beforeEach)
        await fs.writeFile(
          path.join(tempDir, 'rasen', 'config.yaml'),
          `schema: spec-driven
rules:
  proposal:
    - Include rollback plan
`
        );

        // Create a test change
        await createTestChange('non-matching-test');

        // Get instructions for design (not proposal)
        const result = await runCLI(
          ['instructions', 'design', '--change', 'non-matching-test'],
          { cwd: tempDir, timeoutMs: 30000 }
        );
        expect(result.exitCode).toBe(0);

        // Verify rules are NOT injected for design
        expect(result.stdout).not.toContain('Include rollback plan');
      }, 60000);
    });

    describe('backwards compatibility', () => {
      it('existing changes work without config file', async () => {
        // Create change without any config file
        await createTestChange('no-config-change', ['proposal']);

        // Status command should work
        const statusResult = await runCLI(
          ['status', '--change', 'no-config-change'],
          { cwd: tempDir, timeoutMs: 30000 }
        );
        expect(statusResult.exitCode).toBe(0);
        expect(statusResult.stdout).toContain('no-config-change');
        expect(statusResult.stdout).toContain('spec-driven'); // Default schema

        // Instructions command should work
        const instrResult = await runCLI(
          ['instructions', 'design', '--change', 'no-config-change'],
          { cwd: tempDir, timeoutMs: 30000 }
        );
        expect(instrResult.exitCode).toBe(0);
        expect(instrResult.stdout).toContain('<artifact');
      }, 60000);

      it('changes with metadata work without config file', async () => {
        // Create change with explicit schema in metadata
        const changeDir = await createTestChange('metadata-only-change');
        await fs.writeFile(
          path.join(changeDir, '.openspec.yaml'),
          'schema: spec-driven\ncreated: "2025-01-05"\n'
        );

        // Status should use schema from metadata
        const result = await runCLI(
          ['status', '--change', 'metadata-only-change'],
          { cwd: tempDir, timeoutMs: 30000 }
        );
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('spec-driven');
      }, 60000);
    });

    describe('config changes reflected immediately', () => {
      it('config changes are reflected without restart', async () => {
        // Create initial config
        // Note: openspec directory already exists (from changesDir creation in beforeEach)
        await fs.writeFile(
          path.join(tempDir, 'rasen', 'config.yaml'),
          `schema: spec-driven
context: Initial context
`
        );

        // Create a test change
        await createTestChange('immediate-test');

        // Get instructions - should have initial context
        const result1 = await runCLI(
          ['instructions', 'proposal', '--change', 'immediate-test'],
          { cwd: tempDir, timeoutMs: 30000 }
        );
        expect(result1.exitCode).toBe(0);
        expect(result1.stdout).toContain('Initial context');

        // Update config
        await fs.writeFile(
          path.join(tempDir, 'rasen', 'config.yaml'),
          `schema: spec-driven
context: Updated context
`
        );

        // Get instructions again - should have updated context
        const result2 = await runCLI(
          ['instructions', 'proposal', '--change', 'immediate-test'],
          { cwd: tempDir, timeoutMs: 30000 }
        );
        expect(result2.exitCode).toBe(0);
        expect(result2.stdout).toContain('Updated context');
        expect(result2.stdout).not.toContain('Initial context');
      }, 60000);
    });
  });
});
