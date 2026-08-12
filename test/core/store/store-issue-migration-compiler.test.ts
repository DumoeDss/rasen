import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { compileMigrationIssueTree } from '../../../src/core/store/issues/migration-compiler.js';
import { parseExecutionPlanRevision } from '../../../src/core/store/issues/plans.js';
import { parseIssueRecord } from '../../../src/core/store/issues/records.js';
import type { StoreIssues } from '../../../src/core/store/issues/types.js';

const NOW = '2026-08-07T00:00:00.000Z';

type Assert<T extends true> = T;
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;

// Compile-time guard: compatibility compilation must not grow the public
// mutation interface. A fourth method (for example importLegacy) fails build.
const publicIssueMethodsAreUnchanged: Assert<
  Equal<keyof StoreIssues, 'create' | 'setState' | 'publishPlan'>
> = true;

describe('Store Issue migration compiler', () => {
  it('purely compiles canonical Issue and revision 0001 bytes', () => {
    expect(publicIssueMethodsAreUnchanged).toBe(true);
    const compiled = compileMigrationIssueTree({
      issueId: 'release-coordinator',
      title: '协调跨项目发布',
      state: 'open',
      reason: null,
      createdAt: NOW,
      nodes: [
        {
          nodeId: 'docs',
          kind: 'intent',
          projectId: 'elftia',
          targetLineId: 'line-0.2',
          summary: 'Publish the integration guide',
          dependsOn: [],
        },
      ],
    });

    expect(compiled.rootRelative).toBe('rasen/issues/release-coordinator');
    expect(compiled.files.map((file) => [file.role, file.relativePath])).toEqual([
      ['issue-record', 'issue.yaml'],
      ['execution-plan', 'plans/0001.yaml'],
    ]);
    for (const file of compiled.files) {
      expect(file.digest).toBe(createHash('sha256').update(file.content, 'utf8').digest('hex'));
      expect(file.content.charCodeAt(0)).not.toBe(0xfeff);
      expect(file.content).not.toContain('sourceChange');
    }
    expect(parseIssueRecord(compiled.files[0]!.content)).toMatchObject({
      id: 'release-coordinator',
      title: '协调跨项目发布',
      state: 'open',
    });
    expect(
      parseExecutionPlanRevision(compiled.files[1]!.content, { verifyDigest: true })
    ).toMatchObject({ revisionId: '0001', supersedes: null });
    expect(compiled.files.map((file) => file.content)).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/sourceChange|project:|cwd:|commit:|Pipeline|Dispatch|acceptance/iu),
      ])
    );
  });

  it('emits only issue.yaml when no plan is supplied and stays deterministic', () => {
    const input = {
      issueId: 'no-plan-coordinator',
      title: 'No plan supplied',
      state: 'open' as const,
      reason: null,
      createdAt: NOW,
    };
    const first = compileMigrationIssueTree(input);
    const second = compileMigrationIssueTree(input);
    expect(second).toEqual(first);
    expect(first.files.map((file) => file.relativePath)).toEqual(['issue.yaml']);
    expect(first.files[0]!.content).not.toMatch(/README|plans\/|placeholder/iu);
    expect(() =>
      parseIssueRecord(
        first.files[0]!.content,
        `/store/rasen/issues/${first.issueId}/issue.yaml`
      )
    ).not.toThrow();
  });

  it('requires terminal rationale and reuses portable Issue validation', () => {
    expect(() =>
      compileMigrationIssueTree({
        issueId: 'terminal-coordinator',
        title: 'Terminal coordinator',
        state: 'resolved',
        reason: null,
        createdAt: NOW,
      })
    ).toThrow(/requires an operator reason/iu);
    expect(() =>
      compileMigrationIssueTree({
        issueId: 'portable-coordinator',
        title: 'C:\\machine\\specific',
        state: 'open',
        reason: null,
        createdAt: NOW,
      })
    ).toThrow(/filesystem path/iu);
  });

  it('rejects invalid DAGs and runtime schemas reject migration-only fields', () => {
    expect(() =>
      compileMigrationIssueTree({
        issueId: 'cyclic-coordinator',
        title: 'Cycle',
        state: 'open',
        reason: null,
        createdAt: NOW,
        nodes: [
          {
            nodeId: 'one',
            kind: 'intent',
            projectId: 'elftia',
            targetLineId: 'line-0.2',
            summary: 'One',
            dependsOn: ['two'],
          },
          {
            nodeId: 'two',
            kind: 'intent',
            projectId: 'elftia',
            targetLineId: 'line-0.2',
            summary: 'Two',
            dependsOn: ['one'],
          },
        ],
      })
    ).toThrow(/cycle/iu);

    const issueWithProject = [
      'version: 1',
      'id: strict-record',
      'title: Strict record',
      'state: open',
      'reason: null',
      `createdAt: ${NOW}`,
      'project: elftia',
      '',
    ].join('\n');
    expect(() => parseIssueRecord(issueWithProject)).toThrow(/project|unrecognized/iu);

    const compiled = compileMigrationIssueTree({
      issueId: 'strict-plan',
      title: 'Strict plan',
      state: 'open',
      reason: null,
      createdAt: NOW,
      nodes: [
        {
          nodeId: 'intent',
          kind: 'intent',
          projectId: 'elftia',
          targetLineId: 'line-0.2',
          summary: 'Intent',
        },
      ],
    });
    const withSelector = compiled.files[1]!.content.replace(
      '    summary: Intent',
      '    summary: Intent\n    sourceChange: legacy-alias'
    );
    expect(() => parseExecutionPlanRevision(withSelector)).toThrow(/sourceChange|unrecognized/iu);
  });
});
