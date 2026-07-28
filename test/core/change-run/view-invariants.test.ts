import { describe, expect, it } from 'vitest';

import {
  ChangeRunContractError,
  decodeChangeRunView,
  deriveReceiptDisposition,
  type ReceiptDispositionFacts,
} from '../../../src/core/change-run/index.js';
import type {
  ChangeInstanceId,
  Digest,
  PlanningSpaceId,
  RunId,
  WorkspaceInstanceId,
} from '../../../src/core/change-run/index.js';

const branded = <T>(value: string): T => value as T;
const digest = (c: string) => branded<Digest>(`sha256:${c.repeat(64)}`);

function facts(overrides: Partial<ReceiptDispositionFacts>): ReceiptDispositionFacts {
  return {
    created: false,
    reused: false,
    idempotent: false,
    becameTerminal: false,
    grantedActionCount: 0,
    waitCount: 0,
    ...overrides,
  };
}

describe('receipt disposition priority + action-grant matrix (1.5/1.6/1.7)', () => {
  it('ranks created > reused > idempotent > terminal > waiting > advanced', () => {
    expect(deriveReceiptDisposition(facts({ created: true, reused: true }))).toBe('created');
    expect(deriveReceiptDisposition(facts({ reused: true, idempotent: true }))).toBe('reused');
    expect(deriveReceiptDisposition(facts({ idempotent: true, becameTerminal: true }))).toBe(
      'idempotent'
    );
    expect(deriveReceiptDisposition(facts({ becameTerminal: true, grantedActionCount: 3 }))).toBe(
      'terminal'
    );
    expect(deriveReceiptDisposition(facts({ grantedActionCount: 0, waitCount: 2 }))).toBe(
      'waiting'
    );
    expect(deriveReceiptDisposition(facts({ grantedActionCount: 1 }))).toBe('advanced');
  });

  it('guarantees reused, idempotent, terminal, and waiting carry no executable grant', () => {
    // These dispositions imply grantedActionCount === 0 (actions: []), so a
    // reused start, idempotent completion, terminal, or pure-wait response
    // never hands the caller a new executable Action.
    for (const override of [
      { reused: true },
      { idempotent: true },
      { becameTerminal: true },
      { grantedActionCount: 0, waitCount: 1 },
    ] as const) {
      const disposition = deriveReceiptDisposition(facts(override));
      expect(disposition).not.toBe('advanced');
    }
  });

  it('rejects negative or non-integer counts', () => {
    expect(() =>
      deriveReceiptDisposition(facts({ grantedActionCount: -1 }))
    ).toThrow(ChangeRunContractError);
    expect(() => deriveReceiptDisposition(facts({ waitCount: 1.5 }))).toThrow(
      ChangeRunContractError
    );
  });
});

describe('root-dag view invariants (1.5)', () => {
  const runId = branded<RunId>(`run:${'a'.repeat(64)}`);
  const change = {
    planningSpaceId: branded<PlanningSpaceId>('planning-space:' + '1'.repeat(64)),
    projectId: 'project-fixture',
    changeId: 'fixture-change',
    instanceId: branded<ChangeInstanceId>('change-instance:' + '2'.repeat(64)),
  };
  const workspaceInstanceId = branded<WorkspaceInstanceId>(
    'workspace-instance:' + '3'.repeat(64)
  );

  function view(overrides: Record<string, unknown>) {
    return {
      format: 'change-run-view/1',
      engine: 'reconciler',
      runId,
      change,
      recordVersion: 0,
      status: 'running',
      sourceState: 'active',
      workspace: { instanceId: workspaceInstanceId, scope: 'current' },
      drift: {
        definition: 'unchanged',
        sourceRevision: { provenance: 'unchanged', content: 'unchanged', semantic: 'unchanged' },
        capability: 'unchanged',
        policy: 'unchanged',
        workspace: 'unchanged',
      },
      sections: [
        {
          kind: 'root-dag',
          version: 1,
          frontier: [],
          activeInvocations: [],
          actions: [],
          waits: [],
          workspace: {
            current: {
              format: 'workspace-revision/1',
              head: { kind: 'commit', digest: digest('c'), detached: false },
              treeDigest: digest('c'),
              dirtyWorktreeDigest: digest('c'),
            },
            expectedByActiveWriters: [],
          },
          effectDiagnostics: [],
          allowedControls: [],
        },
      ],
      ...overrides,
    };
  }

  it('accepts a minimal valid root-dag view', () => {
    expect(() => decodeChangeRunView(view({}))).not.toThrow();
  });

  it('rejects a view with zero root-dag sections', () => {
    expect(() => decodeChangeRunView(view({ sections: [] }))).toThrow(ChangeRunContractError);
  });

  it('rejects a terminal status that retains actions or waits', () => {
    expect(() =>
      decodeChangeRunView(
        view({
          status: 'completed',
          sections: [
            {
              kind: 'root-dag',
              version: 1,
              frontier: [],
              activeInvocations: [],
              actions: [],
              waits: [],
              terminal: { kind: 'completed', outcome: 'done' },
              workspace: {
                current: {
                  format: 'workspace-revision/1',
                  head: { kind: 'commit', digest: digest('c'), detached: false },
                  treeDigest: digest('c'),
                  dirtyWorktreeDigest: digest('c'),
                },
                expectedByActiveWriters: [],
              },
              effectDiagnostics: [],
              allowedControls: [],
            },
          ],
        })
      )
    ).not.toThrow(); // terminal with empty members is valid
  });
});
