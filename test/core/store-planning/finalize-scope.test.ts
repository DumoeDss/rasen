/**
 * `store-finalization-outcomes-v2` tasks 2.4 and 2.6 — the `finalize-change`
 * intent and the `archive-entry` typed address.
 *
 * Finalization needs strictly MORE authority than a project read: the Change
 * already exists, its committed identity is frozen, and the entry it publishes
 * is Git-tracked Store content. So the intent has its own three refusals, and
 * the address it hands back is derived, never joined by a caller.
 *
 * `archive-line` stays the PARENT: an `archive-entry` always resolves inside
 * the `archive-line` location the same scope reports, on both path flavors.
 * That containment is what makes the destination override safe for the
 * transaction — publication is a rename from a sibling stage directory, and a
 * destination outside the line would break it.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PlanningScopeError } from '../../../src/core/store-planning/index.js';
import {
  createStorePlanningResolverForTesting,
  nodeStorePlanningFileSystem,
  type ProjectIdentityClaimantSnapshot,
  type ProjectRegistrySnapshotEntry,
  type StorePlanningDependencies,
} from '../../../src/core/store-planning/testing.js';
import {
  deriveChangeInstanceId,
  derivePlanningScopeId,
  deriveWorktreeInstanceId,
  parseChangeInstanceSeed,
  type VerifiedChangeInstanceId,
} from '../../../src/core/store/planning-foundation.js';
import { resolveStorePlanningLayoutV2Path } from '../../../src/core/store/planning-layout-v2.js';

const STORE_UID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT = 'project-a';
const LINE = 'line-0.2';
const CHANGE = 'redesign-routing';
const SEED = '0123456789abcdef0123456789abcdef';
const DATE = '2026-08-07';

const INSTANCE = deriveChangeInstanceId({
  planningScopeId: derivePlanningScopeId({
    storeUid: STORE_UID,
    projectId: PROJECT,
    targetLineId: LINE,
  }),
  instanceSeed: SEED,
});

const tempRoots: string[] = [];

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-finalize-scope-'));
  tempRoots.push(root);
  return fs.realpathSync.native(root);
}

function write(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function changeMetadata(targetLineId = LINE): string {
  return [
    'schema: spec-driven',
    'identity:',
    '  version: 2',
    `  instanceSeed: ${SEED}`,
    `  instanceId: ${deriveChangeInstanceId({
      planningScopeId: derivePlanningScopeId({
        storeUid: STORE_UID,
        projectId: PROJECT,
        targetLineId,
      }),
      instanceSeed: SEED,
    })}`,
    `  storeUid: ${STORE_UID}`,
    `  projectId: ${PROJECT}`,
    `  targetLineId: ${targetLineId}`,
    '',
  ].join('\n');
}

interface Roots {
  storeRoot: string;
  projectRoot: string;
}

function storeFixture(
  options: { marker?: boolean; layoutVersion?: 1 | 2; changeLine?: string } = {}
): Roots {
  const root = temporaryRoot();
  const storeRoot = path.join(root, 'team-store');
  const projectRoot = path.join(root, PROJECT);
  const layoutVersion = options.layoutVersion ?? 2;
  write(
    path.join(storeRoot, '.rasen-store', 'store.yaml'),
    layoutVersion === 2
      ? `version: 2\nuid: ${STORE_UID}\nid: team-store\nlayoutVersion: 2\n`
      : // A legacy flat Store: no `layoutVersion: 2` declaration at all, which
        // is exactly how one is distinguished from a migrated Store.
        `version: 2\nuid: ${STORE_UID}\nid: team-store\n`
  );
  write(
    path.join(storeRoot, '.rasen-store', 'projects', `${PROJECT}.yaml`),
    `version: 2\nprojectId: ${PROJECT}\nid: ${PROJECT}\nroles:\n  planning: true\n  knowledge: false\nplanningBinding:\n  state: bound\n  boundAt: 2026-08-06T00:00:00.000Z\n`
  );
  write(
    path.join(storeRoot, '.rasen-store', 'target-lines', `${LINE}.yaml`),
    `version: 1\nid: ${LINE}\nstoreRef: refs/heads/release/0.2\nprojects:\n  ${PROJECT}:\n    codeRef: refs/heads/release/0.2\n`
  );
  write(
    path.join(projectRoot, 'rasen', 'config.yaml'),
    `schema: spec-driven\nprojectId: ${PROJECT}\nstore:\n  uid: ${STORE_UID}\n  id: team-store\n`
  );
  if (layoutVersion === 2) {
    write(
      path.join(
        storeRoot,
        'rasen',
        'projects',
        PROJECT,
        'changes',
        CHANGE,
        '.openspec.yaml'
      ),
      changeMetadata(options.changeLine ?? LINE)
    );
    write(
      path.join(storeRoot, 'rasen', 'projects', PROJECT, 'changes', CHANGE, 'proposal.md'),
      '## Why\n\nBecause.\n'
    );
  } else {
    write(path.join(storeRoot, 'rasen', 'changes', CHANGE, 'proposal.md'), '## Why\n\nFlat.\n');
  }
  if (options.marker !== false) {
    write(
      path.join(storeRoot, '.rasen', 'planning-line.json'),
      `${JSON.stringify({
        version: 1,
        storeUid: STORE_UID,
        storeId: 'team-store',
        projectId: PROJECT,
        targetLineId: LINE,
      })}\n`
    );
  }
  return { storeRoot, projectRoot };
}

function standaloneFixture(): string {
  const root = temporaryRoot();
  const projectRoot = path.join(root, 'solo');
  write(
    path.join(projectRoot, 'rasen', 'config.yaml'),
    'schema: spec-driven\nprojectId: solo\n'
  );
  write(path.join(projectRoot, 'rasen', 'changes', CHANGE, 'proposal.md'), '## Why\n\nSolo.\n');
  fs.mkdirSync(path.join(projectRoot, 'rasen', 'specs'), { recursive: true });
  return projectRoot;
}

function healthyPlanningProbe(): StorePlanningDependencies['probePlanningWorktree'] {
  return async ({ planningRoot }) => ({
    isWorktree: true,
    linked: true,
    worktreeInstanceId: deriveWorktreeInstanceId({
      repositoryIdentity: `${planningRoot}/.git`,
      worktreeIdentity: planningRoot,
    }),
    storeRefOid: 'a'.repeat(40),
  });
}

function resolver(
  roots: { storeRoot?: string; projectRoot: string },
  overrides: Partial<StorePlanningDependencies> = {}
) {
  const projectEntry: ProjectRegistrySnapshotEntry['entry'] = {
    projectId: PROJECT,
    name: PROJECT,
    mode: roots.storeRoot === undefined ? 'in-repo' : 'store',
    home: `${PROJECT}-home`,
    lastSeen: '2026-08-06T00:00:00.000Z',
  };
  const projectClaimant: ProjectIdentityClaimantSnapshot = {
    root: roots.projectRoot,
    entry: projectEntry,
    live: true,
    aliases: [{
      registryPath: roots.projectRoot,
      canonicalPath: roots.projectRoot,
      entry: projectEntry,
      live: true,
      direct: true,
    }],
    fixedMetadataConflict: false,
  };
  const dependencies: StorePlanningDependencies = {
    fs: nodeStorePlanningFileSystem,
    probePlanningWorktree: overrides.probePlanningWorktree ?? healthyPlanningProbe(),
    assertPlanningWorktreeUnbound: async () => {},
    completeChangeBinding: async () => ({
      bindingState: 'prepared' as const,
      entry: null,
      findings: [],
    }),
    snapshotStores: async () =>
      roots.storeRoot === undefined
        ? []
        : [{ id: 'team-store', uid: STORE_UID, type: 'store', root: roots.storeRoot }],
    snapshotProjects: async () => [
      {
        root: roots.projectRoot,
        entry: projectEntry,
      },
    ],
    findProjectIdentityClaimants: async () => [projectClaimant],
    findRegisteredProject: async () => null,
    sessionContextPath: () => undefined,
    checkoutRole: overrides.checkoutRole ?? (() => 'linked-worktree'),
    now: () => new Date('2026-08-07T12:00:00.000Z'),
    mintInstanceSeed: () => parseChangeInstanceSeed(SEED),
    randomSuffix: () => 'deterministic',
    ...overrides,
  };
  return new createStorePlanningResolverForTesting(dependencies);
}

function codeOf(error: unknown): string {
  if (error instanceof PlanningScopeError) return error.diagnostic.code;
  throw error;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('the finalize-change intent across the four scope kinds', () => {
  it('opens a Store v2 project scope and reports the frozen identity', async () => {
    const roots = storeFixture();
    const scope = await resolver(roots).open({
      intent: 'finalize-change',
      startPath: roots.storeRoot,
      selection: { store: 'team-store', project: PROJECT, targetLine: LINE },
      change: { changeId: CHANGE },
    });

    expect(scope.ref.mode).toBe('store-project');
    expect(scope.change.changeId).toBe(CHANGE);
    expect(scope.change.metadata?.identity?.instanceId).toBe(INSTANCE);
    expect(scope.change.location.absolutePath).toBe(
      path.join(roots.storeRoot, 'rasen', 'projects', PROJECT, 'changes', CHANGE)
    );
  });

  it('refuses a Store aggregate, which selects no project', async () => {
    const roots = storeFixture();
    let thrown: unknown;
    try {
      await resolver(roots).open({
        intent: 'finalize-change',
        startPath: roots.storeRoot,
        selection: { store: 'team-store' },
        change: { changeId: CHANGE },
      });
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('project_scope_required');
  });

  it('resolves a STANDALONE project to its existing flat archive location, minting no v2 identity', async () => {
    const projectRoot = standaloneFixture();
    const scope = await resolver({ projectRoot }).open({
      intent: 'finalize-change',
      startPath: projectRoot,
      change: { changeId: CHANGE },
    });

    expect(scope.ref.mode).toBe('standalone');
    expect(scope.change.metadata?.identity).toBeUndefined();
    expect(scope.locate({ kind: 'archive-line' }).absolutePath).toBe(
      path.join(projectRoot, 'rasen', 'changes', 'archive')
    );
    // The flat entry name, with no instance suffix and no target line.
    expect(
      scope.locate({ kind: 'archive-entry', changeId: CHANGE, archiveDate: DATE }).absolutePath
    ).toBe(path.join(projectRoot, 'rasen', 'changes', 'archive', `${DATE}-${CHANGE}`));
  });

  it('resolves a LEGACY flat Store to its existing flat archive location too', async () => {
    const roots = storeFixture({ layoutVersion: 1, marker: false });
    const scope = await resolver(roots).open({
      intent: 'finalize-change',
      startPath: roots.storeRoot,
      selection: { store: 'team-store' },
      change: { changeId: CHANGE },
    });

    expect(scope.ref.mode).toBe('legacy-store');
    expect(
      scope.locate({ kind: 'archive-entry', changeId: CHANGE, archiveDate: DATE }).absolutePath
    ).toBe(path.join(roots.storeRoot, 'rasen', 'changes', 'archive', `${DATE}-${CHANGE}`));
    // No v2 identity is minted for a legacy Change.
    expect(scope.change.metadata?.identity).toBeUndefined();
  });
});

describe('the three authority refusals, exactly as project mutation states them', () => {
  it('refuses with target_line_required when no stable line is proven', async () => {
    const roots = storeFixture({ marker: false });
    let thrown: unknown;
    try {
      await resolver(roots).open({
        intent: 'finalize-change',
        startPath: roots.storeRoot,
        selection: { store: 'team-store', project: PROJECT },
        change: { changeId: CHANGE },
      });
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('target_line_required');
    expect((thrown as PlanningScopeError).diagnostic.fix).toContain('--target-line');
  });

  it('refuses with planning_worktree_required from the integration checkout', async () => {
    const roots = storeFixture();
    let thrown: unknown;
    try {
      await resolver(roots, {
        checkoutRole: () => 'integration',
        probePlanningWorktree: async () => ({
          isWorktree: true,
          linked: false,
          worktreeInstanceId: undefined,
          storeRefOid: null,
        }),
      }).open({
        intent: 'finalize-change',
        startPath: roots.storeRoot,
        selection: { store: 'team-store', project: PROJECT, targetLine: LINE },
        change: { changeId: CHANGE },
      });
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('planning_worktree_required');
    expect((thrown as Error).message).toContain('read-only');
  });

  it('refuses a project selector that disagrees with the resolved scope rather than substituting one', async () => {
    const roots = storeFixture();
    let thrown: unknown;
    try {
      await resolver(roots).open({
        intent: 'finalize-change',
        startPath: roots.storeRoot,
        selection: { store: 'team-store', project: 'not-a-member' },
        change: { changeId: CHANGE },
      });
    } catch (error) {
      thrown = error;
    }
    // The refusal is a SELECTION conflict, not a silent fallback to the
    // project the marker names: an unknown project never resolves to the
    // nearest available one.
    expect(codeOf(thrown)).toBe('planning_selection_conflict');
  });

  it('refuses a Change frozen against a different target line before any address', async () => {
    const roots = storeFixture({ changeLine: 'line-0.3' });
    write(
      path.join(roots.storeRoot, '.rasen-store', 'target-lines', 'line-0.3.yaml'),
      'version: 1\nid: line-0.3\nstoreRef: refs/heads/release/0.3\nprojects: {}\n'
    );
    let thrown: unknown;
    try {
      await resolver(roots).open({
        intent: 'finalize-change',
        startPath: roots.storeRoot,
        selection: { store: 'team-store', project: PROJECT, targetLine: LINE },
        change: { changeId: CHANGE },
      });
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('target_line_mismatch');
  });
});

describe('archive-line is the parent of every archive-entry', () => {
  it('resolves the entry inside the line on the NATIVE flavor', async () => {
    const roots = storeFixture();
    const scope = await resolver(roots).open({
      intent: 'finalize-change',
      startPath: roots.storeRoot,
      selection: { store: 'team-store', project: PROJECT, targetLine: LINE },
      change: { changeId: CHANGE },
    });

    const line = scope.locate({ kind: 'archive-line' }).absolutePath;
    const entry = scope.locate({
      kind: 'archive-entry',
      changeId: CHANGE,
      archiveDate: DATE,
      changeInstanceId: INSTANCE,
    }).absolutePath;

    expect(path.dirname(entry)).toBe(line);
    expect(line).toBe(
      path.join(
        roots.storeRoot,
        'rasen',
        'projects',
        PROJECT,
        'changes',
        'archive',
        LINE
      )
    );
  });

  // A scope can only be opened against a start path spelled in the HOST's
  // flavor, so the foreign flavor is exercised one layer down, against the same
  // layout contract the scope delegates to. Both addresses come from that
  // contract, so containment there is containment everywhere.
  it.each(['win32', 'posix'] as const)(
    'places the entry directly inside its line on path.%s',
    flavor => {
      const api = flavor === 'win32' ? path.win32 : path.posix;
      const root = flavor === 'win32' ? 'C:\\stores\\team' : '/stores/team';
      const line = resolveStorePlanningLayoutV2Path(
        root,
        { kind: 'archive-line', projectId: PROJECT, targetLineId: LINE },
        flavor
      );
      const entry = resolveStorePlanningLayoutV2Path(
        root,
        {
          kind: 'archive-entry',
          projectId: PROJECT,
          targetLineId: LINE,
          changeId: CHANGE,
          archiveDate: DATE,
          changeInstanceId: INSTANCE as VerifiedChangeInstanceId,
        },
        flavor
      );

      expect(api.dirname(entry)).toBe(line);
      expect(api.relative(line, entry)).toBe(api.basename(entry));
      // The stage directory publication renames FROM is a sibling of the
      // entry, so the entry being a direct child of the line is what keeps
      // publication a same-volume rename.
      expect(api.relative(line, entry).includes(api.sep)).toBe(false);
    }
  );

  it('refuses a malformed Change instance id rather than returning a path', async () => {
    const roots = storeFixture();
    const scope = await resolver(roots).open({
      intent: 'finalize-change',
      startPath: roots.storeRoot,
      selection: { store: 'team-store', project: PROJECT, targetLine: LINE },
      change: { changeId: CHANGE },
    });

    for (const malformed of ['ci_not-hex', 'ci_', INSTANCE.toUpperCase(), 'wp_' + 'a'.repeat(64)]) {
      // Pinned to the identity refusal by name. A bare `.toThrow()` here would
      // pass on any unrelated `TypeError` a refactor introduced, which is the
      // failure mode this repository has recorded repeatedly; the point of the
      // case is that the ADDRESS refuses a malformed instance, so the message
      // that says so is what the assertion has to name. Note the uppercase and
      // `wp_`-prefixed cases refuse for the same stated reason, which is
      // itself the claim: there is one canonical spelling, not four checks.
      expect(() =>
        scope.locate({
          kind: 'archive-entry',
          changeId: CHANGE,
          archiveDate: DATE,
          changeInstanceId: malformed,
        })
      ).toThrow(/changeInstanceId: must use ci_<64 lowercase hex/u);
    }
  });

  it('refuses a v2 archive-entry address with no Change instance at all', async () => {
    const roots = storeFixture();
    const scope = await resolver(roots).open({
      intent: 'finalize-change',
      startPath: roots.storeRoot,
      selection: { store: 'team-store', project: PROJECT, targetLine: LINE },
      change: { changeId: CHANGE },
    });

    let thrown: unknown;
    try {
      scope.locate({ kind: 'archive-entry', changeId: CHANGE, archiveDate: DATE });
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('change_identity_mismatch');
  });
});
