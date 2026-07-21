import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  getGlobalConfigDir,
  getGlobalConfigPath,
  getGlobalDataDir,
  getGlobalConfig,
  saveGlobalConfig,
  adoptLegacyMachineData,
  checkMachineRootRelocation,
  GLOBAL_CONFIG_DIR_NAME,
  GLOBAL_CONFIG_FILE_NAME
} from '../../src/core/global-config.js';
import type { Profile, Delivery } from '../../src/core/global-config.js';
import {
  getProjectHomeDir,
  getProjectRegistryPath,
  registerProject,
  findProjectRegistryEntry,
} from '../../src/core/project-registry.js';

describe('global-config', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Create temp directory for tests
    tempDir = path.join(os.tmpdir(), `rasen-global-config-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    // Save original env
    originalEnv = { ...process.env };

    // The global vitest safety net (vitest.setup.ts) sets RASEN_HOME for the
    // whole run, which outranks XDG_CONFIG_HOME/XDG_DATA_HOME. This suite
    // exercises that exact precedence chain via ambient process.env (calls
    // with no explicit `env` option), so clear it here; tests that need an
    // active RASEN_HOME set it explicitly via the `env` option instead.
    delete process.env.RASEN_HOME;

    // Spy on console.error for warning tests
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;

    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });

    // Restore console.error
    consoleErrorSpy.mockRestore();
  });

  describe('constants', () => {
    it('should export correct directory name', () => {
      expect(GLOBAL_CONFIG_DIR_NAME).toBe('rasen');
    });

    it('should export correct file name', () => {
      expect(GLOBAL_CONFIG_FILE_NAME).toBe('config.json');
    });
  });

  describe('getGlobalConfigDir', () => {
    it('should use XDG_CONFIG_HOME when set', () => {
      process.env.XDG_CONFIG_HOME = tempDir;

      const result = getGlobalConfigDir();

      expect(result).toBe(path.join(tempDir, 'rasen'));
    });

    it('should default to ~/.rasen when nothing is set', () => {
      delete process.env.RASEN_HOME;
      delete process.env.XDG_CONFIG_HOME;

      const result = getGlobalConfigDir({ homedir: tempDir });

      expect(result).toBe(path.join(tempDir, '.rasen'));
    });
  });

  describe('getGlobalConfigPath', () => {
    it('should return path to config.json in config directory', () => {
      process.env.XDG_CONFIG_HOME = tempDir;

      const result = getGlobalConfigPath();

      expect(result).toBe(path.join(tempDir, 'rasen', 'config.json'));
    });
  });

  describe('default machine root: ~/.rasen on every platform', () => {
    it('resolves ~/.rasen with POSIX separators on Unix-like platforms', () => {
      expect(
        getGlobalDataDir({ env: {}, platform: 'linux', homedir: '/home/tabish' })
      ).toBe('/home/tabish/.rasen');

      expect(
        getGlobalConfigDir({ env: {}, platform: 'darwin', homedir: '/Users/tabish' })
      ).toBe('/Users/tabish/.rasen');
    });

    it('resolves ~/.rasen with Windows separators on native Windows platform overrides', () => {
      expect(
        getGlobalDataDir({ env: {}, platform: 'win32', homedir: 'C:\\Users\\Tabish' })
      ).toBe('C:\\Users\\Tabish\\.rasen');

      expect(
        getGlobalConfigDir({ env: {}, platform: 'win32', homedir: 'C:\\Users\\Tabish' })
      ).toBe('C:\\Users\\Tabish\\.rasen');
    });

    it('no longer consults LOCALAPPDATA/APPDATA', () => {
      const result = getGlobalDataDir({
        env: { LOCALAPPDATA: 'D:\\Users\\Tabish\\AppData\\Local' },
        platform: 'win32',
        homedir: 'C:\\Users\\Tabish',
      });

      expect(result).toBe('C:\\Users\\Tabish\\.rasen');
    });
  });

  describe('XDG alias retained below RASEN_HOME', () => {
    it('honors XDG_DATA_HOME for the data dir', () => {
      expect(
        getGlobalDataDir({ env: { XDG_DATA_HOME: '/var/data' }, platform: 'darwin', homedir: '/Users/tabish' })
      ).toBe('/var/data/rasen');
    });

    it('honors XDG_CONFIG_HOME for the config dir', () => {
      expect(
        getGlobalConfigDir({ env: { XDG_CONFIG_HOME: '/var/config' }, platform: 'darwin', homedir: '/Users/tabish' })
      ).toBe('/var/config/rasen');
    });
  });

  describe('RASEN_HOME precedence', () => {
    it('wins over XDG_DATA_HOME for the data dir', () => {
      const result = getGlobalDataDir({
        env: { RASEN_HOME: tempDir, XDG_DATA_HOME: path.join(tempDir, 'xdg-data') },
      });

      expect(result).toBe(path.resolve(tempDir));
    });

    it('wins over XDG_CONFIG_HOME for the config dir', () => {
      const result = getGlobalConfigDir({
        env: { RASEN_HOME: tempDir, XDG_CONFIG_HOME: path.join(tempDir, 'xdg-config') },
      });

      expect(result).toBe(path.resolve(tempDir));
    });

    it('points both getters at the same directory', () => {
      const dataDir = getGlobalDataDir({ env: { RASEN_HOME: tempDir } });
      const configDir = getGlobalConfigDir({ env: { RASEN_HOME: tempDir } });

      expect(dataDir).toBe(configDir);
    });

    it('resolves a relative RASEN_HOME against the working directory', () => {
      const relative = 'some-relative-rasen-home';

      const result = getGlobalDataDir({ env: { RASEN_HOME: relative } });

      expect(result).toBe(path.resolve(relative));
    });

    it('falls back to XDG and warns when RASEN_HOME points at an existing file', () => {
      const filePath = path.join(tempDir, 'not-a-dir.txt');
      fs.writeFileSync(filePath, 'x');
      const xdgDir = path.join(tempDir, 'xdg-data');

      const result = getGlobalDataDir({ env: { RASEN_HOME: filePath, XDG_DATA_HOME: xdgDir } });

      expect(result).toBe(path.join(xdgDir, 'rasen'));
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('RASEN_HOME'));
    });

    it('falls back to the ~/.rasen default when RASEN_HOME is unusable and no XDG is set', () => {
      const filePath = path.join(tempDir, 'not-a-dir2.txt');
      fs.writeFileSync(filePath, 'x');

      const result = getGlobalDataDir({ env: { RASEN_HOME: filePath }, homedir: tempDir });

      expect(result).toBe(path.join(tempDir, '.rasen'));
    });

    it('treats a blank RASEN_HOME as unset', () => {
      const result = getGlobalDataDir({ env: { RASEN_HOME: '   ' }, homedir: tempDir });

      expect(result).toBe(path.join(tempDir, '.rasen'));
    });
  });

  describe('getGlobalConfig', () => {
    it('should return defaults when config file does not exist', () => {
      process.env.XDG_CONFIG_HOME = tempDir;

      const config = getGlobalConfig();

      expect(config).toEqual({ featureFlags: {}, profile: 'full', delivery: 'both', language: 'auto', proactive: true, repoMode: 'collaborative' });
    });

    it('should not create directory when reading non-existent config', () => {
      process.env.XDG_CONFIG_HOME = tempDir;
      const configDir = path.join(tempDir, 'rasen');

      getGlobalConfig();

      expect(fs.existsSync(configDir)).toBe(false);
    });

    it('should load valid config from file', () => {
      process.env.XDG_CONFIG_HOME = tempDir;
      const configDir = path.join(tempDir, 'rasen');
      const configPath = path.join(configDir, 'config.json');

      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify({
        featureFlags: { testFlag: true, anotherFlag: false }
      }));

      const config = getGlobalConfig();

      expect(config.featureFlags).toEqual({ testFlag: true, anotherFlag: false });
    });

    it('should return defaults for invalid JSON', () => {
      process.env.XDG_CONFIG_HOME = tempDir;
      const configDir = path.join(tempDir, 'rasen');
      const configPath = path.join(configDir, 'config.json');

      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(configPath, '{ invalid json }');

      const config = getGlobalConfig();

      expect(config).toEqual({ featureFlags: {}, profile: 'full', delivery: 'both', language: 'auto', proactive: true, repoMode: 'collaborative' });
    });

    it('should log warning for invalid JSON', () => {
      process.env.XDG_CONFIG_HOME = tempDir;
      const configDir = path.join(tempDir, 'rasen');
      const configPath = path.join(configDir, 'config.json');

      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(configPath, '{ invalid json }');

      getGlobalConfig();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid JSON')
      );
    });

    it('should preserve unknown fields from config file', () => {
      process.env.XDG_CONFIG_HOME = tempDir;
      const configDir = path.join(tempDir, 'rasen');
      const configPath = path.join(configDir, 'config.json');

      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify({
        featureFlags: { x: true },
        unknownField: 'preserved',
        futureOption: 123
      }));

      const config = getGlobalConfig();

      expect((config as any).unknownField).toBe('preserved');
      expect((config as any).futureOption).toBe(123);
    });

    it('should merge loaded config with defaults', () => {
      process.env.XDG_CONFIG_HOME = tempDir;
      const configDir = path.join(tempDir, 'rasen');
      const configPath = path.join(configDir, 'config.json');

      // Config with only some fields
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify({
        featureFlags: { customFlag: true }
      }));

      const config = getGlobalConfig();

      // Should have the custom flag
      expect(config.featureFlags?.customFlag).toBe(true);
    });

    describe('schema evolution', () => {
      it('should add default profile and delivery when loading old config without them', () => {
        process.env.XDG_CONFIG_HOME = tempDir;
        const configDir = path.join(tempDir, 'rasen');
        const configPath = path.join(configDir, 'config.json');

        // Simulate a pre-existing config that only has featureFlags
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify({
          featureFlags: { existingFlag: true }
        }));

        const config = getGlobalConfig();

        expect(config.profile).toBe('full');
        expect(config.delivery).toBe('both');
        expect(config.language).toBe('auto');
        expect(config.workflows).toBeUndefined();
        expect(config.featureFlags?.existingFlag).toBe(true);
      });

      it('should preserve explicit profile and delivery values from config', () => {
        process.env.XDG_CONFIG_HOME = tempDir;
        const configDir = path.join(tempDir, 'rasen');
        const configPath = path.join(configDir, 'config.json');

        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify({
          featureFlags: {},
          profile: 'custom',
          delivery: 'skills',
          workflows: ['propose', 'review']
        }));

        const config = getGlobalConfig();

        expect(config.profile).toBe('custom');
        expect(config.delivery).toBe('skills');
        expect(config.workflows).toEqual(['propose', 'review']);
      });

      it('round-trips the exact canonical zh-cn language', () => {
        process.env.XDG_CONFIG_HOME = tempDir;
        const originalConfig = {
          featureFlags: { flag1: true },
          profile: 'custom' as Profile,
          delivery: 'skills' as Delivery,
          language: 'zh-cn' as const,
          workflows: ['propose']
        };

        saveGlobalConfig(originalConfig);
        const loadedConfig = getGlobalConfig();
        const persistedConfig = JSON.parse(fs.readFileSync(getGlobalConfigPath(), 'utf-8'));

        expect(loadedConfig.profile).toBe('custom');
        expect(loadedConfig.delivery).toBe('skills');
        expect(loadedConfig.language).toBe('zh-cn');
        expect(loadedConfig.workflows).toEqual(['propose']);
        expect(persistedConfig.language).toBe('zh-cn');
      });

      it.each(['zh-CN', 'zh_CN', 'zh-SG', 'zh-Hans', 'zh', 'fr'])(
        'falls back to auto without rewriting unsupported persisted language %j',
        (language) => {
          process.env.XDG_CONFIG_HOME = tempDir;
          const configDir = path.join(tempDir, 'rasen');
          const configPath = path.join(configDir, 'config.json');
          fs.mkdirSync(configDir, { recursive: true });
          fs.writeFileSync(configPath, JSON.stringify({ language }));

          expect(getGlobalConfig().language).toBe('auto');
          expect(JSON.parse(fs.readFileSync(configPath, 'utf-8')).language).toBe(language);
        }
      );

      it('should default workflows to undefined when not in config', () => {
        process.env.XDG_CONFIG_HOME = tempDir;
        const configDir = path.join(tempDir, 'rasen');
        const configPath = path.join(configDir, 'config.json');

        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify({
          featureFlags: {},
          profile: 'core',
          delivery: 'both'
        }));

        const config = getGlobalConfig();

        expect(config.workflows).toBeUndefined();
      });
    });

    describe('legacy delivery migration', () => {
      const legacyMappings: Array<[string, Delivery]> = [
        ['skills-first', 'skills'],
        ['commands', 'both'],
        ['commands-first', 'both'],
      ];

      for (const [legacy, mapped] of legacyMappings) {
        it(`maps legacy delivery '${legacy}' to '${mapped}' with a one-time notice`, () => {
          process.env.XDG_CONFIG_HOME = tempDir;
          const configDir = path.join(tempDir, 'rasen');
          const configPath = path.join(configDir, 'config.json');
          fs.mkdirSync(configDir, { recursive: true });
          fs.writeFileSync(configPath, JSON.stringify({ featureFlags: {}, profile: 'full', delivery: legacy }));

          const config = getGlobalConfig();
          expect(config.delivery).toBe(mapped);
          expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining(legacy));
          expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining(mapped));

          // Config file rewritten to the mapped value so the notice is genuinely one-time.
          const rewritten = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          expect(rewritten.delivery).toBe(mapped);

          // Second read finds the already-mapped value and prints no notice.
          consoleErrorSpy.mockClear();
          const config2 = getGlobalConfig();
          expect(config2.delivery).toBe(mapped);
          expect(consoleErrorSpy).not.toHaveBeenCalled();
        });
      }

      it("falls back an unrecognized delivery value to 'both' without persisting", () => {
        process.env.XDG_CONFIG_HOME = tempDir;
        const configDir = path.join(tempDir, 'rasen');
        const configPath = path.join(configDir, 'config.json');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify({ featureFlags: {}, profile: 'full', delivery: 'bogus-value' }));

        const config = getGlobalConfig();
        expect(config.delivery).toBe('both');
        expect(consoleErrorSpy).not.toHaveBeenCalled();

        // Garbage values are not treated as a legacy migration, so the file is untouched.
        const onDisk = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        expect(onDisk.delivery).toBe('bogus-value');
      });
    });
  });

  describe('saveGlobalConfig', () => {
    it('should create directory if it does not exist', () => {
      process.env.XDG_CONFIG_HOME = tempDir;
      const configDir = path.join(tempDir, 'rasen');

      saveGlobalConfig({ featureFlags: { test: true } });

      expect(fs.existsSync(configDir)).toBe(true);
    });

    it('should write config to file', () => {
      process.env.XDG_CONFIG_HOME = tempDir;
      const configPath = path.join(tempDir, 'rasen', 'config.json');

      saveGlobalConfig({ featureFlags: { myFlag: true } });

      const content = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.featureFlags.myFlag).toBe(true);
    });

    it('should overwrite existing config file', () => {
      process.env.XDG_CONFIG_HOME = tempDir;
      const configDir = path.join(tempDir, 'rasen');
      const configPath = path.join(configDir, 'config.json');

      // Create initial config
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify({ featureFlags: { old: true } }));

      // Overwrite
      saveGlobalConfig({ featureFlags: { new: true } });

      const content = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.featureFlags.new).toBe(true);
      expect(parsed.featureFlags.old).toBeUndefined();
    });

    it('should write formatted JSON with trailing newline', () => {
      process.env.XDG_CONFIG_HOME = tempDir;
      const configPath = path.join(tempDir, 'rasen', 'config.json');

      saveGlobalConfig({ featureFlags: {} });

      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).toContain('\n');
      expect(content.endsWith('\n')).toBe(true);
    });

    it('should round-trip config correctly', () => {
      process.env.XDG_CONFIG_HOME = tempDir;
      const originalConfig = {
        featureFlags: { flag1: true, flag2: false }
      };

      saveGlobalConfig(originalConfig);
      const loadedConfig = getGlobalConfig();

      expect(loadedConfig.featureFlags).toEqual(originalConfig.featureFlags);
    });
  });

  // Adoption chain: covers both the historical brand rename (openspec ->
  // rasen) and the root relocation (platform dirs -> ~/.rasen), all fixture
  // dirs anchored under `tempDir` via the homedir DI option — never the real
  // home.
  describe('adoptLegacyMachineData', () => {
    function oldDataDir(): string {
      return os.platform() === 'win32'
        ? path.join(tempDir, 'AppData', 'Local', 'rasen')
        : path.join(tempDir, '.local', 'share', 'rasen');
    }

    function oldConfigDir(): string {
      return os.platform() === 'win32'
        ? path.join(tempDir, 'AppData', 'Roaming', 'rasen')
        : path.join(tempDir, '.config', 'rasen');
    }

    function oldDataOpenspecDir(): string {
      return path.join(path.dirname(oldDataDir()), 'openspec');
    }

    function oldConfigOpenspecDir(): string {
      return path.join(path.dirname(oldConfigDir()), 'openspec');
    }

    function newRoot(): string {
      return path.join(tempDir, '.rasen');
    }

    it('adopts old-scheme rasen data into ~/.rasen', () => {
      const oldDir = oldDataDir();
      fs.mkdirSync(path.join(oldDir, 'projects'), { recursive: true });
      fs.writeFileSync(path.join(oldDir, 'projects', 'registry.json'), '{"version":1,"projects":{}}');
      fs.mkdirSync(path.join(oldDir, 'stores'), { recursive: true });
      fs.writeFileSync(path.join(oldDir, 'stores', 'registry.yaml'), 'stores: {}\n');

      adoptLegacyMachineData({ env: {}, homedir: tempDir });

      expect(fs.existsSync(path.join(newRoot(), 'projects', 'registry.json'))).toBe(true);
      expect(fs.existsSync(path.join(newRoot(), 'stores', 'registry.yaml'))).toBe(true);
      // Copy-not-move: the old directory is left untouched.
      expect(fs.existsSync(path.join(oldDir, 'projects', 'registry.json'))).toBe(true);
    });

    it('adopts an ancient openspec install in one hop when no rasen-scheme dir exists', () => {
      const legacyDir = oldDataOpenspecDir();
      fs.mkdirSync(path.join(legacyDir, 'projects'), { recursive: true });
      fs.writeFileSync(path.join(legacyDir, 'projects', 'registry.json'), '{"version":1,"projects":{}}');

      adoptLegacyMachineData({ env: {}, homedir: tempDir });

      expect(fs.existsSync(path.join(newRoot(), 'projects', 'registry.json'))).toBe(true);
    });

    it('merges data and config adoption into one target directory', () => {
      fs.mkdirSync(path.join(oldDataDir(), 'projects'), { recursive: true });
      fs.writeFileSync(path.join(oldDataDir(), 'projects', 'registry.json'), '{"version":1,"projects":{}}');

      const legacyConfigDir = oldConfigDir();
      fs.mkdirSync(legacyConfigDir, { recursive: true });
      fs.writeFileSync(
        path.join(legacyConfigDir, 'config.json'),
        JSON.stringify({ anonymousId: 'abc-123', noticeSeen: true })
      );

      adoptLegacyMachineData({ env: {}, homedir: tempDir });

      expect(fs.existsSync(path.join(newRoot(), 'projects', 'registry.json'))).toBe(true);
      const migrated = JSON.parse(fs.readFileSync(path.join(newRoot(), 'config.json'), 'utf-8'));
      expect(migrated.anonymousId).toBe('abc-123');
      expect(migrated.noticeSeen).toBe(true);
    });

    it('never overwrites an existing child at the target', () => {
      fs.mkdirSync(path.join(oldDataDir(), 'projects'), { recursive: true });
      fs.writeFileSync(path.join(oldDataDir(), 'projects', 'registry.json'), '{"version":1,"projects":{"old":true}}');

      fs.mkdirSync(path.join(newRoot(), 'projects'), { recursive: true });
      fs.writeFileSync(path.join(newRoot(), 'projects', 'registry.json'), '{"version":1,"projects":{"kept":true}}');

      adoptLegacyMachineData({ env: {}, homedir: tempDir });

      const kept = JSON.parse(fs.readFileSync(path.join(newRoot(), 'projects', 'registry.json'), 'utf-8'));
      expect(kept.projects.kept).toBe(true);
    });

    it('does not adopt when RASEN_HOME is set', () => {
      fs.mkdirSync(path.join(oldDataDir(), 'projects'), { recursive: true });
      fs.writeFileSync(path.join(oldDataDir(), 'projects', 'registry.json'), '{"version":1,"projects":{}}');

      const rasenHomeDir = path.join(tempDir, 'explicit-home');
      adoptLegacyMachineData({ env: { RASEN_HOME: rasenHomeDir }, homedir: tempDir });

      expect(fs.existsSync(path.join(rasenHomeDir, 'projects'))).toBe(false);
      expect(fs.existsSync(newRoot())).toBe(false);
    });

    it('does not adopt data when XDG_DATA_HOME is set, but still adopts config', () => {
      fs.mkdirSync(path.join(oldDataDir(), 'projects'), { recursive: true });
      fs.writeFileSync(path.join(oldDataDir(), 'projects', 'registry.json'), '{"version":1,"projects":{}}');

      const legacyConfigDir = oldConfigDir();
      fs.mkdirSync(legacyConfigDir, { recursive: true });
      fs.writeFileSync(path.join(legacyConfigDir, 'config.json'), JSON.stringify({ anonymousId: 'xyz' }));

      const xdgDataHome = path.join(tempDir, 'xdg-data');
      adoptLegacyMachineData({ env: { XDG_DATA_HOME: xdgDataHome }, homedir: tempDir });

      // Data adoption skipped: env override in effect.
      expect(fs.existsSync(path.join(xdgDataHome, 'rasen', 'projects'))).toBe(false);
      // Config adoption still runs (no override for XDG_CONFIG_HOME/RASEN_HOME).
      expect(fs.existsSync(path.join(newRoot(), 'config.json'))).toBe(true);
    });

    it('is a no-op when no old-scheme directory exists', () => {
      adoptLegacyMachineData({ env: {}, homedir: tempDir });

      expect(fs.existsSync(newRoot())).toBe(false);
    });

    it('is idempotent: a second run changes nothing further', () => {
      fs.mkdirSync(path.join(oldDataDir(), 'projects'), { recursive: true });
      fs.writeFileSync(path.join(oldDataDir(), 'projects', 'registry.json'), '{"version":1,"projects":{}}');

      adoptLegacyMachineData({ env: {}, homedir: tempDir });
      const firstRun = fs.readFileSync(path.join(newRoot(), 'projects', 'registry.json'), 'utf-8');

      // Simulate the old install picking up new (would-be) content after the
      // first adoption — the second run must not touch the already-adopted child.
      fs.writeFileSync(path.join(oldDataDir(), 'projects', 'registry.json'), '{"version":1,"projects":{"new":true}}');
      adoptLegacyMachineData({ env: {}, homedir: tempDir });

      const secondRun = fs.readFileSync(path.join(newRoot(), 'projects', 'registry.json'), 'utf-8');
      expect(secondRun).toBe(firstRun);
    });

    it('swallows adverse filesystem state so startup cannot break', () => {
      // Old-scheme path exists but is a *file*, not a directory.
      fs.mkdirSync(path.dirname(oldDataDir()), { recursive: true });
      fs.writeFileSync(oldDataDir(), 'not a directory\n');

      expect(() => adoptLegacyMachineData({ env: {}, homedir: tempDir })).not.toThrow();
      expect(fs.existsSync(newRoot())).toBe(false);
    });

    it('failure adopting one child is loud but never fatal, and does not block other children', () => {
      fs.mkdirSync(path.join(oldDataDir(), 'projects'), { recursive: true });
      fs.writeFileSync(path.join(oldDataDir(), 'projects', 'registry.json'), '{"version":1,"projects":{}}');
      fs.mkdirSync(path.join(oldDataDir(), 'stores'), { recursive: true });
      fs.writeFileSync(path.join(oldDataDir(), 'stores', 'registry.yaml'), 'stores: {}\n');

      // Pre-create the target as a *file* so mkdirSync(target, {recursive}) inside
      // adoptChildrenInto throws for every child — proves failures are swallowed
      // per-child, never crash the caller.
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(newRoot(), 'blocking file, not a directory\n');

      expect(() => adoptLegacyMachineData({ env: {}, homedir: tempDir })).not.toThrow();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('prefers the rasen-scheme old dir over its openspec sibling when both exist simultaneously (review m2)', () => {
      // Both old-scheme dirs present at once, with DIFFERENT, non-overlapping
      // children, so the outcome unambiguously distinguishes "rasen wins
      // outright" from "rasen and openspec get merged."
      fs.mkdirSync(path.join(oldDataDir(), 'projects'), { recursive: true });
      fs.writeFileSync(
        path.join(oldDataDir(), 'projects', 'registry.json'),
        '{"version":1,"projects":{"source":"rasen-scheme"}}'
      );

      fs.mkdirSync(path.join(oldDataOpenspecDir(), 'stores'), { recursive: true });
      fs.writeFileSync(path.join(oldDataOpenspecDir(), 'stores', 'registry.yaml'), 'source: openspec-scheme\n');

      adoptLegacyMachineData({ env: {}, homedir: tempDir });

      // The winning (rasen-scheme) source's content is adopted.
      const adopted = JSON.parse(fs.readFileSync(path.join(newRoot(), 'projects', 'registry.json'), 'utf-8'));
      expect(adopted.projects.source).toBe('rasen-scheme');
      // The losing (openspec-scheme) source contributes NOTHING — this is an
      // exclusive chain, not a merge of both sources' children.
      expect(fs.existsSync(path.join(newRoot(), 'stores'))).toBe(false);
    });

    // D1: a pre-existing target `projects/` no longer skips the whole legacy
    // subtree — it recurses one level and merges below.
    it('recurses into a pre-existing target projects/ and adopts a missing per-home dir without overwriting existing homes', () => {
      fs.mkdirSync(path.join(oldDataDir(), 'projects', 'home-a'), { recursive: true });
      fs.writeFileSync(path.join(oldDataDir(), 'projects', 'home-a', 'marker.txt'), 'old-a\n');
      fs.mkdirSync(path.join(oldDataDir(), 'projects', 'home-b'), { recursive: true });
      fs.writeFileSync(path.join(oldDataDir(), 'projects', 'home-b', 'marker.txt'), 'old-b\n');

      // Target `projects/` already exists (created by another session) and
      // already has `home-a` with DIFFERENT content — never-overwrite must
      // preserve it, while `home-b` (missing at target) still gets adopted.
      fs.mkdirSync(path.join(newRoot(), 'projects', 'home-a'), { recursive: true });
      fs.writeFileSync(path.join(newRoot(), 'projects', 'home-a', 'marker.txt'), 'current-a\n');

      adoptLegacyMachineData({ env: {}, homedir: tempDir });

      expect(fs.readFileSync(path.join(newRoot(), 'projects', 'home-a', 'marker.txt'), 'utf-8')).toBe('current-a\n');
      expect(fs.readFileSync(path.join(newRoot(), 'projects', 'home-b', 'marker.txt'), 'utf-8')).toBe('old-b\n');
    });

    // D2: old home names map to the CURRENT registry's home for the same
    // projectId, so content merges into the referenced home instead of
    // landing under an unreferenced (GC-bait) old name.
    it('maps an old home name to the current registry home sharing the same projectId', () => {
      fs.mkdirSync(path.join(oldDataDir(), 'projects', 'openspec-code-1e42477e'), { recursive: true });
      fs.writeFileSync(
        path.join(oldDataDir(), 'projects', 'openspec-code-1e42477e', 'marker.txt'),
        'old content\n'
      );
      fs.writeFileSync(
        path.join(oldDataDir(), 'projects', 'registry.json'),
        JSON.stringify({
          version: 1,
          projects: {
            '/old/path': {
              projectId: 'shared-id',
              name: 'openspec-code',
              mode: 'in-repo',
              home: 'openspec-code-1e42477e',
              lastSeen: new Date().toISOString(),
            },
          },
        })
      );

      // Target `projects/` already exists (forces the recursive path) with a
      // CURRENT registry referencing the SAME projectId under a different home.
      fs.mkdirSync(path.join(newRoot(), 'projects'), { recursive: true });
      fs.writeFileSync(
        path.join(newRoot(), 'projects', 'registry.json'),
        JSON.stringify({
          version: 1,
          projects: {
            '/current/path': {
              projectId: 'shared-id',
              name: 'autonomy-ladder',
              mode: 'in-repo',
              home: 'autonomy-ladder-1e42477e',
              lastSeen: new Date().toISOString(),
            },
          },
        })
      );

      adoptLegacyMachineData({ env: {}, homedir: tempDir });

      // Content lands under the CURRENT (referenced) home name...
      expect(
        fs.readFileSync(path.join(newRoot(), 'projects', 'autonomy-ladder-1e42477e', 'marker.txt'), 'utf-8')
      ).toBe('old content\n');
      // ...never under the stale old name (which doctor --gc would sweep as
      // unreferenced GC-bait).
      expect(fs.existsSync(path.join(newRoot(), 'projects', 'openspec-code-1e42477e'))).toBe(false);
      // The current registry is read-only input to the mapping — never
      // overwritten by adoption.
      const targetRegistry = JSON.parse(
        fs.readFileSync(path.join(newRoot(), 'projects', 'registry.json'), 'utf-8')
      );
      expect(targetRegistry.projects['/current/path'].home).toBe('autonomy-ladder-1e42477e');
      expect(targetRegistry.projects['/old/path']).toBeUndefined();
    });

    // D2 fallback: when the old registry is missing/unreadable, or no
    // current entry shares the projectId, adoption still makes progress by
    // copying under the old home name — lossless, never throws.
    it('falls back to copying under the old home name when the old registry is absent', () => {
      fs.mkdirSync(path.join(oldDataDir(), 'projects', 'openspec-code-1e42477e'), { recursive: true });
      fs.writeFileSync(
        path.join(oldDataDir(), 'projects', 'openspec-code-1e42477e', 'marker.txt'),
        'old content\n'
      );
      // No old registry.json written.

      // Force the recursive path with a target `projects/` that has no
      // registry either.
      fs.mkdirSync(path.join(newRoot(), 'projects', 'other-home'), { recursive: true });

      expect(() => adoptLegacyMachineData({ env: {}, homedir: tempDir })).not.toThrow();

      expect(
        fs.readFileSync(path.join(newRoot(), 'projects', 'openspec-code-1e42477e', 'marker.txt'), 'utf-8')
      ).toBe('old content\n');
    });

    // Round-1 review Major: a malformed OLD registry can have two DIFFERENT
    // old homes claiming the same projectId. Trusting that mapping would
    // route both to the SAME destination name; the second would be silently
    // dropped by never-overwrite, and doctor's relocation probe would then
    // misreport the whole subtree as "fully adopted" (a false safe-to-delete
    // signal). The fix falls back to each home's own (collision-free) name
    // instead of the ambiguous mapping, and warns.
    it('falls back to each home\'s own name — not a shared mapped destination — when two old homes claim the same projectId', () => {
      fs.mkdirSync(path.join(oldDataDir(), 'projects', 'home-alpha'), { recursive: true });
      fs.writeFileSync(path.join(oldDataDir(), 'projects', 'home-alpha', 'marker.txt'), 'alpha content\n');
      fs.mkdirSync(path.join(oldDataDir(), 'projects', 'home-beta'), { recursive: true });
      fs.writeFileSync(path.join(oldDataDir(), 'projects', 'home-beta', 'marker.txt'), 'beta content\n');
      fs.writeFileSync(
        path.join(oldDataDir(), 'projects', 'registry.json'),
        JSON.stringify({
          version: 1,
          projects: {
            '/old/alpha': {
              projectId: 'dup-id',
              name: 'home-alpha',
              mode: 'in-repo',
              home: 'home-alpha',
              lastSeen: new Date().toISOString(),
            },
            '/old/beta': {
              projectId: 'dup-id',
              name: 'home-beta',
              mode: 'in-repo',
              home: 'home-beta',
              lastSeen: new Date().toISOString(),
            },
          },
        })
      );

      // Target `projects/` already exists (forces the recursive path) with a
      // CURRENT registry that would (naively) map "dup-id" to one shared home.
      fs.mkdirSync(path.join(newRoot(), 'projects'), { recursive: true });
      fs.writeFileSync(
        path.join(newRoot(), 'projects', 'registry.json'),
        JSON.stringify({
          version: 1,
          projects: {
            '/current/path': {
              projectId: 'dup-id',
              name: 'shared-home',
              mode: 'in-repo',
              home: 'shared-home',
              lastSeen: new Date().toISOString(),
            },
          },
        })
      );

      adoptLegacyMachineData({ env: {}, homedir: tempDir });

      // Both adopt under their OWN names — no destination collision, no data
      // silently dropped.
      expect(
        fs.readFileSync(path.join(newRoot(), 'projects', 'home-alpha', 'marker.txt'), 'utf-8')
      ).toBe('alpha content\n');
      expect(
        fs.readFileSync(path.join(newRoot(), 'projects', 'home-beta', 'marker.txt'), 'utf-8')
      ).toBe('beta content\n');
      // Neither was mapped onto the ambiguous shared destination.
      expect(fs.existsSync(path.join(newRoot(), 'projects', 'shared-home', 'marker.txt'))).toBe(false);
      // The ambiguity is surfaced, not silent.
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('multiple homes'));
    });

    // Mirror case: a malformed OLD registry has two entries sharing the same
    // `home` field but different projectIds — resolveAdoptedHomeName's
    // `.find` would otherwise pick an arbitrary (potentially wrong) entry.
    it('falls back to the old home\'s own name when the old registry has ambiguous entries for that home (different projectIds)', () => {
      fs.mkdirSync(path.join(oldDataDir(), 'projects', 'ambiguous-home'), { recursive: true });
      fs.writeFileSync(
        path.join(oldDataDir(), 'projects', 'ambiguous-home', 'marker.txt'),
        'ambiguous content\n'
      );
      fs.writeFileSync(
        path.join(oldDataDir(), 'projects', 'registry.json'),
        JSON.stringify({
          version: 1,
          projects: {
            '/old/one': {
              projectId: 'id-one',
              name: 'ambiguous-home',
              mode: 'in-repo',
              home: 'ambiguous-home',
              lastSeen: new Date().toISOString(),
            },
            '/old/two': {
              projectId: 'id-two',
              name: 'ambiguous-home',
              mode: 'in-repo',
              home: 'ambiguous-home',
              lastSeen: new Date().toISOString(),
            },
          },
        })
      );

      fs.mkdirSync(path.join(newRoot(), 'projects'), { recursive: true });
      fs.writeFileSync(
        path.join(newRoot(), 'projects', 'registry.json'),
        JSON.stringify({
          version: 1,
          projects: {
            '/current/path': {
              projectId: 'id-one',
              name: 'mapped-target',
              mode: 'in-repo',
              home: 'mapped-target',
              lastSeen: new Date().toISOString(),
            },
          },
        })
      );

      adoptLegacyMachineData({ env: {}, homedir: tempDir });

      expect(
        fs.readFileSync(path.join(newRoot(), 'projects', 'ambiguous-home', 'marker.txt'), 'utf-8')
      ).toBe('ambiguous content\n');
      expect(fs.existsSync(path.join(newRoot(), 'projects', 'mapped-target'))).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('ambiguous entries'));
    });

    // The never-overwrite skip inside adoptProjectsSubtree must always be
    // visible, not just for collisions — a silent skip is what let the
    // original bug hide behind a "clean" doctor probe.
    it('warns (does not silently skip) when a per-home destination already exists', () => {
      fs.mkdirSync(path.join(oldDataDir(), 'projects', 'already-there'), { recursive: true });
      fs.writeFileSync(path.join(oldDataDir(), 'projects', 'already-there', 'marker.txt'), 'old\n');

      fs.mkdirSync(path.join(newRoot(), 'projects', 'already-there'), { recursive: true });
      fs.writeFileSync(path.join(newRoot(), 'projects', 'already-there', 'marker.txt'), 'current\n');

      adoptLegacyMachineData({ env: {}, homedir: tempDir });

      expect(
        fs.readFileSync(path.join(newRoot(), 'projects', 'already-there', 'marker.txt'), 'utf-8')
      ).toBe('current\n');
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('left behind'));
    });
  });

  describe('checkMachineRootRelocation (doctor D4 probe)', () => {
    function oldDataDir(): string {
      return os.platform() === 'win32'
        ? path.join(tempDir, 'AppData', 'Local', 'rasen')
        : path.join(tempDir, '.local', 'share', 'rasen');
    }

    it('returns nothing in the clean state (no old-scheme directory)', () => {
      const result = checkMachineRootRelocation({ env: {}, homedir: tempDir });
      expect(result).toEqual([]);
    });

    it('reports pending/failed relocation when the old dir exists and the target lacks content', () => {
      fs.mkdirSync(path.join(oldDataDir(), 'projects'), { recursive: true });

      const result = checkMachineRootRelocation({ env: {}, homedir: tempDir });

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe(oldDataDir());
      expect(result[0].targetHasContent).toBe(false);
    });

    it('reports a lingering directory after a successful adoption', () => {
      fs.mkdirSync(path.join(oldDataDir(), 'projects'), { recursive: true });
      fs.writeFileSync(path.join(oldDataDir(), 'projects', 'registry.json'), '{"version":1,"projects":{}}');

      adoptLegacyMachineData({ env: {}, homedir: tempDir });
      const result = checkMachineRootRelocation({ env: {}, homedir: tempDir });

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe(oldDataDir());
      expect(result[0].targetHasContent).toBe(true);
    });

    it('skips a resolution whose env override is active', () => {
      fs.mkdirSync(path.join(oldDataDir(), 'projects'), { recursive: true });

      const result = checkMachineRootRelocation({ env: { XDG_DATA_HOME: path.join(tempDir, 'xdg') }, homedir: tempDir });

      expect(result).toEqual([]);
    });

    it('reports pending, not lingering, when the target is non-empty but holds only UNRELATED content (review m1)', () => {
      fs.mkdirSync(path.join(oldDataDir(), 'projects'), { recursive: true });

      const newRoot = path.join(tempDir, '.rasen');
      fs.mkdirSync(path.join(newRoot, 'unrelated-stuff'), { recursive: true });

      const result = checkMachineRootRelocation({ env: {}, homedir: tempDir });

      expect(result).toHaveLength(1);
      // The target is non-empty, but none of it is the old dir's own
      // content — a coarse "target non-empty" check would wrongly call this
      // lingering/safe-to-delete.
      expect(result[0].targetHasContent).toBe(false);
    });

    it('reports pending, not lingering, when adoption partially failed (some but not all children present)', () => {
      fs.mkdirSync(path.join(oldDataDir(), 'projects'), { recursive: true });
      fs.mkdirSync(path.join(oldDataDir(), 'stores'), { recursive: true });

      // Only ONE of the old dir's two children made it to the target —
      // simulates a partial per-child adoption failure.
      const newRoot = path.join(tempDir, '.rasen');
      fs.mkdirSync(path.join(newRoot, 'projects'), { recursive: true });

      const result = checkMachineRootRelocation({ env: {}, homedir: tempDir });

      expect(result).toHaveLength(1);
      expect(result[0].targetHasContent).toBe(false);
    });

    // Round-1 review Major: with a collision-ambiguous old registry (two old
    // homes sharing one projectId), the presence check must resolve each old
    // home the SAME collision-safe way adoption does (own name, not the
    // ambiguous shared mapping) — and must NOT report the subtree as fully
    // adopted while one of the ambiguous homes genuinely never made it over.
    it('does not report a collision-ambiguous subtree as fully adopted when one home failed to copy', () => {
      fs.mkdirSync(path.join(oldDataDir(), 'projects', 'home-alpha'), { recursive: true });
      fs.mkdirSync(path.join(oldDataDir(), 'projects', 'home-beta'), { recursive: true });
      fs.writeFileSync(
        path.join(oldDataDir(), 'projects', 'registry.json'),
        JSON.stringify({
          version: 1,
          projects: {
            '/old/alpha': {
              projectId: 'dup-id',
              name: 'home-alpha',
              mode: 'in-repo',
              home: 'home-alpha',
              lastSeen: new Date().toISOString(),
            },
            '/old/beta': {
              projectId: 'dup-id',
              name: 'home-beta',
              mode: 'in-repo',
              home: 'home-beta',
              lastSeen: new Date().toISOString(),
            },
          },
        })
      );

      const newRoot = path.join(tempDir, '.rasen');
      fs.mkdirSync(path.join(newRoot, 'projects'), { recursive: true });
      fs.writeFileSync(
        path.join(newRoot, 'projects', 'registry.json'),
        JSON.stringify({
          version: 1,
          projects: {
            '/current/path': {
              projectId: 'dup-id',
              name: 'shared-home',
              mode: 'in-repo',
              home: 'shared-home',
              lastSeen: new Date().toISOString(),
            },
          },
        })
      );
      // Only home-alpha (resolved under its own collision-safe name) is
      // present at the target; home-beta genuinely never made it over.
      fs.mkdirSync(path.join(newRoot, 'projects', 'home-alpha'), { recursive: true });

      const result = checkMachineRootRelocation({ env: {}, homedir: tempDir });

      expect(result).toHaveLength(1);
      // A naive mapping-trusting check would see "shared-home" absent (or
      // present via the OTHER old entry) and could misreport this as fully
      // adopted; the collision-safe check must correctly see home-beta's own
      // name is still missing and report NOT fully adopted.
      expect(result[0].targetHasContent).toBe(false);
    });
  });

  // End-to-end relocation proof (design D3): a registered project's home and
  // registry, seeded under the OLD scheme, must be readable byte-identical
  // (modulo lastSeen, which registerProject itself sets) under the NEW root
  // after adoption — no registry rewrite occurs.
  describe('end-to-end relocation proof (design D3)', () => {
    it('resolveProjectHome/findProjectRegistryEntry find the adopted project under the new root', async () => {
      const oldDataDir = os.platform() === 'win32'
        ? path.join(tempDir, 'AppData', 'Local', 'rasen')
        : path.join(tempDir, '.local', 'share', 'rasen');
      const newRoot = path.join(tempDir, '.rasen');

      const fixtureProjectRoot = path.join(tempDir, 'fixture-project');
      fs.mkdirSync(fixtureProjectRoot, { recursive: true });

      // Seed a registration directly under the OLD-scheme global data dir.
      const seeded = await registerProject(
        { projectRoot: fixtureProjectRoot, projectId: 'fixture-project-id', mode: 'in-repo' },
        { globalDataDir: oldDataDir }
      );
      const workFile = path.join(getProjectHomeDir(seeded.entry.home, { globalDataDir: oldDataDir }), 'changes', 'demo', 'work', 'notes.txt');
      fs.mkdirSync(path.dirname(workFile), { recursive: true });
      fs.writeFileSync(workFile, 'hello from the old scheme\n');

      const registryBefore = fs.readFileSync(getProjectRegistryPath({ globalDataDir: oldDataDir }), 'utf-8');

      adoptLegacyMachineData({ env: {}, homedir: tempDir });

      // No registry rewrite: byte-identical copy at the new root.
      const registryAfter = fs.readFileSync(getProjectRegistryPath({ globalDataDir: newRoot }), 'utf-8');
      expect(registryAfter).toBe(registryBefore);

      const found = await findProjectRegistryEntry(fixtureProjectRoot, { globalDataDir: newRoot });
      expect(found).not.toBeNull();
      expect(found!.entry.home).toBe(seeded.entry.home);
      expect(found!.entry.lastSeen).toBe(seeded.entry.lastSeen);

      const adoptedWorkFile = path.join(getProjectHomeDir(seeded.entry.home, { globalDataDir: newRoot }), 'changes', 'demo', 'work', 'notes.txt');
      expect(fs.readFileSync(adoptedWorkFile, 'utf-8')).toBe('hello from the old scheme\n');
    });
  });
});
