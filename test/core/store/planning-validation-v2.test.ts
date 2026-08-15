import { describe, expect, it } from 'vitest';

import {
  EXECUTION_PLAN_REVISION_WIDTH,
  WINDOWS_RESERVED_DEVICE_NAMES,
  formatExecutionPlanRevisionId,
  isChangeId,
  isExecutionPlanRevisionId,
  isFullGitRef,
  isGitOid,
  isIssueId,
  isPortableRelativePath,
  isProjectId,
  isSha256Digest,
  isTargetLineId,
  parsePortableRelativePath,
} from '../../../src/core/store/planning-foundation.js';

const UUID = '8a0c76e8-faa9-49dc-b0d1-c35df3ad797f';

describe('Store planning v2 portable validators', () => {
  it.each([UUID, 'elftia', 'project-2'])(
    'accepts canonical project id %s',
    value => {
      expect(isProjectId(value)).toBe(true);
    }
  );

  it.each([
    '',
    '.',
    '..',
    UUID.toUpperCase(),
    'Project-2',
    'project/name',
    'project\\name',
    'project' + String.fromCharCode(0) + 'name',
    'project.',
    'project ',
    'con',
  ])('rejects non-canonical or unsafe project id %j', value => {
    expect(isProjectId(value)).toBe(false);
  });

  it.each(['main', 'line-0.2', 'release-2026.08'])(
    'accepts target-line id %s',
    value => {
      expect(isTargetLineId(value)).toBe(true);
    }
  );

  it.each([
    '.main',
    'main.',
    'line--2',
    'line..2',
    'line.-2',
    'Line-2',
    '../main',
    'con.release',
  ])('rejects ambiguous target-line id %j', value => {
    expect(isTargetLineId(value)).toBe(false);
  });

  it('uses the shared kebab policy for v2 Change ids with portable guards', () => {
    expect(isChangeId('refresh-cache')).toBe(true);
    for (const value of ['Refresh-cache', 'refresh.cache', '..', 'nul']) {
      expect(isChangeId(value), value).toBe(false);
    }
  });

  it('centralizes every Windows reserved device name', () => {
    expect(WINDOWS_RESERVED_DEVICE_NAMES).toHaveLength(22);
    for (const name of WINDOWS_RESERVED_DEVICE_NAMES) {
      expect(isProjectId(name), name).toBe(false);
      expect(isTargetLineId(`${name}.release`), name).toBe(false);
    }
    expect(isProjectId('com0')).toBe(true);
    expect(isProjectId('lpt0')).toBe(true);
  });

  // Task 1.1's brands: `IssueId` is a Store-level identifier on the same
  // portable canonical-segment contract as a v2 project id, and
  // `ExecutionPlanRevisionId` is the zero-padded ordinal that addresses one
  // immutable revision. Both are validated here through the same public
  // surface as every other brand in this file, and neither reaches this
  // suite through `store-issue-layout.test.ts`'s dedicated layout coverage —
  // this is the validator-only contract, independent of any filesystem join.
  it.each(['refresh-cache', 'issue-2', UUID])(
    'accepts canonical Issue id %s',
    value => {
      expect(isIssueId(value)).toBe(true);
    }
  );

  it.each([
    '',
    '.',
    '..',
    'Refresh-Cache',
    'issue/name',
    'issue\\name',
    'issue' + String.fromCharCode(0) + 'name',
    'issue.',
    'issue ',
    '../escape',
    'con',
  ])('rejects non-canonical or unsafe Issue id %j', value => {
    expect(isIssueId(value)).toBe(false);
  });

  it('rejects every Windows reserved device name as an Issue id too', () => {
    for (const name of WINDOWS_RESERVED_DEVICE_NAMES) {
      expect(isIssueId(name), name).toBe(false);
    }
    expect(isIssueId('com0')).toBe(true);
  });

  it('formats an Execution Plan revision ordinal at the fixed canonical width', () => {
    expect(EXECUTION_PLAN_REVISION_WIDTH).toBe(4);
    expect(formatExecutionPlanRevisionId(1)).toBe('0001');
    expect(formatExecutionPlanRevisionId(42)).toBe('0042');
    expect(formatExecutionPlanRevisionId(9999)).toBe('9999');
  });

  it.each(['0001', '0042', '9999'])(
    'accepts a canonical Execution Plan revision ordinal %s',
    value => {
      expect(isExecutionPlanRevisionId(value)).toBe(true);
    }
  );

  it.each([
    '1', // unpadded
    '001', // under-padded
    '00001', // over-padded
    '0000', // zero ordinal — there is no zeroth revision
    '000a', // non-digit
    '-0001', // signed
    ' 0001', // leading whitespace
    '0001 ', // trailing whitespace
  ])('rejects a non-canonical Execution Plan revision ordinal %j', value => {
    expect(isExecutionPlanRevisionId(value)).toBe(false);
  });

  it.each([0, -1, 1.5, 10000])(
    'refuses to mint an out-of-range or non-integer revision ordinal %s',
    ordinal => {
      expect(() => formatExecutionPlanRevisionId(ordinal)).toThrow();
    }
  );

  it('accepts only conservative full Git refs', () => {
    for (const value of [
      'refs/heads/main',
      'refs/heads/release/0.2',
      'refs/tags/Release-2',
    ]) {
      expect(isFullGitRef(value), value).toBe(true);
    }
    for (const value of [
      'main',
      'refs/heads/a..b',
      'refs/heads/a.lock',
      'refs/heads/a b',
      'refs/heads/a@{b',
      'refs//heads/main',
      'refs/heads/main/',
      'refs/heads/a\\b',
      'refs/heads/con',
      'refs/heads/NUL.txt',
      'refs/heads/con .topic',
      'refs/heads/a<b',
      'refs/heads/a>b',
      'refs/heads/a"b',
      'refs/heads/a|b',
    ]) {
      expect(isFullGitRef(value), value).toBe(false);
    }
  });

  // Deliberately NOT parameterized by flavor. `isPortableRelativePath` and
  // `isFullGitRef` take no flavor argument — the rule is unconditional on every
  // platform, which is the point. An `it.each(['win32','posix'])` here ran the
  // identical body twice under two names that each claimed a per-flavor
  // guarantee neither case actually exercised.
  it('enforces Windows-representable path/ref components on every platform', () => {
    for (const character of [':', '*', '?', '"', '<', '>', '|']) {
      expect(
        isPortableRelativePath(`evidence/report${character}name.md`),
        `portable path containing ${character}`
      ).toBe(false);
      expect(
        isFullGitRef(`refs/heads/report${character}name`),
        `portable ref containing ${character}`
      ).toBe(false);
    }
    for (const reserved of ['con', 'NUL.txt', 'com1.release', 'con .txt']) {
      expect(isPortableRelativePath(`evidence/${reserved}`), reserved).toBe(false);
      expect(isFullGitRef(`refs/heads/${reserved}`), reserved).toBe(false);
    }
  });

  it('accepts canonical full Git OIDs and SHA-256 digests', () => {
    expect(isGitOid('a'.repeat(40))).toBe(true);
    expect(isGitOid('b'.repeat(64))).toBe(true);
    expect(isSha256Digest('c'.repeat(64))).toBe(true);

    for (const value of ['a'.repeat(39), 'A'.repeat(40), 'g'.repeat(40)]) {
      expect(isGitOid(value), value).toBe(false);
    }
    for (const value of ['a'.repeat(63), 'A'.repeat(64), 'z'.repeat(64)]) {
      expect(isSha256Digest(value), value).toBe(false);
    }
  });

  it.each(['evidence/verification-report.md', 'nested/quality/report-2.json'])(
    'accepts portable relative evidence path %s',
    value => {
      expect(parsePortableRelativePath(value)).toBe(value);
    }
  );

  it.each([
    '',
    '/absolute/report.md',
    'C:/absolute/report.md',
    '../escape.md',
    'evidence/../escape.md',
    'evidence\\report.md',
    'evidence//report.md',
    'evidence/con.txt',
    'evidence/con .txt',
    'evidence/report. ',
  ])('rejects non-portable evidence path %j', value => {
    expect(isPortableRelativePath(value)).toBe(false);
  });
});
