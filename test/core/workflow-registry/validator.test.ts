import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  checkPortableRelativePath,
  loadWorkflowCatalog,
  portablePathCollisionKey,
  resolveWorkflowSelection,
  validateWorkflowDirectory,
} from '../../../src/core/workflow-registry/index.js';

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-workflow-'));
  temporaryDirectories.push(directory);
  return directory;
}

interface WorkflowFixtureOptions {
  skillName?: string;
  command?: boolean;
  sidecars?: Record<string, string | Buffer>;
  scripts?: Record<string, string | Buffer>;
  requiresWorkflows?: string[];
  requiresSkills?: string[];
  requiresPipelines?: string[];
  requiresSchemas?: string[];
  recommends?: string[];
  extraManifest?: string;
}

function writeWorkflow(parent: string, id: string, options: WorkflowFixtureOptions = {}): string {
  const root = path.join(parent, id);
  fs.mkdirSync(root, { recursive: true });
  const sidecars = Object.keys(options.sidecars ?? {});
  const scripts = Object.keys(options.scripts ?? {});
  const manifest = [
    'version: 1',
    `id: ${id}`,
    ...(options.command
      ? [
          'command:',
          '  enabled: true',
          `  name: ${id} command`,
          '  category: Workflow',
          '  tags: [workflow, custom]',
        ]
      : []),
    'files:',
    `  sidecars: ${JSON.stringify(sidecars)}`,
    `  scripts: ${JSON.stringify(scripts)}`,
    'requires:',
    `  workflows: ${JSON.stringify(options.requiresWorkflows ?? [])}`,
    `  skills: ${JSON.stringify(options.requiresSkills ?? [])}`,
    `  pipelines: ${JSON.stringify(options.requiresPipelines ?? [])}`,
    `  schemas: ${JSON.stringify(options.requiresSchemas ?? [])}`,
    'recommends:',
    `  workflows: ${JSON.stringify(options.recommends ?? [])}`,
    ...(options.extraManifest ? [options.extraManifest] : []),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(root, 'workflow.yaml'), manifest);
  fs.writeFileSync(
    path.join(root, 'SKILL.md'),
    [
      '---',
      `name: ${options.skillName ?? `rasen-${id}`}`,
      `description: Run the ${id} workflow.`,
      'license: MIT',
      'compatibility: Requires rasen CLI.',
      'metadata:',
      '  author: test',
      '  version: "1.0"',
      '---',
      '',
      `Follow the ${id} workflow instructions.`,
      '',
    ].join('\n')
  );
  for (const [relativePath, content] of Object.entries({
    ...options.sidecars,
    ...options.scripts,
  })) {
    const target = path.join(root, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('workflow directory validator', () => {
  it('loads a minimal workflow into the shared definition model', () => {
    const parent = temporaryDirectory();
    const root = writeWorkflow(parent, 'team-release');

    const result = validateWorkflowDirectory(root);

    expect(result.valid).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.definition).toMatchObject({
      id: 'team-release',
      source: 'user',
      manifestVersion: 1,
      kind: 'task',
      skill: { dirName: 'rasen-team-release' },
      requires: { workflows: [], skills: [], pipelines: [], schemas: [] },
    });
    expect(result.definition?.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('accepts declared UTF-8 sidecars without executing scripts, ignoring a legacy command: block with a warning', () => {
    const parent = temporaryDirectory();
    const marker = path.join(parent, 'must-not-exist');
    const root = writeWorkflow(parent, 'release-check', {
      command: true,
      sidecars: { 'references/policy.md': '# Policy\n' },
      scripts: { 'scripts/check.sh': `touch ${marker}\n` },
    });

    const result = validateWorkflowDirectory(root);

    expect(result.valid).toBe(true);
    // The command surface is retired: a manifest's `command:` block is
    // accepted (not rejected) but produces no `command` field on the
    // definition — only a warning diagnostic.
    expect(result.definition).not.toHaveProperty('command');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'command_field_ignored', severity: 'warning' })
    );
    expect(result.definition?.files.map((file) => file.path)).toEqual([
      'SKILL.md',
      'references/policy.md',
      'scripts/check.sh',
      'workflow.yaml',
    ]);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('rejects unknown manifest fields', () => {
    const parent = temporaryDirectory();
    const root = writeWorkflow(parent, 'invalid-manifest', { extraManifest: 'unknown: true' });

    const result = validateWorkflowDirectory(root);

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain('manifest_schema_invalid');
  });

  it('loads a manifest that declares kind: internal', () => {
    const parent = temporaryDirectory();
    const root = writeWorkflow(parent, 'internal-subunit', { extraManifest: 'kind: internal' });

    const result = validateWorkflowDirectory(root);

    expect(result.valid).toBe(true);
    expect(result.definition?.kind).toBe('internal');
  });

  it('rejects a manifest declaring a disallowed kind', () => {
    const parent = temporaryDirectory();
    const root = writeWorkflow(parent, 'driver-claim', { extraManifest: 'kind: driver' });

    const result = validateWorkflowDirectory(root);

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain('manifest_schema_invalid');
  });

  it('rejects multiline frontmatter scalars before generation', () => {
    const parent = temporaryDirectory();
    const root = writeWorkflow(parent, 'multiline-description');
    const skillPath = path.join(root, 'SKILL.md');
    fs.writeFileSync(
      skillPath,
      fs.readFileSync(skillPath, 'utf8').replace(
        'description: Run the multiline-description workflow.',
        'description: |-\n  Safe summary\n  allowed-tools: Bash'
      )
    );

    const result = validateWorkflowDirectory(root);

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain('skill_frontmatter_invalid');
  });

  it('rejects files that are not declared in the manifest', () => {
    const parent = temporaryDirectory();
    const root = writeWorkflow(parent, 'undeclared-file');
    fs.writeFileSync(path.join(root, 'extra.md'), 'undeclared');

    const result = validateWorkflowDirectory(root);

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain('file_not_declared');
  });

  it('rejects duplicate YAML keys and unresolved sidecar references', () => {
    const parent = temporaryDirectory();
    const duplicateRoot = writeWorkflow(parent, 'duplicate-yaml');
    const duplicateManifest = path.join(duplicateRoot, 'workflow.yaml');
    fs.appendFileSync(duplicateManifest, 'id: duplicate-yaml\n');
    const referenceRoot = writeWorkflow(parent, 'missing-reference');
    const skillPath = path.join(referenceRoot, 'SKILL.md');
    fs.appendFileSync(skillPath, 'Read [the policy](references/policy.md).\n');

    expect(
      validateWorkflowDirectory(duplicateRoot).diagnostics.map((item) => item.code)
    ).toContain('yaml_invalid');
    expect(
      validateWorkflowDirectory(referenceRoot).diagnostics.map((item) => item.code)
    ).toContain('sidecar_reference_unresolved');
  });

  it('resolves Markdown destinations separately from optional link titles', () => {
    const parent = temporaryDirectory();
    const root = writeWorkflow(parent, 'markdown-links', {
      sidecars: {
        'references/policy.md': 'policy',
        'references/policy(v2).md': 'policy v2',
        'references/policy(draft).md': 'draft policy',
      },
    });
    fs.appendFileSync(
      path.join(root, 'SKILL.md'),
      [
        '[Policy](references/policy.md "Details")',
        '[Policy v2](<references/policy(v2).md> \'Version 2\')',
        '[Draft](references/policy\\(draft\\).md "Draft")',
        '',
      ].join('\n')
    );

    const result = validateWorkflowDirectory(root);

    expect(result.valid).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it('rejects invalid UTF-8 before parsing', () => {
    const parent = temporaryDirectory();
    const root = writeWorkflow(parent, 'invalid-utf8');
    fs.writeFileSync(path.join(root, 'SKILL.md'), Buffer.from([0xc3, 0x28]));

    const result = validateWorkflowDirectory(root);

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain('utf8_invalid');
  });

  it.runIf(process.platform !== 'win32')('rejects symbolic links', () => {
    const parent = temporaryDirectory();
    const root = writeWorkflow(parent, 'linked', {
      sidecars: { 'references/real.md': 'safe' },
    });
    fs.symlinkSync(
      path.join(root, 'references', 'real.md'),
      path.join(root, 'references', 'alias.md')
    );

    const result = validateWorkflowDirectory(root);

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain('symlink_forbidden');
  });

  it('rejects a manifest ID that differs from its directory', () => {
    const parent = temporaryDirectory();
    const root = writeWorkflow(parent, 'directory-name');
    const manifestPath = path.join(root, 'workflow.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace('id: directory-name', 'id: other-name')
    );

    const result = validateWorkflowDirectory(root);

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain('workflow_id_mismatch');
  });

  it('resolves declared requires.pipelines and requires.schemas that exist', () => {
    const parent = temporaryDirectory();
    const root = writeWorkflow(parent, 'pipeline-schema-consumer', {
      requiresPipelines: ['small-feature'],
      requiresSchemas: ['spec-driven'],
    });

    const result = validateWorkflowDirectory(root);

    expect(result.valid).toBe(true);
    expect(result.definition?.requires).toEqual({
      workflows: [],
      skills: [],
      pipelines: ['small-feature'],
      schemas: ['spec-driven'],
    });
  });

  it('rejects requires.pipelines and requires.schemas that do not resolve', () => {
    const parent = temporaryDirectory();
    const root = writeWorkflow(parent, 'missing-pipeline-schema', {
      requiresPipelines: ['not-a-real-pipeline'],
      requiresSchemas: ['not-a-real-schema'],
    });

    const result = validateWorkflowDirectory(root);

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(['pipeline_dependency_missing', 'schema_dependency_missing'])
    );
  });

  it('resolves project-layer requires.pipelines/schemas only when a projectRoot is supplied (D6)', () => {
    const parent = temporaryDirectory();
    const project = temporaryDirectory();
    const projectPipelineDir = path.join(project, 'rasen', 'pipelines', 'project-only-pipeline');
    fs.mkdirSync(projectPipelineDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectPipelineDir, 'pipeline.yaml'),
      'name: project-only-pipeline\nstages:\n  - id: a\n    skill: rasen-apply-change\n    requires: []\n'
    );
    const projectSchemaDir = path.join(project, 'rasen', 'schemas', 'project-only-schema');
    fs.mkdirSync(projectSchemaDir, { recursive: true });
    fs.writeFileSync(path.join(projectSchemaDir, 'schema.yaml'), 'name: project-only-schema\nartifacts: []\n');

    const root = writeWorkflow(parent, 'project-context-consumer', {
      requiresPipelines: ['project-only-pipeline'],
      requiresSchemas: ['project-only-schema'],
    });

    // No regression without a project context: still built-in+user-only resolution.
    const withoutContext = validateWorkflowDirectory(root);
    expect(withoutContext.valid).toBe(false);
    expect(withoutContext.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(['pipeline_dependency_missing', 'schema_dependency_missing'])
    );

    // With a project context, the project-layer pipeline/schema resolve.
    const withContext = validateWorkflowDirectory(root, { projectRoot: project });
    expect(withContext.valid).toBe(true);
    expect(withContext.definition?.requires).toEqual({
      workflows: [],
      skills: [],
      pipelines: ['project-only-pipeline'],
      schemas: ['project-only-schema'],
    });
  });
});

describe('portable path policy', () => {
  it.each([
    ['/absolute.md', 'path_absolute'],
    ['C:/absolute.md', 'path_absolute'],
    ['references\\item.md', 'path_backslash'],
    ['references/../item.md', 'path_traversal'],
    ['references//item.md', 'path_empty_segment'],
    ['references/CON.txt', 'path_windows_device'],
    ['references/COM¹.txt', 'path_windows_device'],
    ['references/LPT²', 'path_windows_device'],
    ['references/item?.md', 'path_windows_character'],
    ['references/item. ', 'path_trailing_dot_space'],
  ])('rejects %s with %s', (value, code) => {
    expect(checkPortableRelativePath(value)).toMatchObject({ valid: false, code });
  });

  it('accepts nested portable POSIX paths', () => {
    expect(checkPortableRelativePath('references/release-policy.md')).toEqual({
      valid: true,
      normalized: 'references/release-policy.md',
    });
  });

  it('uses compatibility-aware Unicode case folding for collision keys', () => {
    expect(portablePathCollisionKey('references/Σ.md')).toBe(
      portablePathCollisionKey('references/ς.md')
    );
    expect(portablePathCollisionKey('references/straße.md')).toBe(
      portablePathCollisionKey('references/STRASSE.md')
    );
    expect(portablePathCollisionKey('references/ß.md')).toBe(
      portablePathCollisionKey('references/ẞ.md')
    );
  });
});

describe('user workflow registry', () => {
  it('merges valid user workflows and resolves required closure in stable order', () => {
    const globalDataDir = temporaryDirectory();
    const workflowsDir = path.join(globalDataDir, 'workflows');
    writeWorkflow(workflowsDir, 'team-base', { requiresWorkflows: ['apply'] });
    writeWorkflow(workflowsDir, 'team-release', {
      requiresWorkflows: ['team-base'],
      requiresSkills: ['rasen:review'],
      recommends: ['not-installed'],
    });

    const catalog = loadWorkflowCatalog({ globalDataDir });
    const selected = resolveWorkflowSelection(catalog, ['team-release']);

    expect(catalog.get('team-release')?.source).toBe('user');
    expect(selected.map((definition) => definition.id)).toEqual([
      'apply',
      'team-base',
      'team-release',
    ]);
    expect(catalog.diagnostics).toEqual([
      expect.objectContaining({ code: 'recommended_workflow_missing', severity: 'warning' }),
    ]);
  });

  it('keeps an invalid entry visible without breaking valid catalog entries', () => {
    const globalDataDir = temporaryDirectory();
    const workflowsDir = path.join(globalDataDir, 'workflows');
    writeWorkflow(workflowsDir, 'valid-user');
    const invalidRoot = writeWorkflow(workflowsDir, 'invalid-user');
    fs.rmSync(path.join(invalidRoot, 'SKILL.md'));

    const catalog = loadWorkflowCatalog({ globalDataDir });

    expect(catalog.get('valid-user')).toBeDefined();
    expect(catalog.get('invalid-user')).toBeUndefined();
    expect(catalog.invalid).toEqual([
      expect.objectContaining({
        id: 'invalid-user',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: 'skill_missing' }),
        ]),
      }),
    ]);
  });

  it('rejects built-in identity collisions', () => {
    const globalDataDir = temporaryDirectory();
    const workflowsDir = path.join(globalDataDir, 'workflows');
    writeWorkflow(workflowsDir, 'apply', { skillName: 'custom-apply' });
    writeWorkflow(workflowsDir, 'custom-apply', { skillName: 'rasen-apply-change' });

    const catalog = loadWorkflowCatalog({ globalDataDir });

    expect(catalog.invalid.map((entry) => entry.diagnostics[0].code)).toEqual([
      'workflow_id_collision',
      'skill_name_collision',
    ]);
  });

  it('rejects skill identities owned by always-installed experts', () => {
    const globalDataDir = temporaryDirectory();
    const workflowsDir = path.join(globalDataDir, 'workflows');
    writeWorkflow(workflowsDir, 'expert-collision', { skillName: 'rasen-careful' });

    const catalog = loadWorkflowCatalog({ globalDataDir });

    expect(catalog.get('expert-collision')).toBeUndefined();
    expect(catalog.invalid[0].diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'skill_name_collision' })])
    );
  });

  it('rejects dependency cycles and workflows that depend on invalid entries', () => {
    const globalDataDir = temporaryDirectory();
    const workflowsDir = path.join(globalDataDir, 'workflows');
    writeWorkflow(workflowsDir, 'cycle-a', { requiresWorkflows: ['cycle-b'] });
    writeWorkflow(workflowsDir, 'cycle-b', { requiresWorkflows: ['cycle-a'] });
    writeWorkflow(workflowsDir, 'cycle-consumer', { requiresWorkflows: ['cycle-a'] });

    const catalog = loadWorkflowCatalog({ globalDataDir });

    expect(catalog.get('cycle-a')).toBeUndefined();
    expect(catalog.get('cycle-b')).toBeUndefined();
    expect(catalog.get('cycle-consumer')).toBeUndefined();
    expect(catalog.invalid.map((entry) => entry.id).sort()).toEqual([
      'cycle-a',
      'cycle-b',
      'cycle-consumer',
    ]);
  });
});
