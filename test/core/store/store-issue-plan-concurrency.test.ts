import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isStoreIssueError } from '../../../src/core/store/issues/diagnostics.js';
import { StoreIssuesModuleInstance } from '../../../src/core/store/issues/module.js';
import { parseExecutionPlanRevisionId } from '../../../src/core/store/planning-validation.js';
import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../../helpers/store-workspace-fixture.js';

const PROJECT = 'app-a';
const LINE = 'main';
const ISSUE = 'conditional-plan';

describe('conditional Execution Plan publication', { timeout: 180_000 }, () => {
  let f: StoreWorkspaceFixture;
  let issueUid: string;

  const scope = () => ({
    store: f.storeId,
    startPath: f.storeRoot,
    globalDataDir: f.globalDataDir,
  });

  const nodes = (nodeId: string) => [
    {
      nodeId,
      kind: 'intent' as const,
      projectId: PROJECT,
      targetLineId: LINE,
      summary: `work ${nodeId}`,
      dependsOn: [],
    },
  ];

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-plan-cas-',
      projects: [PROJECT],
      lines: [{ id: LINE, storeRef: 'refs/heads/main', codeRefs: { [PROJECT]: 'refs/heads/main' } }],
    });
    const created = await StoreIssuesModuleInstance.create({
      ...scope(), issueId: ISSUE, title: 'Conditional plan',
    });
    issueUid = created.identity.uid;
  });

  afterEach(() => f.cleanup());

  it('accepts null only for no plan, a matching revision, and omitted legacy callers', async () => {
    const first = await StoreIssuesModuleInstance.publishPlan({
      ...scope(),
      issueId: ISSUE,
      nodes: nodes('first'),
      expectedRevisionId: null,
    });
    expect(first.revision.revisionId).toBe('0001');
    expect(first.revision.supersedes).toBeNull();

    const second = await StoreIssuesModuleInstance.publishPlan({
      ...scope(),
      issueId: ISSUE,
      nodes: nodes('second'),
      expectedRevisionId: parseExecutionPlanRevisionId('0001'),
    });
    expect(second.revision.revisionId).toBe('0002');
    expect(second.revision.supersedes).toBe('0001');

    const third = await StoreIssuesModuleInstance.publishPlan({
      ...scope(),
      issueId: ISSUE,
      nodes: nodes('third'),
    });
    expect(third.revision.revisionId).toBe('0003');
    expect(third.revision.supersedes).toBe('0002');
  });

  it('refuses a stale base with zero bytes written and releases the Issue lock', async () => {
    await StoreIssuesModuleInstance.publishPlan({
      ...scope(), issueId: ISSUE, nodes: nodes('first'), expectedRevisionId: null,
    });
    await StoreIssuesModuleInstance.publishPlan({
      ...scope(), issueId: ISSUE, nodes: nodes('winner'),
      expectedRevisionId: parseExecutionPlanRevisionId('0001'),
    });
    const plansDir = path.join(f.storeRoot, 'rasen', 'issues', issueUid, 'plans');
    const before = fs.readdirSync(plansDir).map(name => [name, fs.readFileSync(path.join(plansDir, name), 'utf8')]);

    let refusal: unknown;
    try {
      await StoreIssuesModuleInstance.publishPlan({
        ...scope(), issueId: ISSUE, nodes: nodes('stale'),
        expectedRevisionId: parseExecutionPlanRevisionId('0001'),
      });
    } catch (error) {
      refusal = error;
    }
    expect(isStoreIssueError(refusal)).toBe(true);
    if (isStoreIssueError(refusal)) {
      expect(refusal.issueCode).toBe('execution_plan_revision_conflict');
      expect(refusal.expected).toBe('0001');
      expect(refusal.actual).toBe('0002');
    }
    expect(fs.readdirSync(plansDir).map(name => [name, fs.readFileSync(path.join(plansDir, name), 'utf8')])).toEqual(before);

    const afterConflict = await StoreIssuesModuleInstance.publishPlan({
      ...scope(), issueId: ISSUE, nodes: nodes('after-conflict'),
    });
    expect(afterConflict.revision.revisionId).toBe('0003');
  });

  it('serializes two conditional writers from one base so exactly one succeeds', async () => {
    await StoreIssuesModuleInstance.publishPlan({
      ...scope(), issueId: ISSUE, nodes: nodes('base'), expectedRevisionId: null,
    });
    const base = parseExecutionPlanRevisionId('0001');
    const results = await Promise.allSettled([
      StoreIssuesModuleInstance.publishPlan({ ...scope(), issueId: ISSUE, nodes: nodes('writer-a'), expectedRevisionId: base }),
      StoreIssuesModuleInstance.publishPlan({ ...scope(), issueId: ISSUE, nodes: nodes('writer-b'), expectedRevisionId: base }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(result => result.status === 'rejected');
    expect(rejected?.status).toBe('rejected');
    if (rejected?.status === 'rejected') {
      expect(isStoreIssueError(rejected.reason)).toBe(true);
      if (isStoreIssueError(rejected.reason)) {
        expect(rejected.reason.issueCode).toBe('execution_plan_revision_conflict');
      }
    }
    expect(fs.readdirSync(path.join(f.storeRoot, 'rasen', 'issues', issueUid, 'plans')).sort()).toEqual([
      '0001.yaml',
      '0002.yaml',
    ]);
  });
});
