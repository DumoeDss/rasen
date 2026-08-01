import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  BOOTSTRAP_MODES,
  parseSuppliedPaths,
  renderBootstrapReport,
  resolveMode,
  runBootstrapCommand,
} from '../../src/commands/bootstrap.js';
import {
  BOOTSTRAP_MESSAGE_KEYS,
  getBootstrapMessages,
} from '../../src/commands/bootstrap-messages.js';
import { COMMAND_REGISTRY } from '../../src/core/completions/command-registry.js';
import { getGlobalDataDir } from '../../src/core/index.js';
import { getStoreRegistryPath } from '../../src/core/store/foundation.js';
import {
  appendStoreMembershipHint,
  updateProjectConfigKey,
} from '../../src/core/project-config.js';
import {
  buildBootstrapReport,
  type BootstrapReport,
} from '../../src/core/store/bootstrap.js';
import { getLocaleCatalog } from '../../src/locales/index.js';
import { SUPPORTED_CLI_LOCALES } from '../../src/utils/locale.js';
import { createOpenSpecRoot } from '../helpers/rasen-fixtures.js';

const PROJECT_ID = '3c0f0a3e-9e2b-4a0e-8c2f-6d5b1f0a7e11';
const ABSENT_UID = '99999999-9999-4999-8999-999999999999';

/** Every file under `dir` with its bytes, for a zero-writes assertion. */
function snapshot(dir: string): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else found.set(path.relative(dir, full), fs.readFileSync(full, 'utf-8'));
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return found;
}

describe('rasen bootstrap command surface', () => {
  let tempDir: string;
  let project: string;
  let globalDataDir: string;
  let savedXdg: string | undefined;
  let savedRasenHome: string | undefined;
  let logged: string[];
  let errored: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-bootstrap-cmd-'));
    savedXdg = process.env.XDG_DATA_HOME;
    savedRasenHome = process.env.RASEN_HOME;
    delete process.env.RASEN_HOME;
    process.env.XDG_DATA_HOME = path.join(tempDir, 'data');
    globalDataDir = getGlobalDataDir({ env: process.env });

    project = path.join(tempDir, 'project');
    createOpenSpecRoot(project);
    updateProjectConfigKey(project, 'projectId', PROJECT_ID);
    updateProjectConfigKey(project, 'store', {
      uid: ABSENT_UID,
      id: 'team-store',
      remote: 'https://example.test/team/team-store.git',
    });
    await appendStoreMembershipHint(project, {
      uid: ABSENT_UID,
      id: 'team-store',
      remote: 'https://example.test/team/team-store.git',
    });

    logged = [];
    errored = [];
    logSpy = vi.spyOn(console, 'log').mockImplementation((line?: unknown) => {
      logged.push(String(line ?? ''));
    });
    errorSpy = vi.spyOn(console, 'error').mockImplementation((line?: unknown) => {
      errored.push(String(line ?? ''));
    });
    process.exitCode = undefined;
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.exitCode = undefined;
    if (savedXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = savedXdg;
    if (savedRasenHome === undefined) delete process.env.RASEN_HOME;
    else process.env.RASEN_HOME = savedRasenHome;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('flag parsing', () => {
    it('reads a location as <selector>=<directory>, repeatably', () => {
      const messages = getBootstrapMessages('en');
      const parsed = parseSuppliedPaths(
        [`team-store=${path.join('C:', 'stores', 'team')}`, 'other=/srv/other'],
        messages
      );
      expect(parsed.get('team-store')).toBe(path.join('C:', 'stores', 'team'));
      expect(parsed.get('other')).toBe('/srv/other');
    });

    it('rejects a location that does not name what it is for', () => {
      const messages = getBootstrapMessages('en');
      expect(() => parseSuppliedPaths(['/srv/team-store'], messages)).toThrow(
        /--path/u
      );
      expect(() => parseSuppliedPaths(['team-store='], messages)).toThrow(/--path/u);
      expect(() => parseSuppliedPaths(['=/srv/x'], messages)).toThrow(/--path/u);
    });

    it('resolves each mode from its own flag', () => {
      const messages = getBootstrapMessages('en');
      expect(resolveMode({ check: true }, messages)).toBe('check');
      expect(resolveMode({ dryRun: true }, messages)).toBe('preview');
      expect(resolveMode({}, messages)).toBeNull();
    });

    it('rejects both modes together before any work', async () => {
      const before = [snapshot(project), snapshot(globalDataDir)];
      await runBootstrapCommand({ check: true, dryRun: true }, project);

      expect(process.exitCode).toBe(1);
      expect(errored.join('\n')).toContain('--check');
      // Nothing was reported, and nothing was read into a report either.
      expect(logged).toEqual([]);
      expect(snapshot(project)).toEqual(before[0]);
      expect(snapshot(globalDataDir)).toEqual(before[1]);
    });
  });

  describe('the bare invocation', () => {
    it('reports which modes exist and does nothing else', async () => {
      const before = [snapshot(project), snapshot(globalDataDir)];
      await runBootstrapCommand({}, project);

      const messages = getBootstrapMessages('en');
      expect(logged).toEqual([
        messages.modeRequired,
        messages.modeRequiredCheck,
        messages.modeRequiredPreview,
        messages.modeRequiredApply,
      ]);
      // No report, no state, no repair — and no failure either.
      expect(process.exitCode).toBeUndefined();
      expect(logged.join('\n')).not.toContain('team-store');
      expect(snapshot(project)).toEqual(before[0]);
      expect(snapshot(globalDataDir)).toEqual(before[1]);
    });

    it('names both modes in JSON too', async () => {
      await runBootstrapCommand({ json: true }, project);
      const payload = JSON.parse(logged.join('\n')) as {
        modeRequired: boolean;
        modes: string[];
      };
      expect(payload.modeRequired).toBe(true);
      expect(payload.modes).toEqual([...BOOTSTRAP_MODES]);
    });
  });

  describe('human and JSON carry the same facts', () => {
    async function jsonReport(check = true): Promise<BootstrapReport> {
      logged = [];
      await runBootstrapCommand(
        check ? { check: true, json: true } : { dryRun: true, json: true },
        project
      );
      return (JSON.parse(logged.join('\n')) as { report: BootstrapReport }).report;
    }

    it('reports the same state, items, and repair commands in both forms', async () => {
      const report = await jsonReport();
      logged = [];
      await runBootstrapCommand({ check: true }, project);
      const human = logged.join('\n');

      const messages = getBootstrapMessages('en');
      expect(report.state).toBe('degraded');
      expect(human).toContain(messages.state(report.state));

      for (const entry of report.stores) {
        expect(human).toContain(entry.selector);
        expect(human).toContain(messages.storeClass(entry.class));
        expect(human).toContain(messages.membership(entry.membership.state));
        for (const repair of [...entry.repair, ...entry.membership.repair]) {
          if (repair.kind === 'command') expect(human).toContain(repair.command);
        }
      }
    });

    it('keeps the JSON shape stable across both modes', async () => {
      for (const check of [true, false]) {
        const report = await jsonReport(check);
        expect(Object.keys(report).sort()).toEqual([
          'diagnostics',
          'mode',
          'origin',
          'problems',
          'project',
          'projects',
          'state',
          'stores',
        ]);
        expect(report.mode).toBe(check ? 'check' : 'preview');
        expect(report.origin).toBe('project');
        for (const entry of report.stores) {
          expect(Object.keys(entry)).toEqual(
            expect.arrayContaining([
              'key',
              'sources',
              'selector',
              'class',
              'membership',
              'repair',
              'diagnostics',
            ])
          );
        }
      }
    });

    it('reports the same facts on an unknown, where only the diagnostic knows why', () => {
      // `presence: 'unknown'` carries no repair, so before entry diagnostics
      // were rendered the human reader got a bare "cannot be determined" while
      // JSON carried the code, the message and the fix.
      for (const locale of SUPPORTED_CLI_LOCALES) {
        const messages = getBootstrapMessages(locale);
        const lines = renderBootstrapReport(
          {
            mode: 'check',
            origin: 'store',
            state: 'degraded',
            store: { root: path.join('C', 'store'), id: 'team-store', registered: true },
            stores: [],
            projects: [
              {
                projectId: PROJECT_ID,
                presence: 'unknown',
                diagnostics: [
                  {
                    severity: 'error',
                    code: 'bootstrap_project_identity_unreadable',
                    message: 'the registered project at /repo has no readable identity',
                    fix: 'Repair the Rasen config in /repo.',
                  },
                ],
              },
            ],
            problems: [],
            diagnostics: [],
          },
          messages
        );

        const text = lines.join('\n');
        expect(text, locale).toContain(messages.presence('unknown'));
        // The REASON reaches the human reader — that is what r2-m1 was about.
        expect(text, locale).toContain('the registered project at /repo has no readable identity');
      }
    });

    it('never renders a diagnostic fix, which is an unfiltered command channel', () => {
      // A `fix` may embed a state-changing command mid-sentence, where
      // `isMutatingRepair`'s prefix match cannot see it — and under an answer
      // the report has just called undetermined, an indented instruction line
      // is indistinguishable from a repair to a human reader.
      const messages = getBootstrapMessages('en');
      const lines = renderBootstrapReport(
        {
          mode: 'check',
          origin: 'store',
          state: 'degraded',
          store: { root: path.join('C', 'store'), id: 'team-store', registered: true },
          stores: [],
          projects: [
            {
              projectId: PROJECT_ID,
              presence: 'unknown',
              diagnostics: [
                {
                  severity: 'error',
                  code: 'bootstrap_project_identity_unreadable',
                  message: 'the registered project at /repo has no readable identity',
                  fix: 'Repair /repo, or unregister it with rasen store unregister --project repo.',
                },
              ],
            },
          ],
          problems: [],
          diagnostics: [],
        },
        messages
      );

      const text = lines.join('\n');
      expect(text).toContain('the registered project at /repo has no readable identity');
      expect(text).not.toContain('rasen store unregister');
      expect(text).not.toContain('Repair /repo,');
    });

    it('renders every report shape without an untranslated hole', () => {
      for (const locale of SUPPORTED_CLI_LOCALES) {
        const messages = getBootstrapMessages(locale);
        const lines = renderBootstrapReport(
          {
            mode: 'preview',
            origin: 'project',
            state: 'blocked',
            project: { root: project, projectId: PROJECT_ID, declaresStore: true },
            stores: [
              {
                key: 'uid:x',
                sources: ['planning'],
                id: 'team-store',
                selector: 'team-store',
                class: 'absent-without-remote',
                reason: 'not-registered',
                membership: { state: 'unverifiable-here', repair: [{ kind: 'supply-path' }] },
                repair: [{ kind: 'supply-path' }, { kind: 'manual', instruction: 'do this' }],
                location: { kind: 'required', because: 'no-safe-name' },
                diagnostics: [],
              },
            ],
            projects: [
              {
                projectId: PROJECT_ID,
                presence: 'obtainable',
                remote: 'https://example.test/x.git',
                location: {
                  kind: 'refused',
                  path: path.join('C:', 'x'),
                  source: 'supplied-path',
                  because: 'not-empty',
                },
                diagnostics: [],
              },
            ],
            problems: [
              {
                kind: 'declaration-malformed',
                path: path.join(project, 'rasen', 'config.yaml'),
                reason: 'pointer-malformed',
                repair: [],
                diagnostics: [],
              },
            ],
            diagnostics: [],
          },
          messages
        );

        const text = lines.join('\n');
        expect(text, locale).not.toContain('undefined');
        expect(text, locale).toContain(messages.state('blocked'));
        expect(text, locale).toContain(messages.repairSupplyPath('team-store'));
      }
    });
  });

  describe('a machine whose own state is unreadable', () => {
    function corruptRegistry(): string {
      const registryPath = getStoreRegistryPath({ globalDataDir });
      fs.mkdirSync(path.dirname(registryPath), { recursive: true });
      fs.writeFileSync(registryPath, 'version: 2\nstores: {oops\n  broken: [\n');
      return registryPath;
    }

    it('emits valid JSON reporting blocked, rather than crashing', async () => {
      const registryPath = corruptRegistry();
      const before = [snapshot(project), snapshot(globalDataDir)];

      await runBootstrapCommand({ check: true, json: true }, project);

      // Valid JSON, not a stack trace and not an empty stream.
      const payload = JSON.parse(logged.join('\n')) as {
        ok: boolean;
        report: BootstrapReport;
      };
      expect(payload.ok).toBe(true);
      expect(payload.report.state).toBe('blocked');
      expect(payload.report.problems.map((problem) => problem.kind)).toEqual([
        'unreadable-state',
      ]);
      expect(payload.report.problems[0]?.path).toBe(registryPath);
      expect(errored).toEqual([]);
      expect(process.exitCode).toBeUndefined();
      // Still writes nothing on the broken-machine path.
      expect(snapshot(project)).toEqual(before[0]);
      expect(snapshot(globalDataDir)).toEqual(before[1]);
    });

    it('reports it in human output with the file and the repair', async () => {
      const registryPath = corruptRegistry();
      await runBootstrapCommand({ check: true }, project);

      const messages = getBootstrapMessages('en');
      const human = logged.join('\n');
      expect(human).toContain(messages.state('blocked'));
      expect(human).toContain(registryPath);
      expect(human).toContain('rasen doctor');
      expect(errored).toEqual([]);
    });

    it('reports it in preview mode too, creating nothing', async () => {
      corruptRegistry();
      await runBootstrapCommand(
        { dryRun: true, json: true, into: path.join(tempDir, 'clones') },
        project
      );

      const payload = JSON.parse(logged.join('\n')) as { report: BootstrapReport };
      expect(payload.report.state).toBe('blocked');
      expect(fs.existsSync(path.join(tempDir, 'clones'))).toBe(false);
    });
  });

  describe('every printed command exists today', () => {
    /** The top-level commands and subcommands the CLI actually defines. */
    function knownCommandPaths(): Set<string> {
      const paths = new Set<string>();
      const walk = (
        definitions: readonly { name: string; subcommands?: readonly unknown[] }[],
        prefix: string
      ): void => {
        for (const definition of definitions) {
          const full = prefix ? `${prefix} ${definition.name}` : definition.name;
          paths.add(full);
          walk(
            (definition.subcommands ?? []) as readonly { name: string }[],
            full
          );
        }
      };
      walk(COMMAND_REGISTRY.subcommands ?? [], '');
      return paths;
    }

    it('emits only commands the CLI defines, and never names bootstrap as a repair', async () => {
      const known = knownCommandPaths();
      const seen: string[] = [];

      // Every reachable shape this change can emit a repair for.
      const reports = [
        await buildBootstrapReport({ cwd: project, mode: 'check', globalDataDir }),
        await buildBootstrapReport({
          cwd: project,
          mode: 'preview',
          globalDataDir,
          into: path.join(tempDir, 'clones'),
        }),
      ];

      for (const report of reports) {
        const repairs = [
          ...report.problems.flatMap((problem) => problem.repair),
          ...report.stores.flatMap((entry) => [...entry.repair, ...entry.membership.repair]),
        ];
        for (const repair of repairs) {
          if (repair.kind !== 'command') continue;
          seen.push(repair.command);
          // A repair may chain `git clone … && rasen …`; every rasen segment
          // in it must name a command that exists.
          for (const segment of repair.command.split('&&').map((part) => part.trim())) {
            if (!segment.startsWith('rasen ')) {
              expect(segment.startsWith('git '), segment).toBe(true);
              continue;
            }
            const words = segment.split(' ').slice(1);
            const candidates = [words.slice(0, 2).join(' '), words[0] ?? ''];
            expect(
              candidates.some((candidate) => known.has(candidate)),
              `${segment} names no command the CLI defines`
            ).toBe(true);
          }
          expect(repair.command, repair.command).not.toMatch(/\brasen bootstrap\b/u);
        }
      }

      expect(seen.length, 'no repair was exercised at all').toBeGreaterThan(0);
    });
  });

  describe('message surface', () => {
    it('defines every bootstrap message key in every supported locale', () => {
      for (const locale of SUPPORTED_CLI_LOCALES) {
        const section = getLocaleCatalog(locale).bootstrap as Record<string, string>;
        expect(Object.keys(section).sort(), locale).toEqual([...BOOTSTRAP_MESSAGE_KEYS].sort());
        for (const key of BOOTSTRAP_MESSAGE_KEYS) {
          expect(section[key], `${locale}: ${key}`).toBeTruthy();
        }
      }
    });

    it('carries a real translation for every message and description, not the English', () => {
      const english = getLocaleCatalog('en');
      for (const locale of SUPPORTED_CLI_LOCALES) {
        if (locale === 'en') continue;
        const section = getLocaleCatalog(locale).bootstrap as Record<string, string>;
        const englishSection = english.bootstrap as Record<string, string>;
        for (const key of BOOTSTRAP_MESSAGE_KEYS) {
          // Placeholder-only and flag-only lines are identical by nature; a
          // message with prose in it must not read as the English string.
          if (/^[\s{}A-Za-z]*$/u.test(englishSection[key] ?? '') && !/[a-z]{4}/u.test(englishSection[key] ?? '')) {
            continue;
          }
          if (key === 'repairLine' || key === 'detailLine' || key === 'storeRow' || key === 'projectRow') {
            continue;
          }
          expect(section[key], `${locale}: ${key} still reads as English`).not.toBe(
            englishSection[key]
          );
        }

        expect(
          getLocaleCatalog(locale).cli.root.commands.bootstrap.description,
          `${locale}: bootstrap CLI description`,
        ).not.toBe(english.cli.root.commands.bootstrap.description);
      }
    });
  });
});
