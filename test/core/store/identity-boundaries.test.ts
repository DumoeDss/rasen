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
  projectIdentityUnrecordable,
  projectMembershipLocatorMissing,
  projectMembershipUnverified,
  sharedMetadataContainsLocalPath,
  storeLegacyReferenceUnresolved,
  storeMembershipLegacyManifest,
  storeMembershipRolesInferred,
  storeProjectRecordKeyMismatch,
  storeProjectRecordMissing,
} from '../../../src/core/store/identity-diagnostics.js';
import {
  propertyReceivers,
  sourceFiles,
  withoutComments,
} from '../../helpers/source-guards.js';
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
  // store-bootstrap-diagnose: the report resolves the project's planning
  // declaration and every membership hint through `resolveStoreBinding`, and
  // the command is the surface that prints the result — so both must stay off
  // the compat reader, whose by-id lookup would let a namesake Store be
  // reported as the declared one.
  'src/core/store/bootstrap.ts',
  'src/commands/bootstrap.ts',
  // project-keyed-store-membership: the membership provider reaches every
  // Store through `resolveStoreBinding` and enumerates the registry through
  // its own reader, so the ban must cover it.
  'src/core/store/membership.ts',
  'src/core/store/project-records.ts',
  // unified-session-runtime-context: the session launch resolver validates a
  // Store session's project choice through `resolveStoreBinding` and child B's
  // membership provider, so the by-id-lookup ban must cover it too.
  'src/core/management-api/session-launch-context.ts',
  // store-scoped-learned-knowledge: a `--store <selector>` now resolves through
  // `resolveStoreBinding`, so two Stores sharing a display name refuse instead
  // of one being picked by registry order — which for a catalog would mean
  // publishing a team's knowledge into someone else's repository.
  'src/core/learned-skills/context.ts',
  'src/core/learned-skills/stores.ts',
  'src/core/learned-skills/authority.ts',
  // learned-knowledge-effective-resolution: effective resolution reaches every
  // eligible Store through child B's provider and the pointer through
  // `resolveStoreBinding`, and the ownership-record migration ENUMERATES the
  // registry precisely so an ambiguous display name blocks instead of being
  // resolved to one of its namesakes.
  'src/core/learned-skills/effective.ts',
  'src/core/project-learned-skill-ledger.ts',
  // knowledge-bundle-export: bundle project identity is resolved through the
  // project namespace and the identity-keyed project knowledge home. Neither
  // the closed schema nor its writer may regress to display-name Store lookup.
  'src/core/knowledge-bundle/schema.ts',
  'src/core/knowledge-bundle/export.ts',
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
  // Deliberately kept (project-keyed-store-membership task 9.5): this handler
  // ENUMERATES every registered store, which the boundary permits — the ban
  // targets resolving one store by its display name. It no longer performs a
  // by-id lookup: each pointer repo's declaration now goes through
  // `resolveStoreBinding`. Child C rewrites this file's resolution and decides
  // whether to retire the enumeration import.
  'src/core/management-api/spaces.ts',
];

/**
 * `listRegisteredStores` lives in the first and is what the second exists to
 * do; neither is a consumer that a sibling retires.
 */
const COMPAT_READER_HOME = ['src/core/store/registry.ts', 'src/core/store/operations.ts'];

/**
 * Every file that reads a declaration's DISPLAY ALIAS (`pointer.value`), with
 * why it is legitimate. `pointer.value` is not "does this repo declare a
 * Store?" — a durable declaration may record only the permanent identity,
 * leaving `value` undefined — so a new site is a defect until someone
 * justifies it here.
 */
const POINTER_VALUE_ALLOWLIST: Record<string, string> = {
  'src/core/project-config.ts': 'defines the shape; describeStoreDeclaration is the accessor',
  'src/core/effective-config.ts': 'reads it inside the alias arm of the declaration bridge',
  'src/commands/doctor.ts': 'reports the declared display alias, as the declared alias',
  'src/core/store/upgrade-identity.ts': 'guarded by pointer.shape === alias on the same line',
  // store-bootstrap-diagnose: presence is tested with `hasStoreDeclaration`;
  // the alias is read only to build the declaration's alias arm and to label
  // the reported Store, both guarded by the shape on the same expression.
  'src/core/store/bootstrap.ts': 'reads the declared display alias, as the declared alias',
  // Both entries retired by unified-session-runtime-context: the launch
  // resolver's member check and the knowledge resolver's "planning is
  // externalized" check now go through `hasStoreDeclaration` +
  // `resolveStoreBinding`, so neither file reads the display alias at all.
  // Leaving a justification behind for a read that no longer exists is what
  // the staleness assertion below exists to catch.
};

/**
 * The guard is PROPERTY-first: it finds every read of `.value` in scope,
 * whatever the receiver, and this allowlist names the `<file>::<receiver>`
 * pairs that are provably not a Store declaration.
 *
 * It used to work the other way round — a regex enumerating receiver SHAPES
 * (`<ident>Pointer.value`) — and was defeated by `readStorePointer(root).value`,
 * whose receiver is a call result. That miss let a real defect live in
 * `spaces.ts`: a durable declaration carrying only a permanent identity has
 * `value === undefined`, so the member repo silently vanished from its Store's
 * member list. An allowlist is checked for staleness below; a regex is checked
 * by nobody, because a passing regex is never re-read.
 */
const INNOCENT_VALUE_RECEIVERS: Record<string, string> = {
  'src/core/init.ts::tool': 'detected external tool, not a store declaration',
  'src/core/init.ts::t': 'detected external tool (loop binding)',
  'src/core/init.ts::td': 'detected external tool (loop binding)',
  'src/core/init.ts::candidate': 'candidate external tool path',
  'src/core/project-config.ts::edit': 'a config edit descriptor',
  'src/core/effective-config.ts::envOverride': 'an environment-variable override entry',
};

/**
 * The scope, DERIVED from the source rather than hand-maintained: a file can
 * only read a declaration's alias if it first obtains a declaration, which
 * means naming one of these. Unioned with the OLD receiver-shape pattern, so
 * the new guard is a provable superset of the one it replaces — everything the
 * regex caught is still in scope — while `.value` reads in files that never
 * touch a declaration stay out of it and need no justification.
 */
const STORE_POINTER_VOCABULARY =
  /\breadStorePointer\b|\bStorePointer\b|\bclassifyOpenSpecDir\b|\bstoreBindingDeclarationFrom\b|\bhasStoreDeclaration\b/u;
const LEGACY_POINTER_VALUE_SHAPE =
  /(?:^|[^\w$])[\w$]*[Pp]ointer\s*\??\.\s*value\b|\{[^{}]*\bvalue\b[^{}]*\}\s*=\s*[\w$.]*[Pp]ointer\b/u;

function readsStoreDeclarations(source: string): boolean {
  const code = withoutComments(source);
  return STORE_POINTER_VOCABULARY.test(code) || LEGACY_POINTER_VALUE_SHAPE.test(code);
}

/** `<file>::<receiver>` for every `.value` read in scope. */
function pointerValueReads(): string[] {
  const reads: string[] = [];
  for (const file of sourceFiles(repoRoot)) {
    const source = fs.readFileSync(path.join(repoRoot, file), 'utf-8');
    if (!readsStoreDeclarations(source)) continue;
    for (const receiver of propertyReceivers(source, 'value')) {
      reads.push(`${file}::${receiver}`);
    }
  }
  return reads;
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
    const users = sourceFiles(repoRoot).filter(
      (file) =>
        !COMPAT_READER_HOME.includes(file) &&
        /\blistRegisteredStores\b/u.test(withoutComments(fs.readFileSync(path.join(repoRoot, file), 'utf-8')))
    );
    expect(users).toEqual([...DEFERRED_COMPAT_CONSUMERS].sort());
  });

  it('enumerates every display-alias read, so none escapes into a guard', () => {
    const reads = pointerValueReads();
    const offenders = reads.filter((read) => {
      const file = read.slice(0, read.indexOf('::'));
      return (
        INNOCENT_VALUE_RECEIVERS[read] === undefined && POINTER_VALUE_ALLOWLIST[file] === undefined
      );
    });
    expect(
      offenders,
      'Asking "does this repo declare a Store?" reads hasStoreDeclaration(pointer); pointer.value is the DISPLAY ALIAS and is undefined for a uid-only declaration. Justify a new read in POINTER_VALUE_ALLOWLIST, or name the receiver in INNOCENT_VALUE_RECEIVERS when it is not a declaration at all.'
    ).toEqual([]);

    // Neither allowlist may rot: a stale entry hides the next real read behind
    // a justification nobody re-checks. This is what a receiver-shape regex
    // could never have — and why the guard is now allowlist-shaped.
    const files = new Set(reads.map((read) => read.slice(0, read.indexOf('::'))));
    expect(Object.keys(POINTER_VALUE_ALLOWLIST).filter((file) => !files.has(file))).toEqual([]);
    expect(
      Object.keys(INNOCENT_VALUE_RECEIVERS).filter((pair) => !reads.includes(pair))
    ).toEqual([]);
  });

  it('catches the display-alias spellings a receiver-shape match missed', () => {
    // The guard's own coverage, pinned: each of these is a real read of the
    // declared display alias, and each defeated some previous pattern. The
    // call-result receiver is the one that shipped a defect — it is the exact
    // line `spaces.ts` carried.
    for (const [spelling, receiver] of [
      ['if (pointer.value !== undefined) {}', 'pointer'],
      ['const id = classification.pointer.value;', 'pointer'],
      ['const id = storePointer.value;', 'storePointer'],
      ['const id = pointer?.value;', 'pointer'],
      ['const id = declaration.pointer ?. value;', 'pointer'],
      ['const { value } = pointer;', 'pointer'],
      ['const { value, durable } = storePointer;', 'storePointer'],
      ['if (readStorePointer(root).value === store.id) {}', 'readStorePointer()'],
      ['const id = classifyOpenSpecDir(path.join(a, b)).pointer.value;', 'pointer'],
    ] as const) {
      expect(propertyReceivers(spelling, 'value'), spelling).toContain(receiver);
      // …and none of them is silently innocent under any file's entry.
      expect(
        Object.keys(INNOCENT_VALUE_RECEIVERS).some((pair) => pair.endsWith(`::${receiver}`)),
        spelling
      ).toBe(false);
    }

    // Unrelated `.value` reads still produce a receiver — the guard reports
    // one for every shape rather than deciding for itself which are safe —
    // and it is the ALLOWLIST that says they are not declarations.
    for (const [innocent, receiver] of [
      ['const x = entry.value;', 'entry'],
      ['const y = candidate?.value;', 'candidate'],
      ['const { value } = threshold;', 'threshold'],
      ['const z = list[0].value;', '(index)'],
    ] as const) {
      expect(propertyReceivers(innocent, 'value'), innocent).toEqual([receiver]);
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
      storeProjectRecordMissing({
        projectId: 'p1',
        store: { id: 'team-store', selector: 'team-store' },
        projectPath: '/repo',
      }),
      projectMembershipLocatorMissing({
        projectId: 'p1',
        store: { id: 'team-store', selector: 'team-store' },
        projectPath: '/repo',
      }),
      projectMembershipUnverified({
        store: { id: 'team-store' },
        repair: 'rasen store register <path>',
      }),
      sharedMetadataContainsLocalPath({
        filePath: '/store/.rasen-store/adoptions.yaml',
        detail: 'the adoption of project p1 recorded sourcePath',
        storeSelector: 'team-store',
      }),
      storeProjectRecordKeyMismatch({
        filePath: '/store/.rasen-store/projects/p1.yaml',
        fileIdentity: 'p1',
        recordedIdentity: 'p2',
      }),
      storeLegacyReferenceUnresolved({
        alias: 'elftia',
        store: { id: 'team-store', selector: 'team-store' },
      }),
      projectIdentityUnrecordable({ projectId: 'con', reason: 'it is a reserved device name' }),
      storeMembershipLegacyManifest({
        manifestPath: '/store/.rasen-store/adoptions.yaml',
        storeSelector: 'team-store',
      }),
      storeMembershipRolesInferred({
        projectId: 'p1',
        provenance: 'legacy adoption data',
        storeSelector: 'team-store',
      }),
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
