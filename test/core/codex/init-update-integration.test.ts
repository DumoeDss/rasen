import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { InitCommand } from '../../../src/core/init.js';
import { UpdateCommand } from '../../../src/core/update.js';

const MANAGED_FIELDS = [
  'min_wait_timeout_ms',
  'default_wait_timeout_ms',
  'max_wait_timeout_ms',
] as const;

function codexConfigPath(projectRoot: string): string {
  return path.join(projectRoot, '.codex', 'config.toml');
}

function currentPolicy(eol = '\n'): string {
  const fields = MANAGED_FIELDS.map((f) => `${f} = 3600000`).join(eol);
  return `[features.multi_agent_v2]${eol}${fields}${eol}`;
}

function driftedPolicy(): string {
  return (
    '[features.multi_agent_v2]\n' +
    'min_wait_timeout_ms = 60\n' +
    'default_wait_timeout_ms = 3600000\n' +
    'max_wait_timeout_ms = 3600000\n'
  );
}

/** Read the three managed integer values back out, stripping inline comments. */
function readManagedValues(content: string): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  for (const field of MANAGED_FIELDS) {
    const match = new RegExp(`^${field}\\s*=\\s*(.+)$`, 'm').exec(content);
    result[field] = match ? match[1].replace(/\s+#.*$/, '').trim() : null;
  }
  return result;
}

/** Collect console.log text into a single lowercase string for substring checks. */
function collectConsole(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((call) => String(call[0])).join('\n').toLowerCase();
}

describe('codex config init/update integration', () => {
  let projectRoot: string;
  let configTempDir: string;
  let dataTempDir: string;
  let originalEnv: NodeEnv;

  type NodeEnv = NodeJS.ProcessEnv;

  beforeEach(async () => {
    projectRoot = path.join(os.tmpdir(), `rasen-codex-it-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(projectRoot, { recursive: true });

    originalEnv = { ...process.env };
    // The global vitest safety net sets RASEN_HOME, which outranks the XDG vars
    // below — clear it so this suite's isolation actually applies.
    delete process.env.RASEN_HOME;

    configTempDir = path.join(os.tmpdir(), `rasen-codex-it-cfg-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(configTempDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = configTempDir;

    dataTempDir = path.join(os.tmpdir(), `rasen-codex-it-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataTempDir, { recursive: true });
    process.env.XDG_DATA_HOME = dataTempDir;

    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    await fs.rm(projectRoot, { recursive: true, force: true });
    await fs.rm(configTempDir, { recursive: true, force: true });
    await fs.rm(dataTempDir, { recursive: true, force: true });
  });

  // --------------------------------------------------------------------------
  // init
  // --------------------------------------------------------------------------

  describe('rasen init', () => {
    it('writes the managed policy when Codex is selected', async () => {
      const init = new InitCommand({ tools: 'codex' });
      await init.execute(projectRoot);

      const written = await fs.readFile(codexConfigPath(projectRoot), 'utf8');
      for (const field of MANAGED_FIELDS) {
        expect(readManagedValues(written)[field]).toBe('3600000');
      }
    });

    it('does not create or touch .codex/config.toml when Codex is excluded', async () => {
      // Pre-existing drifted config that must be left byte-for-byte untouched.
      await fs.mkdir(path.join(projectRoot, '.codex'), { recursive: true });
      const original = driftedPolicy();
      await fs.writeFile(codexConfigPath(projectRoot), original, 'utf8');

      const init = new InitCommand({ tools: 'claude' });
      await init.execute(projectRoot);

      const after = await fs.readFile(codexConfigPath(projectRoot), 'utf8');
      expect(after).toBe(original);
    });

    it('reports a created config and restart guidance, without counting it as a skill', async () => {
      const spy = vi.spyOn(console, 'log');
      const init = new InitCommand({ tools: 'codex' });
      await init.execute(projectRoot);

      const output = collectConsole(spy);
      expect(output).toContain('codex config: wrote project wait policy');
      expect(output).toContain('restart codex for the one-hour wait bounds');
    });

    it('repairs a drifted config during init and reports the update', async () => {
      await fs.mkdir(path.join(projectRoot, '.codex'), { recursive: true });
      await fs.writeFile(codexConfigPath(projectRoot), driftedPolicy(), 'utf8');

      const spy = vi.spyOn(console, 'log');
      const init = new InitCommand({ tools: 'codex' });
      await init.execute(projectRoot);

      const written = await fs.readFile(codexConfigPath(projectRoot), 'utf8');
      expect(readManagedValues(written).min_wait_timeout_ms).toBe('3600000');

      const output = collectConsole(spy);
      expect(output).toContain('codex config: wrote project wait policy');
    });

    it('does not emit a config-specific restart line when the policy is already current', async () => {
      await fs.mkdir(path.join(projectRoot, '.codex'), { recursive: true });
      await fs.writeFile(codexConfigPath(projectRoot), currentPolicy(), 'utf8');

      const spy = vi.spyOn(console, 'log');
      const init = new InitCommand({ tools: 'codex' });
      await init.execute(projectRoot);

      const output = collectConsole(spy);
      expect(output).not.toContain('restart codex for the one-hour wait bounds');
    });

    it('reports a blocked config with an actionable reason and leaves it unchanged', async () => {
      await fs.mkdir(path.join(projectRoot, '.codex'), { recursive: true });
      const original = 'this is = = not valid toml\n';
      await fs.writeFile(codexConfigPath(projectRoot), original, 'utf8');

      const spy = vi.spyOn(console, 'log');
      const init = new InitCommand({ tools: 'codex' });
      await init.execute(projectRoot);

      // Original invalid config is unchanged.
      const after = await fs.readFile(codexConfigPath(projectRoot), 'utf8');
      expect(after).toBe(original);

      const output = collectConsole(spy);
      expect(output).toContain('codex config: could not configure');
      expect(output).toContain('.codex/config.toml');
    });
  });

  // --------------------------------------------------------------------------
  // update
  // --------------------------------------------------------------------------

  describe('rasen update', () => {
    /** Set up a fully-initialized Codex project (skills + manifest + current policy). */
    async function initCodexProject(): Promise<void> {
      const init = new InitCommand({ tools: 'codex' });
      await init.execute(projectRoot);
    }

    it('says "up to date" when the manifest-configured Codex policy is current', async () => {
      await initCodexProject();
      // init leaves the policy current.
      expect(readManagedValues(await fs.readFile(codexConfigPath(projectRoot), 'utf8')).min_wait_timeout_ms)
        .toBe('3600000');

      const spy = vi.spyOn(console, 'log');
      await new UpdateCommand().execute(projectRoot);

      const output = collectConsole(spy);
      expect(output).toContain('up to date');
      // A current policy does not surface a restart notice.
      expect(output).not.toContain('restart codex for the one-hour wait bounds');
    });

    it('treats a drifted Codex policy as update-required and reconciles it', async () => {
      await initCodexProject();
      // Reopen after init's console spy was restored; introduce drift.
      await fs.writeFile(codexConfigPath(projectRoot), driftedPolicy(), 'utf8');

      const spy = vi.spyOn(console, 'log');
      await new UpdateCommand().execute(projectRoot);

      const output = collectConsole(spy);
      // Did NOT short-circuit to "up to date".
      expect(output).not.toContain('all 1 tool(s) up to date');
      // Reconciled and reported with a restart reminder.
      expect(output).toContain('codex config: wrote project wait policy');
      expect(output).toContain('restart codex for the one-hour wait bounds');

      const written = await fs.readFile(codexConfigPath(projectRoot), 'utf8');
      expect(readManagedValues(written).min_wait_timeout_ms).toBe('3600000');
    });

    it('creates the policy when manifest-configured Codex has no config file', async () => {
      await initCodexProject();
      await fs.rm(codexConfigPath(projectRoot));

      const spy = vi.spyOn(console, 'log');
      await new UpdateCommand().execute(projectRoot);

      const output = collectConsole(spy);
      expect(output).not.toContain('all 1 tool(s) up to date');
      expect(output).toContain('codex config: wrote project wait policy');

      expect(fsSync.existsSync(codexConfigPath(projectRoot))).toBe(true);
    });

    it('leaves the Codex config untouched when Codex is not in the manifest', async () => {
      // Initialize a Claude-only project (manifest tools: [claude]).
      const init = new InitCommand({ tools: 'claude' });
      await init.execute(projectRoot);

      // Drop a drifted Codex config on disk — unmanifested, advisory only.
      await fs.mkdir(path.join(projectRoot, '.codex'), { recursive: true });
      const original = driftedPolicy();
      await fs.writeFile(codexConfigPath(projectRoot), original, 'utf8');

      await new UpdateCommand().execute(projectRoot);

      const after = await fs.readFile(codexConfigPath(projectRoot), 'utf8');
      expect(after).toBe(original);
    });
  });
});
