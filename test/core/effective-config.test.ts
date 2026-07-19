import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { resolveEffectiveConfig, resolveHandoffThresholdLayers } from '../../src/core/effective-config.js';
import { saveGlobalConfig } from '../../src/core/global-config.js';

describe('effective-config', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-effective-config-'));
    originalEnv = { ...process.env };
    delete process.env.RASEN_HOME;
    process.env.XDG_CONFIG_HOME = tempDir;
    delete process.env.RASEN_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
    delete process.env.CI;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writeProjectConfig(projectRoot: string, content: string): void {
    const dir = path.join(projectRoot, 'rasen');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.yaml'), content);
  }

  describe('resolveEffectiveConfig', () => {
    it('reports the built-in default when nothing is configured', () => {
      const entries = resolveEffectiveConfig();
      const proactive = entries.find((e) => e.definition.key === 'proactive')!;
      expect(proactive.value).toBe(true);
      expect(proactive.source).toBe('default');
    });

    it('project value wins over global for a both-scope key', () => {
      saveGlobalConfig({ handoff: { threshold: 0.7 } } as never);

      const projectRoot = path.join(tempDir, 'my-project');
      writeProjectConfig(projectRoot, 'schema: spec-driven\nhandoff:\n  threshold: 0.4\n');

      const entries = resolveEffectiveConfig({ projectRoot });
      const threshold = entries.find((e) => e.definition.key === 'handoff.threshold')!;

      expect(threshold.value).toBe(0.4);
      expect(threshold.source).toBe('project');
      expect(threshold.scopeValues).toEqual({ global: 0.7, project: 0.4 });
    });

    it('global value applies when no project root is given', () => {
      saveGlobalConfig({ repoMode: 'solo' } as never);

      const entries = resolveEffectiveConfig();
      const repoMode = entries.find((e) => e.definition.key === 'repoMode')!;

      expect(repoMode.value).toBe('solo');
      expect(repoMode.source).toBe('global');
    });

    it('environment override wins over a global config value for telemetry.enabled', () => {
      saveGlobalConfig({ telemetry: { enabled: true } } as never);
      process.env.RASEN_TELEMETRY = '0';

      const entries = resolveEffectiveConfig();
      const telemetry = entries.find((e) => e.definition.key === 'telemetry.enabled')!;

      expect(telemetry.value).toBe(false);
      expect(telemetry.source).toBe('env-override');
    });

    it('reports RASEN_LANG as an environment override for language', () => {
      saveGlobalConfig({ language: 'en' });
      process.env.RASEN_LANG = 'ja';

      const entries = resolveEffectiveConfig();
      const language = entries.find((entry) => entry.definition.key === 'language')!;

      expect(language.value).toBe('ja');
      expect(language.source).toBe('env-override');
      expect(language.scopeValues.global).toBe('en');
    });

    it('resolves without error and without project contribution when no project root is passed', () => {
      const entries = resolveEffectiveConfig();
      const gates = entries.find((e) => e.definition.key === 'autopilot.gates')!;

      expect(gates.value).toBe('on');
      expect(gates.source).toBe('default');
      expect(gates.scopeValues.project).toBeUndefined();
    });

    it('reads project layers from an explicit projectRoot different from cwd', () => {
      const projectRoot = path.join(tempDir, 'other-project');
      writeProjectConfig(projectRoot, 'schema: spec-driven\nautopilot:\n  gates: off\n');

      const entries = resolveEffectiveConfig({ projectRoot });
      const gates = entries.find((e) => e.definition.key === 'autopilot.gates')!;

      expect(gates.value).toBe('off');
      expect(gates.source).toBe('project');
    });

    it('excludes the featureFlags wildcard entry', () => {
      const entries = resolveEffectiveConfig();
      expect(entries.some((e) => e.definition.key === 'featureFlags')).toBe(false);
    });
  });

  describe('resolveHandoffThresholdLayers', () => {
    it('reports project and global threshold layers independently', () => {
      saveGlobalConfig({ handoff: { threshold: 0.65 } } as never);
      const projectRoot = path.join(tempDir, 'threshold-project');
      writeProjectConfig(projectRoot, 'schema: spec-driven\nhandoff:\n  threshold: 0.3\n');

      const layers = resolveHandoffThresholdLayers(projectRoot);
      expect(layers).toEqual({ projectThreshold: 0.3, globalThreshold: 0.65 });
    });

    it('reports undefined layers when nothing is configured', () => {
      const layers = resolveHandoffThresholdLayers(null);
      expect(layers).toEqual({ projectThreshold: undefined, globalThreshold: undefined });
    });

    it('drops a hand-edited out-of-range global threshold with a warning (MIN2)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      saveGlobalConfig({ handoff: { threshold: 5 } } as never);

      const layers = resolveHandoffThresholdLayers(null);

      expect(layers.globalThreshold).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('handoff.threshold'));
      warnSpy.mockRestore();
    });

    it('drops a hand-edited zero/negative global threshold with a warning', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      saveGlobalConfig({ handoff: { threshold: 0 } } as never);

      const layers = resolveHandoffThresholdLayers(null);

      expect(layers.globalThreshold).toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});
