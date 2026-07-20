import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { runCLI } from '../helpers/run-cli.js';
import { scaffoldWorkflow } from '../../src/core/workflow-library.js';

describe('top-level validate command', () => {
  const projectRoot = process.cwd();
  const testDir = path.join(projectRoot, 'test-validate-command-tmp');
  const changesDir = path.join(testDir, 'rasen', 'changes');
  const specsDir = path.join(testDir, 'rasen', 'specs');

  beforeEach(async () => {
    await fs.mkdir(changesDir, { recursive: true });
    await fs.mkdir(specsDir, { recursive: true });

    // Create a valid spec
    const specContent = [
      '## Purpose',
      'This spec ensures the validation harness exercises a deterministic alpha module for automated tests.',
      '',
      '## Requirements',
      '',
      '### Requirement: Alpha module SHALL produce deterministic output',
      'The alpha module SHALL produce a deterministic response for validation.',
      '',
      '#### Scenario: Deterministic alpha run',
      '- **GIVEN** a configured alpha module',
      '- **WHEN** the module runs the default flow',
      '- **THEN** the output matches the expected fixture result',
    ].join('\n');
    await fs.mkdir(path.join(specsDir, 'alpha'), { recursive: true });
    await fs.writeFile(path.join(specsDir, 'alpha', 'spec.md'), specContent, 'utf-8');

    // Create a simple change with bullets (parser supports this)
    const changeContent = `# Test Change\n\n## Why\nBecause reasons that are sufficiently long for validation.\n\n## What Changes\n- **alpha:** Add something`;
    await fs.mkdir(path.join(changesDir, 'c1'), { recursive: true });
    await fs.writeFile(path.join(changesDir, 'c1', 'proposal.md'), changeContent, 'utf-8');
    const deltaContent = [
      '## ADDED Requirements',
      '### Requirement: Validator SHALL support alpha change deltas',
      'The validator SHALL accept deltas provided by the test harness.',
      '',
      '#### Scenario: Apply alpha delta',
      '- **GIVEN** the test change delta',
      '- **WHEN** rasen validate runs',
      '- **THEN** the validator reports the change as valid',
    ].join('\n');
    const c1DeltaDir = path.join(changesDir, 'c1', 'specs', 'alpha');
    await fs.mkdir(c1DeltaDir, { recursive: true });
    await fs.writeFile(path.join(c1DeltaDir, 'spec.md'), deltaContent, 'utf-8');

    // Duplicate name for ambiguity test
    await fs.mkdir(path.join(changesDir, 'dup'), { recursive: true });
    await fs.writeFile(path.join(changesDir, 'dup', 'proposal.md'), changeContent, 'utf-8');
    const dupDeltaDir = path.join(changesDir, 'dup', 'specs', 'dup');
    await fs.mkdir(dupDeltaDir, { recursive: true });
    await fs.writeFile(path.join(dupDeltaDir, 'spec.md'), deltaContent, 'utf-8');
    await fs.mkdir(path.join(specsDir, 'dup'), { recursive: true });
    await fs.writeFile(path.join(specsDir, 'dup', 'spec.md'), specContent, 'utf-8');
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('prints a helpful hint when no args in non-interactive mode', async () => {
    const result = await runCLI(['validate'], { cwd: testDir });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Nothing to validate. Try one of:');
  });

  it('validates all with --all and outputs JSON summary', async () => {
    const result = await runCLI(['validate', '--all', '--json'], { cwd: testDir });
    expect(result.exitCode).toBe(0);
    const output = result.stdout.trim();
    expect(output).not.toBe('');
    const json = JSON.parse(output);
    expect(Array.isArray(json.items)).toBe(true);
    expect(json.summary?.totals?.items).toBeDefined();
    expect(json.version).toBe('1.0');
  });

  it('validates only specs with --specs and respects --concurrency', async () => {
    const result = await runCLI(['validate', '--specs', '--json', '--concurrency', '1'], { cwd: testDir });
    expect(result.exitCode).toBe(0);
    const output = result.stdout.trim();
    expect(output).not.toBe('');
    const json = JSON.parse(output);
    expect(json.items.every((i: any) => i.type === 'spec')).toBe(true);
  });

  it('errors on ambiguous item names and suggests type override', async () => {
    const result = await runCLI(['validate', 'dup'], { cwd: testDir });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Ambiguous item');
  });

  it('accepts change proposals saved with CRLF line endings', async () => {
    const changeId = 'crlf-change';
    const toCrlf = (segments: string[]) => segments.join('\n').replace(/\n/g, '\r\n');

    const crlfContent = toCrlf([
      '# CRLF Proposal',
      '',
      '## Why',
      'This change verifies validation works with Windows line endings.',
      '',
      '## What Changes',
      '- **alpha:** Ensure validation passes on CRLF files',
    ]);

    await fs.mkdir(path.join(changesDir, changeId), { recursive: true });
    await fs.writeFile(path.join(changesDir, changeId, 'proposal.md'), crlfContent, 'utf-8');

    const deltaContent = toCrlf([
      '## ADDED Requirements',
      '### Requirement: Parser SHALL accept CRLF change proposals',
      'The parser SHALL accept CRLF change proposals without manual edits.',
      '',
      '#### Scenario: Validate CRLF change',
      '- **GIVEN** a change proposal saved with CRLF line endings',
      '- **WHEN** a developer runs rasen validate on the proposal',
      '- **THEN** validation succeeds without section errors',
    ]);

    const deltaDir = path.join(changesDir, changeId, 'specs', 'alpha');
    await fs.mkdir(deltaDir, { recursive: true });
    await fs.writeFile(path.join(deltaDir, 'spec.md'), deltaContent, 'utf-8');

    const result = await runCLI(['validate', changeId], { cwd: testDir });
    expect(result.exitCode).toBe(0);
  });

  // #1182 — validate resolves a change by directory existence (matching
  // status/instructions), not by requiring proposal.md.
  const validDelta = [
    '## ADDED Requirements',
    '### Requirement: Scaffolded change SHALL validate without a proposal',
    'The change SHALL validate by directory existence without a proposal file.',
    '',
    '#### Scenario: Validate scaffolded change',
    '- **GIVEN** a change directory with no proposal.md',
    '- **WHEN** rasen validate runs',
    '- **THEN** the change resolves and its deltas are validated',
  ].join('\n');

  it('resolves and validates a scaffolded change without proposal.md (#1182)', async () => {
    const changeDir = path.join(changesDir, 'scaffolded');
    const deltaDir = path.join(changeDir, 'specs', 'alpha');
    await fs.mkdir(deltaDir, { recursive: true });
    await fs.writeFile(path.join(changeDir, '.openspec.yaml'), 'schema: spec-driven\n', 'utf-8');
    await fs.writeFile(path.join(deltaDir, 'spec.md'), validDelta, 'utf-8');

    const result = await runCLI(['validate', 'scaffolded'], { cwd: testDir });
    expect(result.stderr).not.toContain('Unknown item');
    expect(result.exitCode).toBe(0);
  });

  it('a resolved-but-invalid proposal-less change exits non-zero, not "Unknown item" (#1182)', async () => {
    // Resolves by directory existence, then fails validation (no deltas).
    const changeDir = path.join(changesDir, 'scaffolded-empty');
    await fs.mkdir(changeDir, { recursive: true });
    await fs.writeFile(path.join(changeDir, '.openspec.yaml'), 'schema: spec-driven\n', 'utf-8');

    const result = await runCLI(['validate', 'scaffolded-empty'], { cwd: testDir });
    expect(result.stderr).not.toContain('Unknown item');
    expect(result.exitCode).toBe(1);
  });

  it('includes a sole proposal-less change in --all (not "No items found") (#1182)', async () => {
    const isoRoot = path.join(projectRoot, 'test-validate-iso-tmp');
    const isoChanges = path.join(isoRoot, 'rasen', 'changes');
    const deltaDir = path.join(isoChanges, 'only', 'specs', 'alpha');
    await fs.mkdir(deltaDir, { recursive: true });
    try {
      await fs.writeFile(path.join(isoChanges, 'only', '.openspec.yaml'), 'schema: spec-driven\n', 'utf-8');
      await fs.writeFile(path.join(deltaDir, 'spec.md'), validDelta, 'utf-8');

      const result = await runCLI(['validate', '--all'], { cwd: isoRoot });
      expect(result.stdout + result.stderr).not.toContain('No items found to validate');
      expect(result.exitCode).toBe(0);
    } finally {
      await fs.rm(isoRoot, { recursive: true, force: true });
    }
  });

  it('respects --no-interactive flag passed via CLI', async () => {
    // This test ensures Commander.js --no-interactive flag is correctly parsed
    // and passed to the validate command. The flag sets options.interactive = false
    // (not options.noInteractive = true) due to Commander.js convention.
    const result = await runCLI(['validate', '--specs', '--no-interactive'], {
      cwd: testDir,
      // Don't set OPEN_SPEC_INTERACTIVE to ensure we're testing the flag itself
      env: { ...process.env, OPEN_SPEC_INTERACTIVE: undefined },
    });
    expect(result.exitCode).toBe(0);
    // Should complete without hanging and without prompts
    expect(result.stderr).not.toContain('What would you like to validate?');
  });
});

describe('top-level validate command (pipelines)', () => {
  const projectRoot = process.cwd();
  const testDir = path.join(projectRoot, 'test-validate-pipeline-tmp');
  const pipelinesDir = path.join(testDir, 'rasen', 'pipelines');
  const BUILTIN_NAMES = ['bug-fix', 'full-feature', 'small-feature'];

  function writeProjectPipeline(name: string, content: string): Promise<void> {
    const dir = path.join(pipelinesDir, name);
    return fs
      .mkdir(dir, { recursive: true })
      .then(() => fs.writeFile(path.join(dir, 'pipeline.yaml'), content, 'utf-8'));
  }

  beforeEach(async () => {
    await fs.mkdir(pipelinesDir, { recursive: true });
    // A bare openspec/pipelines/ dir is not a qualifying Rasen root under
    // canonical root selection; give testDir a planning shape so commands
    // resolve it (instead of walking up to the repo root).
    await fs.mkdir(path.join(testDir, 'rasen', 'specs'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'rasen', 'changes'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('reports the three built-ins as valid with --type pipeline (bulk via --pipelines)', async () => {
    const result = await runCLI(['validate', '--pipelines', '--json'], { cwd: testDir });
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.trim());
    const byId: Record<string, any> = {};
    for (const item of json.items) byId[item.id] = item;

    for (const name of BUILTIN_NAMES) {
      expect(byId[name]).toBeDefined();
      expect(byId[name].type).toBe('pipeline');
      expect(byId[name].valid).toBe(true);
      expect(byId[name].issues).toEqual([]);
    }
    expect(json.summary.byType.pipeline.passed).toBeGreaterThanOrEqual(3);
    expect(json.version).toBe('1.0');
  });

  it('includes pipelines under --all', async () => {
    const result = await runCLI(['validate', '--all', '--json'], { cwd: testDir });
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.trim());
    const hasPipeline = json.items.some((i: any) => i.type === 'pipeline');
    expect(hasPipeline).toBe(true);
    expect(json.summary.byType.pipeline).toBeDefined();
  });

  it('validates all pipelines with `--type pipeline` and no item name', async () => {
    const result = await runCLI(['validate', '--type', 'pipeline', '--json'], { cwd: testDir });
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.trim());
    expect(json.items.length).toBeGreaterThanOrEqual(3);
    expect(json.items.every((i: any) => i.type === 'pipeline')).toBe(true);
    expect(json.summary.totals.failed).toBe(0);
  });

  it('reports valid:false for a pipeline with a dangling requires reference', async () => {
    await writeProjectPipeline(
      'broken-deps',
      [
        'name: broken-deps',
        'stages:',
        '  - id: a',
        '    skill: rasen-propose',
        '    requires: [missing-stage]',
      ].join('\n')
    );

    const result = await runCLI(['validate', 'broken-deps', '--type', 'pipeline', '--json'], {
      cwd: testDir,
    });
    expect(result.exitCode).toBe(1);
    const json = JSON.parse(result.stdout.trim());
    const item = json.items[0];
    expect(item.id).toBe('broken-deps');
    expect(item.type).toBe('pipeline');
    expect(item.valid).toBe(false);
    expect(item.issues.length).toBeGreaterThan(0);
    expect(item.issues[0].level).toBe('ERROR');
    expect(item.issues[0].message).toMatch(/missing-stage|does not exist/);
  });

  it('reports valid:false for a pipeline referencing an unknown skill', async () => {
    await writeProjectPipeline(
      'unknown-skill',
      [
        'name: unknown-skill',
        'stages:',
        '  - id: a',
        '    skill: this-skill-does-not-exist',
      ].join('\n')
    );

    const result = await runCLI(['validate', 'unknown-skill', '--type', 'pipeline', '--json'], {
      cwd: testDir,
    });
    expect(result.exitCode).toBe(1);
    const json = JSON.parse(result.stdout.trim());
    const item = json.items[0];
    expect(item.valid).toBe(false);
    expect(item.issues[0].message).toMatch(/unknown skill/);
  });

  it('reports a distinct error for a known workflow skill disabled by the profile', async () => {
    await writeProjectPipeline(
      'disabled-skill',
      [
        'name: disabled-skill',
        'stages:',
        '  - id: apply',
        '    skill: rasen-apply-change',
      ].join('\n')
    );
    const home = path.join(testDir, '.rasen-home');
    await fs.mkdir(home, { recursive: true });
    await fs.writeFile(
      path.join(home, 'config.json'),
      JSON.stringify({ profile: 'custom', delivery: 'both', workflows: ['propose'] })
    );

    const result = await runCLI(
      ['validate', 'disabled-skill', '--type', 'pipeline', '--json'],
      { cwd: testDir, env: { RASEN_HOME: home } }
    );

    expect(result.exitCode).toBe(1);
    const json = JSON.parse(result.stdout.trim());
    expect(json.items[0].issues[0].code).toBe('pipeline_skill_disabled');
    expect(json.items[0].issues[0].message).toMatch(/known but disabled skill/);
    expect(json.items[0].issues[0].message).not.toMatch(/unknown skill/);
  });

  it('enables required user workflow skills through dependency closure', async () => {
    await writeProjectPipeline(
      'dependency-skill',
      [
        'name: dependency-skill',
        'stages:',
        '  - id: base',
        '    skill: rasen-pipeline-base',
      ].join('\n')
    );
    const home = path.join(testDir, '.dependency-home');
    const workflowsDir = path.join(home, 'workflows');
    scaffoldWorkflow('pipeline-base', path.join(workflowsDir, 'pipeline-base'));
    const rootDir = scaffoldWorkflow('pipeline-root', path.join(workflowsDir, 'pipeline-root'));
    const rootManifest = path.join(rootDir, 'workflow.yaml');
    await fs.writeFile(
      rootManifest,
      (await fs.readFile(rootManifest, 'utf8')).replace(
        '  workflows: []',
        '  workflows: [pipeline-base]'
      )
    );
    await fs.writeFile(
      path.join(home, 'config.json'),
      JSON.stringify({ profile: 'custom', delivery: 'skills', workflows: ['pipeline-root'] })
    );

    const result = await runCLI(
      ['validate', 'dependency-skill', '--type', 'pipeline', '--json'],
      { cwd: testDir, env: { RASEN_HOME: home } }
    );

    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.trim());
    expect(json.items[0].valid).toBe(true);
  });
});
