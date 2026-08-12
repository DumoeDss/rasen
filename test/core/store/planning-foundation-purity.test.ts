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

const SRC_DIR = path.resolve(__dirname, '../../../src');
const STORE_DIR = path.join(SRC_DIR, 'core', 'store');

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

/**
 * Design Decision 9 does not only claim the list above is closed — it claims it
 * is *transitively sound*, because each allowlisted dependency was read by hand
 * once. Prose cannot hold that: a forbidden import added to an allowlisted
 * dependency makes the Layer-0 purity claim false without touching a Layer-0
 * file. The guard therefore walks the whole dependency closure and holds every
 * file it reaches to an explicit allowlist — this one for the dependencies, the
 * narrower Layer-0 list above for the five contract modules themselves.
 */
const ALLOWED_DEPENDENCY_SPECIFIERS = new Set([
  'zod',
  'canonicalize',
  'node:crypto',
  './errors.js',
]);

/** Dependencies design Decision 9 names; the walk must actually reach them. */
const EXPECTED_DEPENDENCY_LABELS = [
  'core/canonical-json.ts',
  'core/id.ts',
  'core/store/errors.ts',
  'core/store/identity-types.ts',
  'core/store/remote.ts',
  'core/zod-issues.ts',
] as const;

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

/**
 * Static `import ... from '...'`, bare `import '...'`, `export ... from '...'`,
 * and dynamic `import('...')`. The dynamic form is not a curiosity: a single
 * `await import('./foundation.js')` reaches `node:fs`, the Store registry, and
 * the global data dir, so a guard that only reads static imports can be walked
 * straight past.
 */
function collectModuleSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/gu,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      specifiers.push(match[1]!);
    }
  }
  return specifiers;
}

function resolveRelativeSpecifier(specifier: string, importer: string): string {
  const base = path.resolve(path.dirname(importer), specifier.replace(/\.js$/u, ''));
  const direct = `${base}.ts`;
  return fs.existsSync(direct) ? direct : path.join(base, 'index.ts');
}

interface ClosureModule {
  readonly label: string;
  readonly source: string;
  readonly allowed: ReadonlySet<string>;
}

function buildLayer0Closure(): ClosureModule[] {
  const seeds = LAYER_0_MODULES.map(fileName => path.join(STORE_DIR, fileName));
  const seen = new Map<string, ClosureModule>();
  const queue = [...seeds];

  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    const allowed = seeds.includes(file)
      ? ALLOWED_IMPORT_SPECIFIERS
      : ALLOWED_DEPENDENCY_SPECIFIERS;
    seen.set(file, {
      label: path.relative(SRC_DIR, file).split(path.sep).join('/'),
      source: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '',
      allowed,
    });
    for (const specifier of collectModuleSpecifiers(seen.get(file)!.source)) {
      // Only ALLOWLISTED edges are followed, which keeps the walked set exactly
      // the governed set: a specifier outside the allowlist is a finding of its
      // own (reported by name below), not a licence to drag half the tree into
      // this guard's surface and bury the finding under it.
      if (!specifier.startsWith('.') || !allowed.has(specifier)) continue;
      const dependency = resolveRelativeSpecifier(specifier, file);
      if (fs.existsSync(dependency)) queue.push(dependency);
    }
  }

  return [...seen.values()].sort((left, right) => left.label.localeCompare(right.label));
}

const LAYER_0_CLOSURE = buildLayer0Closure();

describe('Store planning v2 Layer-0 purity', () => {
  it('walks exactly the Layer-0 modules and the dependencies Decision 9 claims are sound', () => {
    // Exact, not `arrayContaining`: the governed set is the whole point, so
    // growing it must be a visible diff someone approves — the same reason the
    // specifier allowlists are explicit lists rather than inferred patterns.
    expect(LAYER_0_CLOSURE.map(module => module.label).sort()).toEqual(
      [
        ...LAYER_0_MODULES.map(fileName => `core/store/${fileName}`),
        ...EXPECTED_DEPENDENCY_LABELS,
      ].sort()
    );
  });

  it.each(LAYER_0_CLOSURE)('reads $label from disk', module => {
    expect(module.source.length).toBeGreaterThan(0);
  });

  it.each(LAYER_0_MODULES)('collects at least one import specifier from %s', fileName => {
    const module = LAYER_0_CLOSURE.find(entry => entry.label === `core/store/${fileName}`);
    expect(module).toBeDefined();
    expect(collectModuleSpecifiers(module!.source).length).toBeGreaterThan(0);
  });

  it.each(LAYER_0_CLOSURE)('imports only allowlisted specifiers in $label', module => {
    for (const specifier of collectModuleSpecifiers(module.source)) {
      expect(
        module.allowed.has(specifier),
        `${module.label} must not import '${specifier}'`
      ).toBe(true);
    }
  });

  it.each(LAYER_0_CLOSURE)(
    'contains no filesystem, process, or registry access in $label',
    module => {
      for (const { label, pattern } of FORBIDDEN_PATTERNS) {
        expect(pattern.test(module.source), `${module.label} must not reference ${label}`).toBe(
          false
        );
      }
    }
  );
});
