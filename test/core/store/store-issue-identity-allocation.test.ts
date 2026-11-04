import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  StoreIssuesModule,
  acceptanceConditionsDigest,
  deriveIssueKey,
  deriveLegacyIssueUid,
  issueAllocationLockHeld,
  issueLockHeld,
  productionStoreIssueDependencies,
  serializeAcceptanceConditionsRevision,
  serializeIssueRecord,
  serializeIssueRecordV2,
  type StoreIssueDependencies,
} from '../../../src/core/store/issues/index.js';
import { parseIssueId, parseIssueUid } from '../../../src/core/store/planning-validation.js';
import { AtomicWorkspaceWriteConflictError } from '../../../src/core/store/workspace/dependencies.js';
import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../../helpers/store-workspace-fixture.js';

const UID_A = '75f3d57b-57e4-46ab-88e4-cbfec96bd257';
const UID_B = '11932ead-a7d4-4273-b47a-6159084f254f';
const UID_C = 'ea088ff0-b6f1-4f2d-9283-78384e398e4c';

describe('system-assigned Issue creation', { timeout: 180_000 }, () => {
  let fixture: StoreWorkspaceFixture;

  const scope = () => ({
    store: fixture.storeId,
    startPath: fixture.storeRoot,
    globalDataDir: fixture.globalDataDir,
  });

  beforeEach(async () => {
    fixture = await createStoreWorkspaceFixture({
      prefix: 'rasen-issue-identity-allocation-',
      lines: [
        {
          id: 'main',
          storeRef: 'refs/heads/main',
          codeRefs: { 'app-a': 'refs/heads/main' },
        },
      ],
    });
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('publishes the V2 record atomically under allocation then UID locks', async () => {
    const calls: Array<{
      readonly target: string;
      readonly expectedBefore: unknown;
      readonly allocationHeld: boolean;
      readonly issueHeld: boolean;
    }> = [];
    const baseFs = productionStoreIssueDependencies.fs;
    const dependencies: StoreIssueDependencies = {
      ...productionStoreIssueDependencies,
      fs: {
        ...baseFs,
        async writeTextAtomic(target, content, expectedBefore) {
          calls.push({
            target,
            expectedBefore,
            allocationHeld: issueAllocationLockHeld(),
            issueHeld: issueLockHeld(),
          });
          await baseFs.writeTextAtomic!(target, content, expectedBefore);
        },
      },
      mintIssueUid: () => UID_A,
    };

    const result = await new StoreIssuesModule({ dependencies }).create({
      ...scope(),
      title: '同一个标题不再承担机器身份',
      issueId: 'legacy-friendly-name',
    });

    expect(result.record.version).toBe(2);
    if (result.record.version !== 2) throw new Error('expected a V2 Issue record');
    expect(result.record.identity).toEqual({
      uid: UID_A,
      key: deriveIssueKey(UID_A),
      slug: null,
      aliases: [{ kind: 'legacy-id', value: 'legacy-friendly-name' }],
    });
    const recordPath = fixture.at('rasen', 'issues', UID_A, 'issue.yaml');
    expect(result.written).toEqual([recordPath]);
    expect(calls).toEqual([
      {
        target: recordPath,
        expectedBefore: { content: null, identity: null },
        allocationHeld: true,
        issueHeld: true,
      },
    ]);
    expect(fs.existsSync(recordPath)).toBe(true);
    expect(fs.existsSync(fixture.at('rasen', 'issues', 'legacy-friendly-name'))).toBe(false);
    expect(fs.existsSync(fixture.at('rasen', 'issues', UID_A, 'plans'))).toBe(false);
  });

  it('allows concurrent repeated titles while assigning distinct UID/key pairs', async () => {
    const minted = [UID_A, UID_B];
    const dependencies: StoreIssueDependencies = {
      ...productionStoreIssueDependencies,
      mintIssueUid: () => {
        const uid = minted.shift();
        if (uid === undefined) throw new Error('unexpected identity allocation');
        return uid;
      },
    };
    const issues = new StoreIssuesModule({ dependencies });

    const results = await Promise.all([
      issues.create({ ...scope(), title: '重复标题' }),
      issues.create({ ...scope(), title: '重复标题' }),
    ]);
    const records = results.map(result => result.record);
    expect(records.every(record => record.version === 2)).toBe(true);
    const identities = records.map(record => {
      if (record.version !== 2) throw new Error('expected V2 Issue records');
      return record.identity;
    });
    expect(new Set(identities.map(identity => identity.uid))).toEqual(new Set([UID_A, UID_B]));
    expect(new Set(identities.map(identity => identity.key))).toEqual(
      new Set([deriveIssueKey(UID_A), deriveIssueKey(UID_B)])
    );
    for (const identity of identities) {
      expect(fs.existsSync(fixture.at('rasen', 'issues', identity.uid, 'issue.yaml'))).toBe(true);
    }
  });

  it('retries a catalog collision and publishes the next generated identity', async () => {
    await new StoreIssuesModule({
      dependencies: {
        ...productionStoreIssueDependencies,
        mintIssueUid: () => UID_A,
      },
    }).create({ ...scope(), title: 'First' });

    const minted = [UID_A, UID_C];
    const result = await new StoreIssuesModule({
      dependencies: {
        ...productionStoreIssueDependencies,
        mintIssueUid: () => minted.shift() ?? UID_C,
      },
    }).create({ ...scope(), title: 'Second' });

    expect(result.record.version).toBe(2);
    if (result.record.version !== 2) throw new Error('expected a V2 Issue record');
    expect(result.record.identity.uid).toBe(UID_C);
    expect(fs.existsSync(fixture.at('rasen', 'issues', UID_A, 'issue.yaml'))).toBe(true);
    expect(fs.existsSync(fixture.at('rasen', 'issues', UID_C, 'issue.yaml'))).toBe(true);
  });

  it('reports an unverified pre-publication failure as indeterminate with its assigned identity', async () => {
    let atomicCalls = 0;
    const dependencies: StoreIssueDependencies = {
      ...productionStoreIssueDependencies,
      fs: {
        ...productionStoreIssueDependencies.fs,
        async writeTextAtomic(target) {
          atomicCalls += 1;
          throw new AtomicWorkspaceWriteConflictError(target, 'injected allocation collision');
        },
      },
      mintIssueUid: () => UID_A,
    };

    await expect(
      new StoreIssuesModule({ dependencies }).create({ ...scope(), title: 'Never published' })
    ).rejects.toMatchObject({
      issueCode: 'issue_publication_indeterminate',
      recovery: {
        kind: 'issue-publication-indeterminate',
        identity: { uid: UID_A, key: deriveIssueKey(UID_A) },
        retrySafe: false,
      },
    });

    expect(atomicCalls).toBe(1);
    const issuesRoot = fixture.at('rasen', 'issues');
    expect(fs.existsSync(issuesRoot)).toBe(false);
    expect(
      fs.existsSync(path.join(fixture.storeRoot, 'rasen', 'issues', UID_A, 'issue.yaml'))
    ).toBe(false);
  });

  it('keeps a verification-read failure out of the retry-safe allocation taxonomy', async () => {
    const recordPath = fixture.at('rasen', 'issues', UID_A, 'issue.yaml');
    const injectedPathError = `verification failed at ${recordPath}`;
    let thrown: unknown;
    try {
      await new StoreIssuesModule({
        dependencies: {
          ...productionStoreIssueDependencies,
          fs: {
            ...productionStoreIssueDependencies.fs,
            async writeTextAtomic(target) {
              throw new AtomicWorkspaceWriteConflictError(target, 'publication outcome unknown');
            },
            async readText(target) {
              if (target === recordPath) throw new Error(injectedPathError);
              return productionStoreIssueDependencies.fs.readText(target);
            },
          },
          mintIssueUid: () => UID_A,
        },
      }).create({ ...scope(), title: 'Verification cannot observe the commit point' });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      issueCode: 'issue_publication_indeterminate',
      recovery: {
        identity: { uid: UID_A, key: deriveIssueKey(UID_A) },
        retrySafe: false,
      },
      cause: {
        writeError: expect.any(AtomicWorkspaceWriteConflictError),
        readError: expect.objectContaining({ message: injectedPathError }),
      },
    });
    expect((thrown as Error).message).not.toContain(recordPath);
    expect((thrown as { diagnostic: { target?: string } }).diagnostic.target).toBeUndefined();
  });

  it('reports retained absent-before carriers as indeterminate instead of claiming zero writes', async () => {
    const baseFs = productionStoreIssueDependencies.fs;
    let retainedCarrier = '';
    let thrown: unknown;
    try {
      await new StoreIssuesModule({
        dependencies: {
          ...productionStoreIssueDependencies,
          fs: {
            ...baseFs,
            async writeTextAtomic(target, content) {
              const digest = createHash('sha256').update(content, 'utf8').digest('hex');
              retainedCarrier = path.join(
                path.dirname(target),
                `.${path.basename(target)}.rasen-write-${digest}.intent`
              );
              await baseFs.writeText(retainedCarrier, content);
              throw new Error(`injected carrier failure at ${target}`);
            },
          },
          mintIssueUid: () => UID_A,
        },
      }).create({ ...scope(), title: 'Carrier survives an unknown outcome' });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      issueCode: 'issue_publication_indeterminate',
      recovery: {
        identity: { uid: UID_A, key: deriveIssueKey(UID_A) },
        retrySafe: false,
      },
    });
    expect(fs.existsSync(retainedCarrier)).toBe(true);
    expect(fs.existsSync(path.dirname(retainedCarrier))).toBe(true);
    expect((thrown as Error).message).not.toContain(fixture.tempDir);
  });

  it('retries only when an atomic race published a different valid occupant', async () => {
    const minted = [UID_A, UID_B];
    let raced = false;
    const baseFs = productionStoreIssueDependencies.fs;
    const dependencies: StoreIssueDependencies = {
      ...productionStoreIssueDependencies,
      fs: {
        ...baseFs,
        async writeTextAtomic(target, content, expectedBefore) {
          if (!raced && target.endsWith(path.join(UID_A, 'issue.yaml'))) {
            raced = true;
            await baseFs.writeText(
              target,
              serializeIssueRecordV2({
                version: 2,
                identity: {
                  uid: parseIssueUid(UID_A),
                  key: deriveIssueKey(UID_A),
                  slug: 'racing-owner',
                  aliases: [],
                },
                title: 'Racing owner',
                state: 'open',
                reason: null,
                createdAt: '2026-08-01T00:00:00.000Z',
              })
            );
            throw new AtomicWorkspaceWriteConflictError(target, 'racing valid occupant');
          }
          await baseFs.writeTextAtomic!(target, content, expectedBefore);
        },
      },
      mintIssueUid: () => minted.shift() ?? UID_B,
    };

    const result = await new StoreIssuesModule({ dependencies }).create({
      ...scope(),
      title: 'Requested Issue',
    });
    expect(result.identity.uid).toBe(UID_B);
    expect(fs.existsSync(fixture.at('rasen', 'issues', UID_A, 'issue.yaml'))).toBe(true);
    expect(fs.existsSync(fixture.at('rasen', 'issues', UID_B, 'issue.yaml'))).toBe(true);
  });

  it('returns the committed identity when atomic cleanup reports a post-publication conflict', async () => {
    const baseFs = productionStoreIssueDependencies.fs;
    const result = await new StoreIssuesModule({
      dependencies: {
        ...productionStoreIssueDependencies,
        fs: {
          ...baseFs,
          async writeTextAtomic(target, content, expectedBefore) {
            await baseFs.writeTextAtomic!(target, content, expectedBefore);
            throw new AtomicWorkspaceWriteConflictError(target, 'injected after publication');
          },
        },
        mintIssueUid: () => UID_A,
      },
    }).create({ ...scope(), title: 'Published exactly once' });

    expect(result.identity.uid).toBe(UID_A);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'issue_record_post_publish_warning' }),
    ]);
    expect(fs.readdirSync(fixture.at('rasen', 'issues'))).toEqual([UID_A]);
  });

  it('returns the committed identity when ordinary post-publication cleanup fails', async () => {
    const baseFs = productionStoreIssueDependencies.fs;
    const result = await new StoreIssuesModule({
      dependencies: {
        ...productionStoreIssueDependencies,
        fs: {
          ...baseFs,
          async writeTextAtomic(target, content, expectedBefore) {
            await baseFs.writeTextAtomic!(target, content, expectedBefore);
            throw new Error('injected ordinary cleanup failure');
          },
        },
        mintIssueUid: () => UID_A,
      },
    }).create({ ...scope(), title: 'Committed before cleanup failed' });

    expect(result.identity.uid).toBe(UID_A);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'issue_record_post_publish_warning',
        message: expect.not.stringContaining('ordinary cleanup failure'),
        cause: expect.objectContaining({ message: 'injected ordinary cleanup failure' }),
      }),
    ]);
    expect(fs.readdirSync(fixture.at('rasen', 'issues'))).toEqual([UID_A]);
  });

  it('maps an ordinary pre-publication filesystem failure to the indeterminate diagnostic', async () => {
    await expect(
      new StoreIssuesModule({
        dependencies: {
          ...productionStoreIssueDependencies,
          fs: {
            ...productionStoreIssueDependencies.fs,
            async writeTextAtomic() {
              throw new Error('injected ordinary publication failure');
            },
          },
          mintIssueUid: () => UID_A,
        },
      }).create({ ...scope(), title: 'Never committed' })
    ).rejects.toMatchObject({
      issueCode: 'issue_publication_indeterminate',
      recovery: {
        identity: { uid: UID_A, key: deriveIssueKey(UID_A) },
        retrySafe: false,
      },
      cause: expect.objectContaining({ message: 'injected ordinary publication failure' }),
    });
    expect(fs.existsSync(fixture.at('rasen', 'issues', UID_A, 'issue.yaml'))).toBe(false);
  });

  it('reports optional README failure as partial success with the committed identity', async () => {
    const baseFs = productionStoreIssueDependencies.fs;
    const result = await new StoreIssuesModule({
      dependencies: {
        ...productionStoreIssueDependencies,
        fs: {
          ...baseFs,
          async writeText(target, content) {
            if (path.basename(target) === 'README.md') throw new Error('injected README failure');
            await baseFs.writeText(target, content);
          },
        },
        mintIssueUid: () => UID_A,
      },
    }).create({ ...scope(), title: 'Record survives README failure', readme: true });

    expect(result.identity.uid).toBe(UID_A);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'issue_readme_write_failed',
        message: expect.not.stringContaining('injected README failure'),
        cause: expect.objectContaining({ message: 'injected README failure' }),
      }),
    ]);
    expect(result.written).toEqual([fixture.at('rasen', 'issues', UID_A, 'issue.yaml')]);
    expect(fs.existsSync(result.written[0]!)).toBe(true);
  });

  it('resolves every mutation selector to one UID and writes V2 child owners', async () => {
    const issues = new StoreIssuesModule({
      dependencies: {
        ...productionStoreIssueDependencies,
        mintIssueUid: () => UID_A,
      },
    });
    const created = await issues.create({
      ...scope(),
      title: 'Selector target',
      issueId: 'selector-target',
    });
    if (created.record.version !== 2) throw new Error('expected a V2 Issue record');
    const identity = created.record.identity;

    const plan = await issues.publishPlan({
      ...scope(),
      issueId: 'legacy:selector-target',
      nodes: [
        {
          nodeId: 'intent',
          kind: 'intent',
          projectId: 'app-a',
          targetLineId: 'main',
          summary: 'Prove selector-independent storage',
          dependsOn: [],
        },
      ],
    });
    expect(plan.revision).toMatchObject({ version: 2, issueUid: identity.uid });

    const conditions = await issues.publishAcceptance({
      ...scope(),
      issueId: identity.key,
      conditions: [{ id: 'identity', requirement: 'Every child names the Issue UID' }],
    });
    expect(conditions.revision).toMatchObject({ version: 2, issueUid: identity.uid });

    const state = await issues.setState({
      ...scope(),
      issueId: `uid:${identity.uid}`,
      state: 'resolved',
    });
    expect(state.record.state).toBe('resolved');
    const accepted = await issues.accept({
      ...scope(),
      issueId: 'selector-target',
      conditionsRevisionId: conditions.revision.revisionId,
      conditionsSha256: conditions.revision.contentSha256,
      gate: { completed: 1, total: 1, health: 'healthy', problemsStanding: 0 },
    });
    expect(accepted.record).toMatchObject({ version: 2, issueUid: identity.uid });
    expect(accepted.written).toEqual([
      fixture.at('rasen', 'issues', identity.uid, 'accepted.yaml'),
    ]);
    expect(fs.existsSync(fixture.at('rasen', 'issues', 'selector-target'))).toBe(false);
  });

  it('holds allocation through selector resolution and the UID-locked mutation', async () => {
    await new StoreIssuesModule({
      dependencies: {
        ...productionStoreIssueDependencies,
        mintIssueUid: () => UID_A,
      },
    }).create({ ...scope(), title: 'Repeated title' });

    const observations: Array<{ allocationHeld: boolean; issueHeld: boolean }> = [];
    const baseFs = productionStoreIssueDependencies.fs;
    const issues = new StoreIssuesModule({
      dependencies: {
        ...productionStoreIssueDependencies,
        fs: {
          ...baseFs,
          async writeText(target, content) {
            if (
              target.endsWith(path.join(UID_A, 'issue.yaml')) &&
              content.includes('state: resolved')
            ) {
              observations.push({
                allocationHeld: issueAllocationLockHeld(),
                issueHeld: issueLockHeld(),
              });
            }
            await baseFs.writeText(target, content);
          },
        },
        mintIssueUid: () => UID_B,
      },
    });

    await issues.setState({
      ...scope(),
      issueId: 'repeated-title',
      state: 'resolved',
    });

    expect(observations).toEqual([{ allocationHeld: true, issueHeld: true }]);
  });

  it('linearizes convenience-selector resolution after a gated same-slug creation', async () => {
    const first = new StoreIssuesModule({
      dependencies: {
        ...productionStoreIssueDependencies,
        mintIssueUid: () => UID_A,
      },
    });
    await first.create({ ...scope(), title: 'Repeated title' });

    let releasePublication!: () => void;
    const publicationReleased = new Promise<void>(resolve => {
      releasePublication = resolve;
    });
    let publicationEntered!: () => void;
    const publicationStarted = new Promise<void>(resolve => {
      publicationEntered = resolve;
    });
    const baseFs = productionStoreIssueDependencies.fs;
    const concurrent = new StoreIssuesModule({
      dependencies: {
        ...productionStoreIssueDependencies,
        fs: {
          ...baseFs,
          async writeTextAtomic(target, content, expectedBefore) {
            publicationEntered();
            await publicationReleased;
            await baseFs.writeTextAtomic!(target, content, expectedBefore);
          },
        },
        mintIssueUid: () => UID_B,
      },
    });

    const createSecond = concurrent.create({ ...scope(), title: 'Repeated title' });
    await publicationStarted;

    let mutationSettled = false;
    const mutation = first
      .setState({ ...scope(), issueId: 'repeated-title', state: 'resolved' })
      .finally(() => {
        mutationSettled = true;
      });
    await Promise.resolve();
    expect(mutationSettled).toBe(false);

    const mutationAssertion = expect(mutation).rejects.toMatchObject({
      issueCode: 'issue_selector_ambiguous',
    });
    releasePublication();
    await expect(createSecond).resolves.toMatchObject({ identity: { uid: UID_B } });
    await mutationAssertion;

    const firstRecord = fs.readFileSync(
      fixture.at('rasen', 'issues', UID_A, 'issue.yaml'),
      'utf8'
    );
    const secondRecord = fs.readFileSync(
      fixture.at('rasen', 'issues', UID_B, 'issue.yaml'),
      'utf8'
    );
    expect(firstRecord).toContain('state: open');
    expect(secondRecord).toContain('state: open');
  });

  it('publishes UID-owned resources for a V1 Issue while retaining its legacy storage record', async () => {
    const legacyId = parseIssueId('historical-issue');
    const projectedUid = deriveLegacyIssueUid(fixture.storeUid, legacyId);
    const legacyRecordPath = fixture.at('rasen', 'issues', legacyId, 'issue.yaml');
    fixture.write(
      legacyRecordPath,
      serializeIssueRecord({
        version: 1,
        id: legacyId,
        title: 'Historical Issue',
        state: 'open',
        reason: null,
        createdAt: '2026-08-01T00:00:00.000Z',
      })
    );
    const issues = new StoreIssuesModule();

    const conditions = await issues.publishAcceptance({
      ...scope(),
      issueId: legacyId,
      conditions: [{ id: 'compatibility', requirement: 'Keep V1 storage stable' }],
    });
    expect(conditions.revision).toMatchObject({ version: 2, issueUid: projectedUid });
    expect(conditions.written[0]).toBe(
      fixture.at('rasen', 'issues', legacyId, 'acceptance', '0001.yaml')
    );

    const accepted = await issues.accept({
      ...scope(),
      issueId: `key:${deriveIssueKey(projectedUid)}`,
      conditionsRevisionId: conditions.revision.revisionId,
      conditionsSha256: conditions.revision.contentSha256,
      gate: { completed: 0, total: 0, health: 'healthy', problemsStanding: 0 },
    });
    expect(accepted.record).toMatchObject({ version: 2, issueUid: projectedUid });
    expect(fs.readFileSync(legacyRecordPath, 'utf8')).toContain('version: 1');
    expect(fs.readFileSync(legacyRecordPath, 'utf8')).toContain('state: resolved');
    expect(fs.existsSync(fixture.at('rasen', 'issues', projectedUid))).toBe(false);
  });

  it('rejects a readable V2 child whose owner UID does not match the selected Issue', async () => {
    const issues = new StoreIssuesModule({
      dependencies: {
        ...productionStoreIssueDependencies,
        mintIssueUid: () => UID_A,
      },
    });
    const created = await issues.create({ ...scope(), title: 'Owner target' });
    if (created.record.version !== 2) throw new Error('expected a V2 Issue record');
    const published = await issues.publishAcceptance({
      ...scope(),
      issueId: created.record.identity.uid,
      conditions: [{ id: 'owner', requirement: 'Owner UID matches' }],
    });
    if (published.revision.version !== 2) {
      throw new Error('expected a V2 acceptance-conditions revision');
    }
    const mismatchDraft = {
      version: 2 as const,
      issueUid: parseIssueUid(UID_B),
      revisionId: published.revision.revisionId,
      supersedes: published.revision.supersedes,
      createdAt: published.revision.createdAt,
      conditions: published.revision.conditions,
    };
    const mismatch = {
      ...mismatchDraft,
      contentSha256: acceptanceConditionsDigest(mismatchDraft),
    };
    fs.writeFileSync(
      published.written[0]!,
      serializeAcceptanceConditionsRevision(mismatch),
      'utf8'
    );

    await expect(
      issues.accept({
        ...scope(),
        issueId: created.record.identity.key,
        conditionsRevisionId: mismatch.revisionId,
        conditionsSha256: mismatch.contentSha256,
        gate: { completed: 0, total: 0, health: 'healthy', problemsStanding: 0 },
      })
    ).rejects.toMatchObject({ issueCode: 'issue_resource_identity_mismatch' });
    expect(
      fs.existsSync(fixture.at('rasen', 'issues', UID_A, 'accepted.yaml'))
    ).toBe(false);
  });
});
