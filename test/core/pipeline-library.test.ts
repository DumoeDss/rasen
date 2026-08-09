import * as fs from 'node:fs';
import fsDefault from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createBlankPipelineDefinitionV2,
  deletePipeline,
  exportPipeline,
  importPipelinePackage,
  PipelineLibraryError,
  savePipeline,
  scaffoldPipeline,
  serializeAuthoredPipelineDefinition,
  validatePipelineInput,
} from '../../src/core/pipeline-library.js';
import {
  createPipelinePackage,
  decodePackage,
  encodePackage,
  type PipelinePackage,
  type PipelinePackageInput,
} from '../../src/core/workflow-package/index.js';
import {
  getUserPipelinesDir,
  createCapabilityCatalogSnapshot,
  createProductionCapabilityCatalogSnapshot,
  EcpDefinitionModule,
  listPipelines,
  loadPipelineByName,
  parsePipeline,
  PIPELINE_DEFINITION_VERSION,
} from '../../src/core/pipeline-registry/index.js';
import { loadWorkflowCatalog } from '../../src/core/workflow-registry/index.js';
import { scaffoldWorkflow, importWorkflow } from '../../src/core/workflow-library.js';

const TEST_ATOMIC_EXECUTION = {
  version: 1 as const,
  role: 'implementer' as const,
  workspace: { access: 'write' as const },
};

function pipelineInput(name: string, extra: string[] = []): PipelinePackageInput {
  return {
    name,
    files: [
      {
        path: 'pipeline.yaml',
        content: [
          `name: ${name}`,
          'stages:',
          '  - id: implement',
          '    skill: rasen-apply-change',
          '    role: implementer',
          '    requires: []',
          ...extra,
          '',
        ].join('\n'),
      },
    ],
  };
}

function packagePath(home: string, name: string, extra: string[] = []): string {
  const packageValue = createPipelinePackage([name], [pipelineInput(name, extra)]);
  const dest = path.join(home, `${name}.rasenpkg`);
  fs.writeFileSync(dest, encodePackage(packageValue));
  return dest;
}

describe('pipeline library lifecycle', () => {
  let home: string;
  let originalHome: string | undefined;
  const originalCwd = process.cwd();
  const cleanup: string[] = [];

  beforeEach(() => {
    originalHome = process.env.RASEN_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-pipeline-home-'));
    cleanup.push(home);
    process.env.RASEN_HOME = home;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalHome === undefined) delete process.env.RASEN_HOME;
    else process.env.RASEN_HOME = originalHome;
    for (const directory of cleanup.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('imports a pipeline package into the user layer and exports it back', async () => {
    const source = packagePath(home, 'solo');

    const result = await importPipelinePackage(source);
    expect(result.imported).toEqual(['solo']);
    expect(listPipelines()).toContain('solo');
    expect(fs.existsSync(path.join(getUserPipelinesDir(), 'solo', 'pipeline.yaml'))).toBe(true);

    const dest = path.join(home, 'solo-export.rasenpkg');
    const exportedPath = await exportPipeline('solo', dest);
    expect(exportedPath).toBe(path.resolve(dest));
    expect(await validatePipelineInput(exportedPath)).toMatchObject({ valid: true, kind: 'package', packageKind: 'pipeline' });
  });

  it('refuses to overwrite an already-installed pipeline without --force, and allows it with --force', async () => {
    const source = packagePath(home, 'dup');
    await importPipelinePackage(source);

    await expect(importPipelinePackage(source)).rejects.toMatchObject({
      code: 'pipeline_already_exists',
    });
    await expect(importPipelinePackage(source, { overwrite: true })).resolves.toMatchObject({
      imported: ['dup'],
    });
  });

  it('serializes two concurrent imports of the same pipeline name via .pipelines.lock/.workflows.lock: one wins, one fails cleanly, no corruption', async () => {
    // Both packages install under the SAME pipeline name ("contended"),
    // forcing the two concurrent imports to contend on the same target.
    const contendedA = createPipelinePackage(['contended'], [pipelineInput('contended', ['    condition: from-a'])]);
    const contendedB = createPipelinePackage(['contended'], [pipelineInput('contended', ['    condition: from-b'])]);
    const sourceA = path.join(home, 'contended-a.rasenpkg');
    const sourceB = path.join(home, 'contended-b.rasenpkg');
    fs.writeFileSync(sourceA, encodePackage(contendedA));
    fs.writeFileSync(sourceB, encodePackage(contendedB));

    const results = await Promise.allSettled([
      importPipelinePackage(sourceA),
      importPipelinePackage(sourceB),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'pipeline_already_exists',
    });

    // No corruption: the installed pipeline.yaml is exactly ONE of the two
    // candidates' content in full, never a mix of both.
    const installedContent = fs.readFileSync(
      path.join(getUserPipelinesDir(), 'contended', 'pipeline.yaml'),
      'utf8'
    );
    const wonFromA = installedContent.includes('from-a');
    const wonFromB = installedContent.includes('from-b');
    expect(wonFromA !== wonFromB).toBe(true); // exactly one, never both, never neither
    expect(listPipelines()).toContain('contended');
  });

  it('imports multiple pipelines atomically: a conflict on one leaves none newly installed', async () => {
    const first = packagePath(home, 'multi-a');
    await importPipelinePackage(first);

    const packageValue = createPipelinePackage(
      ['multi-a', 'multi-b'],
      [pipelineInput('multi-a'), pipelineInput('multi-b')]
    );
    const conflictingSource = path.join(home, 'multi.rasenpkg');
    fs.writeFileSync(conflictingSource, encodePackage(packageValue));

    await expect(importPipelinePackage(conflictingSource)).rejects.toMatchObject({
      code: 'pipeline_already_exists',
    });
    // multi-b must NOT have been installed even though it had no conflict —
    // the whole import is one transaction.
    expect(listPipelines()).not.toContain('multi-b');
  });

  it('validates a pipeline draft directory and a package without requiring installation', async () => {
    const draftParent = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-pipeline-draft-'));
    cleanup.push(draftParent);
    const draft = scaffoldPipeline('draft-pipe', path.join(draftParent, 'draft-pipe'));

    expect(await validatePipelineInput(draft)).toMatchObject({ valid: true, kind: 'directory', name: 'draft-pipe' });

    const source = packagePath(home, 'validate-only');
    expect(await validatePipelineInput(source)).toMatchObject({ valid: true, kind: 'package', packageKind: 'pipeline' });
    expect(listPipelines()).not.toContain('validate-only');
  });

  it('scaffolds the canonical blank v2 envelope without a hidden stage', () => {
    const draftParent = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-pipeline-v2-scaffold-'));
    cleanup.push(draftParent);
    const draft = scaffoldPipeline('v2-draft', path.join(draftParent, 'v2-draft'));
    const manifest = fs.readFileSync(path.join(draft, 'pipeline.yaml'), 'utf8');

    expect(manifest).not.toContain('\r');
    expect(manifest.endsWith('\n')).toBe(true);
    const prepared = EcpDefinitionModule.prepare(
      manifest,
      createCapabilityCatalogSnapshot([])
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.value.authoredSource).toEqual(
      createBlankPipelineDefinitionV2('v2-draft', 'pipeline-init')
    );
    expect(prepared.value.authoredSource).toMatchObject({
      version: 2,
      id: 'pipeline:v2-draft',
      sourceId: 'pipeline-init:v2-draft',
      name: 'v2-draft',
      inputs: [],
      artifacts: [],
      outcomes: [],
      declarations: [],
      root: { nodes: [], connections: [] },
    });
  });

  it('canonically serializes equivalent JSON/YAML v2 sources with digest parity', () => {
    const source = {
      version: 2 as const,
      id: 'pipeline:canonical-v2',
      sourceId: 'fixture:canonical-v2',
      name: 'canonical-v2',
      inputs: [
        { name: 'zeta', type: 'text/plain' },
        { name: 'alpha', type: 'text/plain', required: true },
      ],
      artifacts: [
        { name: 'gamma', type: 'artifact/gamma' },
        { name: 'delta', type: 'artifact/delta' },
      ],
      outcomes: ['zeta', 'alpha'],
      declarations: [],
      root: {
        nodes: [
          { id: 'zeta', kind: 'Finish' as const, outcome: 'zeta' },
          { id: 'alpha', kind: 'Finish' as const, outcome: 'alpha' },
        ],
        connections: [],
        unexposedGraphField: { retained: true },
      },
      unexposedDefinitionField: { retained: true },
    };
    const jsonPrepared = EcpDefinitionModule.prepare(
      JSON.stringify(source),
      createCapabilityCatalogSnapshot([])
    );
    const yamlPrepared = EcpDefinitionModule.prepare(
      [
        'version: 2',
        'name: canonical-v2',
        'sourceId: fixture:canonical-v2',
        'id: pipeline:canonical-v2',
        'outcomes: [zeta, alpha]',
        'artifacts:',
        '  - { name: gamma, type: artifact/gamma }',
        '  - { name: delta, type: artifact/delta }',
        'inputs:',
        '  - { name: zeta, type: text/plain }',
        '  - { name: alpha, type: text/plain, required: true }',
        'declarations: []',
        'root:',
        '  unexposedGraphField: { retained: true }',
        '  connections: []',
        '  nodes:',
        '    - { id: zeta, kind: Finish, outcome: zeta }',
        '    - { id: alpha, kind: Finish, outcome: alpha }',
        'unexposedDefinitionField: { retained: true }',
        '',
      ].join('\r\n'),
      createCapabilityCatalogSnapshot([])
    );
    expect(jsonPrepared.ok).toBe(true);
    expect(yamlPrepared.ok).toBe(true);
    if (!jsonPrepared.ok || !yamlPrepared.ok) return;

    const jsonSerialized = serializeAuthoredPipelineDefinition(jsonPrepared.value);
    const yamlSerialized = serializeAuthoredPipelineDefinition(yamlPrepared.value);
    expect(jsonSerialized).toBe(yamlSerialized);
    expect(jsonSerialized).not.toContain('\r');
    expect(jsonSerialized.endsWith('\n')).toBe(true);

    const roundTrip = EcpDefinitionModule.prepare(
      jsonSerialized,
      createCapabilityCatalogSnapshot([])
    );
    expect(roundTrip.ok).toBe(true);
    if (!roundTrip.ok) return;
    expect(roundTrip.value.authoredSource).toMatchObject({
      inputs: [{ name: 'alpha' }, { name: 'zeta' }],
      artifacts: [{ name: 'delta' }, { name: 'gamma' }],
      outcomes: ['alpha', 'zeta'],
      root: {
        nodes: [{ id: 'alpha' }, { id: 'zeta' }],
        unexposedGraphField: { retained: true },
      },
      unexposedDefinitionField: { retained: true },
    });
    expect(roundTrip.value.digests).toEqual(jsonPrepared.value.digests);
  });

  it('keeps LF/CRLF v2 meaning and package content identical through native path helpers', async () => {
    const name = 'cross-platform-v2';
    const definition = {
      version: 2 as const,
      id: `pipeline:${name}`,
      sourceId: `fixture:${name}`,
      name,
      inputs: [],
      artifacts: [],
      outcomes: ['done'],
      declarations: [],
      root: {
        nodes: [{ id: 'finish', kind: 'Finish' as const, outcome: 'done' }],
        connections: [],
      },
    };
    const fixtureDirectory = path.resolve(home, 'path-fixtures');
    fs.mkdirSync(fixtureDirectory, { recursive: true });
    const lfPath = path.join(fixtureDirectory, 'posix-lf.yaml');
    const crlfPath = path.resolve(fixtureDirectory, 'windows-crlf.yaml');
    const canonical = serializeAuthoredPipelineDefinition(definition);
    fs.writeFileSync(lfPath, canonical, 'utf8');
    fs.writeFileSync(crlfPath, canonical.replace(/\n/g, '\r\n'), 'utf8');

    const catalog = createCapabilityCatalogSnapshot([]);
    const lf = EcpDefinitionModule.prepare(fs.readFileSync(lfPath, 'utf8'), catalog);
    const crlf = EcpDefinitionModule.prepare(fs.readFileSync(crlfPath, 'utf8'), catalog);
    expect(lf.ok).toBe(true);
    expect(crlf.ok).toBe(true);
    if (!lf.ok || !crlf.ok) return;
    expect(serializeAuthoredPipelineDefinition(lf.value)).toBe(canonical);
    expect(serializeAuthoredPipelineDefinition(crlf.value)).toBe(canonical);
    expect(crlf.value.authoredSource).toEqual(lf.value.authoredSource);
    expect(crlf.value.digests).toEqual(lf.value.digests);

    await savePipeline(name, crlfPath);
    const packageDestination = path.resolve(
      home,
      'packages',
      '..',
      'packages',
      `${name}.rasenpkg`
    );
    await exportPipeline(name, packageDestination);
    const packageValue = decodePackage(
      fs.readFileSync(packageDestination),
      'pipeline'
    ) as PipelinePackage;
    const packagedManifest = packageValue.pipelines[0]!.files.find(
      (file) => file.path === 'pipeline.yaml'
    )!;
    expect(packagedManifest.content).toBe(canonical);
    expect(packagedManifest.content).not.toContain('\r');
    const packaged = EcpDefinitionModule.prepare(packagedManifest.content, catalog);
    expect(packaged.ok).toBe(true);
    if (packaged.ok) {
      expect(packaged.value.authoredSource).toEqual(lf.value.authoredSource);
      expect(packaged.value.digests).toEqual(lf.value.digests);
    }
    expect(path.resolve(packageDestination)).toBe(packageDestination);
  });

  it('refuses to export a pipeline that is not in the user layer', async () => {
    await expect(exportPipeline('small-feature', path.join(home, 'small-feature.rasenpkg'))).rejects.toEqual(
      expect.objectContaining<Partial<PipelineLibraryError>>({ code: 'pipeline_not_found' })
    );
  });

  it('rejects a path-traversal name before ever touching the filesystem for it', async () => {
    // A secret file living OUTSIDE the user pipelines directory, at a
    // location a `../`-laden name could reach if `exportPipeline` ever
    // built a path from `name` before validating it.
    const secretDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-pipeline-secret-'));
    cleanup.push(secretDir);
    fs.writeFileSync(path.join(secretDir, 'pipeline.yaml'), 'name: secret\nstages: []\n');
    fs.writeFileSync(path.join(secretDir, 'do-not-read-me.txt'), 'top secret contents');

    const traversalName = path.relative(getUserPipelinesDir(), secretDir);
    await expect(exportPipeline(traversalName, path.join(home, 'traversal.rasenpkg'))).rejects.toEqual(
      expect.objectContaining<Partial<PipelineLibraryError>>({ code: 'pipeline_not_found' })
    );
    // Nothing should have been written from that directory's content.
    expect(fs.existsSync(path.join(home, 'traversal.rasenpkg'))).toBe(false);
  });

  it('blocks delete while another installed pipeline decompose-references it, then allows --force', async () => {
    await importPipelinePackage(packagePath(home, 'child-pipe'));
    const parentPackage = createPipelinePackage(
      ['parent-pipe'],
      [
        {
          name: 'parent-pipe',
          files: [
            {
              path: 'pipeline.yaml',
              content: [
                'name: parent-pipe',
                'stages:',
                '  - id: fanout',
                '    kind: decompose',
                '    childPipeline: child-pipe',
                '    requires: []',
                '',
              ].join('\n'),
            },
          ],
        },
      ]
    );
    const parentPath = path.join(home, 'parent-pipe.rasenpkg');
    fs.writeFileSync(parentPath, encodePackage(parentPackage));
    await importPipelinePackage(parentPath);

    await expect(deletePipeline('child-pipe')).rejects.toMatchObject({ code: 'pipeline_in_use' });
    const result = await deletePipeline('child-pipe', { force: true });
    expect(result.forcedReferrers).toEqual([expect.stringContaining('decompose:parent-pipe')]);
    expect(listPipelines()).not.toContain('child-pipe');
  });

  it('blocks delete while an installed workflow requires the pipeline', async () => {
    await importPipelinePackage(packagePath(home, 'required-pipe'));

    const draftParent = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-workflow-draft-'));
    cleanup.push(draftParent);
    const draft = scaffoldWorkflow('needs-pipe', path.join(draftParent, 'needs-pipe'));
    fs.writeFileSync(
      path.join(draft, 'workflow.yaml'),
      fs
        .readFileSync(path.join(draft, 'workflow.yaml'), 'utf8')
        .replace('pipelines: []', "pipelines: ['required-pipe']")
    );
    await importWorkflow(draft);
    expect(loadWorkflowCatalog().get('needs-pipe')?.requires.pipelines).toEqual(['required-pipe']);

    await expect(deletePipeline('required-pipe')).rejects.toMatchObject({ code: 'pipeline_in_use' });
  });

  it('never deletes a built-in pipeline, even with --force', async () => {
    await expect(deletePipeline('small-feature', { force: true })).rejects.toMatchObject({
      code: 'pipeline_delete_forbidden',
    });
  });

  it('deletes an unreferenced user pipeline cleanly', async () => {
    await importPipelinePackage(packagePath(home, 'lonely-pipe'));
    const result = await deletePipeline('lonely-pipe');
    expect(result.forcedReferrers).toEqual([]);
    expect(listPipelines()).not.toContain('lonely-pipe');
    expect(fs.existsSync(path.join(getUserPipelinesDir(), 'lonely-pipe'))).toBe(false);
  });

  describe('savePipeline (pipeline-definition-api)', () => {
    function writeDefinitionFile(dir: string, filename: string, content: string): string {
      const target = path.join(dir, filename);
      fs.writeFileSync(target, content);
      return target;
    }

    it('installs a valid JSON definition as a user pipeline', async () => {
      const definitionPath = writeDefinitionFile(
        home,
        'draft.json',
        JSON.stringify({
          name: 'saved-from-json',
          stages: [{ id: 'implement', skill: 'rasen-apply-change', role: 'implementer' }],
        })
      );
      const result = await savePipeline('saved-from-json', definitionPath);
      expect(result.created).toBe(true);
      expect(listPipelines()).toContain('saved-from-json');
      const pipeline = loadPipelineByName('saved-from-json');
      expect(pipeline.version).toBe(PIPELINE_DEFINITION_VERSION);
      expect(pipeline.stages[0].skill).toBe('rasen-apply-change');
      expect(
        fs.readFileSync(path.join(getUserPipelinesDir(), 'saved-from-json', 'pipeline.yaml'), 'utf8')
      ).toMatch(/^version: 1$/m);
    });

    it('installs a valid YAML definition, preserving origin verbatim', async () => {
      const definitionPath = writeDefinitionFile(
        home,
        'draft.yaml',
        [
          'name: saved-from-yaml',
          'origin: ui',
          'stages:',
          '  - id: implement',
          '    skill: rasen-apply-change',
          '    role: implementer',
          '  - id: review',
          '    skill: rasen-review',
          '    role: reviewer',
          '    requires: [implement]',
          '    loop:',
          '      kind: review-cycle',
          '',
        ].join('\n')
      );
      const result = await savePipeline('saved-from-yaml', definitionPath);
      expect(result.created).toBe(true);
      const pipeline = loadPipelineByName('saved-from-yaml');
      expect(pipeline.origin).toBe('ui');
    });

    it('round-trips optional fields (requires, loop, role) through save + read-back', async () => {
      const definitionPath = writeDefinitionFile(
        home,
        'draft2.json',
        JSON.stringify({
          name: 'saved-roundtrip',
          stages: [
            { id: 'implement', skill: 'rasen-apply-change', role: 'implementer' },
            {
              id: 'review',
              skill: 'rasen-review',
              role: 'reviewer',
              requires: ['implement'],
              loop: { kind: 'review-cycle', maxRounds: 2 },
            },
          ],
        })
      );
      await savePipeline('saved-roundtrip', definitionPath);
      const pipeline = loadPipelineByName('saved-roundtrip');
      const review = pipeline.stages.find((s) => s.id === 'review')!;
      expect(review.requires).toEqual(['implement']);
      expect(review.loop).toEqual({ kind: 'review-cycle', maxRounds: 2 });
    });

    it('refuses an existing user pipeline without --force, then allows it with --force', async () => {
      const definitionPath = writeDefinitionFile(
        home,
        'draft3.json',
        JSON.stringify({
          name: 'saved-twice',
          stages: [{ id: 'implement', skill: 'rasen-apply-change' }],
        })
      );
      await savePipeline('saved-twice', definitionPath);
      await expect(savePipeline('saved-twice', definitionPath)).rejects.toMatchObject({
        code: 'pipeline_already_exists',
      });
      const result = await savePipeline('saved-twice', definitionPath, { force: true });
      expect(result.created).toBe(false);
    });

    it('atomically admits exactly one concurrent direct no-force save and retains that winner', async () => {
      const definitionA = writeDefinitionFile(
        home,
        'race-a.json',
        JSON.stringify({
          name: 'race-save',
          description: 'winner-a',
          stages: [{ id: 'implement', skill: 'rasen-apply-change' }],
        })
      );
      const definitionB = writeDefinitionFile(
        home,
        'race-b.json',
        JSON.stringify({
          name: 'race-save',
          description: 'winner-b',
          stages: [{ id: 'implement', skill: 'rasen-apply-change' }],
        })
      );

      const results = await Promise.allSettled([
        savePipeline('race-save', definitionA, { force: false }),
        savePipeline('race-save', definitionB, { force: false }),
      ]);

      const fulfilled = results.filter(
        (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof savePipeline>>> =>
          result.status === 'fulfilled'
      );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toMatchObject({
        code: 'pipeline_already_exists',
      });

      const stored = loadPipelineByName('race-save');
      const winner =
        results[0]!.status === 'fulfilled' ? 'winner-a' : 'winner-b';
      expect(stored.description).toBe(winner);
      expect(fulfilled[0]!.value.created).toBe(true);
    });

    it('refuses a built-in pipeline name regardless of force', async () => {
      const definitionPath = writeDefinitionFile(
        home,
        'draft4.json',
        JSON.stringify({
          name: 'bug-fix',
          stages: [{ id: 'implement', skill: 'rasen-apply-change' }],
        })
      );
      await expect(savePipeline('bug-fix', definitionPath, { force: true })).rejects.toMatchObject({
        code: 'pipeline_builtin_protected',
      });
    });

    it('never installs an invalid definition (structural failure)', async () => {
      const definitionPath = writeDefinitionFile(
        home,
        'draft5.json',
        JSON.stringify({
          name: 'saved-invalid',
          stages: [
            { id: 'a', skill: 'rasen-apply-change', requires: ['b'] },
            { id: 'b', skill: 'rasen-apply-change', requires: ['a'] },
          ],
        })
      );
      await expect(savePipeline('saved-invalid', definitionPath)).rejects.toMatchObject({
        code: 'GRAPH_CYCLE',
        message: expect.stringContaining(
          '/stages/1/requires/0: Cyclic dependency detected: a → b → a'
        ),
      });
      expect(listPipelines()).not.toContain('saved-invalid');
    });

    it('rejects the same cyclic-v1 diagnostic during export without writing a destination', async () => {
      const name = 'cyclic-export';
      const pipelineDir = path.join(getUserPipelinesDir(), name);
      fs.mkdirSync(pipelineDir, { recursive: true });
      fs.writeFileSync(
        path.join(pipelineDir, 'pipeline.yaml'),
        [
          'version: 1',
          `name: ${name}`,
          'stages:',
          '  - id: a',
          '    skill: rasen-apply-change',
          '    requires: [b]',
          '  - id: b',
          '    skill: rasen-review',
          '    requires: [a]',
          '',
        ].join('\n')
      );
      const destination = path.join(home, 'cyclic-export.rasenpkg');

      await expect(exportPipeline(name, destination)).rejects.toMatchObject({
        code: 'GRAPH_CYCLE',
        message: expect.stringContaining(
          '/stages/1/requires/0: Cyclic dependency detected: a → b → a'
        ),
      });
      expect(fs.existsSync(destination)).toBe(false);
    });

    it('never installs a definition referencing an unknown skill', async () => {
      const definitionPath = writeDefinitionFile(
        home,
        'draft6.json',
        JSON.stringify({
          name: 'saved-unknown-skill',
          stages: [{ id: 'implement', skill: 'no-such-skill' }],
        })
      );
      await expect(savePipeline('saved-unknown-skill', definitionPath)).rejects.toThrow(/unknown skill/);
      expect(listPipelines()).not.toContain('saved-unknown-skill');
    });

    it('round-trips a complete v2 definition through save, detail source, and package export', async () => {
      const definition = {
        version: 2 as const,
        id: 'definition:v2-roundtrip',
        sourceId: 'fixture:v2-roundtrip',
        name: 'v2-roundtrip',
        description: 'Preserve every authored field',
        inputs: [{ name: 'request', type: 'text/plain', required: true }],
        artifacts: [{ name: 'report', type: 'artifact/report' }],
        outcomes: ['done'],
        declarations: [
          {
            id: 'body',
            kind: 'Composite' as const,
            provenance: 'custom' as const,
            inputs: [],
            artifacts: [],
            outcomes: ['done'],
            graph: {
              nodes: [{ id: 'body-finish', kind: 'Finish' as const, outcome: 'done' }],
              connections: [],
            },
            unexposed: { preserved: true },
          },
        ],
        root: {
          nodes: [{ id: 'finish', kind: 'Finish' as const, outcome: 'done' }],
          connections: [],
        },
        limits: { maxActions: 5, budget: 5 },
        unexposed: { preserved: 'yes' },
      };
      const definitionPath = writeDefinitionFile(
        home,
        'v2-roundtrip.json',
        JSON.stringify(definition)
      );
      const expected = EcpDefinitionModule.prepare(
        definition,
        createCapabilityCatalogSnapshot([])
      );
      expect(expected.ok).toBe(true);

      await savePipeline('v2-roundtrip', definitionPath);
      const storedPath = path.join(
        getUserPipelinesDir(),
        'v2-roundtrip',
        'pipeline.yaml'
      );
      const stored = EcpDefinitionModule.prepare(
        fs.readFileSync(storedPath, 'utf8'),
        createCapabilityCatalogSnapshot([])
      );
      expect(stored.ok).toBe(true);
      if (!expected.ok || !stored.ok) return;
      expect(stored.value.authoredSource).toEqual(definition);
      expect(stored.value.digests.plan).toBe(expected.value.digests.plan);

      const destination = path.join(home, 'nested', 'v2-roundtrip.rasenpkg');
      await exportPipeline('v2-roundtrip', destination);
      const packageValue = decodePackage(
        fs.readFileSync(destination),
        'pipeline'
      ) as PipelinePackage;
      const manifest = packageValue.pipelines[0]!.files.find(
        (file) => file.path === 'pipeline.yaml'
      )!;
      const exported = EcpDefinitionModule.prepare(
        manifest.content,
        createCapabilityCatalogSnapshot([])
      );
      expect(exported.ok).toBe(true);
      if (exported.ok) {
        expect(exported.value.authoredSource).toEqual(definition);
        expect(exported.value.digests.plan).toBe(expected.value.digests.plan);
      }
      expect(path.resolve(destination)).toBe(destination);
    });
  });

  describe('v1 package export normalization', () => {
    function writeUserPipeline(name: string, manifest: string, ancillary?: string): string {
      const directory = path.join(getUserPipelinesDir(), name);
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'pipeline.yaml'), manifest);
      if (ancillary !== undefined) fs.writeFileSync(path.join(directory, 'README.md'), ancillary);
      return directory;
    }

    it('normalizes only packaged pipeline.yaml, preserves ancillary files and package formatVersion, then imports cleanly', async () => {
      const legacyManifest = [
        'name: legacy-export',
        'description: Legacy source remains untouched.',
        'stages:',
        '  - id: implement',
        '    skill: rasen-apply-change',
        '    role: implementer',
        '',
      ].join('\n');
      const ancillary = '# Keep these exact ancillary bytes.\n';
      const sourceDir = writeUserPipeline('legacy-export', legacyManifest, ancillary);
      const destination = path.join(home, 'legacy-export.rasenpkg');

      await exportPipeline('legacy-export', destination);
      expect(fs.readFileSync(path.join(sourceDir, 'pipeline.yaml'), 'utf8')).toBe(legacyManifest);

      const packageValue = decodePackage(
        fs.readFileSync(destination),
        'pipeline'
      ) as PipelinePackage;
      expect(packageValue.formatVersion).toBe(1);
      const packaged = packageValue.pipelines[0];
      const packagedManifest = packaged.files.find((file) => file.path === 'pipeline.yaml')!;
      const packagedAncillary = packaged.files.find((file) => file.path === 'README.md')!;
      expect(parsePipeline(packagedManifest.content).version).toBe(PIPELINE_DEFINITION_VERSION);
      expect(packagedManifest.content).toMatch(/^version: 1$/m);
      expect(packagedAncillary.content).toBe(ancillary);

      await deletePipeline('legacy-export');
      await importPipelinePackage(destination);
      expect(loadPipelineByName('legacy-export').version).toBe(PIPELINE_DEFINITION_VERSION);
      expect(
        fs.readFileSync(path.join(getUserPipelinesDir(), 'legacy-export', 'README.md'), 'utf8')
      ).toBe(ancillary);
    });

    it('fails closed without writing a package when the source declares an unknown content version', async () => {
      writeUserPipeline(
        'future-export',
        [
          'version: 3',
          'name: future-export',
          'stages:',
          '  - id: implement',
          '    skill: rasen-apply-change',
          '',
        ].join('\n')
      );
      const destination = path.join(home, 'future-export.rasenpkg');

      await expect(exportPipeline('future-export', destination)).rejects.toThrow(/\/version/);
      expect(fs.existsSync(destination)).toBe(false);
    });

    it('prepares invalid v2 before export and leaves the destination absent', async () => {
      writeUserPipeline(
        'invalid-v2-export',
        JSON.stringify({
          version: 2,
          id: 'definition:invalid-v2-export',
          sourceId: 'fixture:invalid-v2-export',
          name: 'invalid-v2-export',
          inputs: [],
          artifacts: [],
          outcomes: ['done'],
          declarations: [],
          root: {
            nodes: [{ id: 'future', kind: 'FutureNode' }],
            connections: [],
          },
        })
      );
      const destination = path.join(home, 'nested', 'invalid-v2.rasenpkg');

      await expect(exportPipeline('invalid-v2-export', destination)).rejects.toThrow(
        /\/root\/nodes\/0\/kind/
      );
      expect(fs.existsSync(destination)).toBe(false);
    });

    it('uses the active frozen capability availability for export and writes nothing when disabled', async () => {
      const workflowCatalog = loadWorkflowCatalog();
      const propose = workflowCatalog.definitions.find(
        (definition) => definition.skill.template.name === 'rasen-propose'
      )!;
      fs.writeFileSync(
        path.join(home, 'config.json'),
        JSON.stringify({
          profile: 'custom',
          workflows: ['review'],
          expertSelectionExplicit: true,
        })
      );
      const definition = {
        version: 2 as const,
        id: 'definition:disabled-export',
        sourceId: 'fixture:disabled-export',
        name: 'disabled-export',
        inputs: [],
        artifacts: [],
        outcomes: ['done'],
        declarations: [],
        root: {
          nodes: [
            {
              id: 'propose',
              kind: 'AtomicStage' as const,
              capability: {
                id: 'skill:rasen-propose',
                version: propose.digest,
              },
              execution: TEST_ATOMIC_EXECUTION,
            },
          ],
          connections: [],
        },
      };
      writeUserPipeline('disabled-export', JSON.stringify(definition));
      const expected = EcpDefinitionModule.prepare(
        definition,
        createProductionCapabilityCatalogSnapshot(
          workflowCatalog.definitions,
          new Set(['rasen-review'])
        )
      );
      expect(expected.ok).toBe(false);
      if (!expected.ok) {
        expect(expected.error.diagnostics).toContainEqual(
          expect.objectContaining({
            code: 'CAPABILITY_DISABLED',
            path: '/root/nodes/0/capability',
          })
        );
      }
      const destination = path.join(home, 'disabled-export.rasenpkg');

      try {
        await exportPipeline('disabled-export', destination);
        expect.fail('expected disabled capability export to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(PipelineLibraryError);
        expect(error).toMatchObject({ code: 'CAPABILITY_DISABLED' });
        expect((error as Error).message).toContain(
          '/root/nodes/0/capability'
        );
      }
      expect(fs.existsSync(destination)).toBe(false);
    });

    it('uses the same legacy-project acknowledgement profile for v2 save and export', async () => {
      const workflowCatalog = loadWorkflowCatalog();
      const codex = workflowCatalog.definitions.find(
        (definition) => definition.skill.template.name === 'rasen-codex'
      )!;
      fs.writeFileSync(
        path.join(home, 'config.json'),
        JSON.stringify({
          profile: 'core',
          expertSelectionExplicit: true,
        })
      );
      const projectRoot = path.join(home, 'legacy-unacknowledged-project');
      fs.mkdirSync(projectRoot, { recursive: true });
      const definition = {
        version: 2 as const,
        id: 'definition:legacy-project-parity',
        sourceId: 'fixture:legacy-project-parity',
        name: 'legacy-project-parity',
        inputs: [],
        artifacts: [],
        outcomes: ['done'],
        declarations: [],
        root: {
          nodes: [
            {
              id: 'codex',
              kind: 'AtomicStage' as const,
              capability: {
                id: 'skill:rasen-codex',
                version: codex.digest,
              },
              execution: TEST_ATOMIC_EXECUTION,
            },
          ],
          connections: [],
        },
      };
      const definitionPath = path.join(
        home,
        'legacy-project-parity.json'
      );
      fs.writeFileSync(definitionPath, JSON.stringify(definition));

      await expect(
        savePipeline('legacy-project-parity', definitionPath, {
          projectRoot,
        })
      ).resolves.toMatchObject({ created: true });

      const destination = path.join(
        home,
        'legacy-project-parity.rasenpkg'
      );
      await expect(
        exportPipeline('legacy-project-parity', destination, {
          projectRoot,
        })
      ).resolves.toBe(path.resolve(destination));
      expect(fs.existsSync(destination)).toBe(true);
    });

    it('uses one alternate workflowsDir catalog meaning for v2 save and export', async () => {
      const projectRoot = path.join(home, 'alternate-catalog-project');
      const workflowsDir = path.join(home, 'alternate-catalog-workflows');
      const workflowDir = path.join(workflowsDir, 'alternate');
      fs.mkdirSync(workflowDir, { recursive: true });
      fs.writeFileSync(
        path.join(workflowDir, 'workflow.yaml'),
        [
          'version: 1',
          'id: alternate',
          'files:',
          '  sidecars: []',
          '  scripts: []',
          'requires:',
          '  workflows: []',
          '  skills: []',
          '  pipelines: []',
          '  schemas: []',
          'recommends:',
          '  workflows: []',
          '',
        ].join('\n')
      );
      fs.writeFileSync(
        path.join(workflowDir, 'SKILL.md'),
        [
          '---',
          'name: rasen-alternate',
          'description: Alternate catalog fixture.',
          'license: MIT',
          'compatibility: Requires rasen CLI.',
          'metadata:',
          '  author: test',
          '  version: "1.0"',
          '---',
          '',
          'Fixture.',
          '',
        ].join('\n')
      );
      fs.mkdirSync(projectRoot, { recursive: true });
      fs.writeFileSync(
        path.join(home, 'config.json'),
        JSON.stringify({
          profile: 'custom',
          workflows: ['alternate'],
          expertSelectionExplicit: true,
        })
      );
      const alternate = loadWorkflowCatalog({
        workflowsDir,
        projectRoot,
      }).get('alternate')!;
      const definition = {
        version: 2 as const,
        id: 'definition:alternate-catalog',
        sourceId: 'fixture:alternate-catalog',
        name: 'alternate-catalog',
        inputs: [],
        artifacts: [],
        outcomes: ['done'],
        declarations: [],
        root: {
          nodes: [
            {
              id: 'alternate',
              kind: 'AtomicStage' as const,
              capability: {
                id: 'skill:rasen-alternate',
                version: alternate.digest,
              },
              execution: TEST_ATOMIC_EXECUTION,
            },
          ],
          connections: [],
        },
      };
      const definitionPath = path.join(home, 'alternate-catalog.json');
      fs.writeFileSync(definitionPath, JSON.stringify(definition));

      await expect(
        savePipeline('alternate-catalog', definitionPath, {
          projectRoot,
          workflowsDir,
        })
      ).resolves.toMatchObject({ created: true });
      const destination = path.join(home, 'alternate-catalog.rasenpkg');
      await expect(
        exportPipeline('alternate-catalog', destination, {
          projectRoot,
          workflowsDir,
        })
      ).resolves.toBe(path.resolve(destination));
      expect(fs.existsSync(destination)).toBe(true);
    });

    it.each([
      {
        name: 'missing',
        capabilityId: 'skill:no-such-capability',
        capabilityVersion: '1',
        code: 'CAPABILITY_MISSING',
      },
      {
        name: 'revision-mismatch',
        capabilityId: 'skill:rasen-review',
        capabilityVersion: 'stale-revision',
        code: 'CAPABILITY_VERSION_MISMATCH',
      },
      {
        name: 'forbidden',
        capabilityId: 'skill:rasen-review',
        capabilityVersion: 'installed',
        code: 'CAPABILITY_FORBIDDEN',
      },
    ])(
      'keeps $name catalog diagnostics at export parity and writes nothing',
      async ({ name, capabilityId, capabilityVersion, code }) => {
        const workflowCatalog = loadWorkflowCatalog();
        const review = workflowCatalog.definitions.find(
          (definition) => definition.skill.template.name === 'rasen-review'
        )!;
        fs.writeFileSync(
          path.join(home, 'config.json'),
          JSON.stringify({
            profile: 'custom',
            workflows: ['review'],
            expertSelectionExplicit: true,
          })
        );
        const resolvedVersion =
          capabilityVersion === 'installed'
            ? review.digest
            : capabilityVersion;
        const pipelineName = `catalog-${name}`;
        const definition = {
          version: 2 as const,
          id: `definition:${pipelineName}`,
          sourceId: `fixture:${pipelineName}`,
          name: pipelineName,
          inputs: [],
          artifacts: [],
          outcomes: ['done'],
          declarations: [],
          root: {
            nodes: [
              {
                id: 'subject',
                kind: 'AtomicStage' as const,
                capability: {
                  id: capabilityId,
                  version: resolvedVersion,
                },
                execution: TEST_ATOMIC_EXECUTION,
              },
            ],
            connections: [],
          },
        };
        writeUserPipeline(pipelineName, JSON.stringify(definition));
        const forbidden =
          name === 'forbidden'
            ? new Set(['rasen-review'])
            : new Set<string>();
        const expected = EcpDefinitionModule.prepare(
          definition,
          createProductionCapabilityCatalogSnapshot(
            workflowCatalog.definitions,
            new Set(['rasen-review']),
            forbidden
          )
        );
        expect(expected.ok).toBe(false);
        if (!expected.ok) {
          expect(expected.error.diagnostics).toContainEqual(
            expect.objectContaining({
              code,
              path: '/root/nodes/0/capability',
            })
          );
        }
        const destination = path.join(home, `${pipelineName}.rasenpkg`);

        try {
          await exportPipeline(pipelineName, destination, {
            forbiddenSkillNames: forbidden,
          });
          expect.fail(`expected ${name} capability export to fail`);
        } catch (error) {
          expect(error).toBeInstanceOf(PipelineLibraryError);
          expect(error).toMatchObject({ code });
          expect((error as Error).message).toContain(
            '/root/nodes/0/capability'
          );
        }
        expect(fs.existsSync(destination)).toBe(false);
      }
    );

    it('refuses to export through a pipeline-root symlink or Windows junction', async () => {
      const externalDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-external-pipeline-'));
      cleanup.push(externalDirectory);
      fs.writeFileSync(
        path.join(externalDirectory, 'pipeline.yaml'),
        [
          'version: 1',
          'name: linked-export',
          'stages:',
          '  - id: implement',
          '    skill: rasen-apply-change',
          '',
        ].join('\n')
      );
      fs.writeFileSync(path.join(externalDirectory, 'secret.txt'), 'must-not-be-packaged');

      fs.mkdirSync(getUserPipelinesDir(), { recursive: true });
      const linkedRoot = path.join(getUserPipelinesDir(), 'linked-export');
      try {
        fs.symlinkSync(
          externalDirectory,
          linkedRoot,
          process.platform === 'win32' ? 'junction' : 'dir'
        );
      } catch (error) {
        if (
          process.platform === 'win32' &&
          ['EPERM', 'EACCES', 'UNKNOWN'].includes(
            (error as NodeJS.ErrnoException).code ?? ''
          )
        ) {
          return;
        }
        throw error;
      }

      const destination = path.join(home, 'linked-export.rasenpkg');
      const linkedManifest = path.join(linkedRoot, 'pipeline.yaml');
      const readFileSpy = vi.spyOn(fsDefault, 'readFileSync');
      syncBuiltinESMExports();
      try {
        await expect(exportPipeline('linked-export', destination)).rejects.toEqual(
          expect.objectContaining({ code: 'pipeline_export_source_unsafe' })
        );
        expect(
          readFileSpy.mock.calls.some(
            ([candidate]) =>
              typeof candidate === 'string' &&
              path.resolve(candidate) === path.resolve(linkedManifest)
          )
        ).toBe(false);
        expect(fs.existsSync(destination)).toBe(false);
      } finally {
        readFileSpy.mockRestore();
        syncBuiltinESMExports();
      }
    });

    it('refuses to export when pipeline.yaml is a symlink where supported', async () => {
      const externalDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-external-manifest-'));
      cleanup.push(externalDirectory);
      const externalManifest = path.join(externalDirectory, 'pipeline.yaml');
      fs.writeFileSync(
        externalManifest,
        [
          'version: 1',
          'name: linked-manifest',
          'stages:',
          '  - id: implement',
          '    skill: rasen-apply-change',
          '',
        ].join('\n')
      );

      const pipelineDirectory = path.join(getUserPipelinesDir(), 'linked-manifest');
      fs.mkdirSync(pipelineDirectory, { recursive: true });
      try {
        fs.symlinkSync(externalManifest, path.join(pipelineDirectory, 'pipeline.yaml'), 'file');
      } catch (error) {
        if (
          process.platform === 'win32' &&
          ['EPERM', 'EACCES', 'UNKNOWN'].includes(
            (error as NodeJS.ErrnoException).code ?? ''
          )
        ) {
          return;
        }
        throw error;
      }

      const destination = path.join(home, 'linked-manifest.rasenpkg');
      const linkedManifest = path.join(pipelineDirectory, 'pipeline.yaml');
      const readFileSpy = vi.spyOn(fsDefault, 'readFileSync');
      syncBuiltinESMExports();
      try {
        await expect(exportPipeline('linked-manifest', destination)).rejects.toEqual(
          expect.objectContaining({ code: 'pipeline_export_source_unsafe' })
        );
        expect(
          readFileSpy.mock.calls.some(
            ([candidate]) =>
              typeof candidate === 'string' &&
              path.resolve(candidate) === path.resolve(linkedManifest)
          )
        ).toBe(false);
        expect(fs.existsSync(destination)).toBe(false);
      } finally {
        readFileSpy.mockRestore();
        syncBuiltinESMExports();
      }
    });
  });
});
