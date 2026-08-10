import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  applyReservationDelta,
  classifyReservationDelta,
  createFilesystemWorkspaceReservationRegistry,
  createWorkspaceReservationRegistry,
  type ReservationEntry,
  workspaceReservationStatePath,
} from '../../../src/core/change-run/internal/reservations.js';
import type {
  ActionId,
  AttemptId,
  Digest,
  RunId,
} from '../../../src/core/change-run/index.js';
import { createFilesystemRunStore } from '../../../src/core/change-run/internal/run-store-fs.js';
import { buildActiveTeacherConsultationFixture } from './consultation-fixture.js';

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
    expect(readerConflict?.code).toBe('workspace-reservation-writer-held');
    const writerConflict = registry.reserve(entry(run('3'), act('3'), 'write'));
    expect(writerConflict?.code).toBe('workspace-reservation-writer-held');
    expect(registry.snapshot(WS)).toHaveLength(1);
  });

  it('blocks a writer while readers are held', () => {
    const registry = createWorkspaceReservationRegistry();
    registry.reserve(entry(run('1'), act('1'), 'read'));
    const conflict = registry.reserve(entry(run('2'), act('2'), 'write'));
    expect(conflict?.code).toBe('workspace-reservation-writer-blocked');
  });

  it('re-arming the same Run/Action does not self-conflict', () => {
    const registry = createWorkspaceReservationRegistry();
    const e = entry(run('1'), act('1'), 'write');
    expect(registry.reserve(e)).toBeNull();
    expect(registry.reserve(e)).toBeNull();
    expect(registry.snapshot(WS)).toHaveLength(1);
  });

  it('admits only the exact canonically paused consultation-sponsored reader', () => {
    const registry = createWorkspaceReservationRegistry();
    const sourceRun = run('1');
    const sourceAction = act('1');
    registry.reserve(entry(sourceRun, sourceAction, 'write'));
    const teacher = entry(sourceRun, act('2'), 'read');
    expect(
      registry.reserveConsultationRead(teacher as never, {
        runId: sourceRun,
        actionId: sourceAction,
        consultationId: `consultation:${'a'.repeat(64)}`,
        canonicallyPaused: true,
      })
    ).toBeNull();
    expect(registry.snapshot(WS)).toHaveLength(2);
    expect(
      registry.reserveConsultationRead(entry(sourceRun, act('3'), 'read') as never, {
        runId: sourceRun,
        actionId: act('9'),
        consultationId: `consultation:${'b'.repeat(64)}`,
        canonicallyPaused: true,
      })?.code
    ).toBe('workspace-reservation-sponsor-mismatch');
    expect(registry.reserve(entry(run('3'), act('4'), 'read'))?.code).toBe(
      'workspace-reservation-writer-held'
    );
    expect(
      registry.reserveConsultationRead(teacher as never, {
        runId: sourceRun,
        actionId: sourceAction,
        consultationId: `consultation:${'c'.repeat(64)}`,
        canonicallyPaused: true,
      })?.code
    ).toBe('workspace-reservation-sponsor-mismatch');
  });

  it('releasing a source writer removes its sponsored readers before the sponsor', () => {
    const registry = createWorkspaceReservationRegistry();
    const sourceRun = run('1');
    const sourceAction = act('1');
    registry.reserve(entry(sourceRun, sourceAction, 'write'));
    registry.reserveConsultationRead(
      entry(sourceRun, act('2'), 'read') as never,
      {
        runId: sourceRun,
        actionId: sourceAction,
        consultationId: `consultation:${'a'.repeat(64)}`,
        canonicallyPaused: true,
      }
    );
    registry.release(sourceRun, sourceAction);
    expect(registry.snapshot(WS)).toEqual([]);
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

describe('reservation-delta transaction recovery (8.7/8.8)', () => {
  const predecessor = dig('p');
  const committed = dig('c');
  const WS2 = 'workspace-instance:bbb';
  const closing = [entry(run('1'), act('1'), 'write', WS)];
  const pending = [entry(run('2'), act('2'), 'write', WS2)];

  it('finalizes new and deletes old when the committed Record is durable', () => {
    const decision = classifyReservationDelta({
      predecessorDigest: predecessor,
      committedDigest: committed,
      recordExists: (d) => d === predecessor || d === committed,
    });
    expect(decision).toBe('finalize-new-delete-old');
    const registry = createWorkspaceReservationRegistry();
    registry.reserve(closing[0]!);
    registry.reserve(pending[0]!);
    applyReservationDelta(registry, decision, { closing, pending });
    // Old released; new finalized.
    expect(registry.snapshot(WS).find((e) => e.actionId === act('1'))).toBeUndefined();
    expect(registry.snapshot(WS2).find((e) => e.actionId === act('2'))?.state).toBe('final');
  });

  it('discards new and keeps old when only the unchanged predecessor is durable', () => {
    const decision = classifyReservationDelta({
      predecessorDigest: predecessor,
      committedDigest: committed,
      recordExists: (d) => d === predecessor,
    });
    expect(decision).toBe('discard-new-keep-old');
    const registry = createWorkspaceReservationRegistry();
    registry.reserve(closing[0]!);
    registry.reserve(pending[0]!);
    applyReservationDelta(registry, decision, { closing, pending });
    expect(registry.snapshot(WS).find((e) => e.actionId === act('1'))?.state).toBe('pending');
    expect(registry.snapshot(WS2).find((e) => e.actionId === act('2'))).toBeUndefined();
  });

  it('reports busy/corrupt for an advanced head or missing state, never speculatively cleaning', () => {
    expect(
      classifyReservationDelta({
        predecessorDigest: predecessor,
        committedDigest: committed,
        recordExists: () => false,
      })
    ).toBe('busy');
    expect(
      classifyReservationDelta({
        predecessorDigest: predecessor,
        committedDigest: committed,
        recordExists: (d) => d === committed,
      })
    ).toBe('corrupt');
  });
});

describe('durable cross-process workspace reservations', () => {
  it('recovers a lock only after its owner process is provably dead', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-reservation-dead-lock-'));
    try {
      const storeRoot = path.join(root, 'runs');
      const statePath = workspaceReservationStatePath(storeRoot);
      const lockPath = path.join(path.dirname(statePath), 'state.lock');
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      const exited = spawnSync(
        process.execPath,
        ['-e', 'process.stdout.write(String(process.pid))'],
        { encoding: 'utf8', windowsHide: true }
      );
      expect(exited.status, exited.stderr).toBe(0);
      const deadPid = Number(exited.stdout);
      expect(Number.isSafeInteger(deadPid) && deadPid > 0).toBe(true);
      fs.writeFileSync(
        lockPath,
        JSON.stringify({
          pid: deadPid,
          token: 'a'.repeat(64),
          acquiredAtMs: Date.now(),
        }),
        'utf8'
      );

      const registry = createFilesystemWorkspaceReservationRegistry({
        storeRoot,
        loadRecords: () => [],
      });
      expect(registry.snapshot(WS)).toEqual([]);
      expect(fs.existsSync(lockPath)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not rehydrate an explicit release before the canonical head changes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-reservation-release-'));
    try {
      const fixture = buildActiveTeacherConsultationFixture();
      const registry = createFilesystemWorkspaceReservationRegistry({
        storeRoot: path.join(root, 'runs'),
        loadRecords: () => [fixture.record],
      });
      expect(registry.snapshot(fixture.record.workspaceInstanceId)).toHaveLength(2);
      registry.release(fixture.record.runId, fixture.sourceAction.actionId);
      expect(registry.snapshot(fixture.record.workspaceInstanceId)).toEqual([]);
      expect(registry.snapshot(fixture.record.workspaceInstanceId)).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('drops stale final reservations when restart finds no active canonical head', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-reservation-stale-'));
    try {
      const fixture = buildActiveTeacherConsultationFixture();
      let canonical = [fixture.record];
      const storeRoot = path.join(root, 'runs');
      const first = createFilesystemWorkspaceReservationRegistry({
        storeRoot,
        loadRecords: () => canonical,
      });
      expect(first.snapshot(fixture.record.workspaceInstanceId)).toHaveLength(2);

      canonical = [];
      const restarted = createFilesystemWorkspaceReservationRegistry({
        storeRoot,
        loadRecords: () => canonical,
      });
      expect(restarted.snapshot(fixture.record.workspaceInstanceId)).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('hydrates a paused writer plus sponsored Teacher after restart and blocks a second Run', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-reservation-process-'));
    try {
      const storeRoot = path.join(root, 'runs');
      const fixture = buildActiveTeacherConsultationFixture();
      const store = createFilesystemRunStore(storeRoot);
      store.create(fixture.record.runId, fixture.record);
      const registry = createFilesystemWorkspaceReservationRegistry({
        storeRoot,
        loadRecords: () => store.list().map((summary) => store.load(summary.runId)),
      });
      const hydrated = registry.snapshot(fixture.record.workspaceInstanceId);
      expect(hydrated).toHaveLength(2);
      expect(hydrated).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actionId: fixture.sourceAction.actionId,
            access: 'write',
            state: 'final',
          }),
          expect.objectContaining({
            actionId: fixture.teacherAction.actionId,
            access: 'read',
            state: 'final',
            consultationSponsor: expect.objectContaining({
              actionId: fixture.sourceAction.actionId,
              consultationId: fixture.consultationId,
            }),
          }),
        ])
      );

      const child = spawnSync(
        process.execPath,
        [path.join(process.cwd(), 'test', 'fixtures', 'change-run', 'reservation-process.mjs')],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            RASEN_RESERVATION_MODULE: pathToFileURL(
              path.join(process.cwd(), 'dist', 'core', 'change-run', 'internal', 'reservations.js')
            ).href,
            RASEN_RUN_STORE_MODULE: pathToFileURL(
              path.join(process.cwd(), 'dist', 'core', 'change-run', 'internal', 'run-store-fs.js')
            ).href,
            RASEN_RESERVATION_STORE_ROOT: storeRoot,
            RASEN_RESERVATION_WORKSPACE: fixture.record.workspaceInstanceId,
          },
          encoding: 'utf8',
          windowsHide: true,
        }
      );
      expect(child.status, child.stderr).toBe(0);
      const result = JSON.parse(child.stdout) as {
        count: number;
        sponsored: number;
        readerConflict?: string;
        writerConflict?: string;
      };
      expect(result).toEqual({
        count: 2,
        sponsored: 1,
        readerConflict: 'workspace-reservation-writer-held',
        writerConflict: 'workspace-reservation-writer-held',
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
