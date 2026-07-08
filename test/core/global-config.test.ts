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
  migrateLegacyBrandConfig,
  GLOBAL_CONFIG_DIR_NAME,
  GLOBAL_CONFIG_FILE_NAME
} from '../../src/core/global-config.js';
import type { Profile, Delivery } from '../../src/core/global-config.js';

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

    it('should fall back to ~/.config on Unix/macOS without XDG_CONFIG_HOME', () => {
      delete process.env.XDG_CONFIG_HOME;

      const result = getGlobalConfigDir();

      // On non-Windows, should use ~/.config/rasen
      if (os.platform() !== 'win32') {
        expect(result).toBe(path.join(os.homedir(), '.config', 'rasen'));
      }
    });

    it('should use APPDATA on Windows when XDG_CONFIG_HOME is not set', () => {
      // This test only makes sense conceptually - we can't change os.platform()
      // But we can verify the APPDATA logic by checking the code path
      if (os.platform() === 'win32') {
        delete process.env.XDG_CONFIG_HOME;
        const appData = process.env.APPDATA;
        if (appData) {
          const result = getGlobalConfigDir();
          expect(result).toBe(path.join(appData, 'rasen'));
        }
      }
    });
  });

  describe('getGlobalConfigPath', () => {
    it('should return path to config.json in config directory', () => {
      process.env.XDG_CONFIG_HOME = tempDir;

      const result = getGlobalConfigPath();

      expect(result).toBe(path.join(tempDir, 'rasen', 'config.json'));
    });
  });

  describe('getGlobalDataDir', () => {
    it('should use POSIX separators for Unix-like platform overrides', () => {
      expect(
        getGlobalDataDir({
          env: {},
          platform: 'linux',
          homedir: '/home/tabish',
        })
      ).toBe('/home/tabish/.local/share/rasen');

      expect(
        getGlobalDataDir({
          env: { XDG_DATA_HOME: '/var/data' },
          platform: 'darwin',
          homedir: '/Users/tabish',
        })
      ).toBe('/var/data/rasen');
    });

    it('should use Windows separators for native Windows platform overrides', () => {
      expect(
        getGlobalDataDir({
          env: {},
          platform: 'win32',
          homedir: 'C:\\Users\\Tabish',
        })
      ).toBe('C:\\Users\\Tabish\\AppData\\Local\\rasen');

      expect(
        getGlobalDataDir({
          env: { LOCALAPPDATA: 'D:\\Users\\Tabish\\AppData\\Local' },
          platform: 'win32',
          homedir: 'C:\\Users\\Tabish',
        })
      ).toBe('D:\\Users\\Tabish\\AppData\\Local\\rasen');
    });
  });

  describe('getGlobalConfig', () => {
    it('should return defaults when config file does not exist', () => {
      process.env.XDG_CONFIG_HOME = tempDir;

      const config = getGlobalConfig();

      expect(config).toEqual({ featureFlags: {}, profile: 'full', delivery: 'both', proactive: true, repoMode: 'collaborative' });
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

      expect(config).toEqual({ featureFlags: {}, profile: 'full', delivery: 'both', proactive: true, repoMode: 'collaborative' });
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

      it('should round-trip new fields correctly', () => {
        process.env.XDG_CONFIG_HOME = tempDir;
        const originalConfig = {
          featureFlags: { flag1: true },
          profile: 'custom' as Profile,
          delivery: 'commands' as Delivery,
          workflows: ['propose']
        };

        saveGlobalConfig(originalConfig);
        const loadedConfig = getGlobalConfig();

        expect(loadedConfig.profile).toBe('custom');
        expect(loadedConfig.delivery).toBe('commands');
        expect(loadedConfig.workflows).toEqual(['propose']);
      });

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

  describe('migrateLegacyBrandConfig', () => {
    it('adopts a legacy rasen config dir, preserving anonymousId', () => {
      process.env.XDG_CONFIG_HOME = tempDir;
      process.env.XDG_DATA_HOME = tempDir;

      const legacyDir = path.join(tempDir, 'openspec');
      fs.mkdirSync(legacyDir, { recursive: true });
      fs.writeFileSync(
        path.join(legacyDir, 'config.json'),
        JSON.stringify({ anonymousId: 'abc-123', noticeSeen: true })
      );

      migrateLegacyBrandConfig();

      const newConfigPath = path.join(tempDir, 'rasen', 'config.json');
      expect(fs.existsSync(newConfigPath)).toBe(true);
      const migrated = JSON.parse(fs.readFileSync(newConfigPath, 'utf-8'));
      expect(migrated.anonymousId).toBe('abc-123');
      expect(migrated.noticeSeen).toBe(true);
      // Copy-not-move: legacy dir is never deleted.
      expect(fs.existsSync(path.join(legacyDir, 'config.json'))).toBe(true);
    });

    it('does not overwrite an existing new-brand dir', () => {
      process.env.XDG_CONFIG_HOME = tempDir;
      process.env.XDG_DATA_HOME = tempDir;

      const legacyDir = path.join(tempDir, 'openspec');
      fs.mkdirSync(legacyDir, { recursive: true });
      fs.writeFileSync(
        path.join(legacyDir, 'config.json'),
        JSON.stringify({ anonymousId: 'legacy-id' })
      );

      const newDir = path.join(tempDir, 'rasen');
      fs.mkdirSync(newDir, { recursive: true });
      fs.writeFileSync(
        path.join(newDir, 'config.json'),
        JSON.stringify({ anonymousId: 'existing-id' })
      );

      migrateLegacyBrandConfig();

      const kept = JSON.parse(
        fs.readFileSync(path.join(newDir, 'config.json'), 'utf-8')
      );
      expect(kept.anonymousId).toBe('existing-id');
    });

    it('is a no-op when no legacy dir exists (normal first-write path)', () => {
      process.env.XDG_CONFIG_HOME = tempDir;
      process.env.XDG_DATA_HOME = tempDir;

      migrateLegacyBrandConfig();

      expect(fs.existsSync(path.join(tempDir, 'rasen'))).toBe(false);
    });

    it('swallows adverse filesystem state so startup cannot break', () => {
      process.env.XDG_CONFIG_HOME = tempDir;
      process.env.XDG_DATA_HOME = tempDir;

      // Legacy path exists but is a *file*, not a directory — an unexpected
      // filesystem shape. Migration must skip it gracefully, never throw.
      fs.writeFileSync(path.join(tempDir, 'openspec'), 'not a directory\n');

      expect(() => migrateLegacyBrandConfig()).not.toThrow();
      // Adverse legacy shape is not adopted.
      expect(fs.existsSync(path.join(tempDir, 'rasen'))).toBe(false);
    });
  });
});
