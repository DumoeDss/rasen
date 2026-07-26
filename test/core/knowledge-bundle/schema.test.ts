import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

import { digestContent } from '../../../src/core/learned-skills/catalog.js';
import type { LearnedSkillManifestV2 } from '../../../src/core/learned-skills/types.js';
import {
  KNOWLEDGE_BUNDLE_PERMITTED_FIELDS,
  KNOWLEDGE_BUNDLE_RECORD_PERMITTED_FIELDS,
  KnowledgeBundleMachinePathError,
  UnsupportedKnowledgeBundleVersionError,
  createKnowledgeBundle,
  createKnowledgeBundleRecord,
  parseKnowledgeBundleJson,
  readKnowledgeBundle,
  type KnowledgeBundle,
} from '../../../src/core/knowledge-bundle/schema.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const RECORD_ID = 'portable-typescript-routing';
const CONTENT = '---\nname: portable-typescript-routing\n---\n\nUse the stable route.\n';
const EMBEDDED_MACHINE_PATH_CASES = [
  ['delimiter-adjacent POSIX path', 'path:/home', '/home'],
  [
    'delimiter-adjacent Windows drive path',
    String.raw`path:C:\Users\alice\private`,
    String.raw`C:\Users\alice\private`,
  ],
  [
    'delimiter-adjacent Windows network path',
    String.raw`path:\\server\share\private`,
    String.raw`\\server\share\private`,
  ],
  ['embedded one-segment POSIX path', 'Deploy from /srv today.', '/srv'],
  ['multi-leading-slash POSIX path', '///home', '///home'],
] as const;

function manifest(
  overrides: Partial<LearnedSkillManifestV2> = {}
): LearnedSkillManifestV2 {
  return {
    version: 2,
    scope: 'project',
    owner: { type: 'project', projectId: PROJECT_ID },
    id: RECORD_ID,
    knowledgeKey: 'portable-typescript-routing-key',
    status: 'active',
    generatedBy: 'rasen-learned-skill',
    contentDigest: digestContent(CONTENT),
    description: 'Use the stable route.',
    applicability: { mode: 'all', markers: ['package.json'] },
    evidence: [],
    sources: [],
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:00.000Z',
    ...overrides,
  };
}

function bundle(manifestOverrides: Partial<LearnedSkillManifestV2> = {}): KnowledgeBundle {
  const managed = manifest(manifestOverrides);
  return createKnowledgeBundle({
    bundleId: randomUUID(),
    projectId: PROJECT_ID,
    createdAt: '2026-07-26T00:00:00.000Z',
    baseProjectCommit: null,
    records: [
      createKnowledgeBundleRecord({
        id: managed.id,
        knowledgeKey: managed.knowledgeKey,
        contentDigest: managed.contentDigest,
        manifest: managed,
        content: CONTENT,
      }),
    ],
  });
}

function snapshotTree(root: string): Array<{ path: string; bytes: string }> {
  const snapshot: Array<{ path: string; bytes: string }> = [];
  const visit = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      snapshot.push({
        path: path.relative(root, fullPath),
        bytes: fs.readFileSync(fullPath).toString('base64'),
      });
    }
  };
  visit(root);
  return snapshot.sort((left, right) => left.path.localeCompare(right.path));
}

describe('knowledge bundle schema and non-writing reader', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('round-trips the strict versioned schema and pins the permitted fields', () => {
    const expected = bundle();
    expect(parseKnowledgeBundleJson(`${JSON.stringify(expected)}\n`)).toEqual(expected);
    expect(KNOWLEDGE_BUNDLE_PERMITTED_FIELDS).toEqual([
      'version',
      'bundleId',
      'projectId',
      'createdAt',
      'baseProjectCommit',
      'records',
    ]);
    expect(KNOWLEDGE_BUNDLE_RECORD_PERMITTED_FIELDS).toEqual([
      'id',
      'knowledgeKey',
      'contentDigest',
      'manifest',
      'content',
    ]);
  });

  it('rejects unknown bundle, record, and manifest fields', () => {
    const topLevel = { ...bundle(), machineRoot: 'relative-but-forbidden-by-shape' };
    expect(() => parseKnowledgeBundleJson(JSON.stringify(topLevel))).toThrow(/unrecognized|unknown/i);

    const recordLevel = structuredClone(bundle()) as KnowledgeBundle & {
      records: Array<KnowledgeBundle['records'][number] & { session?: string }>;
    };
    recordLevel.records[0]!.session = 'session-1';
    expect(() => parseKnowledgeBundleJson(JSON.stringify(recordLevel))).toThrow(
      /unrecognized|unknown/i
    );

    const manifestLevel = structuredClone(bundle()) as KnowledgeBundle;
    Object.assign(manifestLevel.records[0]!.manifest, { generatedFile: 'tool-output.md' });
    expect(() => parseKnowledgeBundleJson(JSON.stringify(manifestLevel))).toThrow(
      /unrecognized|unknown/i
    );
  });

  describe.each(['windows host shape', 'POSIX host shape'])('%s', () => {
    it.each([
      ['Windows drive-letter', String.raw`C:\Users\alice\project`],
      ['Windows network-share', String.raw`\\server\share\project`],
      ['POSIX absolute', '/home/alice/project'],
    ])('rejects a %s path and names the record and field', (_label, absolutePath) => {
      expect(() =>
        bundle({
          applicability: { mode: 'all', markers: [absolutePath] },
        })
      ).toThrowError(
        expect.objectContaining<Partial<KnowledgeBundleMachinePathError>>({
          recordId: RECORD_ID,
          field: 'records[0].manifest.applicability.markers[0]',
          value: absolutePath,
        })
      );
    });
  });

  it.each(EMBEDDED_MACHINE_PATH_CASES)(
    'the writer rejects a %s anywhere in a portable string',
    (_label, portableValue, detectedPath) => {
      expect(() =>
        bundle({
          applicability: { mode: 'all', markers: [portableValue] },
        })
      ).toThrowError(
        expect.objectContaining<Partial<KnowledgeBundleMachinePathError>>({
          recordId: RECORD_ID,
          field: 'records[0].manifest.applicability.markers[0]',
          value: detectedPath,
        })
      );
    }
  );

  it.each(EMBEDDED_MACHINE_PATH_CASES)(
    'the reader rejects a %s anywhere in a portable string',
    (_label, portableValue, detectedPath) => {
      const serialized = structuredClone(bundle());
      serialized.records[0]!.manifest.applicability.markers = [portableValue];

      expect(() => parseKnowledgeBundleJson(JSON.stringify(serialized))).toThrowError(
        expect.objectContaining<Partial<KnowledgeBundleMachinePathError>>({
          recordId: RECORD_ID,
          field: 'records[0].manifest.applicability.markers[0]',
          value: detectedPath,
        })
      );
    }
  );

  it.each([
    'https://example.com/docs/project',
    'http://localhost:3000/api',
    'https://example.com/#/workspace',
    'Use package/name and yes/no choices.',
    'C++/Node remains ordinary prose.',
    'Version 1/2 remains ordinary text.',
  ])('does not mistake an ordinary URL or slash-containing text for a machine path: %s', (value) => {
    expect(() =>
      bundle({
        applicability: { mode: 'all', markers: [value] },
      })
    ).not.toThrow();
  });

  it('refuses a newer version before partially interpreting its records', () => {
    const future = {
      ...bundle(),
      version: 2,
      records: [{ futureRecordShape: true }],
    };
    expect(() => parseKnowledgeBundleJson(JSON.stringify(future))).toThrowError(
      expect.objectContaining<Partial<UnsupportedKnowledgeBundleVersionError>>({
        found: 2,
        supported: 1,
      })
    );
  });

  it('leaves a whole tree byte-identical for every reader failure', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-bundle-reader-'));
    tempRoots.push(root);
    fs.mkdirSync(path.join(root, 'sources'), { recursive: true });
    fs.writeFileSync(path.join(root, 'sources', 'unchanged.txt'), 'source bytes\n');

    const invalidInputs = [
      '{ not json',
      JSON.stringify({ ...bundle(), unknown: true }),
      JSON.stringify({ ...bundle(), version: 99 }),
      JSON.stringify({
        ...bundle(),
        records: [
          {
            ...bundle().records[0],
            manifest: {
              ...bundle().records[0]!.manifest,
              applicability: { mode: 'all', markers: ['/var/lib/private/project'] },
            },
          },
        ],
      }),
    ];

    for (const [index, content] of invalidInputs.entries()) {
      const input = path.join(root, `invalid-${index}.json`);
      fs.writeFileSync(input, content);
      const before = snapshotTree(root);
      expect(() => readKnowledgeBundle(input)).toThrow();
      expect(snapshotTree(root)).toEqual(before);
    }
  });
});
