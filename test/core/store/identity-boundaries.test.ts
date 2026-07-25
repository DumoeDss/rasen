import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  STORE_IDENTITY_DIAGNOSTIC_CODES,
  storeAliasAmbiguous,
  storeAliasNumeric,
  storeBootstrapRequired,
  storeMetadataLegacy,
  storePointerAliasDrift,
  storePointerLegacy,
  storePointerRemoteDivergence,
  storeAliasRenamed,
  storeAliasRepeated,
  storeRegistryRekeyBlocked,
  storeRemoteCredentials,
  storeRemoteDivergence,
  storeUidMismatch,
} from '../../../src/core/store/identity-diagnostics.js';
import { getLocaleCatalog } from '../../../src/locales/index.js';
import { SUPPORTED_CLI_LOCALES } from '../../../src/utils/locale.js';
import { PIPELINE_MESSAGE_KEYS } from '../../../src/commands/pipeline-messages.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * The Phase A file set (design D12): every file that resolves a Store must do
 * it through `resolveStoreBinding`, not the compat reader. Children C and D
 * MUST add their files here when they migrate their own consumers, or the ban
 * silently stops covering them.
 */
const PHASE_A_FILES = [
  'src/core/root-selection.ts',
  'src/core/effective-config.ts',
  'src/core/config-api/project-addressing.ts',
  'src/core/config-api/config-context.ts',
  'src/core/relationship-health.ts',
  'src/core/project-home.ts',
  'src/core/store/identity.ts',
  'src/core/store/migration-ops.ts',
  'src/core/agent-context.ts',
  'src/commands/doctor.ts',
  'src/commands/store.ts',
  'src/commands/config.ts',
  'src/commands/pipeline.ts',
];

/**
 * Consumers deliberately left on the compat reader, each with the sibling
 * change that retires it. Listed here so a reviewer can see the boundary is
 * scoped, not forgotten — and asserted to be EXHAUSTIVE below, so a file that
 * quietly starts using the compat reader cannot hide outside both lists.
 */
const DEFERRED_COMPAT_CONSUMERS = [
  'src/core/learned-skills/context.ts',
  'src/core/management-api/spaces.ts',
];

/**
 * `listRegisteredStores` lives in the first and is what the second exists to
 * do; neither is a consumer that a sibling retires.
 */
const COMPAT_READER_HOME = ['src/core/store/registry.ts', 'src/core/store/operations.ts'];

/**
 * Every read of a declaration's DISPLAY ALIAS (`pointer.value`), with why it
 * is legitimate. `pointer.value` is not "does this repo declare a Store?" — a
 * durable declaration may record only the permanent identity, leaving `value`
 * undefined — so a new site is a defect until someone justifies it here. A
 * hand-maintained file list only covers files someone remembered to add; this
 * one is derived from the source, which is how the `project-home.ts` and
 * `migration-ops.ts` misses would have been caught.
 */
const POINTER_VALUE_ALLOWLIST: Record<string, string> = {
  'src/core/project-config.ts': 'defines the shape; describeStoreDeclaration is the accessor',
  'src/core/effective-config.ts': 'reads it inside the alias arm of the declaration bridge',
  'src/commands/doctor.ts': 'reports the declared display alias, as the declared alias',
  'src/core/store/upgrade-identity.ts': 'guarded by pointer.shape === alias on the same line',
  'src/core/learned-skills/context.ts':
    'deferred compat consumer — store-aware-learned-skills-integration',
  'src/core/management-api/session-launch-context.ts':
    'deferred compat consumer — unified-session-runtime-context',
};

/**
 * Reads of a declaration's DISPLAY ALIAS, in every spelling that reaches one:
 * `pointer.value`, `classification.pointer.value`, `storePointer.value`, the
 * optional-chained `pointer?.value` a future author reaches for on a
 * possibly-undefined pointer, and `const { value } = pointer`. A guard that
 * matched only the plain property access would be evaded by the three others
 * without anyone noticing.
 */
const POINTER_VALUE_READ = /(?:^|[^\w$])[\w$]*[Pp]ointer\s*\??\.\s*value\b/u;
const POINTER_VALUE_DESTRUCTURE = /\{[^{}]*\bvalue\b[^{}]*\}\s*=\s*[\w$.]*[Pp]ointer\b/u;

function readsPointerValue(source: string): boolean {
  const code = withoutComments(source);
  return POINTER_VALUE_READ.test(code) || POINTER_VALUE_DESTRUCTURE.test(code);
}

/** Every `.ts` file under `src/`, relative to the repo root with `/` separators. */
function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.ts')) {
        found.push(path.relative(repoRoot, full).split(path.sep).join('/'));
      }
    }
  };
  walk(path.join(repoRoot, 'src'));
  return found.sort();
}

/**
 * Blanks whole-line and block comments, so a guard reads the CODE. Without
 * this, a comment naming the very pattern the guard bans (as the fix for one
 * of these defects does) reports itself as an offender.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split(/\r?\n/u)
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*');
    })
    .join('\n');
}

describe('store identity boundaries', () => {
  it('keeps every Phase A file off the compat store reader', () => {
    const offenders: string[] = [];
    for (const relativePath of PHASE_A_FILES) {
      const fullPath = path.join(repoRoot, relativePath);
      expect(fs.existsSync(fullPath), relativePath).toBe(true);
      if (/\blistRegisteredStores\b/u.test(fs.readFileSync(fullPath, 'utf-8'))) {
        offenders.push(relativePath);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('names the sibling change that retires each deferred compat consumer', () => {
    const registrySource = fs.readFileSync(
      path.join(repoRoot, 'src', 'core', 'store', 'registry.ts'),
      'utf-8'
    );
    expect(registrySource).toContain('listRegisteredStores');
    // The compat export documents who retires it, so the boundary survives
    // the next reader of this code.
    expect(registrySource).toMatch(/retire|compat/i);
    for (const consumer of DEFERRED_COMPAT_CONSUMERS) {
      expect(fs.existsSync(path.join(repoRoot, consumer)), consumer).toBe(true);
    }
  });

  it('keeps the deferred list exhaustive: no third list to fall between', () => {
    const users = sourceFiles().filter(
      (file) =>
        !COMPAT_READER_HOME.includes(file) &&
        /\blistRegisteredStores\b/u.test(withoutComments(fs.readFileSync(path.join(repoRoot, file), 'utf-8')))
    );
    expect(users).toEqual([...DEFERRED_COMPAT_CONSUMERS].sort());
  });

  it('enumerates every display-alias read, so none escapes into a guard', () => {
    const offenders = sourceFiles().filter(
      (file) =>
        POINTER_VALUE_ALLOWLIST[file] === undefined &&
        readsPointerValue(fs.readFileSync(path.join(repoRoot, file), 'utf-8'))
    );
    expect(
      offenders,
      'Asking "does this repo declare a Store?" reads hasStoreDeclaration(pointer); pointer.value is the DISPLAY ALIAS and is undefined for a uid-only declaration. Justify a new read in POINTER_VALUE_ALLOWLIST.'
    ).toEqual([]);

    // The allowlist itself cannot rot into a list of files that no longer
    // read it — a stale entry hides the next one that does.
    const stale = Object.keys(POINTER_VALUE_ALLOWLIST).filter(
      (file) => !readsPointerValue(fs.readFileSync(path.join(repoRoot, file), 'utf-8'))
    );
    expect(stale).toEqual([]);
  });

  it('catches the display-alias spellings a plain property match would miss', () => {
    // The guard's own coverage, pinned: each of these is a real read of the
    // declared display alias, and each defeated the previous pattern.
    for (const spelling of [
      'if (pointer.value !== undefined) {}',
      'const id = classification.pointer.value;',
      'const id = storePointer.value;',
      'const id = pointer?.value;',
      'const id = declaration.pointer ?. value;',
      'const { value } = pointer;',
      'const { value, durable } = storePointer;',
    ]) {
      expect(readsPointerValue(spelling), spelling).toBe(true);
    }

    // …and it does not fire on unrelated `.value` reads, which would push
    // maintainers into allowlisting files that never touch a declaration.
    for (const innocent of [
      'const x = entry.value;',
      'const y = candidate?.value;',
      'const { value } = threshold;',
    ]) {
      expect(readsPointerValue(innocent), innocent).toBe(false);
    }
  });

  it('renders one stable code, message, and repair per diagnostic', () => {
    const built = [
      storeBootstrapRequired({ id: 'team-store' }),
      storeUidMismatch({ expected: 'a', found: 'b', root: '/tmp/store' }),
      storeAliasAmbiguous({
        id: 'shared',
        candidates: [
          { uid: 'a', id: 'shared', root: '/tmp/one' },
          { uid: 'b', id: 'shared', root: '/tmp/two' },
        ],
      }),
      storePointerLegacy({ id: 'team-store' }),
      storePointerRemoteDivergence({ declared: 'https://a.test/x.git', canonical: 'https://b.test/x.git' }),
      storePointerAliasDrift({ declared: 'old', actual: 'new' }),
      storeMetadataLegacy({ id: 'team-store', metadataPath: '/tmp/store.yaml' }),
      storeRemoteCredentials({ remote: 'https://user:secret@example.test/x.git' }),
      storeAliasNumeric({ id: '2026' }),
      storeRemoteDivergence({
        recorded: 'https://a.test/x.git',
        observed: 'https://b.test/x.git',
      }),
      storeRegistryRekeyBlocked({ blockedBy: ['team-store'] }),
      storeAliasRepeated({ id: 'team-store', uid: 'a', matches: 2 }),
      storeAliasRenamed({ from: 'old-store', to: 'team-store', uid: 'a' }),
    ];

    expect(built.map((diagnostic) => diagnostic.code).sort()).toEqual(
      [...STORE_IDENTITY_DIAGNOSTIC_CODES].sort()
    );
    for (const diagnostic of built) {
      expect(diagnostic.message.length, diagnostic.code).toBeGreaterThan(0);
      expect(['error', 'warning', 'info']).toContain(diagnostic.severity);
    }
  });

  it('never leaks a credential into a diagnostic message or fix', () => {
    const diagnostic = storeRemoteCredentials({
      remote: 'https://user:hunter2@example.test/x.git',
    });
    expect(diagnostic.message).not.toContain('hunter2');
    expect(diagnostic.fix ?? '').not.toContain('hunter2');
    expect(
      storePointerRemoteDivergence({
        declared: 'https://user:hunter2@example.test/x.git',
        canonical: 'https://example.test/x.git',
      }).message
    ).not.toContain('hunter2');
    expect(
      storeRemoteDivergence({
        recorded: 'https://user:hunter2@example.test/x.git',
        observed: 'https://example.test/x.git',
      }).message
    ).not.toContain('hunter2');
  });

  it('never picks a candidate for an ambiguous display name', () => {
    const diagnostic = storeAliasAmbiguous({
      id: 'shared',
      candidates: [
        { uid: '11111111-1111-4111-8111-111111111111', id: 'shared', root: '/tmp/one' },
        { uid: '22222222-2222-4222-8222-222222222222', id: 'shared', root: '/tmp/two' },
      ],
    });

    // Pasting the repair must not durably bind the project to whichever
    // candidate happened to sort first.
    expect(diagnostic.fix).toContain('--uid <identity>');
    expect(diagnostic.fix).not.toContain('11111111-1111-4111-8111-111111111111');
    expect(diagnostic.fix).not.toContain('22222222-2222-4222-8222-222222222222');
    // Every candidate is still named, with what tells them apart.
    expect(diagnostic.message).toContain('11111111-1111-4111-8111-111111111111');
    expect(diagnostic.message).toContain('22222222-2222-4222-8222-222222222222');
    expect(diagnostic.message).toContain('/tmp/one');
    expect(diagnostic.message).toContain('/tmp/two');
  });

  it('defines every new store-identity message in all three locale bundles', () => {
    const newKeys = [
      'inheritingStoreConfigByIdentityNotice',
      'inheritingStoreConfigByAliasNotice',
      'unavailableStoreDeclaration',
      'storeReasonNotRegistered',
      'storeReasonMetadataMissing',
      'storeReasonUidMismatch',
      'storeReasonRootUnhealthy',
      'storeReasonAliasAmbiguous',
      'storeReasonPointerMalformed',
    ] as const;

    for (const key of newKeys) {
      expect(PIPELINE_MESSAGE_KEYS, key).toContain(key);
    }

    for (const locale of SUPPORTED_CLI_LOCALES) {
      const messages = getLocaleCatalog(locale).pipeline.messages as Record<string, string>;
      for (const key of newKeys) {
        expect(messages[key], `${locale}: ${key}`).toBeTruthy();
        // No English fallback: each locale must carry its own text.
        if (locale !== 'en') {
          expect(
            messages[key],
            `${locale}: ${key} still reads as the English string`
          ).not.toBe((getLocaleCatalog('en').pipeline.messages as Record<string, string>)[key]);
        }
      }
    }
  });

  it('keeps identifiers as data, never translated', () => {
    for (const locale of SUPPORTED_CLI_LOCALES) {
      const messages = getLocaleCatalog(locale).pipeline.messages as Record<string, string>;
      // Identities, names, paths, remotes, and repair commands travel as
      // placeholders — a locale that hard-coded one would break the message.
      expect(messages.unavailableStoreDeclaration).toContain('{path}');
      expect(messages.unavailableStoreDeclaration).toContain('{store}');
      expect(messages.unavailableStoreDeclaration).toContain('{reason}');
      expect(messages.unavailableStoreDeclaration).toContain('{repair}');
      expect(messages.inheritingStoreConfigByIdentityNotice).toContain('{store}');
      expect(messages.inheritingStoreConfigByAliasNotice).toContain('{store}');
      // Reason phrases carry no identifiers at all.
      for (const key of [
        'storeReasonNotRegistered',
        'storeReasonMetadataMissing',
        'storeReasonUidMismatch',
        'storeReasonRootUnhealthy',
        'storeReasonAliasAmbiguous',
        'storeReasonPointerMalformed',
      ]) {
        expect(messages[key], `${locale}: ${key}`).not.toMatch(/\{[A-Za-z]/u);
      }
    }
  });
});
