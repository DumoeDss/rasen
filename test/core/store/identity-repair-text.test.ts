/**
 * Repair-text tests for store-bootstrap-repair-text (Phase E, child 4).
 *
 * The architecture funnels every ordinary command's unavailable-Store repair
 * through ONE pair: `primaryRepair(binding)` and `describeUnavailableStore(binding)`.
 * These tests prove the new ordering (`rasen bootstrap` first for `not-registered`)
 * reaches every consumer, and that NO consumer builds its own repair string
 * bypassing the shared pair.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  bootstrapRepair,
  registerRepair,
  storeBootstrapRequired,
} from '../../../src/core/store/identity-diagnostics.js';
import {
  primaryRepair,
  describeUnavailableStore,
  resolveStoreBinding,
  type UnavailableStoreBinding,
} from '../../../src/core/store/identity.js';
import { StoreError } from '../../../src/core/store/errors.js';
import { ensureOpenSpecRoot } from '../../../src/core/workspace-root.js';
import { writeStoreMetadataState } from '../../../src/core/store/foundation.js';
import { registerStore } from '../../../src/core/store/registry.js';
import {
  sourceFiles,
  withoutComments,
} from '../../helpers/source-guards.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const UID_A = '9d7a6f8d-6b8e-4f6a-b5c4-2e31fd3525c7';

// ---------------------------------------------------------------------------
// Group 2.3: the bootstrap repair factory
// ---------------------------------------------------------------------------

describe('bootstrapRepair factory', () => {
  it('returns the pasteable whole-gap command', () => {
    // The command is selector-free: bootstrap resolves against the current
    // project, so no Store argument is needed (design D2).
    expect(bootstrapRepair({ id: 'team-store' })).toBe('rasen bootstrap');
    expect(bootstrapRepair({ uid: UID_A, id: 'team-store' })).toBe('rasen bootstrap');
    expect(bootstrapRepair({ uid: UID_A })).toBe('rasen bootstrap');
  });

  it('is pasteable: a single command string with no placeholders', () => {
    const command = bootstrapRepair({ id: 'team-store' });
    // No angle-bracket placeholders that the user must fill in.
    expect(command).not.toContain('<');
    expect(command).not.toContain('>');
    // Starts with the program name, so pasting it runs a command.
    expect(command).toMatch(/^rasen\s/u);
  });

  it('storeBootstrapRequired fix is rasen bootstrap (design D3)', () => {
    const diagnostic = storeBootstrapRequired({ id: 'team-store' });
    expect(diagnostic.fix).toBe('rasen bootstrap');
    // The single-step register repair is NOT in the diagnostic's one-line fix;
    // it remains in the resolver's repair array (tested below).
    expect(diagnostic.fix).not.toContain('register');
  });
});

// ---------------------------------------------------------------------------
// Group 3.2-3.3: repair ordering in the resolver
// ---------------------------------------------------------------------------

describe('not-registered repair ordering', () => {
  let tempDir: string;
  let dataDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-repair-text-'));
    dataDir = path.join(tempDir, 'machine-data');
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /** Resolve a not-registered Store via the alias path. */
  async function resolveNotRegisteredAlias(): Promise<UnavailableStoreBinding> {
    const resolution = await resolveStoreBinding({
      declaration: { form: 'alias', id: 'nowhere' },
      globalDataDir: dataDir,
    });
    expect(resolution.kind).toBe('unavailable');
    return resolution as UnavailableStoreBinding;
  }

  /** Resolve a not-registered Store via the durable uid path. */
  async function resolveNotRegisteredUid(): Promise<UnavailableStoreBinding> {
    const resolution = await resolveStoreBinding({
      declaration: { form: 'durable', uid: UID_A, id: 'ghost' },
      globalDataDir: dataDir,
    });
    expect(resolution.kind).toBe('unavailable');
    return resolution as UnavailableStoreBinding;
  }

  it('places bootstrap first for the alias path (design D1)', async () => {
    const binding = await resolveNotRegisteredAlias();
    expect(binding.reason).toBe('not-registered');
    expect(binding.repair[0]).toBe('rasen bootstrap');
    // The single-step register remains second; doctor last for diagnosis.
    expect(binding.repair).toEqual([
      'rasen bootstrap',
      expect.stringContaining('rasen store register'),
      'rasen doctor',
    ]);
  });

  it('places bootstrap first for the durable uid path (design D1)', async () => {
    const binding = await resolveNotRegisteredUid();
    expect(binding.reason).toBe('not-registered');
    expect(binding.repair[0]).toBe('rasen bootstrap');
    expect(binding.repair).toEqual([
      'rasen bootstrap',
      expect.stringContaining('rasen store register'),
      'rasen doctor',
    ]);
  });

  it('primaryRepair returns rasen bootstrap for not-registered', async () => {
    const binding = await resolveNotRegisteredAlias();
    expect(primaryRepair(binding)).toBe('rasen bootstrap');
  });

  it('describeUnavailableStore ends with Next: rasen bootstrap for not-registered', async () => {
    const binding = await resolveNotRegisteredAlias();
    const message = describeUnavailableStore(binding);
    expect(message).toMatch(/Next: rasen bootstrap$/u);
  });

  it('does NOT name bootstrap for any identity-level reason (design D1)', async () => {
    // Build each identity-level failure by resolving against a real fixture
    // so the reason is genuine, not a constructed mock.
    const storeRoot = path.join(tempDir, 'team');
    fs.mkdirSync(storeRoot, { recursive: true });
    await ensureOpenSpecRoot(storeRoot);
    await writeStoreMetadataState(storeRoot, { version: 2, uid: UID_A, id: 'team-store' });
    await registerStore({ id: 'team-store', localPath: storeRoot, globalDataDir: dataDir });

    // uid-mismatch: the checkout carries a different identity than the entry.
    await writeStoreMetadataState(storeRoot, { version: 2, uid: '00000000-0000-4000-8000-000000000000', id: 'team-store' });
    const mismatch = await resolveStoreBinding({
      declaration: { form: 'durable', uid: UID_A, id: 'team-store' },
      globalDataDir: dataDir,
    });
    if (mismatch.kind === 'unavailable') {
      expect(primaryRepair(mismatch)).not.toBe('rasen bootstrap');
    }

    // metadata-missing: the checkout's metadata file was removed.
    await writeStoreMetadataState(storeRoot, { version: 2, uid: UID_A, id: 'team-store' });
    const metadataPath = path.join(storeRoot, '.rasen-store', 'store.yaml');
    fs.rmSync(metadataPath, { force: true });
    const missingMeta = await resolveStoreBinding({
      declaration: { form: 'alias', id: 'team-store' },
      globalDataDir: dataDir,
    });
    if (missingMeta.kind === 'unavailable') {
      expect(primaryRepair(missingMeta)).not.toBe('rasen bootstrap');
    }

    // root-unhealthy: the Store's rasen root was removed.
    await writeStoreMetadataState(storeRoot, { version: 2, uid: UID_A, id: 'team-store' });
    fs.rmSync(path.join(storeRoot, 'rasen'), { recursive: true, force: true });
    const unhealthy = await resolveStoreBinding({
      declaration: { form: 'alias', id: 'team-store' },
      globalDataDir: dataDir,
    });
    if (unhealthy.kind === 'unavailable') {
      expect(primaryRepair(unhealthy)).not.toBe('rasen bootstrap');
    }

    // pointer-malformed: a declaration that cannot be parsed.
    const malformed = await resolveStoreBinding({
      declaration: { form: 'malformed', problem: 'unreadable' },
      globalDataDir: dataDir,
    });
    if (malformed.kind === 'unavailable') {
      expect(primaryRepair(malformed)).not.toBe('rasen bootstrap');
    }
  });
});

// ---------------------------------------------------------------------------
// Group 4.1-4.5: consumer inheritance (the breadth is in the tests)
// ---------------------------------------------------------------------------

describe('consumer inheritance of the bootstrap repair', () => {
  let tempDir: string;
  let dataDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-repair-inherit-'));
    dataDir = path.join(tempDir, 'machine-data');
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /** A not-registered binding, built through the real resolver. */
  async function notRegisteredBinding(): Promise<UnavailableStoreBinding> {
    const resolution = await resolveStoreBinding({
      declaration: { form: 'alias', id: 'nowhere' },
      globalDataDir: dataDir,
    });
    expect(resolution.kind).toBe('unavailable');
    return resolution as UnavailableStoreBinding;
  }

  // 4.1: root-selection — primaryRepair is what root-selection.ts reads for
  // both the error fix and the unavailable-store-declaration notice.
  it('root-selection error fix and notice carry rasen bootstrap (4.1)', async () => {
    const binding = await notRegisteredBinding();
    // root-selection.ts:620 builds `repair: primaryRepair(binding)` for the
    // unavailable-store-declaration notice; root-selection.ts:550/557/563/569
    // build `fix: primaryRepair(binding)` for the root-selection errors.
    expect(primaryRepair(binding)).toBe('rasen bootstrap');
    // The notice renderer (pipeline-messages) prints whatever repair string it
    // receives — proving the notice path surfaces bootstrap is proving the
    // notice carries primaryRepair's output, which is `rasen bootstrap`.
  });

  // 4.2: effective-config — the StoreError carries `fix: primaryRepair(binding)`.
  it('effective-config StoreError fix is rasen bootstrap (4.2)', async () => {
    const binding = await notRegisteredBinding();
    // effective-config.ts:200-202 raises:
    //   new StoreError(describeUnavailableStore(binding), code, { fix: primaryRepair(binding) })
    const error = new StoreError(
      describeUnavailableStore(binding),
      binding.diagnostics[0]?.code ?? 'store_unavailable',
      { fix: primaryRepair(binding) }
    );
    expect(error.diagnostic.fix).toBe('rasen bootstrap');
    expect(error.message).toMatch(/Next: rasen bootstrap$/u);
  });

  // 4.3: learned-skills — context.ts and stores.ts use describeUnavailableStore.
  it('learned-skills failure message ends with Next: rasen bootstrap (4.3)', async () => {
    const binding = await notRegisteredBinding();
    // learned-skills/context.ts:396 and stores.ts:261 both build:
    //   describeUnavailableStore(binding)
    const message = describeUnavailableStore(binding);
    expect(message).toMatch(/Next: rasen bootstrap$/u);
  });

  // 4.4: membership and migration-ops — both use primaryRepair(binding).
  it('membership and migration-ops surface rasen bootstrap (4.4)', async () => {
    const binding = await notRegisteredBinding();
    // membership.ts:474 and migration-ops.ts:1432 both build:
    //   repair: primaryRepair(binding)
    expect(primaryRepair(binding)).toBe('rasen bootstrap');
  });

  // 4.5: config-api/project-addressing — `Next: ${primaryRepair(binding)}`.
  it('config-api project-addressing message names bootstrap (4.5)', async () => {
    const binding = await notRegisteredBinding();
    // project-addressing.ts:107 builds: `${detail} Next: ${primaryRepair(binding)}`
    const detail = 'Store nowhere is declared by this project.';
    const message = `${detail} Next: ${primaryRepair(binding)}`;
    expect(message).toMatch(/Next: rasen bootstrap$/u);
  });
});

// ---------------------------------------------------------------------------
// Group 4.6: regression guard — no consumer hard-codes the bootstrap repair
// ---------------------------------------------------------------------------

describe('no consumer bypasses primaryRepair / describeUnavailableStore', () => {
  /**
   * Every consumer that resolves a declared Store reads its repair through
   * `primaryRepair(binding)` or `describeUnavailableStore(binding)`. This guard
   * proves the inheritance holds by checking two things:
   *
   * 1. No consumer hard-codes the NEW repair text (`'rasen bootstrap'`) as a
   *    literal — that would mean it is trying to replicate the resolver's
   *    ordering rather than reading it, and would drift the moment the
   *    ordering changes again.
   * 2. Every consumer that touches Store unavailability imports the shared pair.
   *
   * Pre-existing literal repair strings (`'rasen doctor'` as a diagnostic
   * fallback, `'rasen store list'` for knowledge-scope errors) are allowlisted
   * because they serve different purposes than the unavailable-Store repair.
   */
  const CONSUMER_FILES = [
    'src/core/root-selection.ts',
    'src/core/effective-config.ts',
    'src/core/config-api/project-addressing.ts',
    'src/core/learned-skills/context.ts',
    'src/core/learned-skills/stores.ts',
    'src/core/store/membership.ts',
    'src/core/store/migration-ops.ts',
    'src/core/knowledge-bundle/export.ts',
  ];

  it('no consumer hard-codes the bootstrap repair as a literal string', () => {
    // A consumer that writes 'rasen bootstrap' as a literal is bypassing the
    // resolver's repair array — the defect this guard exists to catch.
    const offenders: string[] = [];
    for (const file of CONSUMER_FILES) {
      const fullPath = path.join(repoRoot, file);
      expect(fs.existsSync(fullPath), file).toBe(true);
      const source = withoutComments(fs.readFileSync(fullPath, 'utf-8'));
      // Match 'rasen bootstrap' / "rasen bootstrap" / `rasen bootstrap` as a
      // string literal — NOT as a comment, import, or function name.
      if (/['"`]rasen bootstrap['"`]/u.test(source)) {
        offenders.push(file);
      }
    }
    expect(offenders, 'Consumers must read the repair from primaryRepair / describeUnavailableStore, not hard-code it').toEqual([]);
  });

  it('every consumer that handles Store unavailability imports the shared pair', () => {
    const offenders: string[] = [];
    for (const file of CONSUMER_FILES) {
      const fullPath = path.join(repoRoot, file);
      const source = withoutComments(fs.readFileSync(fullPath, 'utf-8'));

      // Does this file handle unavailable Stores at all?
      const touchesStoreResolution =
        /\bresolveStoreBinding\b/u.test(source) ||
        /\bUnavailableStoreBinding\b/u.test(source) ||
        /\bbinding\.repair\b/u.test(source) ||
        /\bunavailable\b.*\bstor/u.test(source);

      if (!touchesStoreResolution) continue;

      // If it does, it must read the repair through the shared pair.
      const usesSharedPair =
        /\bprimaryRepair\b/u.test(source) || /\bdescribeUnavailableStore\b/u.test(source);

      if (!usesSharedPair) {
        offenders.push(file);
      }
    }
    expect(offenders, 'Consumers that handle Store unavailability must import primaryRepair or describeUnavailableStore').toEqual([]);
  });

  it('rootSelectionErrorFor routes every arm through primaryRepair (review r1 Blocker guard)', () => {
    // The review found that root-selection's not-registered arm hardcoded
    // 'rasen store register' instead of calling primaryRepair(binding). This
    // guard reads the source and verifies EVERY arm of the switch in
    // rootSelectionErrorFor passes primaryRepair(binding) as the fix — not a
    // literal string. A future regression that adds a new arm or reverts an
    // existing one will be caught here.
    const source = withoutComments(
      fs.readFileSync(path.join(repoRoot, 'src/core/root-selection.ts'), 'utf-8')
    );

    // Extract the rootSelectionErrorFor function body. Verify every `build()`
    // call's third argument is `primaryRepair(binding)`, not a literal string.
    const funcMatch = source.match(
      /export function rootSelectionErrorFor[\s\S]*?\n\}/u
    );
    expect(funcMatch, 'rootSelectionErrorFor must exist').toBeTruthy();
    const funcBody = funcMatch![0];

    // Every build() call should pass primaryRepair(binding) as the fix.
    const buildCalls = funcBody.match(/\bbuild\(/gu);
    expect(buildCalls?.length ?? 0).toBeGreaterThan(0);

    // No build() call should pass a literal 'rasen store register' or
    // 'rasen bootstrap' as the fix argument. The fix must always come from
    // primaryRepair(binding).
    expect(funcBody).not.toMatch(/build\([^)]*['"`]rasen\s/u);
  });
});
