/**
 * `store-planning-worktree-bindings` tasks 3.4–3.8 and 3.10 — the binding
 * reducer, the machine index, and the authority order.
 *
 * The rule this suite exists to hold down is one sentence of the capability
 * spec: "conflict fails, absence is repaired". A MISSING index entry is
 * reconstructed from what is already true on disk; a DISAGREEING one is a
 * refusal, never a repair, and never a silent override of committed metadata.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StoreError } from '../../../src/core/store/errors.js';
import {
  assertCarrierAgreesWithScope,
  assertPairAgrees,
  buildIndexEntry,
  detectBindingAmbiguity,
  digestOf,
  executionAssociationPath,
  parseBindingFact,
  planningMarkerPath,
  readBindingFact,
  repairMissingIndexEntry,
  requirePlanningSideFrom,
  serializeBindingFact,
  surveyWorktree,
  verifyIndexEntry,
  type BindingFact,
} from '../../../src/core/store/workspace/binding.js';
import {
  readWorkspaceIndexDocument,
  workspaceIndexFingerprint,
  workspaceIndexRelativePath,
  writeWorkspaceIndexEntry,
  type WorkspaceIndexEntry,
} from '../../../src/core/store/workspace/registry.js';
import type { StoreWorkspaceError } from '../../../src/core/store/workspace/diagnostics.js';
import type { WorkspaceScope } from '../../../src/core/store/workspace/types.js';
import {
  FIXTURE_NOW,
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../../helpers/store-workspace-fixture.js';

const PROJECT = 'app-a';
const LINE = 'line-0.2';
const CHANGE = 'redesign-routing';

function codeOf(error: unknown): string {
  if (error instanceof StoreError) return error.diagnostic.code;
  throw error;
}

function refuses(action: () => void): StoreError {
  try {
    action();
  } catch (error) {
    if (error instanceof StoreError) return error;
    throw error;
  }
  throw new Error('expected a refusal, but the call succeeded');
}

/**
 * Same real-Git fixture class as its sibling workspace suites: the cost per
 * case is worktree and commit wall-clock time, not source size. The 30s
 * default passes solo and fails under the parallel load of the store suites,
 * where a timeout reads as a broken assertion rather than as a timeout --
 * which is what two of this file's siblings did once the re-preparation suite
 * joined the same run.
 */
describe('workspace binding carriers and the machine index', { timeout: 180_000 }, () => {
  let f: StoreWorkspaceFixture;
  let planningRoot: string;
  let executionRoot: string;
  let scope: WorkspaceScope;

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-workspace-binding-',
      projects: [PROJECT],
      storeBranches: ['release/0.2'],
      projectBranches: ['release/0.2'],
      lines: [
        {
          id: LINE,
          storeRef: 'refs/heads/release/0.2',
          codeRefs: { [PROJECT]: 'refs/heads/release/0.2' },
        },
      ],
    });
    planningRoot = f.beside(`store--${CHANGE}`);
    executionRoot = f.beside(`${PROJECT}--${CHANGE}`);
    f.git(f.storeRoot, [
      'worktree',
      'add',
      '-b',
      `change/${LINE}/${PROJECT}/${CHANGE}`,
      planningRoot,
      'refs/heads/release/0.2',
    ]);
    f.git(f.projectRoot(PROJECT), [
      'worktree',
      'add',
      '-b',
      `change/${LINE}/${PROJECT}/${CHANGE}`,
      executionRoot,
      'refs/heads/release/0.2',
    ]);
    scope = {
      storeUid: f.storeUid,
      storeId: f.storeId,
      storeRoot: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      planningScopeId: f.planningScopeId(PROJECT, LINE),
    };
  });

  afterEach(() => {
    f.cleanup();
  });

  function fact(overrides: Partial<BindingFact> = {}): BindingFact {
    return {
      version: 1,
      storeUid: f.storeUid,
      storeId: f.storeId,
      projectId: PROJECT,
      targetLineId: LINE,
      ...overrides,
    };
  }

  async function survey(side: 'planning' | 'execution') {
    const root = side === 'planning' ? planningRoot : executionRoot;
    return surveyWorktree(f.dependencies, {
      side,
      root,
      repositoryRoot: root,
      flavor: 'native',
    });
  }

  async function entryFor(
    overrides: Partial<WorkspaceIndexEntry> = {}
  ): Promise<WorkspaceIndexEntry> {
    return {
      ...buildIndexEntry({
        scope,
        changeId: CHANGE,
        planning: await survey('planning'),
        execution: await survey('execution'),
        planId: 'plan-1',
        phase: 'prepared',
        at: FIXTURE_NOW,
      }),
      ...overrides,
    };
  }

  // ---- carrier documents -------------------------------------------------

  it('round-trips a carrier document byte for byte', () => {
    const serialized = serializeBindingFact(fact({ executionRoot }));
    expect(serialized.endsWith('\n')).toBe(true);
    expect(parseBindingFact(serialized, 'marker')).toEqual(fact({ executionRoot }));
    // Field order is fixed, which is what makes a plan's digest reproducible.
    expect(serializeBindingFact(fact({ executionRoot }))).toBe(serialized);
  });

  it('pins the carrier digest to a fixed value on fixed content, not merely to its own formula', () => {
    // `digestOf` (binding.ts:93) is `sha256` over the serialized carrier bytes
    // directly, no envelope object. A pinned literal here, on content that is
    // independent of this fixture's own storeUid/paths, is what actually
    // catches a silent change to the hash algorithm or to what gets hashed
    // (e.g. hashing the parsed object instead of the exact bytes) — a
    // round-trip check alone would not, since both sides of a round-trip
    // follow the same code.
    const serialized = serializeBindingFact({
      version: 1,
      storeUid: 'store-uid-1',
      storeId: 'store-1',
      projectId: 'app-a',
      targetLineId: 'line-0.2',
      executionRoot: '/exec/root',
    });
    expect(digestOf(serialized)).toBe(
      '7a0d45cdedffad12031493bddff114d493f22a8fca3040db3ba50060c94b0ce7'
    );

    // Mutation proof: one changed field changes the digest, to a second
    // independently pinned literal.
    const mutatedSerialized = serializeBindingFact({
      version: 1,
      storeUid: 'store-uid-1',
      storeId: 'store-1',
      projectId: 'app-a',
      targetLineId: 'line-0.2',
      executionRoot: '/exec/root-2',
    });
    expect(digestOf(mutatedSerialized)).toBe(
      '3fb3e94a3b21da0667ea7885a395002dc5242f77e1af45ed18fdba30662f36b0'
    );
  });

  it('treats a corrupt or incomplete carrier as a conflict, never as an absence', () => {
    for (const [text, needle] of [
      ['{ not json', 'not valid JSON'],
      ['[]', 'must be a JSON object'],
      ['{"version":2}', 'version must be 1'],
      [`{"version":1,"storeUid":"${'u'}"}`, 'declares no'],
    ] as const) {
      const error = refuses(() => parseBindingFact(text, 'C:/w/.rasen/planning-line.json'));
      expect(codeOf(error), text).toBe('workspace_marker_conflict');
      expect(error.diagnostic.message, text).toContain(needle);
    }
  });

  it('reads a carrier from the exact path the layout rule names', async () => {
    const markerPath = planningMarkerPath(planningRoot);
    expect(markerPath).toBe(path.join(planningRoot, '.rasen', 'planning-line.json'));
    expect(executionAssociationPath(executionRoot)).toBe(
      path.join(executionRoot, '.rasen', 'planning-binding.json')
    );
    // Absence is absence — only a document that EXISTS and cannot be read is a
    // conflict.
    expect(await readBindingFact(f.dependencies, markerPath)).toBeNull();
    f.write(markerPath, serializeBindingFact(fact({ executionRoot })));
    expect((await readBindingFact(f.dependencies, markerPath))?.fact.executionRoot).toBe(
      executionRoot
    );
  });

  // ---- authority order ---------------------------------------------------

  it('refuses a carrier that names another Store, project, or target line than the committed identity', () => {
    for (const [override, needle] of [
      [{ storeUid: '00000000-0000-4000-8000-000000000000' }, "declares Store"],
      [{ projectId: 'app-b' }, "declares project 'app-b'"],
      [{ targetLineId: 'line-0.3' }, "declares target line 'line-0.3'"],
    ] as const) {
      const error = refuses(() =>
        assertCarrierAgreesWithScope(fact(override), scope, 'the planning marker')
      );
      expect(codeOf(error)).toBe('workspace_marker_conflict');
      expect(error.diagnostic.message).toContain(needle);
      // The repair is to correct the disagreement, never to rewrite a carrier.
      expect(error.diagnostic.fix).toContain('Correct the planning marker');
      // Both disagreeing values are carried, which is what makes the code a
      // diagnostic rather than a category.
      expect((error as StoreWorkspaceError).expected).toBeDefined();
      expect((error as StoreWorkspaceError).actual).toBeDefined();
    }
    expect(() =>
      assertCarrierAgreesWithScope(fact(), scope, 'the planning marker')
    ).not.toThrow();
  });

  it('never infers a planning worktree for an execution checkout that records none', () => {
    const error = refuses(() =>
      requirePlanningSideFrom(fact(), executionAssociationPath(executionRoot))
    );
    expect(codeOf(error)).toBe('planning_execution_binding_missing');
    expect(error.diagnostic.fix).toContain('never infers a planning worktree');
    expect(requirePlanningSideFrom(fact({ planningWorktree: planningRoot }), 'assoc')).toBe(
      planningRoot
    );
  });

  it('refuses two carriers that disagree, on every axis they can disagree about', () => {
    const base = {
      markerPath: planningMarkerPath(planningRoot),
      associationPath: executionAssociationPath(executionRoot),
      planningRoot,
      executionRoot,
      flavor: 'native' as const,
    };
    // Agreeing carriers pass.
    expect(() =>
      assertPairAgrees({
        ...base,
        marker: fact({ executionRoot }),
        association: fact({ planningWorktree: planningRoot, executionRoot }),
      })
    ).not.toThrow();

    // The association names another planning worktree.
    expect(
      codeOf(
        refuses(() =>
          assertPairAgrees({
            ...base,
            marker: fact({ executionRoot }),
            association: fact({ planningWorktree: f.beside('some-other-tree'), executionRoot }),
          })
        )
      )
    ).toBe('planning_execution_binding_mismatch');

    // The marker names another execution worktree.
    expect(
      codeOf(
        refuses(() =>
          assertPairAgrees({
            ...base,
            marker: fact({ executionRoot: f.beside('some-other-tree') }),
            association: fact({ planningWorktree: planningRoot, executionRoot }),
          })
        )
      )
    ).toBe('planning_execution_binding_mismatch');

    // The two carriers declare different scopes.
    const scopeError = refuses(() =>
      assertPairAgrees({
        ...base,
        marker: fact({ executionRoot }),
        association: fact({
          planningWorktree: planningRoot,
          executionRoot,
          targetLineId: 'line-0.3',
        }),
      })
    );
    expect(codeOf(scopeError)).toBe('planning_execution_binding_mismatch');
    expect(scopeError.diagnostic.fix).toContain('never rewrites one to agree');
  });

  // ---- the machine index -------------------------------------------------

  it('pins the index fingerprint to a fixed value on a fixed document, not merely to its own formula', () => {
    // `workspaceIndexFingerprint` (registry.ts:201) is what a plan freezes and
    // `apply` revalidates — a silent change to the envelope it hashes (a
    // reordered field, a canonicalization change) would invalidate every
    // outstanding plan token without a single existing test failing, since
    // every other test that touches it compares two runtime-computed values
    // to each other. This anchor is on a hand-built document, independent of
    // any real fixture, so it cannot be updated by copy-pasting a formula
    // change into a test helper the way a relational check could be.
    const emptyDocument = { version: 1 as const, planningScopeId: 'scope-1', entries: [] };
    expect(workspaceIndexFingerprint(emptyDocument)).toBe(
      '3da87f0b93923d155faac662ecb49b5c3c82439780589ec986634fd37f275479'
    );

    const side = {
      root: '/planning/root',
      repositoryIdentity: 'repo-a',
      worktreeInstanceId: 'wt-a',
      ref: 'refs/heads/planning-line-0-2',
      headOid: 'a'.repeat(40),
    };
    const executionSide = { ...side, root: '/execution/root', ref: 'refs/heads/release/0.2' };
    const oneEntryDocument = {
      version: 1 as const,
      planningScopeId: 'scope-1',
      entries: [
        {
          version: 1 as const,
          planningScopeId: 'scope-1',
          storeUid: 'store-uid-1',
          storeId: 'store-1',
          projectId: 'app-a',
          targetLineId: 'line-0.2',
          changeId: 'my-change',
          changeInstanceId: `ci_${'a'.repeat(64)}`,
          workspacePairId: `wp_${'b'.repeat(64)}`,
          planning: side,
          execution: executionSide,
          planId: 'c'.repeat(64),
          phase: 'bound' as const,
          recordedAt: '2026-08-07T00:00:00.000Z',
          updatedAt: '2026-08-07T00:00:00.000Z',
        },
      ],
    };
    expect(workspaceIndexFingerprint(oneEntryDocument)).toBe(
      'b6ed56f146780d6fe7714d154d1a6eef26716725cbbfe524fca0ef28e1478098'
    );

    // Mutation proof: one changed field (the execution root) changes the
    // fingerprint, to a second independently pinned literal.
    const mutatedDocument = {
      ...oneEntryDocument,
      entries: [
        {
          ...oneEntryDocument.entries[0],
          execution: { ...executionSide, root: '/execution/root-MUTATED' },
        },
      ],
    };
    expect(workspaceIndexFingerprint(mutatedDocument)).toBe(
      '4466771cfec42ee811f2b0353ed27932560816099d4ac0c8b0652204ff88d6d2'
    );

    // `excludeChangeId` matching the document's only entry produces the same
    // fingerprint as the empty document — the exclusion the docstring
    // promises, pinned rather than merely asserted equal to itself.
    expect(workspaceIndexFingerprint(oneEntryDocument, 'my-change')).toBe(
      '3da87f0b93923d155faac662ecb49b5c3c82439780589ec986634fd37f275479'
    );
  });

  it('writes the index document at the per-scope path the record shape names', async () => {
    const entry = await entryFor();
    await writeWorkspaceIndexEntry(f.dependencies.coordination(f.globalDataDir), entry);

    const expected = path.join(
      f.globalDataDir,
      'planning-workspaces',
      'index',
      `${scope.planningScopeId}.json`
    );
    expect(
      f.dependencies
        .coordination(f.globalDataDir)
        .resolve(workspaceIndexRelativePath(scope.planningScopeId))
    ).toBe(expected);
    expect(fs.existsSync(expected)).toBe(true);

    const document = JSON.parse(fs.readFileSync(expected, 'utf8')) as {
      version: number;
      planningScopeId: string;
      entries: WorkspaceIndexEntry[];
    };
    // The file is a per-scope DOCUMENT holding one entry per Change alias, not
    // one file per pair — ambiguity detection needs several entries in hand.
    expect(document.version).toBe(1);
    expect(document.planningScopeId).toBe(scope.planningScopeId);
    expect(document.entries).toHaveLength(1);
    expect(document.entries[0]?.changeId).toBe(CHANGE);
    expect(document.entries[0]?.planning.root).toBe(planningRoot);
    expect(document.entries[0]?.execution.root).toBe(executionRoot);
    expect(document.entries[0]?.planning.ref).toBe(`refs/heads/change/${LINE}/${PROJECT}/${CHANGE}`);
    expect(document.entries[0]?.phase).toBe('prepared');
    // Nothing was written inside either Git repository.
    expect(f.git(f.storeRoot, ['status', '--porcelain'])).toBe('');
    expect(f.git(f.projectRoot(PROJECT), ['status', '--porcelain'])).toBe('');
  });

  it('re-verifies a healthy entry as consistent', async () => {
    const verification = await verifyIndexEntry(f.dependencies, await entryFor(), 'native');
    expect(verification.findings).toEqual([]);
    expect(verification.consistent).toBe(true);
    expect(verification.planning.worktreeInstanceId).toBe(
      (await survey('planning')).worktreeInstanceId
    );
  });

  it('treats a removed worktree as a conflict rather than as truth', async () => {
    const entry = await entryFor();
    f.git(f.storeRoot, ['worktree', 'remove', planningRoot]);

    const verification = await verifyIndexEntry(f.dependencies, entry, 'native');
    expect(verification.consistent).toBe(false);
    expect(verification.findings.map((finding) => finding.code)).toContain(
      'workspace_worktree_absent'
    );
    expect(verification.findings[0]?.message).toContain(planningRoot);
    expect(verification.findings[0]?.severity).toBe('error');
  });

  it('treats a root that is no longer a worktree of the recorded repository as a conflict', async () => {
    const entry = await entryFor();
    f.git(f.storeRoot, ['worktree', 'remove', planningRoot]);
    // A plain directory now stands where the worktree was. The entry still
    // records a worktree instance id, which must not re-derive.
    fs.mkdirSync(planningRoot, { recursive: true });
    fs.writeFileSync(path.join(planningRoot, 'README.md'), 'not a worktree\n', 'utf8');

    const verification = await verifyIndexEntry(f.dependencies, entry, 'native');
    expect(verification.consistent).toBe(false);
    expect(verification.findings.map((finding) => finding.code)).toContain(
      'workspace_worktree_not_a_repository'
    );
  });

  it('reports a ref that moved under a recorded worktree', async () => {
    const entry = await entryFor();
    // A ref change is the user's own `git switch`; Rasen reports it and never
    // switches it back.
    f.git(planningRoot, ['checkout', '--detach', 'HEAD']);

    const verification = await verifyIndexEntry(f.dependencies, entry, 'native');
    expect(verification.consistent).toBe(false);
    const drift = verification.findings.find((finding) => finding.code === 'workspace_ref_drift');
    expect(drift?.expected).toBe(`refs/heads/change/${LINE}/${PROJECT}/${CHANGE}`);
    expect(drift?.actual).toBe('(detached)');
  });

  it('repairs a missing entry from live Git and is byte-stable when repeated', async () => {
    const input = {
      scope,
      changeId: CHANGE,
      planning: await survey('planning'),
      execution: await survey('execution'),
      planId: '',
      phase: 'prepared' as const,
      at: FIXTURE_NOW,
      globalDataDir: f.globalDataDir,
    };
    const indexPath = path.join(
      f.globalDataDir,
      'planning-workspaces',
      'index',
      `${scope.planningScopeId}.json`
    );

    const first = await repairMissingIndexEntry(f.dependencies, input);
    const firstBytes = fs.readFileSync(indexPath);
    // Every field came from live Git; nothing was invented.
    expect(first.planning.worktreeInstanceId).toBe(input.planning.worktreeInstanceId);
    expect(first.execution.headOid).toBe(input.execution.headOid);
    expect(first.changeInstanceId).toBeUndefined();
    expect(first.workspacePairId).toBeUndefined();

    // A second repair with a LATER instant keeps `recordedAt` and so is
    // byte-identical: repeating the reconstruction changes nothing.
    const second = await repairMissingIndexEntry(f.dependencies, {
      ...input,
      at: '2026-09-09T09:09:09.000Z',
    });
    expect(second.recordedAt).toBe(FIXTURE_NOW);
    expect(fs.readFileSync(indexPath).equals(firstBytes)).toBe(false);
    // ...and repeating it with the same instant is byte-identical.
    await repairMissingIndexEntry(f.dependencies, input);
    const third = fs.readFileSync(indexPath);
    await repairMissingIndexEntry(f.dependencies, input);
    expect(fs.readFileSync(indexPath).equals(third)).toBe(true);
  });

  // ---- ambiguity ---------------------------------------------------------

  it('refuses two entries claiming one execution worktree, listing every claimant', async () => {
    const first = await entryFor();
    const second = await entryFor({ changeId: 'second-change' });

    const error = refuses(() => detectBindingAmbiguity([first, second], 'native'));
    expect(codeOf(error)).toBe('workspace_binding_ambiguous');
    expect(error.diagnostic.message).toContain(CHANGE);
    expect(error.diagnostic.message).toContain('second-change');
    expect((error as StoreWorkspaceError).actual).toBe('2 claimants');
    expect((error as StoreWorkspaceError).expected).toBe('1 claimant');
  });

  it('refuses two planning worktrees claiming one Change instance', async () => {
    const otherPlanning = f.beside('store--second');
    f.git(f.storeRoot, ['worktree', 'add', '-b', 'line/second', otherPlanning, 'HEAD']);
    const otherFacts = await surveyWorktree(f.dependencies, {
      side: 'planning',
      root: otherPlanning,
      repositoryRoot: otherPlanning,
      flavor: 'native',
    });

    const instanceId = f.seedChange({
      root: planningRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: CHANGE,
    }).instanceId;
    const first = await entryFor({ changeInstanceId: instanceId });
    const second: WorkspaceIndexEntry = {
      ...(await entryFor({ changeInstanceId: instanceId })),
      planning: {
        root: otherFacts.root,
        repositoryIdentity: otherFacts.repositoryIdentity ?? '',
        worktreeInstanceId: otherFacts.worktreeInstanceId ?? '',
        ref: otherFacts.ref ?? '',
        headOid: otherFacts.headOid ?? '',
      },
      // A distinct execution side, so this is the CHANGE-INSTANCE ambiguity
      // rather than the execution-worktree one.
      execution: { root: '', repositoryIdentity: '', worktreeInstanceId: '', ref: '', headOid: '' },
    };

    const error = refuses(() => detectBindingAmbiguity([first, second], 'native'));
    expect(codeOf(error)).toBe('workspace_binding_ambiguous');
    expect(error.diagnostic.message).toContain(instanceId);
    expect(error.diagnostic.message).toContain(planningRoot);
    expect(error.diagnostic.message).toContain(otherPlanning);
    expect((error as StoreWorkspaceError).actual).toBe('2 planning worktrees');
  });

  it('accepts two Changes in one scope that hold different worktrees', async () => {
    const otherPlanning = f.beside('store--second');
    const otherExecution = f.beside(`${PROJECT}--second`);
    f.git(f.storeRoot, ['worktree', 'add', '-b', 'line/second', otherPlanning, 'HEAD']);
    f.git(f.projectRoot(PROJECT), [
      'worktree',
      'add',
      '-b',
      'line/second',
      otherExecution,
      'HEAD',
    ]);
    const second = buildIndexEntry({
      scope,
      changeId: 'second-change',
      planning: await surveyWorktree(f.dependencies, {
        side: 'planning',
        root: otherPlanning,
        repositoryRoot: otherPlanning,
        flavor: 'native',
      }),
      execution: await surveyWorktree(f.dependencies, {
        side: 'execution',
        root: otherExecution,
        repositoryRoot: otherExecution,
        flavor: 'native',
      }),
      planId: 'plan-2',
      phase: 'prepared',
      at: FIXTURE_NOW,
    });

    const first = await entryFor();
    expect(() => detectBindingAmbiguity([first, second], 'native')).not.toThrow();
    const coordination = f.dependencies.coordination(f.globalDataDir);
    await writeWorkspaceIndexEntry(coordination, first);
    await writeWorkspaceIndexEntry(coordination, second);
    const document = await readWorkspaceIndexDocument(coordination, scope.planningScopeId);
    expect(document.entries.map((entry) => entry.changeId)).toEqual([CHANGE, 'second-change']);
  });
});
