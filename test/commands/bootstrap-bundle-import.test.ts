import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  renderBootstrapReport,
} from '../../src/commands/bootstrap.js';
import { getBootstrapMessages } from '../../src/commands/bootstrap-messages.js';
import type { BootstrapReport } from '../../src/core/store/bootstrap.js';

function report(): BootstrapReport {
  return {
    mode: 'apply',
    origin: 'project',
    state: 'degraded',
    project: {
      root: path.resolve('portable-project'),
      projectId: 'portable-project',
      declaresStore: false,
    },
    stores: [],
    projects: [],
    problems: [],
    diagnostics: [],
    bundleImports: [
      {
        actionKey: 'import-bundle:portable-project:carry',
        projectId: 'portable-project',
        projectRoot: path.resolve('portable-project'),
        locator: path.join('carry', 'portable.bundle.json'),
        resolvedPath: path.resolve('portable-project', 'carry', 'portable.bundle.json'),
        canonicalPath: path.resolve('portable-project', 'carry', 'portable.bundle.json'),
        sources: [
          {
            kind: 'store-record',
            storeId: 'team-store',
            declarationPath: path.resolve('team-store', '.rasen-store', 'projects', 'portable-project.yaml'),
            ownerRoot: path.resolve('team-store'),
            locator: path.join('carry', 'portable.bundle.json'),
          },
        ],
        trust: 'store-record-only',
        availability: 'usable',
        outcome: 'refused',
        bundleId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        baseProjectCommit: 'd'.repeat(40),
        added: [
          {
            id: 'clean-routing',
            knowledgeKey: 'clean-routing-key',
            status: 'active',
            contentDigest: `sha256:${'a'.repeat(64)}`,
          },
        ],
        alreadyPresent: [],
        conflicts: [
          {
            id: 'conflicting-routing',
            knowledgeKey: 'conflicting-routing-key',
            reason: 'content-differs',
            bundle: {
              contentDigest: `sha256:${'b'.repeat(64)}`,
              status: 'active',
            },
            local: {
              kind: 'managed',
              contentDigest: `sha256:${'c'.repeat(64)}`,
              status: 'active',
            },
          },
        ],
        warnings: [
          {
            code: 'staging_cleanup_deferred',
            baseProjectCommit: null,
          },
        ],
        refusal: {
          code: 'knowledge_bundle_import_conflict',
          message: 'raw importer message',
          details: {
            bundleProjectId: 'portable-project',
            targetProjectId: 'portable-project',
            repair: 'raw F3 repair',
            diagnostic: 'raw F3 diagnostic',
          },
          issues: [
            {
              recordId: 'conflicting-routing',
              field: 'contentDigest',
              reason: 'digest differs from local record',
            },
          ],
        },
        repair: [
          {
            kind: 'repair-permissions',
            path: path.resolve('portable-project', 'carry', 'portable.bundle.json'),
          },
          {
            kind: 'repair-import',
            code: 'knowledge_bundle_import_conflict',
            bundlePath: path.resolve('portable-project', 'carry', 'portable.bundle.json'),
          },
        ],
        changed: 'unknown',
        retainedPaths: [path.resolve('project-knowledge', 'conflicting-routing')],
      },
    ],
  };
}

describe('bootstrap declared-bundle rendering', () => {
  it.each(['en', 'zh-cn', 'ja'] as const)(
    'renders every JSON fact through the %s catalog without raw enum fallback',
    (locale) => {
      const lines = renderBootstrapReport(report(), getBootstrapMessages(locale));
      const output = lines.join('\n');

      expect(output).toContain('portable-project');
      expect(output).toContain('team-store');
      expect(output).toContain('clean-routing');
      expect(output).toContain('conflicting-routing');
      expect(output).toContain('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      expect(output).toContain('d'.repeat(40));
      expect(output).toContain('clean-routing-key');
      expect(output).toContain(`sha256:${'a'.repeat(64)}`);
      expect(output).toContain('bundleProjectId');
      expect(output).toContain('contentDigest');
      expect(output).toContain('digest differs from local record');
      expect(output).toContain(path.resolve('project-knowledge', 'conflicting-routing'));
      for (const raw of [
        'store-record-only',
        'content-differs',
        'staging_cleanup_deferred',
        'knowledge_bundle_import_conflict',
        'raw importer message',
        'raw F3 repair',
        'raw F3 diagnostic',
      ]) {
        expect(output).not.toContain(raw);
      }
    }
  );
});
