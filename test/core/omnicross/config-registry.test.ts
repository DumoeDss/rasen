import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  findConfigKeyDefinition,
  validateConfigKeyPath,
  validateConfigValue,
} from '../../../src/core/config-keys.js';
import { serializeConfigEntry } from '../../../src/core/config-api/serialize.js';
import { resolveEffectiveConfig } from '../../../src/core/effective-config.js';
import { readProjectConfig } from '../../../src/core/project-config.js';

let root: string;
let rasenHome: string;
let previousHome: string | undefined;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-omnicross-config-'));
  rasenHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-omnicross-home-'));
  previousHome = process.env.RASEN_HOME;
  process.env.RASEN_HOME = rasenHome;
  fs.mkdirSync(path.join(root, 'rasen'));
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.RASEN_HOME;
  else process.env.RASEN_HOME = previousHome;
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(rasenHome, { recursive: true, force: true });
});

describe('OmniCross config registry', () => {
  const keys = [
    'omnicross.endpoint',
    'omnicross.controlTokenEnv',
    'omnicross.requestTimeoutMs',
    'omnicross.leaseTtlSeconds',
  ] as const;

  it('registers all four keys at global/store/project scope', () => {
    for (const key of keys) {
      for (const scope of ['global', 'store', 'project'] as const) {
        expect(validateConfigKeyPath(key, scope).valid).toBe(true);
      }
      expect(findConfigKeyDefinition(key, 'project')?.group).toBe('OmniCross');
    }
  });

  it('validates loopback URLs, environment names, and numeric bounds', () => {
    const endpoint = findConfigKeyDefinition('omnicross.endpoint', 'project')!;
    expect(validateConfigValue(endpoint, 'http://[::1]:8765')).toBeNull();
    expect(validateConfigValue(endpoint, 'http://example.com:8765')).toMatch(/loopback/);
    const env = findConfigKeyDefinition('omnicross.controlTokenEnv', 'project')!;
    expect(validateConfigValue(env, 'OMNICROSS_ADMIN_TOKEN')).toBeNull();
    expect(validateConfigValue(env, 'bad-name')).toMatch(/environment/);
    const timeout = findConfigKeyDefinition('omnicross.requestTimeoutMs', 'project')!;
    expect(validateConfigValue(timeout, 100)).toBeNull();
    expect(validateConfigValue(timeout, 99)).toMatch(/100/);
    const ttl = findConfigKeyDefinition('omnicross.leaseTtlSeconds', 'project')!;
    expect(validateConfigValue(ttl, 3_600)).toBeNull();
    expect(validateConfigValue(ttl, 3_601)).toMatch(/3600/);
  });

  it('resolves project values and exposes bounded wire metadata', () => {
    fs.writeFileSync(
      path.join(root, 'rasen', 'config.yaml'),
      [
        'schema: spec-driven',
        'omnicross:',
        '  endpoint: http://127.0.0.1:8765',
        '  controlTokenEnv: TEST_OMNI_TOKEN',
        '  requestTimeoutMs: 1500',
        '  leaseTtlSeconds: 90',
        '',
      ].join('\n'),
      'utf8'
    );
    const entries = resolveEffectiveConfig({ projectRoot: root });
    expect(Object.fromEntries(
      entries.filter((entry) => entry.definition.key.startsWith('omnicross.'))
        .map((entry) => [entry.definition.key, entry.value])
    )).toEqual({
      'omnicross.endpoint': 'http://127.0.0.1:8765',
      'omnicross.controlTokenEnv': 'TEST_OMNI_TOKEN',
      'omnicross.requestTimeoutMs': 1500,
      'omnicross.leaseTtlSeconds': 90,
    });
    const timeout = entries.find((entry) => entry.definition.key === 'omnicross.requestTimeoutMs')!;
    expect(serializeConfigEntry(timeout).definition.constraints.integerRange).toEqual({
      min: 100,
      max: 60_000,
    });
  });

  it('drops invalid leaves while preserving valid siblings with diagnostics', () => {
    fs.writeFileSync(
      path.join(root, 'rasen', 'config.yaml'),
      [
        'schema: spec-driven',
        'omnicross:',
        '  endpoint: http://127.0.0.1:8765',
        '  controlTokenEnv: bad-name',
        '  requestTimeoutMs: 20',
        '  leaseTtlSeconds: 120',
        '',
      ].join('\n'),
      'utf8'
    );
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(readProjectConfig(root)?.omnicross).toEqual({
        endpoint: 'http://127.0.0.1:8765',
        leaseTtlSeconds: 120,
      });
      expect(warning.mock.calls.flat().join(' ')).toMatch(/controlTokenEnv.*requestTimeoutMs/);
    } finally {
      warning.mockRestore();
    }
  });
});
