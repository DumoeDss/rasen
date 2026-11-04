import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  EXECUTION_PLAN_REVISION_WIDTH,
  StorePlanningValidationError,
  formatExecutionPlanRevisionId,
  isExecutionPlanRevisionId,
  isIssueId,
  parseExecutionPlanRevisionId,
  parseIssueId,
  parseIssueStorageKey,
  resolveStorePlanningLayoutV2Path,
} from '../../../src/core/store/planning-foundation.js';

const WIN_ROOT = 'C:\\stores\\atelier';
const POSIX_ROOT = '/srv/stores/atelier';
const ISSUE = 'cross-line-telemetry';
const ISSUE_STORAGE_KEY = parseIssueStorageKey(ISSUE);

function win(address: Parameters<typeof resolveStorePlanningLayoutV2Path>[1]): string {
  return resolveStorePlanningLayoutV2Path(WIN_ROOT, address, 'win32');
}

function posix(address: Parameters<typeof resolveStorePlanningLayoutV2Path>[1]): string {
  return resolveStorePlanningLayoutV2Path(POSIX_ROOT, address, 'posix');
}

describe('Store-level Issue layout addresses', () => {
  it('addresses the directory, the record, the revisions directory, and one revision', () => {
    expect(posix({ kind: 'issue', issueStorageKey: ISSUE_STORAGE_KEY })).toBe(
      `${POSIX_ROOT}/rasen/issues/${ISSUE}`
    );
    expect(posix({ kind: 'issue-record', issueStorageKey: ISSUE_STORAGE_KEY })).toBe(
      `${POSIX_ROOT}/rasen/issues/${ISSUE}/issue.yaml`
    );
    expect(posix({ kind: 'execution-plans', issueStorageKey: ISSUE_STORAGE_KEY })).toBe(
      `${POSIX_ROOT}/rasen/issues/${ISSUE}/plans`
    );
    expect(posix({ kind: 'execution-plan', issueStorageKey: ISSUE_STORAGE_KEY, revisionId: '0002' })).toBe(
      `${POSIX_ROOT}/rasen/issues/${ISSUE}/plans/0002.yaml`
    );
  });

  it('gives the revision file its own address so no caller appends a filename', () => {
    const plansDir = posix({ kind: 'execution-plans', issueStorageKey: ISSUE_STORAGE_KEY });
    const revision = posix({ kind: 'execution-plan', issueStorageKey: ISSUE_STORAGE_KEY, revisionId: '0001' });
    // The point is not that the strings relate; it is that the contract supplies
    // BOTH, so a caller never has to compose the second from the first.
    expect(revision.startsWith(plansDir)).toBe(true);
    expect(revision).not.toBe(`${plansDir}/0001`);
  });

  it('resolves the same paths on win32 and posix flavors', () => {
    expect(win({ kind: 'issue-record', issueStorageKey: ISSUE_STORAGE_KEY })).toBe(
      `${WIN_ROOT}\\rasen\\issues\\${ISSUE}\\issue.yaml`
    );
    expect(win({ kind: 'execution-plan', issueStorageKey: ISSUE_STORAGE_KEY, revisionId: '0010' })).toBe(
      `${WIN_ROOT}\\rasen\\issues\\${ISSUE}\\plans\\0010.yaml`
    );
    // Same logical address, two flavors, one relative shape.
    const relativeWin = path.win32
      .relative(WIN_ROOT, win({ kind: 'execution-plan', issueStorageKey: ISSUE_STORAGE_KEY, revisionId: '0010' }))
      .split(path.win32.sep)
      .join('/');
    const relativePosix = path.posix.relative(
      POSIX_ROOT,
      posix({ kind: 'execution-plan', issueStorageKey: ISSUE_STORAGE_KEY, revisionId: '0010' })
    );
    expect(relativeWin).toBe(relativePosix);
  });

  it('accepts a mixed-case drive letter and forward-slash spelling on win32', () => {
    const lower = resolveStorePlanningLayoutV2Path(
      'c:/stores/atelier',
      { kind: 'issue-record', issueStorageKey: ISSUE_STORAGE_KEY },
      'win32'
    );
    expect(lower.toLowerCase()).toBe(
      `c:\\stores\\atelier\\rasen\\issues\\${ISSUE}\\issue.yaml`
    );
  });

  it('addresses long paths without truncating or shortening a segment', () => {
    const deep = `${POSIX_ROOT}/${'nested/'.repeat(30)}store`;
    const resolved = resolveStorePlanningLayoutV2Path(
      deep,
      { kind: 'execution-plan', issueStorageKey: ISSUE_STORAGE_KEY, revisionId: '9999' },
      'posix'
    );
    expect(resolved).toBe(`${deep}/rasen/issues/${ISSUE}/plans/9999.yaml`);
    expect(resolved.length).toBeGreaterThan(255);
  });

  it('is Store-level: no project or target line participates in the address', () => {
    // Every Issue address takes exactly one input. The type system already
    // refuses a projectId here, so the behavioural claim worth pinning is that
    // TWO Stores that differ only in project content produce the same relative
    // Issue address.
    const first = resolveStorePlanningLayoutV2Path(
      '/a',
      { kind: 'issue-record', issueStorageKey: ISSUE_STORAGE_KEY },
      'posix'
    );
    const second = resolveStorePlanningLayoutV2Path(
      '/b',
      { kind: 'issue-record', issueStorageKey: ISSUE_STORAGE_KEY },
      'posix'
    );
    expect(path.posix.relative('/a', first)).toBe(path.posix.relative('/b', second));
  });

  it('never resolves Issue content to project-planning content or the reverse', () => {
    const issue = posix({ kind: 'issue', issueStorageKey: ISSUE_STORAGE_KEY });
    const projectHome = posix({ kind: 'project-home', projectId: 'elftia' });
    const projectSpecs = posix({ kind: 'project-specs', projectId: 'elftia' });
    expect(issue.startsWith(projectHome)).toBe(false);
    expect(projectHome.startsWith(issue)).toBe(false);
    expect(projectSpecs.startsWith(issue)).toBe(false);
    expect(issue).toContain('/rasen/issues/');
    expect(projectHome).toContain('/rasen/projects/');
  });

  it('keeps a UTF-8 Chinese title out of the address by keeping ids ASCII', () => {
    // A Chinese TITLE lives in the record; the id is a portable segment. The
    // contract must reject a non-ASCII id rather than percent-encode it into a
    // different directory.
    expect(() => parseIssueId('跨项目遥测')).toThrow(StorePlanningValidationError);
  });

  it('refuses a relative Store root rather than resolving against cwd', () => {
    expect(() =>
      resolveStorePlanningLayoutV2Path('stores/atelier', { kind: 'issue', issueStorageKey: ISSUE_STORAGE_KEY }, 'posix')
    ).toThrow(/absolute/u);
  });
});

describe('Issue identifiers are portable canonical segments', () => {
  const rejected: readonly string[] = [
    '',
    '.',
    '..',
    'a/b',
    'a\\b',
    'trailing.',
    'trailing ',
    'con',
    'CON',
    'con.txt',
    'nul',
    'lpt9',
    'Mixed-Case',
    'UPPER',
    'has space',
    'has:colon',
    'has*star',
    'under_score',
  ];

  for (const value of rejected) {
    it(`rejects ${JSON.stringify(value)} on every platform`, () => {
      expect(() => parseIssueId(value)).toThrow(StorePlanningValidationError);
      expect(isIssueId(value)).toBe(false);
    });
  }

  it('rejects a control character without sanitizing it into another id', () => {
    const control = `bad${String.fromCharCode(1)}id`;
    expect(() => parseIssueId(control)).toThrow(StorePlanningValidationError);
    // No replacement segment is ever returned: the only success path returns
    // the INPUT, so an invalid value can never become a different valid one.
    expect(isIssueId(control)).toBe(false);
  });

  it('accepts canonical lowercase kebab ids', () => {
    for (const value of ['a', 'cross-line-telemetry', 'issue-2026-08', 'x1']) {
      expect(parseIssueId(value)).toBe(value);
    }
  });

  it('does not alias a lowercase Issue directory from a mixed-case spelling', () => {
    expect(() => parseIssueId('Cross-Line-Telemetry')).toThrow(StorePlanningValidationError);
    expect(() => parseIssueStorageKey('Cross-Line-Telemetry')).toThrow(
      StorePlanningValidationError
    );
  });
});

describe('Execution Plan revision identifiers are canonical ordinals', () => {
  it('accepts only fixed-width zero-padded ordinals', () => {
    expect(parseExecutionPlanRevisionId('0001')).toBe('0001');
    expect(parseExecutionPlanRevisionId('0042')).toBe('0042');
    expect(parseExecutionPlanRevisionId('9999')).toBe('9999');
    expect(EXECUTION_PLAN_REVISION_WIDTH).toBe(4);
  });

  for (const value of ['0000', '1', '01', '001', '00001', '0001.yaml', '-001', '000a', '૦૦૦૧']) {
    it(`rejects ${JSON.stringify(value)} without sanitizing it`, () => {
      expect(() => parseExecutionPlanRevisionId(value)).toThrow(StorePlanningValidationError);
      expect(isExecutionPlanRevisionId(value)).toBe(false);
    });
  }

  it('mints only the canonical spelling of an ordinal', () => {
    expect(formatExecutionPlanRevisionId(1)).toBe('0001');
    expect(formatExecutionPlanRevisionId(10)).toBe('0010');
    expect(formatExecutionPlanRevisionId(9999)).toBe('9999');
    expect(() => formatExecutionPlanRevisionId(0)).toThrow(StorePlanningValidationError);
    expect(() => formatExecutionPlanRevisionId(-1)).toThrow(StorePlanningValidationError);
    expect(() => formatExecutionPlanRevisionId(10_000)).toThrow(StorePlanningValidationError);
    expect(() => formatExecutionPlanRevisionId(1.5)).toThrow(StorePlanningValidationError);
  });

  it('refuses a rejected spelling as an address, so it cannot reach an existing revision', () => {
    expect(() =>
      resolveStorePlanningLayoutV2Path(
        POSIX_ROOT,
        { kind: 'execution-plan', issueStorageKey: ISSUE_STORAGE_KEY, revisionId: '1' },
        'posix'
      )
    ).toThrow(StorePlanningValidationError);
  });
});

describe('Issue addresses stay contained and pure', () => {
  it('refuses an identifier that would escape the Store root', () => {
    for (const escape of ['../elsewhere', '..', 'a/../..']) {
      expect(() => parseIssueStorageKey(escape)).toThrow(StorePlanningValidationError);
    }
  });

  it('touches no filesystem: an address resolves for a Store root that does not exist', () => {
    const nowhere = '/definitely/not/a/real/store/root';
    expect(
      resolveStorePlanningLayoutV2Path(
        nowhere,
        { kind: 'issue-record', issueStorageKey: ISSUE_STORAGE_KEY },
        'posix'
      )
    ).toBe(`${nowhere}/rasen/issues/${ISSUE}/issue.yaml`);
  });

  it('is deterministic: the same inputs produce byte-identical output', () => {
    const first = posix({ kind: 'execution-plan', issueStorageKey: ISSUE_STORAGE_KEY, revisionId: '0003' });
    const second = posix({ kind: 'execution-plan', issueStorageKey: ISSUE_STORAGE_KEY, revisionId: '0003' });
    expect(first).toBe(second);
  });
});
