import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { registerSchemeCommand } from '../../src/commands/scheme.js';
import {
  getThresholdSchemesDir,
  saveThresholdScheme,
} from '../../src/core/threshold-schemes.js';

async function runScheme(args: string[]): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerSchemeCommand(program);
  await program.parseAsync(['node', 'rasen', 'scheme', ...args]);
}

describe('scheme commands', () => {
  let home: string;
  let oldHome: string | undefined;
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-scheme-command-'));
    oldHome = process.env.RASEN_HOME;
    process.env.RASEN_HOME = home;
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    log.mockRestore();
    if (oldHome === undefined) delete process.env.RASEN_HOME;
    else process.env.RASEN_HOME = oldHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('lists an empty headless library as JSON', async () => {
    await runScheme(['list', '--json']);
    expect(JSON.parse(String(log.mock.calls[0]![0]))).toEqual({ schemes: [] });
  });

  it('lists valid and malformed schemes in sorted JSON/text output', async () => {
    saveThresholdScheme('zeta', { handoff: 0.5, reuse: 0.25 });
    saveThresholdScheme('alpha', { handoff: 0.4, reuse: 0.2 });
    fs.writeFileSync(path.join(getThresholdSchemesDir(), 'broken.yaml'), 'handoff: [\n');

    await runScheme(['list', '--json']);
    const json = JSON.parse(String(log.mock.calls[0]![0]));
    expect(json.schemes.map((entry: { name: string }) => entry.name)).toEqual([
      'alpha',
      'broken',
      'zeta',
    ]);
    expect(json.schemes.find((entry: { name: string }) => entry.name === 'broken')).toMatchObject({
      valid: false,
    });

    log.mockClear();
    await runScheme(['list']);
    expect(log.mock.calls.map((call) => String(call[0])).join('\n')).toContain('broken  invalid');
  });

  it('shows a complete valid scheme as JSON', async () => {
    saveThresholdScheme('focused', {
      handoff: 0.5,
      handoffRoles: { reviewer: 0.6 },
      reuse: 0.25,
    });
    await runScheme(['show', 'focused', '--json']);
    expect(JSON.parse(String(log.mock.calls[0]![0]))).toEqual({
      name: 'focused',
      handoff: 0.5,
      handoffRoles: { reviewer: 0.6 },
      reuse: 0.25,
    });
  });

  it.each(['missing', '../escape', 'default'])(
    'fails actionably for missing/invalid show target %s',
    async (name) => {
      await expect(runScheme(['show', name, '--json'])).rejects.toThrow(/scheme|reserved/i);
    }
  );

  it('fails actionably for malformed show contents', async () => {
    fs.mkdirSync(getThresholdSchemesDir(), { recursive: true });
    fs.writeFileSync(path.join(getThresholdSchemesDir(), 'broken.yaml'), 'handoff: [\n');
    await expect(runScheme(['show', 'broken'])).rejects.toThrow(/invalid/i);
  });
});
