import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildActionContext } from '../../src/core/change-status-policy.js';

describe('store v2 action context planning grant', () => {
  const storeRoot = '/test/store';
  const projectId = 'api-server';
  const projectRoot = '/test/project';

  it('grants the project partition for a Store v2 project scope session', () => {
    const ctx = buildActionContext({
      projectRoot,
      artifactIds: [],
      session: {
        planning: {
          type: 'store',
          root: storeRoot,
          id: 'team-plans',
          projectId,
        },
        execution: {
          kind: 'project',
          projectId,
          root: projectRoot,
        },
      },
    });

    // The grant MUST include the project partition's planning locations.
    expect(ctx.planningWriteRoots).toContain(
      path.join(storeRoot, 'rasen', 'projects', projectId, 'specs')
    );
    expect(ctx.planningWriteRoots).toContain(
      path.join(storeRoot, 'rasen', 'projects', projectId, 'changes')
    );

    // The grant MUST NOT include the root-level Store planning paths layout v2
    // forbids.
    expect(ctx.planningWriteRoots).not.toContain(
      path.join(storeRoot, 'rasen', 'specs')
    );
    expect(ctx.planningWriteRoots).not.toContain(
      path.join(storeRoot, 'rasen', 'changes')
    );
  });

  it('keeps standalone grants unchanged (no session)', () => {
    const ctx = buildActionContext({
      projectRoot,
      artifactIds: [],
    });

    // Standalone: the grant is the in-project planning directories.
    expect(ctx.planningWriteRoots).toContain(
      path.join(projectRoot, 'rasen', 'specs')
    );
    expect(ctx.planningWriteRoots).toContain(
      path.join(projectRoot, 'rasen', 'changes')
    );
    // No project partition in standalone.
    expect(ctx.planningWriteRoots).not.toContain(
      path.join(projectRoot, 'rasen', 'projects')
    );
  });

  it('keeps a project-type session grant unchanged (not a Store)', () => {
    const ctx = buildActionContext({
      projectRoot,
      artifactIds: [],
      session: {
        planning: {
          type: 'project',
          root: projectRoot,
          projectId: 'my-project',
        },
        execution: {
          kind: 'project',
          projectId: 'my-project',
          root: projectRoot,
        },
      },
    });

    // A project-type session uses the standard planning directories.
    expect(ctx.planningWriteRoots).toContain(
      path.join(projectRoot, 'rasen', 'specs')
    );
    expect(ctx.planningWriteRoots).toContain(
      path.join(projectRoot, 'rasen', 'changes')
    );
  });

  it('falls back to root-level paths for a Store session without projectId', () => {
    // A store-aggregate session has no project scope; the planning write roots
    // are the legacy root-level paths (same as pre-change behavior).
    const ctx = buildActionContext({
      projectRoot,
      artifactIds: [],
      session: {
        planning: {
          type: 'store',
          root: storeRoot,
          id: 'team-plans',
          // No projectId — this is a store aggregate.
        },
        execution: {
          kind: 'planning-only',
        },
      },
    });

    expect(ctx.planningWriteRoots).toContain(
      path.join(storeRoot, 'rasen', 'specs')
    );
    expect(ctx.planningWriteRoots).toContain(
      path.join(storeRoot, 'rasen', 'changes')
    );
  });
});
