import { describe, expect, it } from 'vitest';

import type {
  SessionListEntry,
  StoreChangeIssueLinkEntry,
} from '../../src/api/types.js';
import {
  attributeRunChange,
  attributeSessionChange,
  classifySession,
} from '../../src/components/operations-model.js';

function session(overrides: Partial<SessionListEntry['session']> = {}): SessionListEntry {
  return {
    session: {
      id: 'session-1',
      kind: 'auto',
      task: 'operate',
      cwd: 'C:\\work\\member-a',
      state: 'running',
      startedAt: 1,
      lastOutputAt: 2,
      changeName: 'shared-change',
      execution: { kind: 'project', projectId: 'project-a', root: '/work/member-a' },
      ...overrides,
    },
    runState: { kind: 'absent' },
  };
}

function linkEntry(input: {
  instance: string | null;
  project?: string;
  line?: string;
  eligibility?: StoreChangeIssueLinkEntry['eligibility'];
  issueIds?: readonly string[];
}): StoreChangeIssueLinkEntry {
  return {
    occurrence: {
      kind: 'active',
      change: {
        changeId: 'shared-change',
        changeInstanceId: input.instance,
        projectId: input.project ?? 'project-a',
        targetLineId: input.line ?? 'main',
        foundAtRef: 'refs/heads/main',
        localLocator: null,
      },
    },
    association: input.issueIds?.length ? 'linked' : 'unlinked',
    eligibility: input.eligibility ?? (input.issueIds?.length ? 'already-linked' : 'attachable'),
    issues: (input.issueIds ?? []).map(issueId => ({
      identity: {
        uid: issueId,
        key: `ISS-${issueId}`,
        slug: null,
        aliases: [],
      },
      issueId,
      title: issueId,
      state: 'open',
      revisionId: '0001',
      nodeIds: ['change-node'],
    })),
  };
}

describe('operations presentation model', () => {
  it('classifies active, abnormal, and settled Session facts without inventing a lifecycle', () => {
    expect(classifySession(session()).groups).toEqual(['active']);
    expect(classifySession({
      ...session(),
      runState: { name: 'shared-change', kind: 'error', message: 'unreadable' },
    })).toEqual({ groups: ['active', 'abnormal'], abnormal: true });
    expect(classifySession(session({
      state: 'exited',
      terminationReason: 'signal',
      exitCode: null,
    })).groups).toEqual(['abnormal']);
    expect(classifySession(session({
      state: 'exited',
      terminationReason: 'exit',
      exitCode: 0,
    }))).toEqual({ groups: ['settled'], abnormal: false });
  });

  it('keeps two target-line instances ambiguous after project and alias match', () => {
    const main = linkEntry({ instance: 'change-main', line: 'main' });
    const release = linkEntry({ instance: 'change-release', line: 'release' });
    const result = attributeSessionChange(
      session({
        space: {
          type: 'store',
          id: 'store-x',
          root: '/planning/store-x',
          planning: { projectId: 'project-a', targetLineId: 'release' },
        },
      }).session,
      [main, release]
    );
    expect(result).toEqual({ kind: 'ambiguous', candidates: [main, release] });
  });

  it('keeps multiple proven Issue links on one exact Change attribution', () => {
    const entry = linkEntry({ instance: 'change-main', issueIds: ['issue-a', 'issue-b'] });
    const result = attributeRunChange(
      {
        runId: 'run-1',
        changeId: 'shared-change',
        planningSpaceId: 'planning-1',
        engine: 'reconciler',
        recordVersion: 3,
        status: 'waiting',
        sourceState: 'active',
      },
      'project-a',
      [entry]
    );
    expect(result).toEqual({ kind: 'exact', entry });
    if (result.kind === 'exact') {
      expect(result.entry.issues.map(issue => issue.issueId)).toEqual(['issue-a', 'issue-b']);
    }
  });

  it('names planning-only, legacy execution, missing identity, and duplicate identity without choosing', () => {
    const stable = linkEntry({ instance: 'change-main' });
    expect(attributeSessionChange(session({ execution: { kind: 'planning-only' } }).session, [stable]))
      .toEqual({ kind: 'unavailable', reason: 'planning-only' });
    expect(attributeSessionChange(session({ execution: undefined }).session, [stable]))
      .toEqual({ kind: 'unavailable', reason: 'legacy-execution' });
    expect(attributeSessionChange(session().session, [linkEntry({ instance: null, eligibility: 'identity-missing' })]))
      .toEqual({ kind: 'unavailable', reason: 'identity-missing' });
    expect(attributeSessionChange(session().session, [
      linkEntry({ instance: 'duplicate', eligibility: 'identity-ambiguous' }),
    ]).kind).toBe('ambiguous');
  });

  it('never parses Windows or POSIX cwd spellings as project authority', () => {
    const entry = linkEntry({ instance: 'change-main' });
    const windows = attributeSessionChange(
      session({ cwd: 'C:\\different\\checkout' }).session,
      [entry]
    );
    const posix = attributeSessionChange(
      session({ cwd: '/entirely/different/checkout' }).session,
      [entry]
    );
    expect(windows).toEqual({ kind: 'exact', entry });
    expect(posix).toEqual(windows);
  });
});
