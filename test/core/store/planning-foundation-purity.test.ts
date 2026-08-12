import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Layer-0 Store-planning v2 modules re-exported by `planning-foundation.ts`
 * (design Decision 9). Each must stay free of filesystem, registry, cwd,
 * environment, command, and Git-process access so the contract layer stays
 * pure and side-effect-free. The barrel file itself is intentionally excluded
 * here — its whole purpose is to aggregate the five modules below, so it
 * legitimately imports sibling specifiers this allowlist does not cover.
 */
const LAYER_0_MODULES = [
  'planning-validation.ts',
  'planning-catalogs.ts',
  'planning-identity.ts',
  'planning-layout-v2.ts',
  'finalization-v2.ts',
] as const;

const STORE_DIR = path.resolve(__dirname, '../../../src/core/store');

const ALLOWED_IMPORT_SPECIFIERS = new Set([
  'zod',
  'yaml',
  'node:crypto',
  'node:path',
  '../canonical-json.js',
  '../zod-issues.js',
  '../id.js',
  './identity-types.js',
  './remote.js',
  './planning-validation.js',
  './planning-identity.js',
]);

const FORBIDDEN_PATTERNS: ReadonlyArray<{ readonly label: string; readonly pattern: RegExp }> = [
  { label: 'node:fs', pattern: /(?:^|['"])(?:node:)?fs(?:\/promises)?(?:['"])/u },
  { label: 'node:child_process', pattern: /(?:^|['"])(?:node:)?child_process['"]/u },
  { label: 'execSync', pattern: /\bexecSync\b/u },
  { label: 'spawn', pattern: /\bspawn(?:Sync)?\s*\(/u },
  { label: 'node:os', pattern: /(?:^|['"])(?:node:)?os['"]/u },
  { label: 'process.cwd', pattern: /\bprocess\.cwd\s*\(/u },
  { label: 'process.env', pattern: /\bprocess\.env\b/u },
  { label: 'Store registry', pattern: /\.\/registry\.js|StoreRegistry/u },
];

function readLayer0Source(fileName: string): string {
  return fs.readFileSync(path.join(STORE_DIR, fileName), 'utf8');
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const importPattern = /\bimport\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/gu;
  let match: RegExpExecArray | null;
  while ((match = importPattern.exec(source)) !== null) {
    specifiers.push(match[1]!);
  }
  return specifiers;
}

describe('Store planning v2 Layer-0 purity', () => {
  it.each(LAYER_0_MODULES)('reads %s from disk', fileName => {
    expect(() => readLayer0Source(fileName)).not.toThrow();
  });

  it.each(LAYER_0_MODULES)('imports only allowlisted specifiers in %s', fileName => {
    const source = readLayer0Source(fileName);
    const specifiers = importSpecifiers(source);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(ALLOWED_IMPORT_SPECIFIERS.has(specifier)).toBe(true);
    }
  });

  it.each(LAYER_0_MODULES)(
    'contains no filesystem, process, or registry access in %s',
    fileName => {
      const source = readLayer0Source(fileName);
      for (const { label, pattern } of FORBIDDEN_PATTERNS) {
        expect(pattern.test(source), `${fileName} must not reference ${label}`).toBe(false);
      }
    }
  );
});
