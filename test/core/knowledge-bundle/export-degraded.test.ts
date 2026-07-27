/**
 * Minor 2 regression: `exportKnowledgeBundle` must NOT silently produce an
 * incomplete bundle when the project catalog has recoverable backup debris
 * (M5 invariant — "recoverable data treated as absent" — extended to the
 * export path). A killed mutation renames records into
 * `.rasen-learned-skill-backup-*`; the read returns those names in
 * `recoverableBackups` and the visible `records` is missing the backed-up
 * data. The export must fail closed with a clear repair rather than emit a
 * bundle that silently omits the recoverable records.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  exportKnowledgeBundle,
  KnowledgeBundleExportError,
  type ExportKnowledgeBundleOptions,
} from '../../../src/core/knowledge-bundle/export.js';
import { resolveProjectKnowledgeHome } from '../../../src/core/project-knowledge-home.js';

const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const CREATED_AT = '2026-07-27T02:00:00.000Z';
const BASE_COMMIT = 'b'.repeat(40);

describe('Minor 2 — export fails closed on recoverable backup debris', () => {
  let tempRoot: string;
  let globalDataDir: string;
  let checkout: string;
  let outputDir: string;

  beforeEach(() => {
    tempRoot = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-bundle-export-degraded-'))
    );
    globalDataDir = path.join(tempRoot, 'machine-data');
    checkout = path.join(tempRoot, 'checkout');
    outputDir = path.join(tempRoot, 'exports');
    for (const root of [checkout, outputDir]) {
      fs.mkdirSync(root, { recursive: true });
    }
    fs.mkdirSync(path.join(checkout, 'rasen'), { recursive: true });
    fs.writeFileSync(
      path.join(checkout, 'rasen', 'config.yaml'),
      `schema: spec-driven\nprojectId: ${PROJECT_ID}\n`
    );
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  function options(
    to: string,
    overrides: Pick<ExportKnowledgeBundleOptions, 'dependencies'> = {}
  ): ExportKnowledgeBundleOptions {
    return {
      project: PROJECT_ID,
      to,
      dependencies: {
        resolveProject: async (selector) => {
          if (selector !== PROJECT_ID && selector !== checkout) return null;
          return {
            root: checkout,
            ref: { projectId: PROJECT_ID, name: 'degraded-project', root: checkout },
          };
        },
        resolveKnowledgeHome: (projectId) =>
          resolveProjectKnowledgeHome(projectId, { globalDataDir }),
        readBaseProjectCommit: async () => BASE_COMMIT,
        bundleId: randomUUID,
        now: () => new Date(CREATED_AT),
        ...overrides.dependencies,
      },
    };
  }

  it('rejects with knowledge_bundle_catalog_degraded and writes nothing when recoverableBackups is non-empty', async () => {
    const destination = path.join(outputDir, 'degraded.bundle.json');
    // Inject a catalog that simulates a killed mutation: the visible records
    // list is empty, but recoverableBackups carries the debris directory
    // name. The export must NOT treat this as an empty-but-healthy catalog.
    let opened = 0;
    const result = exportKnowledgeBundle(
      options(destination, {
        dependencies: {
          // The override above spreads last, so readCatalog here replaces
          // the default. Resolve knowledge home the same way the default
          // would, so the catalog call shape matches production.
          readCatalog: () => ({
            records: [],
            unreadable: [],
            recoverableBackups: ['.rasen-learned-skill-backup-shared-record-killed-mid-swap'],
          }),
          io: {
            openExclusive: () => {
              opened += 1;
              throw new Error('must not open a staging file for a degraded catalog');
            },
          },
        } as ExportKnowledgeBundleOptions['dependencies'],
      })
    );

    await expect(result).rejects.toMatchObject({
      name: 'KnowledgeBundleExportError',
      code: 'knowledge_bundle_catalog_degraded',
    });
    await expect(result).rejects.toThrow(/recoverable backup debris/);
    await expect(result).rejects.toThrow(
      /\.rasen-learned-skill-backup-shared-record-killed-mid-swap/
    );

    // Nothing was written — the check fires BEFORE any staging file is opened.
    expect(opened).toBe(0);
    expect(fs.existsSync(destination)).toBe(false);
    expect(fs.readdirSync(outputDir)).toEqual([]);
  });

  it('still succeeds when recoverableBackups is empty (regression protection)', async () => {
    // The new guard must NOT fire on a healthy catalog. Inject a catalog with
    // zero records but empty recoverableBackups; the export should produce a
    // valid (empty) bundle without throwing. This is the contrast case that
    // proves the guard discriminates on the debris field, not on record count.
    const destination = path.join(outputDir, 'healthy.bundle.json');
    const result = await exportKnowledgeBundle(
      options(destination, {
        dependencies: {
          readCatalog: () => ({ records: [], unreadable: [], recoverableBackups: [] }),
        } as ExportKnowledgeBundleOptions['dependencies'],
      })
    );
    expect(result.projectId).toBe(PROJECT_ID);
    expect(fs.existsSync(destination)).toBe(true);
  });

  it('KnowledgeBundleExportError surfaces the dirs in details for programmatic consumers', async () => {
    const destination = path.join(outputDir, 'details.bundle.json');
    try {
      await exportKnowledgeBundle(
        options(destination, {
          dependencies: {
            readCatalog: () => ({
              records: [],
              unreadable: [],
              recoverableBackups: [
                '.rasen-learned-skill-backup-a-killed',
                '.rasen-learned-skill-backup-b-killed',
              ],
            }),
          } as ExportKnowledgeBundleOptions['dependencies'],
        })
      );
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(KnowledgeBundleExportError);
      const details = (error as KnowledgeBundleExportError).details;
      // The details carry the recoverable dirs so a JSON consumer can react.
      expect(details.recoverableBackups).toContain('.rasen-learned-skill-backup-a-killed');
      expect(details.recoverableBackups).toContain('.rasen-learned-skill-backup-b-killed');
    }
  });
});
