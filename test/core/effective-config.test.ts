import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  resolveConfigStoreLayer,
  resolveEffectiveConfig,
  resolveHandoffThresholdLayers,
  resolveModelConfigLayers,
} from '../../src/core/effective-config.js';
import { saveGlobalConfig } from '../../src/core/global-config.js';
import { registerStore } from '../../src/core/store/registry.js';

describe('effective-config', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-effective-config-'));
    originalEnv = { ...process.env };
    delete process.env.RASEN_HOME;
    process.env.XDG_CONFIG_HOME = tempDir;
    delete process.env.RASEN_TELEMETRY;
    delete process.env.RASEN_LANG;
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

  /** A store's own config is the same `rasen/config.yaml` shape (design D2). */
  function writeStoreConfig(storeRoot: string, content: string): string {
    writeProjectConfig(storeRoot, content);
    return storeRoot;
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

    it('reports an exact persisted zh-cn language from the global layer', () => {
      saveGlobalConfig({ language: 'zh-cn' });

      const entries = resolveEffectiveConfig();
      const language = entries.find((entry) => entry.definition.key === 'language')!;

      expect(language.value).toBe('zh-cn');
      expect(language.source).toBe('global');
      expect(language.scopeValues.global).toBe('zh-cn');
    });

    it('environment override wins over a global config value for telemetry.enabled', () => {
      saveGlobalConfig({ telemetry: { enabled: true } } as never);
      process.env.RASEN_TELEMETRY = '0';

      const entries = resolveEffectiveConfig();
      const telemetry = entries.find((e) => e.definition.key === 'telemetry.enabled')!;

      expect(telemetry.value).toBe(false);
      expect(telemetry.source).toBe('env-override');
    });

    it('normalizes RASEN_LANG aliases as an environment override for language', () => {
      saveGlobalConfig({ language: 'en' });
      process.env.RASEN_LANG = 'ZH_cn.UTF-8@calendar';

      const entries = resolveEffectiveConfig();
      const language = entries.find((entry) => entry.definition.key === 'language')!;

      expect(language.value).toBe('zh-cn');
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

    it('project wins over store wins over global per key', () => {
      saveGlobalConfig({ handoff: { threshold: 0.7 } } as never);
      const storeRoot = writeStoreConfig(
        path.join(tempDir, 'the-store'),
        'schema: spec-driven\nhandoff:\n  threshold: 0.6\n'
      );
      const projectRoot = path.join(tempDir, 'member-project');
      writeProjectConfig(projectRoot, 'schema: spec-driven\nhandoff:\n  threshold: 0.4\n');

      const entries = resolveEffectiveConfig({
        projectRoot,
        store: { storeId: 'the-store', storeRoot },
      });
      const threshold = entries.find((e) => e.definition.key === 'handoff.threshold')!;

      expect(threshold.value).toBe(0.4);
      expect(threshold.source).toBe('project');
      expect(threshold.scopeValues).toEqual({ global: 0.7, store: 0.6, project: 0.4 });
    });

    it('store value wins over global with source store when the project sets none', () => {
      saveGlobalConfig({ models: { default: 'sonnet' } } as never);
      const storeRoot = writeStoreConfig(
        path.join(tempDir, 'model-store'),
        'schema: spec-driven\nmodels:\n  default: opus\n'
      );
      const projectRoot = path.join(tempDir, 'model-member');
      writeProjectConfig(projectRoot, 'schema: spec-driven\n');

      const entries = resolveEffectiveConfig({
        projectRoot,
        store: { storeId: 'model-store', storeRoot },
      });
      const model = entries.find((e) => e.definition.key === 'models.default')!;

      expect(model.value).toBe('opus');
      expect(model.source).toBe('store');
      expect(model.scopeValues.store).toBe('opus');
    });

    it('addresses a store root directly with the project layer absent', () => {
      saveGlobalConfig({ handoff: { threshold: 0.7 } } as never);
      const storeRoot = writeStoreConfig(
        path.join(tempDir, 'direct-store'),
        'schema: spec-driven\nhandoff:\n  threshold: 0.55\n'
      );

      const entries = resolveEffectiveConfig({ store: { storeId: 'direct-store', storeRoot } });
      const threshold = entries.find((e) => e.definition.key === 'handoff.threshold')!;

      expect(threshold.value).toBe(0.55);
      expect(threshold.source).toBe('store');
      expect(threshold.scopeValues.store).toBe(0.55);
      expect(threshold.scopeValues.project).toBeUndefined();
    });

    it('never reads the store layer for a key that is not store-scoped', () => {
      const storeRoot = writeStoreConfig(
        path.join(tempDir, 'profile-store'),
        'schema: spec-driven\nprofile: core\n'
      );

      const entries = resolveEffectiveConfig({ store: { storeId: 'profile-store', storeRoot } });
      const profile = entries.find((e) => e.definition.key === 'profile')!;

      // `profile` is global-only, so a store's `profile:` never contributes.
      expect(profile.scopeValues.store).toBeUndefined();
      expect(profile.source).toBe('default');
    });
  });

  describe('wildcard family instances (includeWildcards)', () => {
    it('emits templates only when no instance is set, with no default value', () => {
      const entries = resolveEffectiveConfig({ includeWildcards: true });
      const wildcardEntries = entries.filter((e) => e.definition.wildcard);
      // featureFlags + three pipelines families, each a template with no instanceKey.
      const templates = wildcardEntries.filter((e) => e.instanceKey === undefined);
      expect(templates.length).toBe(4);
      expect(entries.some((e) => e.instanceKey !== undefined)).toBe(false);
      const gatesTemplate = templates.find(
        (e) => e.definition.key === 'pipelines.<name>.gates.<stage>'
      )!;
      expect(gatesTemplate.value).toBeUndefined();
      expect(gatesTemplate.definition.defaultValue).toBeUndefined();
    });

    it('omits wildcard families entirely without the opt-in flag', () => {
      const entries = resolveEffectiveConfig();
      expect(entries.some((e) => e.definition.wildcard)).toBe(false);
    });

    it('surfaces a project-set instance with its instance key and source', () => {
      const projectRoot = path.join(tempDir, 'inst-project');
      writeProjectConfig(
        projectRoot,
        'schema: spec-driven\npipelines:\n  small-feature:\n    gates:\n      propose: on\n'
      );
      const entries = resolveEffectiveConfig({ projectRoot, includeWildcards: true });
      const inst = entries.find(
        (e) => e.instanceKey === 'pipelines.small-feature.gates.propose'
      )!;
      expect(inst).toBeDefined();
      expect(inst.value).toBe('on');
      expect(inst.source).toBe('project');
      expect(inst.definition.key).toBe('pipelines.<name>.gates.<stage>');
    });

    it('resolves an instance across layers with project > store > global precedence', () => {
      saveGlobalConfig({ pipelines: { 'small-feature': { gates: { propose: 'off' } } } } as never);
      const storeRoot = writeStoreConfig(
        path.join(tempDir, 'inst-store'),
        'schema: spec-driven\npipelines:\n  small-feature:\n    gates:\n      propose: off\n'
      );
      const projectRoot = path.join(tempDir, 'inst-member');
      writeProjectConfig(
        projectRoot,
        'schema: spec-driven\npipelines:\n  small-feature:\n    gates:\n      propose: on\n'
      );

      const entries = resolveEffectiveConfig({
        projectRoot,
        store: { storeId: 'inst-store', storeRoot },
        includeWildcards: true,
      });
      const inst = entries.find(
        (e) => e.instanceKey === 'pipelines.small-feature.gates.propose'
      )!;
      expect(inst.value).toBe('on');
      expect(inst.source).toBe('project');
      expect(inst.scopeValues).toEqual({ global: 'off', store: 'off', project: 'on' });
    });

    it('surfaces a store-layer instance when the project sets none', () => {
      const storeRoot = writeStoreConfig(
        path.join(tempDir, 'model-inst-store'),
        'schema: spec-driven\npipelines:\n  bug-fix:\n    models:\n      review: opus\n'
      );
      const projectRoot = path.join(tempDir, 'model-inst-member');
      writeProjectConfig(projectRoot, 'schema: spec-driven\n');

      const entries = resolveEffectiveConfig({
        projectRoot,
        store: { storeId: 'model-inst-store', storeRoot },
        includeWildcards: true,
      });
      const inst = entries.find(
        (e) => e.instanceKey === 'pipelines.bug-fix.models.review'
      )!;
      expect(inst.value).toBe('opus');
      expect(inst.source).toBe('store');
      expect(inst.scopeValues.store).toBe('opus');
    });

    it('surfaces a global featureFlags instance through the general mechanism', () => {
      saveGlobalConfig({ featureFlags: { myFlag: true } });
      const entries = resolveEffectiveConfig({ includeWildcards: true });
      const inst = entries.find((e) => e.instanceKey === 'featureFlags.myFlag')!;
      expect(inst.value).toBe(true);
      expect(inst.source).toBe('global');
      expect(inst.definition.key).toBe('featureFlags');
    });

    it('drops an invalid on-disk global instance value with a warning, emitting no entry', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      saveGlobalConfig({ pipelines: { 'small-feature': { gates: { propose: 'maybe' } } } } as never);

      const entries = resolveEffectiveConfig({ includeWildcards: true });
      expect(entries.some((e) => e.instanceKey === 'pipelines.small-feature.gates.propose')).toBe(
        false
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('pipelines.small-feature.gates.propose')
      );
      warnSpy.mockRestore();
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

    it('reports project and global per-role layers independently', () => {
      saveGlobalConfig({ handoff: { roles: { implementer: 0.8 } } } as never);
      const projectRoot = path.join(tempDir, 'role-threshold-project');
      writeProjectConfig(
        projectRoot,
        'schema: spec-driven\nhandoff:\n  roles:\n    reviewer: 0.7\n'
      );

      const layers = resolveHandoffThresholdLayers(projectRoot);
      expect(layers.projectRoles).toEqual({ reviewer: 0.7 });
      expect(layers.globalRoles).toEqual({ implementer: 0.8 });
    });

    it('drops a hand-edited invalid global per-role threshold with a warning, keeping valid siblings', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      saveGlobalConfig({ handoff: { roles: { reviewer: 5, implementer: 0.6 } } } as never);

      const layers = resolveHandoffThresholdLayers(null);

      expect(layers.globalRoles).toEqual({ implementer: 0.6 });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('handoff.roles.reviewer'));
      warnSpy.mockRestore();
    });

    it('populates the store threshold layers from a store root', () => {
      const storeRoot = writeStoreConfig(
        path.join(tempDir, 'handoff-store'),
        'schema: spec-driven\nhandoff:\n  threshold: 0.45\n  roles:\n    reviewer: 0.7\n'
      );
      const layers = resolveHandoffThresholdLayers(null, storeRoot);
      expect(layers.storeThreshold).toBe(0.45);
      expect(layers.storeRoles).toEqual({ reviewer: 0.7 });
    });
  });

  describe('resolveModelConfigLayers', () => {
    it('reports project and global model layers independently', () => {
      saveGlobalConfig({ models: { default: 'sonnet', roles: { reviewer: 'fable' } } } as never);
      const projectRoot = path.join(tempDir, 'model-project');
      writeProjectConfig(
        projectRoot,
        'schema: spec-driven\nmodels:\n  default: haiku\n  roles:\n    implementer: opus\n'
      );

      const layers = resolveModelConfigLayers(projectRoot);
      expect(layers).toEqual({
        projectDefault: 'haiku',
        projectRoles: { implementer: 'opus' },
        globalDefault: 'sonnet',
        globalRoles: { reviewer: 'fable' },
      });
    });

    it('reports undefined layers when nothing is configured', () => {
      const layers = resolveModelConfigLayers(null);
      expect(layers).toEqual({
        projectDefault: undefined,
        projectRoles: undefined,
        globalDefault: undefined,
        globalRoles: undefined,
      });
    });

    it('drops a hand-edited empty-string global default with a warning', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      saveGlobalConfig({ models: { default: '' } } as never);

      const layers = resolveModelConfigLayers(null);

      expect(layers.globalDefault).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('models.default'));
      warnSpy.mockRestore();
    });

    it('drops a hand-edited invalid global per-role model with a warning, keeping valid siblings', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      saveGlobalConfig({ models: { roles: { reviewer: 42, implementer: 'opus' } } } as never);

      const layers = resolveModelConfigLayers(null);

      expect(layers.globalRoles).toEqual({ implementer: 'opus' });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('models.roles.reviewer'));
      warnSpy.mockRestore();
    });

    it('populates the store model layers from a store root', () => {
      const storeRoot = writeStoreConfig(
        path.join(tempDir, 'model-layer-store'),
        'schema: spec-driven\nmodels:\n  default: opus\n  roles:\n    reviewer: fable\n'
      );
      const layers = resolveModelConfigLayers(null, storeRoot);
      expect(layers.storeDefault).toBe('opus');
      expect(layers.storeRoles).toEqual({ reviewer: 'fable' });
    });
  });

  describe('resolveConfigStoreLayer', () => {
    let globalDataDir: string;

    beforeEach(() => {
      globalDataDir = path.join(tempDir, 'store-registry-data');
      fs.mkdirSync(globalDataDir, { recursive: true });
    });

    function createPlanningRoot(dir: string, configContent: string): string {
      fs.mkdirSync(path.join(dir, 'rasen', 'specs'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'rasen', 'config.yaml'), configContent);
      return dir;
    }

    async function registerStoreAt(id: string): Promise<string> {
      const root = createPlanningRoot(
        path.join(tempDir, 'stores', id),
        'schema: spec-driven\nhandoff:\n  threshold: 0.7\n'
      );
      await registerStore({ id, localPath: root, globalDataDir });
      return root;
    }

    it('resolves the layer for a registered pointer beside local planning', async () => {
      await registerStoreAt('team-store');
      const projectRoot = createPlanningRoot(
        path.join(tempDir, 'member-proj'),
        'schema: spec-driven\nstore: team-store\n'
      );
      const layer = await resolveConfigStoreLayer(projectRoot, { globalDataDir });
      expect(layer?.storeId).toBe('team-store');
      expect(layer?.storeRoot).toBeTruthy();
    });

    it('returns null for a pointer with no local planning shape', async () => {
      await registerStoreAt('team-store');
      const pointerDir = path.join(tempDir, 'pointer-only');
      fs.mkdirSync(path.join(pointerDir, 'rasen'), { recursive: true });
      fs.writeFileSync(path.join(pointerDir, 'rasen', 'config.yaml'), 'store: team-store\n');
      expect(await resolveConfigStoreLayer(pointerDir, { globalDataDir })).toBeNull();
    });

    it('returns null when there is no pointer', async () => {
      const projectRoot = createPlanningRoot(
        path.join(tempDir, 'no-pointer'),
        'schema: spec-driven\n'
      );
      expect(await resolveConfigStoreLayer(projectRoot, { globalDataDir })).toBeNull();
    });

    it('returns null for an unregistered store', async () => {
      const projectRoot = createPlanningRoot(
        path.join(tempDir, 'unregistered-member'),
        'schema: spec-driven\nstore: nowhere\n'
      );
      expect(await resolveConfigStoreLayer(projectRoot, { globalDataDir })).toBeNull();
    });

    it('returns null for a malformed pointer', async () => {
      const projectRoot = createPlanningRoot(
        path.join(tempDir, 'malformed-member'),
        'schema: spec-driven\nstore: [a, b]\n'
      );
      expect(await resolveConfigStoreLayer(projectRoot, { globalDataDir })).toBeNull();
    });

    it('returns null when the root IS a registered store with its own store field (no transitivity)', async () => {
      const storeARoot = createPlanningRoot(
        path.join(tempDir, 'stores', 'store-a'),
        'schema: spec-driven\nstore: store-b\n'
      );
      await registerStore({ id: 'store-a', localPath: storeARoot, globalDataDir });
      await registerStoreAt('store-b');
      // Resolving store-a's OWN root: its `store: store-b` field is ignored.
      expect(await resolveConfigStoreLayer(storeARoot, { globalDataDir })).toBeNull();
    });

    it('returns null when no projectRoot is given', async () => {
      expect(await resolveConfigStoreLayer(null, { globalDataDir })).toBeNull();
      expect(await resolveConfigStoreLayer(undefined, { globalDataDir })).toBeNull();
    });
  });
});
