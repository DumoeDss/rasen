import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  archiveDatePrefixedNameMatches,
  isArchiveContainedPath,
  resolveArchiveTransactionPaths,
  validArchiveIntentRelativePath,
} from '../../src/core/archive-engine.js';

describe('archive path semantics are explicit, not inferred from the host', () => {
  const transactionId = '11111111-1111-4111-8111-111111111111';

  it('uses win32 drive, separator, stage/final, and journal identity', () => {
    const paths = resolveArchiveTransactionPaths(
      'c:\\Planning\\rasen\\changes\\archive',
      '2026-07-31',
      'Feature',
      transactionId,
      path.win32
    );

    expect(paths).toEqual({
      archiveParent: 'c:\\Planning\\rasen\\changes\\archive',
      stage:
        'c:\\Planning\\rasen\\changes\\archive\\.rasen-archive-stage-11111111-1111-4111-8111-111111111111',
      final: 'c:\\Planning\\rasen\\changes\\archive\\2026-07-31-Feature',
      journal:
        'c:\\Planning\\rasen\\changes\\archive\\.rasen-archive-stage-11111111-1111-4111-8111-111111111111\\.rasen-archive-journal.json',
      publishedJournal:
        'c:\\Planning\\rasen\\changes\\archive\\2026-07-31-Feature\\.rasen-archive-journal.json',
    });
    expect(path.win32.dirname(paths.stage)).toBe(paths.archiveParent);
    expect(path.win32.dirname(paths.final)).toBe(paths.archiveParent);
  });

  it('uses posix separator, stage/final, and journal identity', () => {
    const paths = resolveArchiveTransactionPaths(
      '/planning/rasen/changes/archive',
      '2026-07-31',
      'Feature',
      transactionId,
      path.posix
    );

    expect(paths).toEqual({
      archiveParent: '/planning/rasen/changes/archive',
      stage:
        '/planning/rasen/changes/archive/.rasen-archive-stage-11111111-1111-4111-8111-111111111111',
      final: '/planning/rasen/changes/archive/2026-07-31-Feature',
      journal:
        '/planning/rasen/changes/archive/.rasen-archive-stage-11111111-1111-4111-8111-111111111111/.rasen-archive-journal.json',
      publishedJournal:
        '/planning/rasen/changes/archive/2026-07-31-Feature/.rasen-archive-journal.json',
    });
    expect(path.posix.dirname(paths.stage)).toBe(paths.archiveParent);
    expect(path.posix.dirname(paths.final)).toBe(paths.archiveParent);
  });

  it('applies explicit win32 and posix case identity to date-prefixed collisions', () => {
    expect(
      archiveDatePrefixedNameMatches('2026-07-31-Feature', 'feature', 'win32')
    ).toBe(true);
    expect(
      archiveDatePrefixedNameMatches('2026-07-31-Feature', 'feature', 'posix')
    ).toBe(false);
    expect(
      archiveDatePrefixedNameMatches('2026-07-31-other-Feature', 'Feature', 'win32')
    ).toBe(false);
    expect(archiveDatePrefixedNameMatches('Feature', 'Feature', 'win32')).toBe(false);
  });

  it('checks lexical and resolved containment with the selected path API', () => {
    expect(
      isArchiveContainedPath(
        'C:\\Repo',
        path.win32.resolve('c:\\repo', 'handoff', 'note.md'),
        path.win32
      )
    ).toBe(true);
    expect(
      isArchiveContainedPath('C:\\Repo', 'D:\\outside\\probe', path.win32)
    ).toBe(false);
    expect(
      isArchiveContainedPath('C:\\Repo', 'C:\\Repo-sibling\\probe', path.win32)
    ).toBe(false);

    expect(
      isArchiveContainedPath(
        '/repo',
        path.posix.resolve('/repo', 'handoff', 'note.md'),
        path.posix
      )
    ).toBe(true);
    expect(isArchiveContainedPath('/repo', '/Repo/probe', path.posix)).toBe(false);
    expect(isArchiveContainedPath('/repo', '/repo-sibling/probe', path.posix)).toBe(
      false
    );
  });

  it('rejects sidecar/probe drive, absolute, separator, dot, and escape forms explicitly', () => {
    for (const pathApi of [path.win32, path.posix]) {
      expect(
        validArchiveIntentRelativePath(
          path.posix.join('handoff', 'nested', 'note.md'),
          'handoff',
          pathApi
        )
      ).toBe(true);
      expect(
        validArchiveIntentRelativePath(
          path.posix.join('experiments', 'probe'),
          undefined,
          pathApi
        )
      ).toBe(true);
      expect(validArchiveIntentRelativePath('../outside', undefined, pathApi)).toBe(
        false
      );
      expect(validArchiveIntentRelativePath('handoff/./note.md', 'handoff', pathApi)).toBe(
        false
      );
      expect(
        validArchiveIntentRelativePath('handoff\\note.md', 'handoff', pathApi)
      ).toBe(false);
      expect(validArchiveIntentRelativePath('/outside', undefined, pathApi)).toBe(false);
      expect(
        validArchiveIntentRelativePath('C:\\outside\\probe', undefined, pathApi)
      ).toBe(false);
      expect(validArchiveIntentRelativePath('C:/outside/probe', undefined, pathApi)).toBe(
        false
      );
    }
  });

  it('models resolved symlink escape without depending on the native host', () => {
    const cases = [
      {
        pathApi: path.win32,
        rootReal: 'C:\\repo',
        containedReal: 'c:\\REPO\\probe-real',
        escapedReal: 'D:\\outside\\probe-real',
      },
      {
        pathApi: path.posix,
        rootReal: '/repo',
        containedReal: '/repo/probe-real',
        escapedReal: '/outside/probe-real',
      },
    ] as const;

    for (const fixture of cases) {
      expect(
        isArchiveContainedPath(
          fixture.rootReal,
          fixture.containedReal,
          fixture.pathApi
        )
      ).toBe(true);
      expect(
        isArchiveContainedPath(
          fixture.rootReal,
          fixture.escapedReal,
          fixture.pathApi
        )
      ).toBe(false);
    }
  });
});
