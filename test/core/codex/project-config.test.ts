import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  resolveCodexConfigPath,
  inspectCodexProjectConfig,
  reconcileCodexProjectConfig,
} from '../../../src/core/codex/project-config.js';

const MANAGED_FIELDS = [
  'min_wait_timeout_ms',
  'default_wait_timeout_ms',
  'max_wait_timeout_ms',
] as const;

/** The canonical managed table block Rasen owns. */
function managedBlock(eol = '\n'): string {
  const fields = MANAGED_FIELDS.map((f) => `${f} = 3600000`).join(eol);
  return `[features.multi_agent_v2]${eol}${fields}${eol}`;
}

/** Read the three managed values back out of a written file via the parser-free
 *  expectation the suite controls. */
function readManagedValues(content: string): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  for (const field of MANAGED_FIELDS) {
    const match = new RegExp(`^${field}\\s*=\\s*(.+)$`, 'm').exec(content);
    if (!match) {
      result[field] = null;
      continue;
    }
    // Strip trailing inline comments (managed values are integers, never quoted).
    result[field] = match[1].replace(/\s+#.*$/, '').trim();
  }
  return result;
}

describe('codex project-config', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = path.join(os.tmpdir(), `rasen-codex-cfg-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(projectRoot, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const configPath = () => resolveCodexConfigPath(projectRoot);

  // --------------------------------------------------------------------------
  // Path resolution
  // --------------------------------------------------------------------------

  describe('resolveCodexConfigPath', () => {
    it('resolves to .codex/config.toml under the project root', () => {
      const resolved = resolveCodexConfigPath(projectRoot);
      expect(resolved).toBe(path.join(projectRoot, '.codex', 'config.toml'));
    });
  });

  // --------------------------------------------------------------------------
  // Inspection
  // --------------------------------------------------------------------------

  describe('inspectCodexProjectConfig', () => {
    it('reports missing when no file exists', async () => {
      const { inspection } = await inspectCodexProjectConfig(projectRoot);
      expect(inspection).toEqual({ status: 'missing' });
    });

    it('reports current when all three managed values are present and correct', async () => {
      await fs.mkdir(path.join(projectRoot, '.codex'), { recursive: true });
      await fs.writeFile(configPath(), managedBlock(), 'utf8');
      const { inspection } = await inspectCodexProjectConfig(projectRoot);
      expect(inspection).toEqual({ status: 'current' });
    });

    it('reports drifted when the managed table is entirely absent', async () => {
      await fs.mkdir(path.join(projectRoot, '.codex'), { recursive: true });
      await fs.writeFile(configPath(), '[other]\nfoo = "bar"\n', 'utf8');
      const { inspection } = await inspectCodexProjectConfig(projectRoot);
      expect(inspection).toEqual({ status: 'drifted' });
    });

    it('reports drifted when a managed value is wrong', async () => {
      await fs.mkdir(path.join(projectRoot, '.codex'), { recursive: true });
      const content =
        '[features.multi_agent_v2]\n' +
        'min_wait_timeout_ms = 60000\n' +
        'default_wait_timeout_ms = 3600000\n' +
        'max_wait_timeout_ms = 3600000\n';
      await fs.writeFile(configPath(), content, 'utf8');
      const { inspection } = await inspectCodexProjectConfig(projectRoot);
      expect(inspection).toEqual({ status: 'drifted' });
    });

    it('reports drifted when a managed field is missing', async () => {
      await fs.mkdir(path.join(projectRoot, '.codex'), { recursive: true });
      const content =
        '[features.multi_agent_v2]\n' +
        'min_wait_timeout_ms = 3600000\n' +
        'default_wait_timeout_ms = 3600000\n';
      await fs.writeFile(configPath(), content, 'utf8');
      const { inspection } = await inspectCodexProjectConfig(projectRoot);
      expect(inspection).toEqual({ status: 'drifted' });
    });

    it('reports blocked for invalid TOML', async () => {
      await fs.mkdir(path.join(projectRoot, '.codex'), { recursive: true });
      await fs.writeFile(configPath(), 'this is = = not valid toml\n', 'utf8');
      const { inspection } = await inspectCodexProjectConfig(projectRoot);
      expect(inspection.status).toBe('blocked');
    });

    it('reports blocked when the target is an array-of-tables', async () => {
      await fs.mkdir(path.join(projectRoot, '.codex'), { recursive: true });
      await fs.writeFile(
        configPath(),
        '[[features.multi_agent_v2]]\nmin_wait_timeout_ms = 3600000\n',
        'utf8'
      );
      const { inspection } = await inspectCodexProjectConfig(projectRoot);
      expect(inspection.status).toBe('blocked');
    });

    it('reports blocked when the managed path is defined via dotted keys', async () => {
      await fs.mkdir(path.join(projectRoot, '.codex'), { recursive: true });
      await fs.writeFile(
        configPath(),
        'features.multi_agent_v2.min_wait_timeout_ms = 3600000\n',
        'utf8'
      );
      const { inspection } = await inspectCodexProjectConfig(projectRoot);
      expect(inspection.status).toBe('blocked');
    });

    it('does not detect a table header that appears inside a multiline string', async () => {
      await fs.mkdir(path.join(projectRoot, '.codex'), { recursive: true });
      // The header text is inside a multi-line basic string, not a real table.
      const content =
        'note = """\n' +
        '[features.multi_agent_v2]\n' +
        'min_wait_timeout_ms = 1\n' +
        '"""\n';
      await fs.writeFile(configPath(), content, 'utf8');
      const { inspection } = await inspectCodexProjectConfig(projectRoot);
      // No real managed table → drifted (not current, not blocked).
      expect(inspection).toEqual({ status: 'drifted' });
    });

    it('is read-only and does not create the file', async () => {
      await inspectCodexProjectConfig(projectRoot);
      await expect(fs.access(configPath())).rejects.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // Reconciliation
  // --------------------------------------------------------------------------

  describe('reconcileCodexProjectConfig', () => {
    it('creates the file with all three managed values when absent', async () => {
      const result = await reconcileCodexProjectConfig(projectRoot);
      expect(result.outcome).toBe('created');
      expect(result.needsRestart).toBe(true);

      const written = await fs.readFile(configPath(), 'utf8');
      const values = readManagedValues(written);
      for (const field of MANAGED_FIELDS) {
        expect(values[field]).toBe('3600000');
      }
      expect(written).toContain('[features.multi_agent_v2]');
    });

    it('reports unchanged and does not rewrite an already-current file', async () => {
      await fs.mkdir(path.join(projectRoot, '.codex'), { recursive: true });
      await fs.writeFile(configPath(), managedBlock(), 'utf8');
      const beforeStat = await fs.stat(configPath());

      // Wait briefly so an erroneous rewrite would be observable via mtime.
      await new Promise((resolve) => setTimeout(resolve, 20));

      const result = await reconcileCodexProjectConfig(projectRoot);
      expect(result.outcome).toBe('unchanged');
      expect(result.needsRestart).toBe(false);

      const afterStat = await fs.stat(configPath());
      // mtime (1s resolution on some FS) must not advance for a no-op.
      expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
    });

    it('is idempotent: reconciling twice leaves the file current and stable', async () => {
      const first = await reconcileCodexProjectConfig(projectRoot);
      expect(first.outcome).toBe('created');
      const second = await reconcileCodexProjectConfig(projectRoot);
      expect(second.outcome).toBe('unchanged');

      const written = await fs.readFile(configPath(), 'utf8');
      for (const field of MANAGED_FIELDS) {
        expect(readManagedValues(written)[field]).toBe('3600000');
      }
    });

    it('updates a wrong managed value while preserving unrelated content', async () => {
      await fs.mkdir(path.join(projectRoot, '.codex'), { recursive: true });
      const original =
        '# my codex config\n' +
        'model = "gpt-5"\n\n' +
        '[features.multi_agent_v2]\n' +
        'min_wait_timeout_ms = 60 # keep this comment\n' +
        'default_wait_timeout_ms = 3600000\n' +
        'max_wait_timeout_ms = 3600000\n\n' +
        '[other]\n' +
        'foo = "bar"\n';
      await fs.writeFile(configPath(), original, 'utf8');

      const result = await reconcileCodexProjectConfig(projectRoot);
      expect(result.outcome).toBe('updated');
      expect(result.needsRestart).toBe(true);

      const written = await fs.readFile(configPath(), 'utf8');
      // The managed value was repaired...
      expect(readManagedValues(written).min_wait_timeout_ms).toBe('3600000');
      // ...and the inline comment, unrelated keys, tables, and ordering remain.
      expect(written).toContain('# my codex config');
      expect(written).toContain('model = "gpt-5"');
      expect(written).toContain('# keep this comment');
      expect(written).toContain('foo = "bar"');
      expect(written).toContain('[other]');
    });

    it('inserts a missing managed field into an existing table', async () => {
      await fs.mkdir(path.join(projectRoot, '.codex'), { recursive: true });
      const original =
        '[features.multi_agent_v2]\n' +
        'min_wait_timeout_ms = 3600000\n' +
        'default_wait_timeout_ms = 3600000\n';
      await fs.writeFile(configPath(), original, 'utf8');

      const result = await reconcileCodexProjectConfig(projectRoot);
      expect(result.outcome).toBe('updated');

      const written = await fs.readFile(configPath(), 'utf8');
      expect(readManagedValues(written).max_wait_timeout_ms).toBe('3600000');
      // The two originally-present fields are unchanged.
      expect(written).toContain('min_wait_timeout_ms = 3600000');
      expect(written).toContain('default_wait_timeout_ms = 3600000');
    });

    it('appends the managed table when the file has unrelated content only', async () => {
      await fs.mkdir(path.join(projectRoot, '.codex'), { recursive: true });
      const original = 'model = "gpt-5"\n[other]\nfoo = "bar"\n';
      await fs.writeFile(configPath(), original, 'utf8');

      const result = await reconcileCodexProjectConfig(projectRoot);
      expect(result.outcome).toBe('updated');

      const written = await fs.readFile(configPath(), 'utf8');
      // Unrelated content preserved...
      expect(written).toContain('model = "gpt-5"');
      expect(written).toContain('foo = "bar"');
      // ...and the managed table appended.
      expect(written).toContain('[features.multi_agent_v2]');
      for (const field of MANAGED_FIELDS) {
        expect(readManagedValues(written)[field]).toBe('3600000');
      }
    });

    it('appends the managed table to an empty config file', async () => {
      await fs.mkdir(path.join(projectRoot, '.codex'), { recursive: true });
      await fs.writeFile(configPath(), '', 'utf8');

      const result = await reconcileCodexProjectConfig(projectRoot);
      expect(result.outcome).toBe('updated');

      const written = await fs.readFile(configPath(), 'utf8');
      expect(written).toContain('[features.multi_agent_v2]');
      for (const field of MANAGED_FIELDS) {
        expect(readManagedValues(written)[field]).toBe('3600000');
      }
    });

    it('preserves CRLF line endings', async () => {
      await fs.mkdir(path.join(projectRoot, '.codex'), { recursive: true });
      const original =
        'model = "gpt-5"\r\n' +
        '[features.multi_agent_v2]\r\n' +
        'min_wait_timeout_ms = 60\r\n' +
        'default_wait_timeout_ms = 3600000\r\n' +
        'max_wait_timeout_ms = 3600000\r\n';
      await fs.writeFile(configPath(), original, 'utf8');

      const result = await reconcileCodexProjectConfig(projectRoot);
      expect(result.outcome).toBe('updated');

      const written = await fs.readFile(configPath(), 'utf8');
      // The inserted/repaired line uses CRLF, and no lone LF was introduced.
      expect(written).toContain('min_wait_timeout_ms = 3600000\r\n');
      expect(written).not.toMatch(/[^\r]\n/);
    });

    it('preserves a leading UTF-8 BOM', async () => {
      await fs.mkdir(path.join(projectRoot, '.codex'), { recursive: true });
      const bom = '﻿';
      const original =
        bom +
        '[features.multi_agent_v2]\n' +
        'min_wait_timeout_ms = 60\n' +
        'default_wait_timeout_ms = 3600000\n' +
        'max_wait_timeout_ms = 3600000\n';
      await fs.writeFile(configPath(), original, 'utf8');

      const result = await reconcileCodexProjectConfig(projectRoot);
      expect(result.outcome).toBe('updated');

      const written = await fs.readFile(configPath(), 'utf8');
      expect(written.charCodeAt(0)).toBe(0xfeff);
      expect(readManagedValues(written).min_wait_timeout_ms).toBe('3600000');
    });

    it('does not write and reports blocked for invalid TOML', async () => {
      await fs.mkdir(path.join(projectRoot, '.codex'), { recursive: true });
      const original = 'this is = = broken\n';
      await fs.writeFile(configPath(), original, 'utf8');

      const result = await reconcileCodexProjectConfig(projectRoot);
      expect(result.outcome).toBe('blocked');
      expect(result.needsRestart).toBe(false);

      // Original file is byte-for-byte unchanged.
      const written = await fs.readFile(configPath(), 'utf8');
      expect(written).toBe(original);
    });

    it('does not write and reports blocked for an array-of-tables target', async () => {
      await fs.mkdir(path.join(projectRoot, '.codex'), { recursive: true });
      const original = '[[features.multi_agent_v2]]\nmin_wait_timeout_ms = 3600000\n';
      await fs.writeFile(configPath(), original, 'utf8');

      const result = await reconcileCodexProjectConfig(projectRoot);
      expect(result.outcome).toBe('blocked');
      const written = await fs.readFile(configPath(), 'utf8');
      expect(written).toBe(original);
    });

    it('preserves a user-authored multi_agent_mode_hint_text', async () => {
      await fs.mkdir(path.join(projectRoot, '.codex'), { recursive: true });
      const original =
        '[features.multi_agent_v2]\n' +
        'multi_agent_mode_hint_text = "do the thing"\n' +
        'min_wait_timeout_ms = 60\n' +
        'default_wait_timeout_ms = 3600000\n' +
        'max_wait_timeout_ms = 3600000\n';
      await fs.writeFile(configPath(), original, 'utf8');

      const result = await reconcileCodexProjectConfig(projectRoot);
      expect(result.outcome).toBe('updated');

      const written = await fs.readFile(configPath(), 'utf8');
      expect(written).toContain('multi_agent_mode_hint_text = "do the thing"');
      expect(readManagedValues(written).min_wait_timeout_ms).toBe('3600000');
    });

    it('handles a non-integer managed value by replacing it', async () => {
      await fs.mkdir(path.join(projectRoot, '.codex'), { recursive: true });
      const original =
        '[features.multi_agent_v2]\n' +
        'min_wait_timeout_ms = "short"\n' +
        'default_wait_timeout_ms = 3600000\n' +
        'max_wait_timeout_ms = 3600000\n';
      await fs.writeFile(configPath(), original, 'utf8');

      const result = await reconcileCodexProjectConfig(projectRoot);
      expect(result.outcome).toBe('updated');
      const written = await fs.readFile(configPath(), 'utf8');
      expect(readManagedValues(written).min_wait_timeout_ms).toBe('3600000');
    });
  });
});
