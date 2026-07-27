import { describe, expect, it } from 'vitest';

import {
  createWorkspaceReservationRegistry,
  type ReservationEntry,
} from '../../../src/core/change-run/internal/reservations.js';
import type {
  ActionId,
  AttemptId,
  Digest,
  RunId,
} from '../../../src/core/change-run/index.js';

const branded = <T>(value: string): T => value as T;
const run = (c: string) => branded<RunId>(`run:${c.repeat(60)}${c}${c}`);
const act = (c: string) => branded<ActionId>(`action:${c.repeat(58)}${c}${c}`);
const att = (c: string) => branded<AttemptId>(`attempt:${c.repeat(57)}${c}${c}${c}`);
const dig = (c: string) => branded<Digest>(`sha256:${c.repeat(64)}`);
const WS = 'workspace-instance:aaa';

function entry(
  runId: RunId,
  actionId: ActionId,
  access: 'read' | 'write',
  workspaceInstanceId = WS
): ReservationEntry {
  return {
    workspaceInstanceId,
    runId,
    actionId,
    attemptId: att('1'),
    access,
    recordDigest: dig('1'),
    recordVersion: 1,
    state: 'pending',
  };
}

describe('cross-Run workspace reservation registry (8.5/8.6)', () => {
  it('lets readers coexist across Runs', () => {
    const registry = createWorkspaceReservationRegistry();
    expect(registry.reserve(entry(run('1'), act('1'), 'read'))).toBeNull();
    expect(registry.reserve(entry(run('2'), act('2'), 'read'))).toBeNull();
    expect(registry.snapshot(WS)).toHaveLength(2);
  });

  it('excludes every other touch while a writer is held', () => {
    const registry = createWorkspaceReservationRegistry();
    expect(registry.reserve(entry(run('1'), act('1'), 'write'))).toBeNull();
    const readerConflict = registry.reserve(entry(run('2'), act('2'), 'read'));
    expect(readerConflict?.code).toBe('workspace_reservation_writer_held');
    const writerConflict = registry.reserve(entry(run('3'), act('3'), 'write'));
    expect(writerConflict?.code).toBe('workspace_reservation_writer_held');
    expect(registry.snapshot(WS)).toHaveLength(1);
  });

  it('blocks a writer while readers are held', () => {
    const registry = createWorkspaceReservationRegistry();
    registry.reserve(entry(run('1'), act('1'), 'read'));
    const conflict = registry.reserve(entry(run('2'), act('2'), 'write'));
    expect(conflict?.code).toBe('workspace_reservation_writer_blocked');
  });

  it('re-arming the same Run/Action does not self-conflict', () => {
    const registry = createWorkspaceReservationRegistry();
    const e = entry(run('1'), act('1'), 'write');
    expect(registry.reserve(e)).toBeNull();
    expect(registry.reserve(e)).toBeNull();
    expect(registry.snapshot(WS)).toHaveLength(1);
  });

  it('release frees the slot and finalize promotes pending to final', () => {
    const registry = createWorkspaceReservationRegistry();
    registry.reserve(entry(run('1'), act('1'), 'write'));
    expect(registry.isBusy(WS)).toBe(true);
    registry.finalize(run('1'), act('1'));
    expect(registry.snapshot(WS)[0]!.state).toBe('final');
    registry.release(run('1'), act('1'));
    expect(registry.isBusy(WS)).toBe(false);
    // After release a writer can be admitted again.
    expect(registry.reserve(entry(run('2'), act('2'), 'write'))).toBeNull();
  });

  it('never blocks across different WorkspaceInstanceIds', () => {
    const registry = createWorkspaceReservationRegistry();
    registry.reserve(entry(run('1'), act('1'), 'write', 'workspace-instance:bbb'));
    expect(registry.isBusy(WS)).toBe(false);
    expect(registry.reserve(entry(run('2'), act('2'), 'write', WS))).toBeNull();
  });
});
