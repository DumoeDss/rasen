import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildActionContext } from '../../src/core/change-status-policy.js';
import { WORKSPACE_DIR_NAME } from '../../src/core/config.js';

const storeRoot = path.join(os.tmpdir(), 'rasen-ac-store');
const checkout = path.join(os.tmpdir(), 'rasen-ac-checkout');
const otherMember = path.join(os.tmpdir(), 'rasen-ac-other-member');

function planningDirs(root: string): string[] {
  return [
    path.join(root, WORKSPACE_DIR_NAME, 'specs'),
    path.join(root, WORKSPACE_DIR_NAME, 'changes'),
  ];
}

/** Path containment, the same relation the projection is asserted against. */
function isWithin(child: string, parent: string): boolean {
  if (path.resolve(child) === path.resolve(parent)) return true;
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Every session shape this change composes a capability for, with the single
 * root v1 would previously have granted for that same context — which is
 * exactly what `buildActionContext` received as `projectRoot`.
 */
const SESSION_SHAPES = [
  {
    name: 'repo-local (no session context)',
    input: { projectRoot: checkout, artifactIds: ['proposal'] },
  },
  {
    name: 'project planning with its own execution',
    input: {
      projectRoot: checkout,
      artifactIds: ['proposal'],
      session: {
        planning: { type: 'project' as const, projectId: 'p1', root: checkout },
        execution: { kind: 'project' as const, projectId: 'p1', root: checkout },
      },
    },
  },
  {
    name: 'Store planning with project execution',
    input: {
      projectRoot: checkout,
      artifactIds: ['proposal'],
      session: {
        planning: { type: 'store' as const, id: 'team-store', root: storeRoot },
        execution: { kind: 'project' as const, projectId: 'p1', root: checkout },
      },
    },
  },
  {
    name: 'planning-only',
    input: {
      projectRoot: storeRoot,
      artifactIds: ['proposal'],
      session: {
        planning: { type: 'store' as const, id: 'team-store', root: storeRoot },
        execution: { kind: 'planning-only' as const },
      },
    },
  },
];

describe('action context v2', () => {
  it('keeps the repo-local shape and its single editable root when there is no session', () => {
    const context = buildActionContext({ projectRoot: checkout, artifactIds: ['proposal'] });
    expect(context.mode).toBe('repo-local');
    expect(context.version).toBe(1);
    expect(context.planningWriteRoots).toEqual(planningDirs(checkout));
    expect(context.codeWriteRoots).toEqual([checkout]);
    // The compatibility view is exactly what v1 reported before this change.
    expect(context.allowedEditRoots).toEqual([checkout]);
  });

  it('separates the three lists for Store planning with project execution', () => {
    const context = buildActionContext(SESSION_SHAPES[2]!.input);
    expect(context.planningWriteRoots).toEqual(planningDirs(storeRoot));
    expect(context.codeWriteRoots).toEqual([checkout]);
    expect(context.readRoots).toEqual([storeRoot, checkout]);
  });

  it('reports the newer version rather than widening when the split cannot be projected', () => {
    const context = buildActionContext(SESSION_SHAPES[2]!.input);
    // v1 could only ever express ONE root. Reporting the union under v1 here
    // would hand a v1 consumer the Store's planning directories, which it
    // never asked for — so the version changes instead.
    expect(context.version).toBe(2);
    expect(context.allowedEditRoots).toBeUndefined();
  });

  it('grants a planning-only session no code write root at all', () => {
    const context = buildActionContext(SESSION_SHAPES[3]!.input);
    expect(context.codeWriteRoots).toEqual([]);
    expect(context.planningWriteRoots).toEqual(planningDirs(storeRoot));
    expect(context.readRoots).toEqual([storeRoot]);
    // Projectable — the union is strictly narrower than the store root v1
    // would have granted — so the compatibility view stays available.
    expect(context.version).toBe(1);
    expect(context.allowedEditRoots).toEqual(planningDirs(storeRoot));
  });

  it('states the planning-only restriction in the constraints an agent reads', () => {
    const context = buildActionContext(SESSION_SHAPES[3]!.input);
    expect(context.constraints.join(' ')).toContain('no code write root');
    expect(context.constraints.join(' ')).toContain('no project-scoped materialization');
  });

  it('states that visibility is not authorization, for every shape', () => {
    for (const shape of SESSION_SHAPES) {
      expect(buildActionContext(shape.input).constraints.join(' '), shape.name).toContain(
        'not authorization to write it'
      );
    }
  });

  it('never lists another member checkout of the same Store as writable', () => {
    const context = buildActionContext(SESSION_SHAPES[2]!.input);
    for (const list of [context.planningWriteRoots, context.codeWriteRoots, context.readRoots]) {
      expect(list).not.toContain(otherMember);
    }
  });

  it('never lists a home directory in any of the three lists', () => {
    const home = os.homedir();
    const context = buildActionContext({
      projectRoot: home,
      artifactIds: [],
      session: {
        planning: { type: 'project', projectId: 'p1', root: home },
        execution: { kind: 'project', projectId: 'p1', root: home },
      },
    });
    expect(context.codeWriteRoots).not.toContain(home);
    expect(context.readRoots).not.toContain(home);
    expect(context.planningWriteRoots).not.toContain(home);
  });

  // The one property that must never regress (task 7.7).
  it('projects to a SUBSET of what v1 previously granted, for every session shape', () => {
    for (const shape of SESSION_SHAPES) {
      const context = buildActionContext(shape.input);
      const priorV1Grant = [shape.input.projectRoot];
      if (context.version === 1) {
        expect(context.allowedEditRoots, shape.name).toBeDefined();
        for (const root of context.allowedEditRoots ?? []) {
          expect(
            priorV1Grant.some((granted) => isWithin(root, granted)),
            `${shape.name}: ${root} escapes what v1 granted (${priorV1Grant.join(', ')})`
          ).toBe(true);
        }
      } else {
        // Not projectable — and therefore reported under a version a v1
        // consumer does not recognize, with no root list to inherit.
        expect(context.allowedEditRoots, shape.name).toBeUndefined();
      }
    }
  });
});
