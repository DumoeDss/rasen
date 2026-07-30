import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  bundleExportCommand,
  registerKnowledgeCommand,
} from '../../src/commands/knowledge.js';
import {
  KnowledgeBundleExportError,
  type ExportKnowledgeBundleOptions,
  type KnowledgeBundleExportResult,
} from '../../src/core/knowledge-bundle/export.js';
import {
  digestContent,
  serializeManifest,
} from '../../src/core/learned-skills/catalog.js';
import { resolveProjectHome } from '../../src/core/project-home.js';
import { resolveProjectKnowledgeHome } from '../../src/core/project-knowledge-home.js';
import { COMMAND_REGISTRY } from '../../src/core/completions/command-registry.js';

const RECORD_ID = 'portable-command-routing';
const CONTENT = `---\nname: ${RECORD_ID}\n---\n\nUse portable command routing.\n`;

describe('rasen knowledge bundle export command', () => {
  let tempHome: string;
  let projectRoot: string;
  let projectId: string;
  let outputDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let originalCwd: string;
  let originalExitCode: typeof process.exitCode;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  async function runKnowledge(args: string[]): Promise<void> {
    const program = new Command();
    program.exitOverride();
    registerKnowledgeCommand(program);
    await program.parseAsync(['node', 'rasen', 'knowledge', ...args]);
  }

  function lastJson(): Record<string, unknown> | undefined {
    for (const [value] of [...logSpy.mock.calls].reverse()) {
      try {
        return JSON.parse(String(value)) as Record<string, unknown>;
      } catch {
        // Keep scanning for the command's one JSON document.
      }
    }
    return undefined;
  }

  function outputEntries(): string[] {
    return fs.existsSync(outputDir) ? fs.readdirSync(outputDir).sort() : [];
  }

  function writeRecord(marker = 'package.json'): void {
    const directory = path.join(
      resolveProjectKnowledgeHome(projectId).catalogDir,
      RECORD_ID
    );
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'learned-skill.yaml'),
      serializeManifest({
        version: 2,
        scope: 'project',
        owner: { type: 'project', projectId },
        id: RECORD_ID,
        knowledgeKey: `${RECORD_ID}-key`,
        status: 'active',
        generatedBy: 'rasen-learned-skill',
        contentDigest: digestContent(CONTENT),
        description: 'Use portable command routing.',
        applicability: { mode: 'all', markers: [marker] },
        evidence: [],
        sources: [],
        createdAt: '2026-07-26T00:00:00.000Z',
        updatedAt: '2026-07-26T00:00:00.000Z',
      })
    );
    fs.writeFileSync(path.join(directory, 'SKILL.md'), CONTENT);
  }

  beforeEach(async () => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-bundle-command-home-'));
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-bundle-command-project-'));
    outputDir = path.join(tempHome, 'exports');
    fs.mkdirSync(outputDir, { recursive: true });
    originalEnv = { ...process.env };
    originalCwd = process.cwd();
    originalExitCode = process.exitCode;
    process.env.RASEN_HOME = tempHome;
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_DATA_HOME;
    process.env.RASEN_LANG = 'en';
    fs.mkdirSync(path.join(projectRoot, 'rasen'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    fs.writeFileSync(path.join(projectRoot, 'package.json'), '{}\n');
    const home = await resolveProjectHome(projectRoot);
    projectId = home!.projectId;
    process.chdir(projectRoot);
    process.exitCode = undefined;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    writeRecord();
  });

  afterEach(() => {
    process.env = originalEnv;
    process.chdir(originalCwd);
    process.exitCode = originalExitCode;
    logSpy.mockRestore();
    errorSpy.mockRestore();
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('accepts a project id, required destination, and optional JSON output', async () => {
    const destination = path.join(outputDir, 'portable.bundle.json');

    await runKnowledge([
      'bundle',
      'export',
      '--project',
      projectId,
      '--to',
      destination,
      '--json',
    ]);

    expect(lastJson()).toEqual({
      ok: true,
      state: 'exported',
      project: projectId,
      recordCount: 1,
      destination: fs.realpathSync.native(destination),
      warnings: [
        {
          code: 'base_project_commit_unavailable',
          message:
            'Warning: no project commit could be determined; baseProjectCommit is recorded as unavailable.',
        },
      ],
    });
    expect(outputEntries()).toEqual(['portable.bundle.json']);
  });

  it('accepts a registered root and human output reports the same facts as JSON', async () => {
    const jsonDestination = path.join(outputDir, 'json.bundle.json');
    await runKnowledge([
      'bundle',
      'export',
      '--project',
      projectRoot,
      '--to',
      jsonDestination,
      '--json',
    ]);
    const json = lastJson()!;
    logSpy.mockClear();
    process.exitCode = undefined;

    const humanDestination = path.join(outputDir, 'human.bundle.json');
    await runKnowledge([
      'bundle',
      'export',
      '--project',
      projectRoot,
      '--to',
      humanDestination,
    ]);
    const output = logSpy.mock.calls.map(([value]) => String(value)).join('\n');

    expect(output).toContain(String(json.project));
    expect(output).toContain(String(json.recordCount));
    expect(output).toContain(fs.realpathSync.native(humanDestination));
    const warnings = json.warnings as Array<{ message: string }>;
    expect(output).toContain(warnings[0]!.message);
    expect(process.exitCode).toBeUndefined();
  });

  it('reports deferred staging cleanup as the same success warning in JSON and human output', async () => {
    const fakeExporter = async (
      options: ExportKnowledgeBundleOptions
    ): Promise<KnowledgeBundleExportResult> => ({
      projectId,
      recordCount: 1,
      destination: options.to,
      warnings: ['staging_cleanup_deferred'],
      bundle: {} as KnowledgeBundleExportResult['bundle'],
    });
    const jsonDestination = path.join(outputDir, 'cleanup-warning-json.bundle.json');

    await bundleExportCommand(
      {
        project: projectId,
        to: jsonDestination,
        json: true,
      },
      fakeExporter
    );
    const json = lastJson()!;
    expect(json).toEqual({
      ok: true,
      state: 'exported',
      project: projectId,
      recordCount: 1,
      destination: jsonDestination,
      warnings: [
        {
          code: 'staging_cleanup_deferred',
          message:
            'Warning: the bundle was published, but its owned external staging file could not be cleaned automatically; the destination was left untouched.',
        },
      ],
    });

    logSpy.mockClear();
    const humanDestination = path.join(outputDir, 'cleanup-warning-human.bundle.json');
    await bundleExportCommand(
      {
        project: projectId,
        to: humanDestination,
      },
      fakeExporter
    );
    const output = logSpy.mock.calls.map(([value]) => String(value)).join('\n');
    const warning = (json.warnings as Array<{ message: string }>)[0]!.message;

    expect(output).toContain(projectId);
    expect(output).toContain('1');
    expect(output).toContain(humanDestination);
    expect(output).toContain(warning);
    expect(process.exitCode).toBeUndefined();
  });

  it('accepts --to-store and reports the same transport facts in JSON and human output', async () => {
    const calls: ExportKnowledgeBundleOptions[] = [];
    const fakeExporter = async (
      options: ExportKnowledgeBundleOptions
    ): Promise<KnowledgeBundleExportResult> => {
      calls.push(options);
      return {
        projectId,
        recordCount: 1,
        destination: options.to,
        warnings: [],
        bundle: {} as KnowledgeBundleExportResult['bundle'],
        transport: {
          store: {
            id: 'team-store',
            uid: '22222222-2222-4222-8222-222222222222',
          },
          destination: path.join(projectRoot, 'store', 'rasen', 'knowledge-bundles', 'bundle.json'),
          filesToCommit: [path.join('rasen', 'knowledge-bundles', 'bundle.json')],
        },
      };
    };
    const jsonDestination = path.join(outputDir, 'store-json.bundle.json');

    await bundleExportCommand(
      {
        project: projectId,
        to: jsonDestination,
        toStore: 'team-store',
        json: true,
      },
      fakeExporter
    );

    expect(calls[0]).toEqual({
      project: projectId,
      to: jsonDestination,
      toStore: 'team-store',
    });
    const json = lastJson()!;
    expect(json).toMatchObject({
      ok: true,
      state: 'exported',
      project: projectId,
      destination: jsonDestination,
      transport: {
        store: {
          id: 'team-store',
          uid: '22222222-2222-4222-8222-222222222222',
        },
        filesToCommit: [path.join('rasen', 'knowledge-bundles', 'bundle.json')],
      },
    });

    logSpy.mockClear();
    const humanDestination = path.join(outputDir, 'store-human.bundle.json');
    await bundleExportCommand(
      {
        project: projectId,
        to: humanDestination,
        toStore: 'team-store',
      },
      fakeExporter
    );
    const output = logSpy.mock.calls.map(([value]) => String(value)).join('\n');
    const transport = json.transport as {
      store: { uid: string };
      destination: string;
      filesToCommit: string[];
    };
    expect(output).toContain(transport.store.uid);
    expect(output).toContain(transport.destination);
    expect(output).toContain(transport.filesToCommit[0]);
  });

  it('reports raw Store publication failure and honest user-file success in JSON and human output', async () => {
    const userDestination = path.join(outputDir, 'partial.bundle.json');
    const storeDestination = path.join(
      projectRoot,
      'store',
      'rasen',
      'knowledge-bundles',
      'bundle.json'
    );
    const reason = 'transport publish denied';
    const fakeExporter = async (): Promise<KnowledgeBundleExportResult> => {
      throw new KnowledgeBundleExportError(
        'knowledge_bundle_store_write_failed',
        `Could not place knowledge bundle in Store at ${storeDestination}.`,
        {
          selector: 'team-store',
          destination: storeDestination,
          reason,
          userDestination,
          userDestinationPublished: 'true',
        }
      );
    };

    await bundleExportCommand(
      {
        project: projectId,
        to: userDestination,
        toStore: 'team-store',
        json: true,
      },
      fakeExporter
    );

    expect(lastJson()).toEqual({
      ok: false,
      error: {
        code: 'knowledge_bundle_store_write_failed',
        message: `The user bundle was exported to ${userDestination}, but Store placement at ${storeDestination} failed: ${reason}`,
        selector: 'team-store',
        destination: storeDestination,
        reason,
        userDestination,
        userDestinationPublished: true,
        repair:
          'Keep the user bundle at its reported path. Repair the Store destination, then retry with a new unused --to path.',
      },
    });

    logSpy.mockClear();
    errorSpy.mockClear();
    await bundleExportCommand(
      {
        project: projectId,
        to: userDestination,
        toStore: 'team-store',
      },
      fakeExporter
    );
    const human = errorSpy.mock.calls
      .map(([value]) => String(value))
      .join('\n');
    expect(human).toContain(userDestination);
    expect(human).toContain(storeDestination);
    expect(human).toContain(reason);
    expect(human).toContain(
      'Keep the user bundle at its reported path.'
    );
  });

  it.each([
    ['missing project', ['bundle', 'export', '--to', 'unused.bundle.json']],
    ['missing destination', ['bundle', 'export', '--project', 'unused-project']],
    [
      'Store selector',
      [
        'bundle',
        'export',
        '--project',
        'unused-project',
        '--store',
        'team',
        '--to',
        'unused.bundle.json',
      ],
    ],
    ['import command', ['bundle', 'import', 'unused.bundle.json']],
  ])('rejects %s before export work', async (_label, args) => {
    const before = outputEntries();
    await expect(runKnowledge(args)).rejects.toBeDefined();
    expect(outputEntries()).toEqual(before);
  });

  it('parses --to-store and fails a missing Store before writing either destination', async () => {
    const destination = path.join(outputDir, 'missing-store.bundle.json');

    await runKnowledge([
      'bundle',
      'export',
      '--project',
      projectId,
      '--to',
      destination,
      '--to-store',
      'missing-store',
      '--json',
    ]);

    expect(lastJson()).toMatchObject({
      ok: false,
      error: {
        code: 'knowledge_bundle_store_unavailable',
        selector: 'missing-store',
        reason: 'not-registered',
      },
    });
    expect(fs.existsSync(destination)).toBe(false);
    expect(outputEntries()).toEqual([]);
  });

  it('returns stable localized refusal details for an occupied destination', async () => {
    const destination = path.join(outputDir, 'occupied.bundle.json');
    fs.writeFileSync(destination, 'existing bytes');

    await runKnowledge([
      'bundle',
      'export',
      '--project',
      projectId,
      '--to',
      destination,
      '--json',
    ]);

    expect(lastJson()).toEqual({
      ok: false,
      error: {
        code: 'knowledge_bundle_destination_occupied',
        message: `The export destination is already occupied: ${fs.realpathSync.native(destination)}`,
        destination: fs.realpathSync.native(destination),
        repair:
          'Choose a new --to path. Bundle export never replaces an existing filesystem entry.',
      },
    });
    expect(fs.readFileSync(destination, 'utf8')).toBe('existing bytes');
    expect(process.exitCode).toBe(1);
  });

  it('returns a record-and-field refusal for non-portable knowledge and writes nothing', async () => {
    fs.rmSync(resolveProjectKnowledgeHome(projectId).catalogDir, {
      recursive: true,
      force: true,
    });
    writeRecord('/home/alice/private/project');
    const destination = path.join(outputDir, 'non-portable.bundle.json');

    await runKnowledge([
      'bundle',
      'export',
      '--project',
      projectId,
      '--to',
      destination,
      '--json',
    ]);

    expect(lastJson()).toMatchObject({
      ok: false,
      error: {
        code: 'knowledge_bundle_non_portable_record',
        record: RECORD_ID,
        field: 'records[0].manifest.applicability.markers[0]',
      },
    });
    expect(fs.existsSync(destination)).toBe(false);
  });

  it('preserves export and registers import separately in the completion surface', () => {
    const knowledge = COMMAND_REGISTRY.subcommands?.find((entry) => entry.name === 'knowledge');
    const bundle = knowledge?.subcommands?.find((entry) => entry.name === 'bundle');
    const commands = bundle?.subcommands?.map((entry) => entry.name);
    const flags = bundle?.subcommands?.[0]?.flags.map((flag) => flag.name);

    expect(commands).toEqual(['export', 'import']);
    expect(flags).toEqual(['project', 'to', 'to-store', 'json']);
    expect(bundle?.subcommands?.[1]).toMatchObject({
      name: 'import',
      acceptsPositional: true,
      positionals: [{ name: 'bundle', type: 'path' }],
      flags: [{ name: 'project' }, { name: 'dry-run' }, { name: 'json' }],
    });
  });
});
