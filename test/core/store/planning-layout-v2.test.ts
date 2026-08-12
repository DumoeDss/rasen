import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  computeStorePlanningLayoutV2,
  deriveChangeInstanceId,
  derivePlanningScopeId,
  parseStoreProjectCatalogV2,
  parseStoreTargetLineCatalogV1,
  serializeStoreMetadataState,
  serializeStoreProjectCatalogV2,
  serializeStoreTargetLineCatalogV1,
  parseStoreMetadataState,
  StorePlanningValidationError,
} from '../../../src/core/store/index.js';
import {
  parseStoreProjectRecord,
  serializeStoreProjectRecord,
  type StoreProjectRecord,
} from '../../../src/core/store/project-records.js';

const STORE_UID = '9d1d9f4b-8fd8-45d8-b5ef-f0c7a28491d0';
const PROJECT_ID = '8a0c76e8-faa9-49dc-b0d1-c35df3ad797f';
const OTHER_PROJECT_ID = 'aa11bb22-cc33-4d44-8e55-ff6677889900';
const SEED_A = '11'.repeat(16);
const SEED_B = '22'.repeat(16);

function changeInstance(targetLineId: string, seed: string) {
  return deriveChangeInstanceId({
    planningScopeId: derivePlanningScopeId({
      storeUid: STORE_UID,
      projectId: PROJECT_ID,
      targetLineId,
    }),
    instanceSeed: seed,
  });
}

function projectCatalogWithRemote(remote: string): string {
  return `version: 2
projectId: ${PROJECT_ID}
remote: ${JSON.stringify(remote)}
roles: { planning: true, knowledge: false }
planningBinding: { state: unbound }
`;
}

describe('Store metadata and planning catalogs v2', () => {
  it('keeps legacy Store metadata bytes unchanged when layoutVersion is absent', () => {
    const legacy = `version: 2\nuid: ${STORE_UID}\nid: example-store\n`;
    expect(serializeStoreMetadataState(parseStoreMetadataState(legacy))).toBe(legacy);
  });

  it.each([1, 2] as const)(
    'declares layout v2 independently from metadata schema version %i',
    version => {
      const metadata =
        version === 1
          ? ({ version, id: 'example-store', layoutVersion: 2 } as const)
          : ({ version, uid: STORE_UID, id: 'example-store', layoutVersion: 2 } as const);
      expect(parseStoreMetadataState(serializeStoreMetadataState(metadata))).toEqual(metadata);
    }
  );

  it('keeps version 1 membership records compatible', () => {
    const legacy: StoreProjectRecord = {
      version: 1,
      projectId: PROJECT_ID,
      id: 'example-project',
      roles: { planning: true, knowledge: false },
      adoption: {
        specs: ['auth'],
        changes: ['refresh-cache'],
        adoptedAt: '2026-08-04T00:00:00.000Z',
      },
    };
    expect(parseStoreProjectRecord(serializeStoreProjectRecord(legacy), 'legacy.yaml')).toEqual(
      legacy
    );
  });

  it('round-trips a strict v2 project catalog without adoption or machine paths', () => {
    const content = `version: 2
projectId: ${PROJECT_ID}
id: example-project
remote: git@example.invalid:org/example-project.git
roles:
  planning: true
  knowledge: false
planningBinding:
  state: bound
  boundAt: 2026-08-04T00:00:00.000Z
`;
    const catalog = parseStoreProjectCatalogV2(content, `${PROJECT_ID}.yaml`);
    expect(parseStoreProjectCatalogV2(serializeStoreProjectCatalogV2(catalog), `${PROJECT_ID}.yaml`))
      .toEqual(catalog);
    expect(catalog).not.toHaveProperty('adoption');
    expect(JSON.stringify(catalog)).not.toContain('localPath');
  });

  it.each([
    'https://example.invalid/org/example-project.git',
    'ssh://git@example.invalid/org/example-project.git',
    'git://example.invalid/org/example-project.git',
    'git+ssh://git@example.invalid/org/example-project.git',
    'git@example.invalid:org/example-project.git',
  ])('accepts portable project clone locator %s', remote => {
    expect(
      parseStoreProjectCatalogV2(
        projectCatalogWithRemote(remote),
        `${PROJECT_ID}.yaml`
      ).remote
    ).toBe(remote);
  });

  it.each([
    'relative/repo.git',
    'C:repo.git',
    'C:/repo.git',
    String.raw`\\server\share\repo.git`,
    String.raw`\\?\C:\repo.git`,
    '//server/share/repo.git',
    'file:///srv/repo.git',
    'ftp://example.invalid/repo.git',
    'https://user:secret@example.invalid/repo.git',
    'https://example.invalid/repo.git?token=secret',
    'ssh://git@example.invalid/repo.git#fragment',
  ])('rejects non-portable or credential-bearing project remote %s', remote => {
    expect(() =>
      parseStoreProjectCatalogV2(
        projectCatalogWithRemote(remote),
        `${PROJECT_ID}.yaml`
      )
    ).toThrow(/remote/u);
  });

  it.each(['bundles/report?.md', 'bundles/report|name.md', 'bundles/con.txt'])(
    'rejects Windows-unrepresentable knowledge bundle %s on every platform',
    knowledgeBundle => {
      expect(() =>
        parseStoreProjectCatalogV2(
          `version: 2
projectId: ${PROJECT_ID}
knowledgeBundle: ${JSON.stringify(knowledgeBundle)}
roles: { planning: true, knowledge: true }
planningBinding: { state: unbound }
`,
          `${PROJECT_ID}.yaml`
        )
      ).toThrow(/knowledgeBundle/u);
    }
  );

  it('keeps planning membership independent from binding state', () => {
    const catalog = parseStoreProjectCatalogV2(
      `version: 2
projectId: ${PROJECT_ID}
roles:
  planning: true
  knowledge: false
planningBinding:
  state: unbound
`,
      `${PROJECT_ID}.yaml`
    );
    expect(catalog.planningBinding).toEqual({ state: 'unbound' });
  });

  it.each([
    `version: 2
projectId: ${PROJECT_ID}
roles: { planning: false, knowledge: false }
planningBinding: { state: bound, boundAt: 2026-08-04T00:00:00.000Z }
`,
    `version: 2
projectId: ${PROJECT_ID}
roles: { planning: true, knowledge: false }
planningBinding: { state: bound }
`,
    `version: 2
projectId: ${PROJECT_ID}
roles: { planning: true, knowledge: false }
planningBinding: { state: unbound }
adoption: { specs: [], changes: [], adoptedAt: 2026-08-04T00:00:00.000Z }
`,
    `version: 2
projectId: ${PROJECT_ID}
remote: https://user:secret@example.invalid/repo.git
roles: { planning: true, knowledge: false }
planningBinding: { state: unbound }
`,
    `version: 2
projectId: ${PROJECT_ID}
remote: C:/machine/repo
roles: { planning: true, knowledge: false }
planningBinding: { state: unbound }
`,
    `version: 2
projectId: ${PROJECT_ID}
localPath: C:/repo
roles: { planning: true, knowledge: false }
planningBinding: { state: unbound }
`,
  ])('rejects invalid v2 project catalog cross-fields or unknown fields', content => {
    expect(() => parseStoreProjectCatalogV2(content, `${PROJECT_ID}.yaml`)).toThrow(
      StorePlanningValidationError
    );
  });

  it('rejects a project catalog filename/id mismatch', () => {
    expect(() =>
      parseStoreProjectCatalogV2(
        `version: 2
projectId: ${PROJECT_ID}
roles: { planning: true, knowledge: false }
planningBinding: { state: unbound }
`,
        `${OTHER_PROJECT_ID}.yaml`
      )
    ).toThrow(/must equal projectId/u);
  });

  it('rejects a target-line catalog filename/id mismatch', () => {
    expect(() =>
      parseStoreTargetLineCatalogV1(
        `version: 1
id: line-0.2
storeRef: refs/heads/release/0.2
projects: {}
`,
        'line-0.3.yaml'
      )
    ).toThrow(/must equal id/u);
  });

  it('round-trips a target-line catalog and validates keyed full refs', () => {
    const content = `version: 1
id: line-0.2
storeRef: refs/heads/release/0.2
projects:
  ${PROJECT_ID}:
    codeRef: refs/heads/release/0.2
`;
    const catalog = parseStoreTargetLineCatalogV1(content, 'line-0.2.yaml');
    expect(
      parseStoreTargetLineCatalogV1(
        serializeStoreTargetLineCatalogV1(catalog),
        'line-0.2.yaml'
      )
    ).toEqual(catalog);
  });

  it.each([
    `version: 1
id: line-0.2
storeRef: release/0.2
projects: {}
`,
    `version: 1
id: line-0.2
storeRef: refs/heads/release/0.2
projects:
  Project-A: { codeRef: refs/heads/main }
`,
    `version: 1
id: line-0.2
storeRef: refs/heads/con
projects: {}
`,
    `version: 1
id: line-0.2
storeRef: refs/heads/release/0.2
projects:
  ${PROJECT_ID}: { codeRef: refs/heads/foo<bar }
`,
    `version: 1
id: line-0.2
storeRef: refs/heads/release/0.2
projects: {}
checkout: C:/repo
`,
  ])('rejects malformed target-line catalog', content => {
    expect(() => parseStoreTargetLineCatalogV1(content, 'line-0.2.yaml')).toThrow(
      StorePlanningValidationError
    );
  });
});

describe('pure Store planning layout v2', () => {
  it.runIf(process.platform === 'win32')(
    'uses native Windows semantics and rejects case-alias project ids',
    () => {
      const root = 'C:\\Stores\\Example';
      const layout = computeStorePlanningLayoutV2({
        storeRoot: root,
        projectId: PROJECT_ID,
        targetLineId: 'line-0.2',
        changeId: 'windows-case',
        archiveDate: '2026-08-04',
        changeInstanceId: changeInstance('line-0.2', SEED_A),
      });
      expect(path.relative(root.toLowerCase(), layout.projectHome)).not.toMatch(/^\.\./u);
      expect(() =>
        computeStorePlanningLayoutV2({
          storeRoot: root,
          projectId: PROJECT_ID.toUpperCase(),
          targetLineId: 'line-0.2',
          changeId: 'windows-case',
          archiveDate: '2026-08-04',
          changeInstanceId: changeInstance('line-0.2', SEED_A),
        })
      ).toThrow(StorePlanningValidationError);
    }
  );

  it.each([
    { flavor: 'win32' as const, api: path.win32, root: 'C:\\stores\\example' },
    { flavor: 'posix' as const, api: path.posix, root: '/stores/example' },
  ])('uses $flavor path semantics without hard-coded separators', ({ flavor, api, root }) => {
    const instanceId = changeInstance('line-0.2', SEED_A);
    const layout = computeStorePlanningLayoutV2({
      storeRoot: root,
      projectId: PROJECT_ID,
      targetLineId: 'line-0.2',
      changeId: 'refresh-cache',
      archiveDate: '2026-08-04',
      changeInstanceId: instanceId,
      flavor,
    });

    expect(layout.projectCatalog).toBe(
      api.resolve(root, '.rasen-store', 'projects', `${PROJECT_ID}.yaml`)
    );
    expect(layout.targetLineCatalog).toBe(
      api.resolve(root, '.rasen-store', 'target-lines', 'line-0.2.yaml')
    );
    expect(layout.projectHome).toBe(api.resolve(root, 'rasen', 'projects', PROJECT_ID));
    expect(layout.projectSpecs).toBe(
      api.resolve(root, 'rasen', 'projects', PROJECT_ID, 'specs')
    );
    expect(layout.storeDesignDocs).toBe(api.resolve(root, 'rasen', 'design-docs'));
    expect(layout.projectDesignDocs).toBe(
      api.resolve(root, 'rasen', 'projects', PROJECT_ID, 'design-docs')
    );
    expect(layout.activeChange).toBe(
      api.resolve(root, 'rasen', 'projects', PROJECT_ID, 'changes', 'refresh-cache')
    );
    expect(layout.archiveLine).toBe(
      api.resolve(
        root,
        'rasen',
        'projects',
        PROJECT_ID,
        'changes',
        'archive',
        'line-0.2'
      )
    );
    expect(layout.archiveEntry).toBe(
      api.resolve(layout.archiveLine, `2026-08-04-refresh-cache--${instanceId.slice(3, 15)}`)
    );
    expect(Object.isFrozen(layout)).toBe(true);
  });

  it('partitions same Change aliases by project and Archives by target line', () => {
    const first = computeStorePlanningLayoutV2({
      storeRoot: '/store',
      projectId: PROJECT_ID,
      targetLineId: 'line-0.1',
      changeId: 'same-alias',
      archiveDate: '2026-08-04',
      changeInstanceId: changeInstance('line-0.1', SEED_A),
      flavor: 'posix',
    });
    const second = computeStorePlanningLayoutV2({
      storeRoot: '/store',
      projectId: OTHER_PROJECT_ID,
      targetLineId: 'line-0.2',
      changeId: 'same-alias',
      archiveDate: '2026-08-04',
      changeInstanceId: changeInstance('line-0.2', SEED_B),
      flavor: 'posix',
    });
    expect(first.activeChange).not.toBe(second.activeChange);
    expect(first.archiveLine).toContain('/line-0.1');
    expect(second.archiveLine).toContain('/line-0.2');
    expect(first.activeChange).not.toContain('line-0.1');
  });

  it('disambiguates same-day retries by verified Change instance digest', () => {
    const common = {
      storeRoot: '/store',
      projectId: PROJECT_ID,
      targetLineId: 'line-0.2',
      changeId: 'retry',
      archiveDate: '2026-08-04',
      flavor: 'posix' as const,
    };
    const first = computeStorePlanningLayoutV2({
      ...common,
      changeInstanceId: changeInstance('line-0.2', SEED_A),
    });
    const second = computeStorePlanningLayoutV2({
      ...common,
      changeInstanceId: changeInstance('line-0.2', SEED_B),
    });
    expect(first.archiveEntry).not.toBe(second.archiveEntry);
  });

  it('validates before joining and refuses relative roots or escaping ids', () => {
    const base = {
      storeRoot: '/store',
      projectId: PROJECT_ID,
      targetLineId: 'line-0.2',
      changeId: 'safe-change',
      archiveDate: '2026-08-04',
      changeInstanceId: changeInstance('line-0.2', SEED_A),
      flavor: 'posix' as const,
    };
    expect(() => computeStorePlanningLayoutV2({ ...base, storeRoot: 'relative' })).toThrow(
      /absolute/u
    );
    expect(() => computeStorePlanningLayoutV2({ ...base, projectId: '../escape' })).toThrow(
      StorePlanningValidationError
    );
    expect(() =>
      computeStorePlanningLayoutV2({
        ...base,
        changeInstanceId: 'ci_bad' as ReturnType<typeof changeInstance>,
      })
    ).toThrow(StorePlanningValidationError);
  });

  it.each(['2026-02-29', '2026-13-01', '2026-08-32'])(
    'rejects invalid calendar archive date %s with a stable field',
    archiveDate => {
      try {
        computeStorePlanningLayoutV2({
          storeRoot: '/store',
          projectId: PROJECT_ID,
          targetLineId: 'line-0.2',
          changeId: 'safe-change',
          archiveDate,
          changeInstanceId: changeInstance('line-0.2', SEED_A),
          flavor: 'posix',
        });
        throw new Error('expected layout validation to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(StorePlanningValidationError);
        expect(error).toMatchObject({
          code: 'invalid_store_layout_v2',
          field: 'archiveDate',
        });
      }
    }
  );
});
